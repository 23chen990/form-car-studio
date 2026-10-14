import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { resolveAccessPrincipal, revokeOwnerSessionsInTransaction } from './sessions.js';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const ownerTables = ['projects','assets','versions','drafts','plans','tasks','supplier_attempts','supplier_exposures','credit_lots','reservations','reservation_allocations','ledger_events','feedback','quality_compensations'] as const;

export class MergeError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'MergeError'; }
}

export interface MergeRequest { guestCookie: string; targetAccessToken: string; idempotencyKey: string }
export interface MergeResult { status: 'completed' | 'replayed' | 'deferred'; sourceOwnerId: string; targetOwnerId: string }
export interface MergeOptions { db: DatabaseSync; clock?: () => Date }

type SourceCredential = { revoked_at: string | null; family_revoked_at: string | null; expires_at: string | null; deleted_at: string | null };
type UpgradeRow = { target_owner_id: string; request_digest: string; status: string; completed_at: string | null };
type ProjectPointer = { id: string; original_asset_id: string | null };

function invalid(): never { throw new MergeError('INVALID_MERGE_REQUEST', 400); }
function parseRequest(value: unknown): MergeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const request = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(request);
  if (ownKeys.length !== 3 || ownKeys.some(key => typeof key !== 'string')) return invalid();
  const keys = (ownKeys as string[]).sort().join(',');
  if (keys !== 'guestCookie,idempotencyKey,targetAccessToken' || typeof request.guestCookie !== 'string' || request.guestCookie.length < 1 || request.guestCookie.length > 4096 ||
    typeof request.targetAccessToken !== 'string' || request.targetAccessToken.length > 256 || typeof request.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(request.idempotencyKey)) return invalid();
  return request as unknown as MergeRequest;
}

function sourceFor(cookie: string) { return `legacy-owner-${hash(`form:v2:legacy-owner\0${cookie}`).slice(0, 24)}`; }

function canonicalTime(value: string | null, optional: boolean): boolean {
  if (value === null) return optional;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validExpiry(value: string | null, now: string, optional: boolean): boolean {
  if (!canonicalTime(value, optional) || value === null) return value === null && optional;
  const expires = Date.parse(value), current = Date.parse(now);
  return Number.isFinite(current) && expires > current;
}

function readClock(clock: () => Date): { date: Date; iso: string } {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new MergeError('MERGE_UNAVAILABLE', 503);
  const date = new Date(value.getTime());
  return { date, iso: date.toISOString() };
}

/** A direct completed mapping is provenance only; it never resolves an authenticated actor or follows a chain. */
export function hasDirectCompletedOwnerUpgrade(db: DatabaseSync, sourceOwnerId: string, targetOwnerId: string): boolean {
  if (!safeId(sourceOwnerId) || !safeId(targetOwnerId) || sourceOwnerId === targetOwnerId) return false;
  return !!db.prepare("SELECT 1 FROM owner_upgrades WHERE source_owner_id=? AND target_owner_id=? AND status='completed' AND completed_at IS NOT NULL")
    .get(sourceOwnerId, targetOwnerId);
}

/** Effective claim union preserves source audit rows and never adds units. This query does not authenticate an actor. */
export function workspaceTrialProgramsInTransaction(tx: WalletTransaction, ownerId: string): readonly string[] {
  if (!safeId(ownerId)) throw new MergeError('AUTH_REQUIRED', 401);
  const rows = tx.all<{ trial_program_id: string }>(`SELECT DISTINCT trial_program_id FROM trial_claims
    WHERE user_id=? OR user_id IN (SELECT source_owner_id FROM owner_upgrades
      WHERE target_owner_id=? AND status='completed' AND completed_at IS NOT NULL) ORDER BY trial_program_id`, ownerId, ownerId);
  return Object.freeze(rows.map(row => row.trial_program_id));
}

function verifyTarget(tx: WalletTransaction, request: MergeRequest, principal: NonNullable<ReturnType<typeof resolveAccessPrincipal>>, now: string): void {
  const target = tx.get<{ owner_id: string; family_id: string; expires_at: string; family_revoked: string | null; deleted_at: string | null }>(`SELECT s.owner_id,s.family_id,s.expires_at,f.revoked_at AS family_revoked,u.deleted_at
    FROM v2_sessions s JOIN session_families f ON f.owner_id=s.owner_id AND f.id=s.family_id JOIN users u ON u.id=s.owner_id
    WHERE s.id=? AND s.owner_id=? AND s.token_digest=? AND s.token_kind='access' AND s.revoked_at IS NULL`, principal.sessionId, principal.ownerId, hash(request.targetAccessToken));
  if (!target || target.family_id !== principal.familyId || target.deleted_at || target.family_revoked || !validExpiry(target.expires_at, now, false) ||
    tx.get("SELECT 1 FROM identities WHERE user_id=? AND provider='apple'", principal.ownerId) === undefined ||
    tx.get("SELECT 1 FROM owner_upgrades WHERE source_owner_id=? AND status='completed' AND completed_at IS NOT NULL", principal.ownerId)) throw new MergeError('AUTH_REQUIRED', 401);
}

function verifyGuest(tx: WalletTransaction, cookie: string, ownerId: string, allowHistorical: boolean, now: string): void {
  const digest = hash(cookie);
  const row = tx.get<SourceCredential>(`SELECT s.revoked_at,f.revoked_at AS family_revoked_at,s.expires_at,u.deleted_at
    FROM users u JOIN identities i ON i.user_id=u.id AND i.provider='legacy_cookie' AND i.subject=?
    JOIN v2_sessions s ON s.owner_id=u.id AND s.token_digest=? AND s.token_kind='legacy'
    JOIN session_families f ON f.owner_id=s.owner_id AND f.id=s.family_id WHERE u.id=?`, digest, digest, ownerId);
  if (!row || row.deleted_at || tx.get("SELECT 1 FROM identities WHERE user_id=? AND provider='apple'", ownerId)) throw new MergeError('GUEST_AUTH_REQUIRED', 401);
  if ((allowHistorical && !canonicalTime(row.expires_at, true)) ||
    (!allowHistorical && (row.revoked_at || row.family_revoked_at || !validExpiry(row.expires_at, now, true)))) throw new MergeError('GUEST_AUTH_REQUIRED', 401);
}

function exists(tx: WalletTransaction, sql: string, ...params: (string | number | null)[]) { return !!tx.get(sql, ...params); }
function hasUnresolvedSupplierWork(tx: WalletTransaction, source: string, target: string): boolean {
  return exists(tx, "SELECT 1 FROM supplier_exposures WHERE owner_id IN (?,?) AND status IN ('reserved','started','uncertain') LIMIT 1", source, target) ||
    exists(tx, `SELECT 1 FROM supplier_attempts a LEFT JOIN supplier_exposures e ON e.owner_id=a.owner_id AND e.task_id=a.task_id
      WHERE a.owner_id IN (?,?) AND (a.status IN ('started','uncertain') OR a.ended_at IS NULL OR a.reconciled_cost_usd_micros IS NULL OR e.id IS NULL OR e.status<>'settled') LIMIT 1`, source, target) ||
    exists(tx, `SELECT 1 FROM supplier_exposures e LEFT JOIN supplier_attempts a ON a.owner_id=e.owner_id AND a.task_id=e.task_id
      WHERE e.owner_id IN (?,?) AND e.status='settled' AND a.id IS NULL LIMIT 1`, source, target);
}

function hasActiveWork(tx: WalletTransaction, source: string, target: string): boolean {
  return exists(tx, "SELECT 1 FROM tasks WHERE owner_id IN (?,?) AND status IN ('queued','processing','uncertain') LIMIT 1", source, target) ||
    exists(tx, "SELECT 1 FROM deletion_jobs WHERE owner_id IN (?,?) AND status IN ('queued','running') LIMIT 1", source, target) ||
    hasUnresolvedSupplierWork(tx, source, target);
}

function defer(tx: WalletTransaction, source: string, target: string, digest: string, now: string): MergeResult {
  const result = tx.run(`INSERT INTO owner_upgrades(source_owner_id,target_owner_id,request_digest,created_at,completed_at,status)
    VALUES(?,?,?, ?,NULL,'deferred') ON CONFLICT(source_owner_id) DO UPDATE SET status='deferred'
    WHERE owner_upgrades.target_owner_id=excluded.target_owner_id AND owner_upgrades.request_digest=excluded.request_digest AND owner_upgrades.status='deferred'`, source, target, digest, now);
  if (result.changes !== 1) throw new MergeError('UPGRADE_CONFLICT');
  return { status: 'deferred', sourceOwnerId: source, targetOwnerId: target };
}

function preflight(tx: WalletTransaction, source: string, target: string): void {
  if (exists(tx, 'SELECT 1 FROM purchases WHERE owner_id=? LIMIT 1', source) ||
    exists(tx, "SELECT 1 FROM credit_lots WHERE owner_id=? AND (kind='purchased' OR source_kind='purchase' OR purchase_id IS NOT NULL) LIMIT 1", source)) throw new MergeError('PURCHASE_TRANSFER_UNSUPPORTED');
  if (exists(tx, "SELECT 1 FROM credit_lots WHERE owner_id=? AND (scope<>'demo' OR source_kind='trial') LIMIT 1", source)) throw new MergeError('SOURCE_WALLET_PROVENANCE_UNSUPPORTED');
  const collisions: [string,string][] = [
    ['projects', 'id'], ['assets', 'id'], ['versions', 'id'], ['plans', 'id'], ['tasks', 'id'],
    ['tasks', 'submission_id'], ['ledger_events', 'ledger_event_key'], ['credit_lots', 'source_event_key'],
  ];
  for (const [table, column] of collisions) {
    const nonempty = table === 'credit_lots' && column === 'source_event_key' ? " AND source.source_event_key<>''" : '';
    if (exists(tx, `SELECT 1 FROM ${table} source JOIN ${table} target ON target.${column}=source.${column} WHERE source.owner_id=? AND target.owner_id=?${nonempty} LIMIT 1`, source, target)) throw new MergeError('MERGE_COLLISION');
  }
}

function moveWorkspace(tx: WalletTransaction, source: string, target: string): void {
  const projects = tx.all<ProjectPointer>('SELECT id,original_asset_id FROM projects WHERE owner_id=?', source);
  for (const project of projects) if (project.original_asset_id) tx.run('UPDATE projects SET original_asset_id=NULL WHERE id=? AND owner_id=?', project.id, source);
  tx.run('DELETE FROM plans WHERE owner_id=? AND confirmed_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks WHERE owner_id=? AND (plan_id=plans.id OR confirmed_plan_id=plans.id))', source, source);
  tx.run('UPDATE projects SET owner_id=? WHERE owner_id=?', target, source);
  for (const table of ownerTables.slice(1)) tx.run(`UPDATE ${table} SET owner_id=? WHERE owner_id=?`, target, source);
  for (const project of projects) if (project.original_asset_id) tx.run('UPDATE projects SET original_asset_id=? WHERE id=? AND owner_id=?', project.original_asset_id, project.id, target);
}

export function createMergeService(options: MergeOptions) {
  const { db } = options, repo = new WalletRepository(db), clock = options.clock ?? (() => new Date());
  function upgrade(raw: unknown): MergeResult {
    const request = parseRequest(raw), admissionTime = readClock(clock), principal = resolveAccessPrincipal(db, request.targetAccessToken, admissionTime.date);
    if (!principal) throw new MergeError('AUTH_REQUIRED', 401);
    const source = sourceFor(request.guestCookie), target = principal.ownerId;
    if (source === target) throw new MergeError('UPGRADE_CONFLICT');
    const digest = hash(JSON.stringify({ version: 1, sourceOwnerId: source, targetOwnerId: target, idempotencyKey: request.idempotencyKey }));
    try {
      return repo.transaction(tx => {
        if ((tx.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys ?? 0) !== 1) throw new MergeError('FOREIGN_KEYS_REQUIRED', 503);
        tx.run('PRAGMA defer_foreign_keys=ON');
        if ((tx.get<{ defer_foreign_keys: number }>('PRAGMA defer_foreign_keys')?.defer_foreign_keys ?? 0) !== 1) throw new MergeError('FOREIGN_KEYS_REQUIRED', 503);
        const transactionTime = readClock(clock);
        const currentPrincipal = resolveAccessPrincipal(db, request.targetAccessToken, transactionTime.date);
        if (!currentPrincipal || currentPrincipal.ownerId !== principal.ownerId || currentPrincipal.sessionId !== principal.sessionId || currentPrincipal.familyId !== principal.familyId) throw new MergeError('AUTH_REQUIRED', 401);
        verifyTarget(tx, request, currentPrincipal, transactionTime.iso);
        const mapping = tx.get<UpgradeRow>('SELECT target_owner_id,request_digest,status,completed_at FROM owner_upgrades WHERE source_owner_id=?', source);
        if (mapping && (mapping.target_owner_id !== target || mapping.request_digest !== digest || !['deferred','completed'].includes(mapping.status))) throw new MergeError('UPGRADE_CONFLICT');
        verifyGuest(tx, request.guestCookie, source, mapping?.status === 'completed', transactionTime.iso);
        if (mapping?.status === 'completed') {
          if (!mapping.completed_at) throw new MergeError('UPGRADE_CONFLICT');
          return { status: 'replayed', sourceOwnerId: source, targetOwnerId: target };
        }
        if (hasActiveWork(tx, source, target)) return defer(tx, source, target, digest, transactionTime.iso);
        preflight(tx, source, target);
        moveWorkspace(tx, source, target);
        revokeOwnerSessionsInTransaction(tx, source, transactionTime.iso);
        const completed = tx.run(`INSERT INTO owner_upgrades(source_owner_id,target_owner_id,request_digest,created_at,completed_at,status)
          VALUES(?,?,?,?,?,'completed') ON CONFLICT(source_owner_id) DO UPDATE SET completed_at=excluded.completed_at,status='completed'
          WHERE owner_upgrades.target_owner_id=excluded.target_owner_id AND owner_upgrades.request_digest=excluded.request_digest AND owner_upgrades.status='deferred'`, source, target, digest, mapping ? (tx.get<{ created_at: string }>('SELECT created_at FROM owner_upgrades WHERE source_owner_id=?', source)?.created_at ?? transactionTime.iso) : transactionTime.iso, transactionTime.iso);
        if (completed.changes !== 1) throw new MergeError('UPGRADE_CONFLICT');
        if (tx.all('PRAGMA foreign_key_check').length) throw new MergeError('MERGE_FK_INVALID', 503);
        return { status: 'completed', sourceOwnerId: source, targetOwnerId: target };
      });
    } catch (error) {
      if (error instanceof MergeError) throw error;
      throw new MergeError('MERGE_FAILED', 503);
    }
  }
  return Object.freeze({ upgrade });
}
