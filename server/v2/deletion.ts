import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';
import { hasDirectCompletedOwnerUpgrade } from './merge.js';
import { assertRecentAuthenticationInTransaction, revokeOwnerSessionsInTransaction, type AccessPrincipal } from './sessions.js';

export type DeletionRequest = { eventId: string; kind: 'account'; ownerId: string; requestedAt: string } |
  { eventId: string; kind: 'project'; ownerId: string; projectId: string; requestedAt: string };
type JournalPolicy = { trustedOutsideRestoreSet: true; maxBackupAgeMs: number; retentionMs: number };
type JournalRow = { type: 'request'; request: DeletionRequest } | { type: 'complete'; eventId: string; completedAt: string };
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(Date.parse(v)).toISOString() === v;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const opaqueLegacyOwner = (cookie: string) => `legacy-owner-${hash(`form:v2:legacy-owner\0${cookie}`).slice(0, 24)}`;
const legacyProject = (owner: string, project: string) => `legacy-project-${hash(`${owner}:${project}`).slice(0, 24)}`;
const legacyTask = (owner: string, project: string, task: string) => `legacy-task-${hash(`${owner}:${legacyProject(owner, project)}\0${task}`).slice(0, 24)}`;
class DeletionError extends Error { constructor(readonly code: string) { super(code); this.name = 'DeletionError'; } }
function fail(code: string): never { throw new DeletionError(code); }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}

function checkedFile(path: string) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('DELETION_JOURNAL_PATH_INVALID');
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  const components = relative(root, absolute).split(sep).filter(Boolean);
  for (let i = 0; i < components.length; i++) {
    current = join(current, components[i]!);
    let stat;
    try { stat = lstatSync(current); } catch { fail('DELETION_JOURNAL_UNAVAILABLE'); }
    if (stat.isSymbolicLink() || (i === components.length - 1 ? !stat.isFile() : !stat.isDirectory())) fail('DELETION_JOURNAL_UNSAFE');
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile()) fail('DELETION_JOURNAL_UNSAFE');
  return { path: absolute, stat };
}

function readJournal(path: string): JournalRow[] {
  const checked = checkedFile(path);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags);
  let content: string;
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== checked.stat.dev || opened.ino !== checked.stat.ino || opened.size > MAX_JOURNAL_BYTES) fail('DELETION_JOURNAL_UNSAFE');
    content = readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
  if (content && !content.endsWith('\n')) fail('DELETION_JOURNAL_MALFORMED');
  const rows: JournalRow[] = [], requests = new Map<string, DeletionRequest>(), completed = new Set<string>();
  for (const line of content.split('\n').filter(Boolean)) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { fail('DELETION_JOURNAL_MALFORMED'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('DELETION_JOURNAL_MALFORMED');
    const item = parsed as Record<string, unknown>;
    if (exact(item, ['type','request']) && item.type === 'request') {
      const request = item.request as Record<string, unknown>;
      const valid = request && request.kind === 'account' && exact(request, ['eventId','kind','ownerId','requestedAt']) && validId(request.eventId) && validId(request.ownerId) && iso(request.requestedAt) ? request as unknown as DeletionRequest :
        request && request.kind === 'project' && exact(request, ['eventId','kind','ownerId','projectId','requestedAt']) && validId(request.eventId) && validId(request.ownerId) && validId(request.projectId) && iso(request.requestedAt) ? request as unknown as DeletionRequest : null;
      if (!valid || JSON.stringify({ type: 'request', request: valid }) !== line) fail('DELETION_JOURNAL_MALFORMED');
      const previous = requests.get(valid.eventId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(valid)) fail('DELETION_JOURNAL_CONFLICT');
      requests.set(valid.eventId, valid); rows.push({ type: 'request', request: valid });
    } else if (exact(item, ['type','eventId','completedAt']) && item.type === 'complete' && validId(item.eventId) && iso(item.completedAt)) {
      if (!requests.has(item.eventId) || completed.has(item.eventId) || JSON.stringify({ type: 'complete', eventId: item.eventId, completedAt: item.completedAt }) !== line) fail('DELETION_JOURNAL_MALFORMED');
      completed.add(item.eventId); rows.push(item as JournalRow);
    } else fail('DELETION_JOURNAL_MALFORMED');
  }
  return rows;
}

function writeAll(fd: number, bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset, null);
    if (!Number.isSafeInteger(written) || written <= 0) fail('DELETION_JOURNAL_WRITE_FAILED');
    offset += written;
  }
}

function durableAppend(path: string, row: JournalRow) {
  const checked = checkedFile(path), flags = constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== checked.stat.dev || opened.ino !== checked.stat.ino) fail('DELETION_JOURNAL_UNSAFE');
    const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
    if (opened.size + bytes.length > MAX_JOURNAL_BYTES) fail('DELETION_JOURNAL_FULL');
    writeAll(fd, bytes);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function durableReplace(path: string, content: string) {
  const checked = checkedFile(path), temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(temporary, flags, 0o600);
  try { writeAll(fd, Buffer.from(content)); fsyncSync(fd); } catch (error) { closeSync(fd); unlinkSync(temporary); throw error; }
  closeSync(fd);
  const current = checkedFile(path);
  if (current.stat.dev !== checked.stat.dev || current.stat.ino !== checked.stat.ino) { unlinkSync(temporary); fail('DELETION_JOURNAL_UNSAFE'); }
  try { renameSync(temporary, path); const dir = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); } }
  catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
}

export function createDeletionJournal(options: { path: string; policy?: JournalPolicy }) {
  const policy = options.policy;
  if (!policy || policy.trustedOutsideRestoreSet !== true || !Number.isSafeInteger(policy.maxBackupAgeMs) || policy.maxBackupAgeMs <= 0 || !Number.isSafeInteger(policy.retentionMs) || policy.retentionMs < policy.maxBackupAgeMs) fail('DELETION_RETENTION_POLICY_UNAVAILABLE');
  const retentionMs = policy.retentionMs;
  const path = checkedFile(options.path).path;
  const rows = () => readJournal(path);
  rows();
  function appendRequest(request: DeletionRequest) {
    if (!request || !validId(request.eventId) || !validId(request.ownerId) || !iso(request.requestedAt) || request.kind === 'project' && !validId(request.projectId) || request.kind !== 'account' && request.kind !== 'project') fail('DELETION_REQUEST_INVALID');
    const existing = rows().find(row => row.type === 'request' && row.request.eventId === request.eventId) as Extract<JournalRow,{type:'request'}>|undefined;
    if (existing) { if (JSON.stringify(existing.request) !== JSON.stringify(request)) fail('DELETION_JOURNAL_CONFLICT'); return; }
    durableAppend(path, { type: 'request', request });
  }
  function complete(eventId: string, completedAt: string) {
    if (!validId(eventId) || !iso(completedAt)) fail('DELETION_REQUEST_INVALID');
    const all = rows();
    if (!all.some(row => row.type === 'request' && row.request.eventId === eventId)) fail('DELETION_JOURNAL_MALFORMED');
    if (all.some(row => row.type === 'complete' && row.eventId === eventId)) return;
    durableAppend(path, { type: 'complete', eventId, completedAt });
  }
  function requests() {
    const all = rows(), done = new Map(all.filter((row): row is Extract<JournalRow,{type:'complete'}> => row.type === 'complete').map(row => [row.eventId, row.completedAt]));
    return all.filter((row): row is Extract<JournalRow,{type:'request'}> => row.type === 'request').map(({ request }) => done.has(request.eventId) ? { ...request, completedAt: done.get(request.eventId)! } : { ...request });
  }
  function prune(now: string) {
    if (!iso(now)) fail('DELETION_CLOCK_INVALID');
    const all = rows(), done = new Map(all.filter((row): row is Extract<JournalRow,{type:'complete'}> => row.type === 'complete').map(row => [row.eventId, row.completedAt]));
    const expired = new Set([...done].filter(([, time]) => Date.parse(now) - Date.parse(time) >= retentionMs).map(([id]) => id));
    if (!expired.size) return 0;
    const keep = all.filter(row => row.type === 'request' ? !expired.has(row.request.eventId) : !expired.has(row.eventId));
    durableReplace(path, keep.map(row => JSON.stringify(row)).join('\n') + (keep.length ? '\n' : ''));
    return expired.size;
  }
  return Object.freeze({ appendRequest, complete, requests, pending: () => requests().filter(row => !('completedAt' in row)), prune });
}

export type DeletionJournal = ReturnType<typeof createDeletionJournal>;
export type DeletionResult = { eventId: string; status: 'pending_policy'; detail: 'finance_retention_unknown' | 'cleanup_pending' };
function canonicalNow(clock: () => Date) { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('DELETION_CLOCK_INVALID'); return value.toISOString(); }
function assertPrincipal(tx: WalletTransaction, p: AccessPrincipal, now: string) {
  if (!validId(p.ownerId) || !validId(p.sessionId) || !validId(p.familyId)) fail('AUTH_REQUIRED');
  const row = tx.get<{ revoked_at: string | null; family_revoked: string | null; deleted_at: string | null; expires_at: string | null }>(`SELECT s.revoked_at,f.revoked_at AS family_revoked,u.deleted_at,s.expires_at FROM v2_sessions s
    JOIN session_families f ON f.owner_id=s.owner_id AND f.id=s.family_id JOIN users u ON u.id=s.owner_id WHERE s.id=? AND s.owner_id=? AND s.family_id=? AND s.token_kind='access'`, p.sessionId, p.ownerId, p.familyId);
  if (!row || row.revoked_at || row.family_revoked || row.deleted_at || !row.expires_at || Date.parse(row.expires_at) <= Date.parse(now)) fail('AUTH_REQUIRED');
}
function hasTable(db: DatabaseSync, name: string) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }

function scrubLegacy(db: DatabaseSync, ownerId: string, projectIds: string[], accountScope = false) {
  const owners = db.prepare("SELECT id FROM users WHERE id=? UNION SELECT source_owner_id AS id FROM owner_upgrades WHERE target_owner_id=? AND status='completed' AND completed_at IS NOT NULL").all(ownerId, ownerId) as { id: string }[];
  const scopes = new Map<string, Set<string>>(owners.map(row => [row.id, new Set(projectIds)]));
  for (const source of owners) if (source.id !== ownerId && !hasDirectCompletedOwnerUpgrade(db, source.id, ownerId)) scopes.delete(source.id);
  if (hasTable(db, 'images')) {
    const assets = db.prepare(`SELECT id,project_id,storage_key FROM assets WHERE owner_id=?${projectIds.length ? ` AND project_id IN (${projectIds.map(() => '?').join(',')})` : ''}`)
      .all(ownerId, ...projectIds) as { id: string; project_id: string; storage_key: string }[];
    const seen = new Set<string>();
    for (const asset of assets) {
      const match = /^legacy:\/\/(legacy-owner-[a-f0-9]{24})\/([A-Za-z0-9_-]{1,128})$/.exec(asset.storage_key);
      const sourceOwner = match?.[1], imageId = match?.[2];
      if (!sourceOwner || !imageId || seen.has(imageId) || !scopes.has(sourceOwner)) continue;
      const image = db.prepare('SELECT id,owner,project_id FROM images WHERE id=?').get(imageId) as { id: string; owner: string; project_id: string } | undefined;
      if (!image || !validId(image.owner) || opaqueLegacyOwner(image.owner) !== sourceOwner || legacyProject(sourceOwner, image.project_id) !== asset.project_id) continue;
      const identity = db.prepare("SELECT user_id FROM identities WHERE provider='legacy_cookie' AND subject=?").get(hash(image.owner)) as { user_id: string } | undefined;
      if (!identity || identity.user_id !== sourceOwner) continue;
      db.prepare('DELETE FROM images WHERE id=? AND owner=? AND project_id=?').run(image.id, image.owner, image.project_id);
      seen.add(image.id);
    }
  }
  if (hasTable(db, 'sessions')) scrubLegacySessions(db, ownerId, projectIds, scopes, accountScope);
}

function scrubLegacySessions(db: DatabaseSync, ownerId: string, projectIds: string[], scopes: Map<string, Set<string>>, accountScope: boolean) {
  const rows = db.prepare('SELECT id,state FROM sessions').all() as { id: string; state: string }[];
  const update = db.prepare('UPDATE sessions SET state=? WHERE id=?');
  for (const row of rows) {
    if (typeof row.id !== 'string' || !validId(row.id)) continue;
    const sourceOwner = opaqueLegacyOwner(row.id), scope = scopes.get(sourceOwner);
    if (!scope) continue;
    const identity = db.prepare("SELECT 1 FROM identities WHERE user_id=? AND provider='legacy_cookie' AND subject=?").get(sourceOwner, hash(row.id));
    if (!identity || sourceOwner !== ownerId && !hasDirectCompletedOwnerUpgrade(db, sourceOwner, ownerId)) continue;
    let state: unknown;
    try { state = JSON.parse(row.state); } catch { fail('LEGACY_SESSION_MALFORMED'); }
    if (!state || typeof state !== 'object' || Array.isArray(state)) fail('LEGACY_SESSION_MALFORMED');
    const value = state as Record<string, unknown>;
    if (!Array.isArray(value.projects) || !Array.isArray(value.tasks)) fail('LEGACY_SESSION_MALFORMED');
    const projectIdsForSession = new Set<string>();
    for (const project of value.projects) {
      if (!project || typeof project !== 'object' || Array.isArray(project)) continue;
      const id = (project as Record<string, unknown>).id;
      if (typeof id === 'string' && projectIds.includes(legacyProject(sourceOwner, id))) projectIdsForSession.add(id);
    }
    const deletedTaskIds = new Set<string>();
    for (const task of value.tasks) {
      if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
      const item = task as Record<string, unknown>;
      if (typeof item.id === 'string' && typeof item.projectId === 'string' && (accountScope || projectIdsForSession.has(item.projectId))) deletedTaskIds.add(legacyTask(sourceOwner, item.projectId, item.id));
    }
    if (accountScope) {
      value.projects = [];
      value.tasks = [];
      value.savedStyles = [];
    } else if (projectIdsForSession.size) {
      value.projects = (value.projects as unknown[]).filter(project => !project || typeof project !== 'object' || !projectIdsForSession.has(String((project as Record<string, unknown>).id)));
      value.tasks = (value.tasks as unknown[]).filter(task => !task || typeof task !== 'object' || !projectIdsForSession.has(String((task as Record<string, unknown>).projectId)));
    }
    if (accountScope || projectIdsForSession.size) update.run(JSON.stringify(value), row.id);
    if (deletedTaskIds.size && hasTable(db, 'reports')) {
      const reports = db.prepare('SELECT rowid,task_id FROM reports WHERE owner=?').all(row.id) as { rowid: number; task_id: string }[];
      const scrub = db.prepare("UPDATE reports SET reason='' WHERE rowid=?");
      for (const report of reports) if (deletedTaskIds.has(report.task_id)) scrub.run(report.rowid);
    }
  }
}

function tombstoneDeletion(tx: WalletTransaction, request: DeletionRequest, now: string) {
  if (!tx.get('SELECT 1 FROM users WHERE id=?', request.ownerId)) return false;
  if (request.kind === 'account') {
    tx.run('UPDATE users SET deleted_at=COALESCE(deleted_at,?) WHERE id=?', now, request.ownerId);
    tx.run('UPDATE projects SET deleted_at=COALESCE(deleted_at,?),name=NULL,cover_version_id=NULL,original_asset_id=NULL WHERE owner_id=?', now, request.ownerId);
    revokeOwnerSessionsInTransaction(tx, request.ownerId, now);
    if (tx.get("SELECT 1 FROM pragma_table_info('consents') WHERE name='revoked_at'")) tx.run('UPDATE consents SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=?', now, request.ownerId);
  } else {
    const project = tx.get('SELECT 1 FROM projects WHERE id=? AND owner_id=?', request.projectId, request.ownerId);
    if (!project) return false;
    tx.run('UPDATE projects SET deleted_at=COALESCE(deleted_at,?),name=NULL,cover_version_id=NULL,original_asset_id=NULL WHERE id=? AND owner_id=?', now, request.projectId, request.ownerId);
  }
  tx.run("INSERT OR IGNORE INTO deletion_jobs(id,owner_id,status,created_at) VALUES (?,?,'queued',?)", request.eventId, request.ownerId, now);
  tx.run("UPDATE deletion_jobs SET status='running' WHERE id=? AND owner_id=? AND status<>'succeeded'", request.eventId, request.ownerId);
  return true;
}

function recordCleanupState(tx: WalletTransaction, request: DeletionRequest, now: string, failed: boolean) {
  const details = JSON.stringify({ eventId: request.eventId, lastError: failed ? 'CLEANUP_FAILED' : null,
    retry: { mode: failed ? 'operator_required' : 'awaiting_policy', nextAttemptAt: null } });
  tx.run('UPDATE deletion_jobs SET status=? WHERE id=? AND owner_id=?', failed ? 'failed' : 'running', request.eventId, request.ownerId);
  tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,?,?,?)',
    randomUUID(), request.ownerId, 'deletion_cleanup_status', details, now);
}

function cleanupDeletion(tx: WalletTransaction, db: DatabaseSync, request: DeletionRequest, now: string, repo: WalletRepository) {
  if (request.kind === 'account' && !tx.get('SELECT 1 FROM users WHERE id=? AND deleted_at IS NOT NULL', request.ownerId)) return false;
  const projects = request.kind === 'account'
    ? tx.all<{ id: string }>('SELECT id FROM projects WHERE owner_id=? AND deleted_at IS NOT NULL', request.ownerId).map(row => row.id)
    : tx.all<{ id: string }>('SELECT id FROM projects WHERE owner_id=? AND id=? AND deleted_at IS NOT NULL', request.ownerId, request.projectId).map(row => row.id);
  const placeholders = projects.map(() => '?').join(',');
  if (projects.length) {
    const tasks = tx.all<{ id: string }>(`SELECT id FROM tasks WHERE owner_id=? AND project_id IN (${placeholders}) AND status='queued'`, request.ownerId, ...projects);
    for (const task of tasks) {
      repo.finalizeTaskInTransaction(tx, { ownerId: request.ownerId, taskId: task.id, outcome: 'cancelled' });
      const attempt = tx.get('SELECT 1 FROM supplier_attempts WHERE owner_id=? AND task_id=?', request.ownerId, task.id);
      const exposure = tx.get<{ status: string }>('SELECT status FROM supplier_exposures WHERE owner_id=? AND task_id=?', request.ownerId, task.id);
      if (!attempt && exposure?.status === 'reserved') tx.run("UPDATE supplier_exposures SET status='released',updated_at=? WHERE owner_id=? AND task_id=? AND status='reserved'", now, request.ownerId, task.id);
    }
    const taskFilter = `owner_id=? AND project_id IN (${placeholders})`;
    tx.run(`UPDATE feedback SET body=NULL WHERE task_id IN (SELECT id FROM tasks WHERE ${taskFilter})`, request.ownerId, ...projects);
    tx.run(`UPDATE tasks SET request_snapshot_json=NULL,result_version_id=NULL WHERE ${taskFilter}`, request.ownerId, ...projects);
    tx.run(`UPDATE plans SET source_asset_id=NULL,snapshot_json='{}' WHERE owner_id=? AND project_id IN (${placeholders})`, request.ownerId, ...projects);
    tx.run(`DELETE FROM drafts WHERE owner_id=? AND project_id IN (${placeholders})`, request.ownerId, ...projects);
    tx.run(`UPDATE versions SET parent_version_id=NULL,master_asset_id=NULL,display_asset_id=NULL,recipe_json=NULL,name=NULL,favorite=0 WHERE owner_id=? AND project_id IN (${placeholders})`, request.ownerId, ...projects);
  }
  scrubLegacy(db, request.ownerId, projects, request.kind === 'account');
  if (projects.length) {
    const placeholders = projects.map(() => '?').join(',');
    tx.run(`DELETE FROM assets WHERE owner_id=? AND project_id IN (${placeholders})`, request.ownerId, ...projects);
    tx.run(`DELETE FROM versions WHERE owner_id=? AND project_id IN (${placeholders})`, request.ownerId, ...projects);
  }
  if (request.kind === 'account' && hasTable(db, 'reports')) {
    const reports = db.prepare('SELECT rowid,owner FROM reports').all() as { rowid: number; owner: string }[];
    const reportOwners = db.prepare("SELECT id FROM users WHERE id=? UNION SELECT source_owner_id AS id FROM owner_upgrades WHERE target_owner_id=? AND status='completed' AND completed_at IS NOT NULL").all(request.ownerId, request.ownerId) as { id: string }[];
    const subjects = new Set(reportOwners.filter(row => row.id === request.ownerId || hasDirectCompletedOwnerUpgrade(db, row.id, request.ownerId)).map(row => row.id));
    const scrub = db.prepare("UPDATE reports SET reason='' WHERE rowid=?");
    for (const report of reports) if (typeof report.owner === 'string') {
      const source = opaqueLegacyOwner(report.owner);
      if (subjects.has(source) && db.prepare("SELECT 1 FROM identities WHERE user_id=? AND provider='legacy_cookie' AND subject=?").get(source, hash(report.owner))) scrub.run(report.rowid);
    }
  }
  recordCleanupState(tx, request, now, false);
  return true;
}

function finishCleanup(db: DatabaseSync, journal: DeletionJournal, repo: WalletRepository, request: DeletionRequest, now: string) {
  try {
    if (!repo.transaction(tx => cleanupDeletion(tx, db, request, now, repo))) return false;
    journal.complete(request.eventId, now);
    return true;
  } catch (error) {
    repo.transaction(tx => recordCleanupState(tx, request, now, true));
    throw error;
  }
}

function resumeDeletion(db: DatabaseSync, journal: DeletionJournal, repo: WalletRepository, request: DeletionRequest, now: string) {
  if (!repo.transaction(tx => tombstoneDeletion(tx, request, now))) return false;
  return finishCleanup(db, journal, repo, request, now);
}

export function replayDeletionTombstones(db: DatabaseSync, journal: DeletionJournal, clock: () => Date = () => new Date()) {
  const repo = new WalletRepository(db), replayed: string[] = [];
  for (const entry of journal.requests()) {
    const { completedAt: _completedAt, ...request } = entry as DeletionRequest & { completedAt?: string };
    const now = canonicalNow(clock);
    if (!resumeDeletion(db, journal, repo, request, now)) continue;
    replayed.push(request.eventId);
  }
  return { replayed, status: replayed.length ? 'pending_policy' as const : 'clear' as const };
}

export function createDeletionService(options: { db: DatabaseSync; journal: DeletionJournal; clock?: () => Date }) {
  const { db, journal } = options, clock = options.clock ?? (() => new Date()), repo = new WalletRepository(db);
  function submit(principal: AccessPrincipal, request: DeletionRequest) {
    const now = canonicalNow(clock);
    repo.transaction(tx => {
      assertPrincipal(tx, principal, now);
      if (request.ownerId !== principal.ownerId) fail('AUTH_REQUIRED');
      if (request.kind === 'account') assertRecentAuthenticationInTransaction(tx, principal.ownerId, principal.familyId, now);
      else {
        const project = tx.get('SELECT 1 FROM projects WHERE owner_id=? AND id=?', principal.ownerId, request.projectId);
        if (!project) fail('PROJECT_NOT_FOUND');
      }
      journal.appendRequest(request);
      if (!tombstoneDeletion(tx, request, now)) fail('DELETION_TARGET_NOT_FOUND');
    });
    try {
      if (!finishCleanup(db, journal, repo, request, now)) fail('DELETION_TARGET_NOT_FOUND');
      return { eventId: request.eventId, status: 'pending_policy' as const, detail: 'finance_retention_unknown' as const };
    } catch {
      return { eventId: request.eventId, status: 'pending_policy' as const, detail: 'cleanup_pending' as const };
    }
  }
  function event(kind: DeletionRequest['kind'], ownerId: string, requestedAt: string, projectId?: string): DeletionRequest {
    const eventId = `${kind === 'account' ? 'acct' : 'proj'}-${hash(`${kind}\0${ownerId}\0${projectId ?? ''}`).slice(0, 32)}`;
    const previous = journal.requests().find(row => row.eventId === eventId);
    if (previous) {
      const { completedAt: _completedAt, ...request } = previous as DeletionRequest & { completedAt?: string };
      return request;
    }
    return kind === 'account' ? { eventId, kind, ownerId, requestedAt } : { eventId, kind, ownerId, projectId: projectId!, requestedAt };
  }
  function status(ownerId: string, eventId: string) {
    if (!validId(ownerId) || !validId(eventId)) return null;
    const job = db.prepare('SELECT id FROM deletion_jobs WHERE id=? AND owner_id=?').get(eventId, ownerId);
    const request = journal.requests().find(row => row.eventId === eventId && row.ownerId === ownerId);
    if (!job || !request) return null;
    const row = db.prepare("SELECT details_json FROM audit_events WHERE owner_id=? AND event_type='deletion_cleanup_status' AND json_extract(details_json,'$.eventId')=? ORDER BY rowid DESC LIMIT 1").get(ownerId, eventId) as { details_json: string } | undefined;
    let state: { lastError: string | null; retry: { mode: string; nextAttemptAt: null } } = { lastError: null, retry: { mode: 'operator_required', nextAttemptAt: null } };
    if (row) {
      let value: unknown;
      try { value = JSON.parse(row.details_json); } catch { fail('DELETION_STATUS_INVALID'); }
      if (!exact(value, ['eventId','lastError','retry']) || value.eventId !== eventId || value.lastError !== null && value.lastError !== 'CLEANUP_FAILED' ||
          !exact(value.retry, ['mode','nextAttemptAt']) || typeof value.retry.mode !== 'string' || !['operator_required','awaiting_policy'].includes(value.retry.mode) || value.retry.nextAttemptAt !== null) fail('DELETION_STATUS_INVALID');
      state = { lastError: value.lastError as string | null, retry: { mode: value.retry.mode as string, nextAttemptAt: null } };
    }
    return { eventId, status: 'pending_policy' as const, detail: journal.pending().some(row => row.eventId === eventId) ? 'cleanup_pending' as const : 'finance_retention_unknown' as const, lastError: state.lastError, retry: state.retry };
  }
  return Object.freeze({
    deleteAccount: (principal: AccessPrincipal) => { const now = canonicalNow(clock); return submit(principal, event('account', principal.ownerId, now)); },
    deleteProject: (principal: AccessPrincipal, projectId: string) => { const now = canonicalNow(clock); if (!validId(projectId)) fail('PROJECT_NOT_FOUND'); return submit(principal, event('project', principal.ownerId, now, projectId)); },
    status,
    retry: (eventId: string): DeletionResult => {
      const entry = journal.requests().find(row => row.eventId === eventId);
      const request = entry && (({ completedAt: _completedAt, ...rest }) => rest)(entry as DeletionRequest & { completedAt?: string });
      if (!request) fail('DELETION_REQUEST_NOT_FOUND');
      try {
        if (!resumeDeletion(db, journal, repo, request, canonicalNow(clock))) fail('DELETION_TARGET_NOT_FOUND');
        return { eventId, status: 'pending_policy', detail: 'finance_retention_unknown' };
      } catch {
        return { eventId, status: 'pending_policy', detail: 'cleanup_pending' };
      }
    },
  });
}
