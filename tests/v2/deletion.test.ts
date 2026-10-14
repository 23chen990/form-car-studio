import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { createConsentService, type ConsentCatalog } from '../../server/v2/consents.js';
import { openV2Database } from '../../server/v2/db.js';
import { createPlanService, type PlanConfiguration } from '../../server/v2/plans.js';
import { createProjectService } from '../../server/v2/projects.js';
import { createSessionService, resolveAccessPrincipal } from '../../server/v2/sessions.js';
import { createTaskService } from '../../server/v2/tasks.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { createWorkerService } from '../../server/v2/worker.js';

const deletionModule = await import('../../server/v2/deletion.js').catch(() => null);
const cacheModule = await import('../../src/platform/cache.js').catch(() => null);
const deletionUi = await import('../../src/features/account/deletion.js').catch(() => null);
const deletionRoutes = await import('../../server/v2/routes-deletion.js').catch(() => null);
const TEST_TIME = '2026-10-14T00:00:00.000Z';
const TEST_POLICY = { trustedOutsideRestoreSet: true as const, maxBackupAgeMs: 60_000, retentionMs: 60_000 };
const catalog: ConsentCatalog = { providers: ['provider-f26'], policies: [{ id: 'policy-f26', version: 'consent-f26', providerId: 'provider-f26', purposes: { photoRights: 'photo-rights', uploadStorage: 'private-storage', sharing: 'model-precheck' } }] };
const workerConfig = (): PlanConfiguration => ({ liveEnabled: true, liveCandidates: ['profile-f26'], profiles: [{ providerId: 'provider-f26', profile: { id: 'profile-f26', version: 'profile-v1', protocol: 'openai-images-edits', endpoint: 'https://api.openai.com/v1/images/edits', model: 'synthetic-model', templateVersion: 'template-v1', fields: ['bodyColor'], originalReference: false, approvedForLive: true, officialEvidence: 'https://developers.openai.com/synthetic-evidence', qualityEvidence: 'synthetic-review', maxCostMicrosUSD: 25_000, timeoutMs: 1000, maxInputBytes: 1_000_000, maxOutputBytes: 2_000_000, maxResponseBytes: 3_000_000, output: { format: 'png', size: '1024x1024', quality: 'low' } } }], policyVersion: 'processing-v1', requiredGenerationPurpose: 'model-precheck', budget: { maxSupplierCostMicrosUSD: 100_000 }, sourcePolicy: { version: 'source-v1', allowedKinds: ['user_upload'] } });
const ownerFromCookie = (cookie: string) => `legacy-owner-${createHash('sha256').update(`form:v2:legacy-owner\0${cookie}`).digest('hex').slice(0, 24)}`;
const legacyProjectId = (owner: string, project: string) => `legacy-project-${createHash('sha256').update(`${owner}:${project}`).digest('hex').slice(0, 24)}`;
const legacyTaskId = (owner: string, project: string, task: string) => `legacy-task-${createHash('sha256').update(`${owner}:${legacyProjectId(owner, project)}\0${task}`).digest('hex').slice(0, 24)}`;

function journalFixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'form-f26-journal-'));
  const path = join(dir, 'tombstones.jsonl');
  writeFileSync(path, '', { mode: 0o600 });
  return { dir, path, close: () => rmSync(dir, { recursive: true, force: true }) };
}

function databaseFixture(createdAt = TEST_TIME) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'form-f26-db-'));
  const dbPath = join(dir, 'form.sqlite'), db = openV2Database(dbPath), ownerId = 'owner-f26', projectId = 'project-f26';
  db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(ownerId, TEST_TIME);
  db.prepare('INSERT INTO projects(id,owner_id,name,created_at) VALUES (?,?,?,?)').run(projectId, ownerId, 'Synthetic project name', TEST_TIME);
  db.prepare(`INSERT INTO assets(id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,private_bytes,created_at)
    VALUES ('asset-f26',?,?,'original','image/png',4,1,1,?,'storage-f26',?,?)`).run(ownerId, projectId, 'a'.repeat(64), Buffer.from('data'), TEST_TIME);
  db.prepare('UPDATE projects SET original_asset_id=? WHERE id=?').run('asset-f26', projectId);
  db.prepare('INSERT INTO drafts(id,owner_id,project_id,source_ref,edits_json,updated_at) VALUES (?,?,?,?,?,?)').run('draft-f26', ownerId, projectId, 'private-source', '{"freeText":"private"}', TEST_TIME);
  db.exec('CREATE TABLE images (id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,data BLOB NOT NULL); CREATE TABLE reports (id TEXT PRIMARY KEY,owner TEXT NOT NULL,task_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE sessions (id TEXT PRIMARY KEY,state TEXT NOT NULL);');
  const sessions = createSessionService({ db, clock: () => new Date(createdAt) }), pair = sessions.issue(ownerId);
  const principal = resolveAccessPrincipal(db, pair.accessToken, new Date(TEST_TIME))!;
  return { db, dbPath, dir, ownerId, projectId, sessions, pair, principal, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function deletionFixture(f: ReturnType<typeof databaseFixture>) {
  const path = join(f.dir, 'tombstones.jsonl'); writeFileSync(path, '', { mode: 0o600 });
  const journal = deletionModule!.createDeletionJournal({ path, policy: TEST_POLICY });
  return { journal, service: deletionModule!.createDeletionService({ db: f.db, journal, clock: () => new Date(TEST_TIME) }) };
}

async function liveWorkerTask(f: ReturnType<typeof databaseFixture>) {
  f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run('apple-f26', f.ownerId, 'apple', 'synthetic-apple-f26', TEST_TIME);
  const consent = createConsentService(f.db, catalog).issue(f.ownerId, { policyId: 'policy-f26', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: true });
  const source = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#446688' } }).png().toBuffer();
  const project = await createProjectService({ db: f.db, consentCatalog: catalog, storageQuotaBytes: 300_000_000 }).create(f.ownerId, consent.consentRecordId, source, 'Synthetic worker project', 'user_upload');
  const config = workerConfig(), plan = await createPlanService({ db: f.db, consentCatalog: catalog, config, clock: () => new Date(TEST_TIME) }).quote(f.ownerId, project.projectId, consent.consentRecordId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } });
  const wallet = new WalletRepository(f.db);
  wallet.transaction(tx => wallet.grantInTransaction(tx, { ownerId: f.ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'seed-live-f26', units: 1, scope: 'live', createdAt: TEST_TIME }));
  const task = await createTaskService({ db: f.db, consentCatalog: catalog, config, storageQuotaBytes: 300_000_000, clock: () => new Date(TEST_TIME) }).submit(f.ownerId, { planId: plan.planId, submissionId: 'submission-f26-worker', consentRecordId: consent.consentRecordId });
  return { projectId: project.projectId, taskId: task.task.id };
}

test('F26 exposes the tombstone journal and deletion service', () => {
  assert.ok(deletionModule, 'server/v2/deletion.ts must provide the F26 service');
  assert.equal(typeof deletionModule.createDeletionJournal, 'function');
  assert.equal(typeof deletionModule.createDeletionService, 'function');
});

test('deletion journal requires a pre-provisioned regular path and finite restore policy', () => {
  assert.ok(deletionModule);
  const missing = journalFixture();
  try {
    assert.throws(() => deletionModule.createDeletionJournal({ path: missing.path }), /policy|unavailable/i);
    assert.throws(() => deletionModule.createDeletionJournal({ path: join(missing.dir, 'missing'), policy: TEST_POLICY }), /journal|unavailable/i);
    assert.throws(() => deletionModule.createDeletionJournal({ path: missing.path, policy: { ...TEST_POLICY, retentionMs: 0 } }), /policy|retention/i);
    assert.throws(() => deletionModule.createDeletionJournal({ path: missing.path, policy: { ...TEST_POLICY, retentionMs: 30_000 } }), /policy|retention/i);
    const link = join(missing.dir, 'linked.jsonl'); symlinkSync(missing.path, link);
    assert.throws(() => deletionModule.createDeletionJournal({ path: link, policy: TEST_POLICY }), /journal|symlink|unavailable/i);
  } finally { missing.close(); }
});

test('journal appends durable idempotent requests and completion records, rejecting malformed data', () => {
  assert.ok(deletionModule);
  const f = journalFixture();
  try {
    const record = { eventId: 'delete-account-a', kind: 'account' as const, ownerId: 'owner-a', requestedAt: TEST_TIME };
    const journal = deletionModule.createDeletionJournal({ path: f.path, policy: TEST_POLICY });
    journal.appendRequest(record); journal.appendRequest(record); journal.complete(record.eventId, '2026-10-14T00:00:01.000Z');
    const reopened = deletionModule.createDeletionJournal({ path: f.path, policy: TEST_POLICY });
    assert.deepEqual(reopened.requests(), [{ ...record, completedAt: '2026-10-14T00:00:01.000Z' }]);
    assert.equal(reopened.prune('2026-10-14T00:01:02.000Z'), 1);
    assert.deepEqual(reopened.requests(), []);
    writeFileSync(f.path, '{broken}\n', { mode: 0o600 });
    assert.throws(() => deletionModule.createDeletionJournal({ path: f.path, policy: TEST_POLICY }), /journal|record|malformed/i);
  } finally { f.close(); }
});

test('project deletion tombstones first, cancels queued work once, scrubs private content, and retries safely', () => {
  assert.ok(deletionModule);
  const f = databaseFixture(), { service } = deletionFixture(f);
  try {
    f.db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at,updated_at)
      VALUES ('queued-f26',?,?,?,'queued',1,'{"scope":"demo","prompt":"private"}',?,?)`).run(f.ownerId, f.projectId, 'submission-f26', TEST_TIME, TEST_TIME);
    const wallet = new WalletRepository(f.db);
    wallet.transaction(tx => {
      wallet.grantInTransaction(tx, { ownerId: f.ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'seed-f26', units: 1, scope: 'demo', createdAt: TEST_TIME });
      wallet.reserveTaskInTransaction(tx, { ownerId: f.ownerId, taskId: 'queued-f26' });
    });
    f.db.prepare(`INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at)
      VALUES ('exposure-f26',?,'queued-f26','profile-f26','profile-v1',25000,'USD','synthetic','reserved',?,?)`).run(f.ownerId, TEST_TIME, TEST_TIME);
    const result = service.deleteProject(f.principal, f.projectId);
    assert.equal(result.status, 'pending_policy'); assert.equal(result.detail, 'finance_retention_unknown');
    assert.ok((f.db.prepare('SELECT deleted_at FROM projects WHERE id=?').get(f.projectId) as any).deleted_at);
    assert.equal((f.db.prepare('SELECT status,request_snapshot_json FROM tasks WHERE id=?').get('queued-f26') as any).status, 'cancelled');
    assert.equal((f.db.prepare('SELECT request_snapshot_json FROM tasks WHERE id=?').get('queued-f26') as any).request_snapshot_json, null);
    assert.equal((f.db.prepare('SELECT count(*) n FROM ledger_events WHERE task_id=? AND event_type=\'release\'').get('queued-f26') as any).n, 1);
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE id=?').get('exposure-f26') as any).status, 'released');
    assert.equal((f.db.prepare('SELECT count(*) n FROM assets WHERE project_id=?').get(f.projectId) as any).n, 0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM drafts WHERE project_id=?').get(f.projectId) as any).n, 0);
    assert.equal((f.db.prepare('SELECT name FROM projects WHERE id=?').get(f.projectId) as any).name, null);
    service.retry(result.eventId);
    assert.equal((f.db.prepare('SELECT count(*) n FROM ledger_events WHERE task_id=? AND event_type=\'release\'').get('queued-f26') as any).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM purchases WHERE owner_id=?').get(f.ownerId) as any).n, 0);
  } finally { f.close(); }
});

test('cleanup failure preserves the durable account tombstone and revoked sessions for retry', () => {
  assert.ok(deletionModule);
  const f = databaseFixture(), { journal, service } = deletionFixture(f);
  try {
    f.db.exec("CREATE TRIGGER fail_f26_asset_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure'); END;");
    const first = service.deleteAccount(f.principal);
    assert.equal(first.detail, 'cleanup_pending');
    assert.ok((f.db.prepare('SELECT deleted_at FROM users WHERE id=?').get(f.ownerId) as any).deleted_at);
    assert.ok((f.db.prepare('SELECT deleted_at FROM projects WHERE id=?').get(f.projectId) as any).deleted_at);
    assert.equal(resolveAccessPrincipal(f.db, f.pair.accessToken, new Date(TEST_TIME)), null);
    assert.ok((f.db.prepare('SELECT revoked_at FROM session_families WHERE owner_id=?').get(f.ownerId) as any).revoked_at);
    assert.equal((f.db.prepare('SELECT status FROM deletion_jobs WHERE id=?').get(first.eventId) as any).status, 'failed');
    assert.deepEqual(service.status(f.ownerId, first.eventId), { eventId: first.eventId, status: 'pending_policy', detail: 'cleanup_pending', lastError: 'CLEANUP_FAILED', retry: { mode: 'operator_required', nextAttemptAt: null } });
    assert.equal((f.db.prepare('SELECT count(*) n FROM assets WHERE owner_id=?').get(f.ownerId) as any).n, 1);
    f.db.exec('DROP TRIGGER fail_f26_asset_delete;');
    assert.equal(service.retry(first.eventId).detail, 'finance_retention_unknown');
    assert.equal(service.status(f.ownerId, first.eventId)?.lastError, null);
    assert.deepEqual(service.status(f.ownerId, first.eventId)?.retry, { mode: 'awaiting_policy', nextAttemptAt: null });
    assert.equal((f.db.prepare('SELECT count(*) n FROM assets WHERE owner_id=?').get(f.ownerId) as any).n, 0);
    assert.equal(journal.pending().length, 0);
  } finally { f.close(); }
});

test('project deletion scrubs only a directly upgraded legacy origin and its raw session content', () => {
  assert.ok(deletionModule);
  const f = databaseFixture(), { service } = deletionFixture(f), cookie = 'f26-guest-cookie', sourceOwner = ownerFromCookie(cookie), rawProjectId = 'guest-project';
  const movedProjectId = legacyProjectId(sourceOwner, rawProjectId), imageBytes = Buffer.from('synthetic legacy image');
  const otherCookie = 'f26-unrelated-cookie', otherOwner = ownerFromCookie(otherCookie);
  try {
    f.db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(sourceOwner, TEST_TIME);
    f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run('legacy-identity-f26', sourceOwner, 'legacy_cookie', createHash('sha256').update(cookie).digest('hex'), TEST_TIME);
    f.db.prepare(`INSERT INTO owner_upgrades(source_owner_id,target_owner_id,request_digest,created_at,completed_at,status)
      VALUES (?,?,? ,?,?,'completed')`).run(sourceOwner, f.ownerId, 'upgrade-digest-f26', TEST_TIME, TEST_TIME);
    f.db.prepare('INSERT INTO projects(id,owner_id,name,created_at) VALUES (?,?,?,?)').run(movedProjectId, f.ownerId, 'Guest private name', TEST_TIME);
    f.db.prepare(`INSERT INTO assets(id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,private_bytes,created_at)
      VALUES ('moved-legacy-asset',?,?,'original','application/octet-stream',?,NULL,NULL,? ,?,?,?)`).run(f.ownerId, movedProjectId, imageBytes.length, createHash('sha256').update(imageBytes).digest('hex'), `legacy://${sourceOwner}/legacy-image-f26`, null, TEST_TIME);
    f.db.prepare('INSERT INTO images(id,owner,project_id,data) VALUES (?,?,?,?)').run('legacy-image-f26', cookie, rawProjectId, imageBytes);
    f.db.prepare('INSERT INTO reports(id,owner,task_id,reason,created_at) VALUES (?,?,?,?,?)').run('report-upgraded-f26', cookie, legacyTaskId(sourceOwner, rawProjectId, 'legacy-task'), 'private support text', TEST_TIME);
    f.db.prepare('INSERT INTO reports(id,owner,task_id,reason,created_at) VALUES (?,?,?,?,?)').run('report-unrelated-task-f26', cookie, 'unrelated-task', 'preserve other report', TEST_TIME);
    f.db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(otherOwner, TEST_TIME);
    f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run('legacy-identity-other', otherOwner, 'legacy_cookie', createHash('sha256').update(otherCookie).digest('hex'), TEST_TIME);
    f.db.prepare('INSERT INTO images(id,owner,project_id,data) VALUES (?,?,?,?)').run('unrelated-image-f26', otherCookie, 'unrelated-project', Buffer.from('keep unrelated image'));
    const legacyState = (projectId: string) => JSON.stringify({ mode: 'demo', credits: 2, reservedCredits: 0, projects: [{ id: projectId, name: 'private project title', draft: { prompt: 'private recipe' } }], tasks: [{ id: 'legacy-task', projectId, target: { bodyColor: 'red' } }], ledger: [], savedStyles: ['red'], generationEnabled: false });
    f.db.prepare('INSERT INTO sessions(id,state) VALUES (?,?)').run(cookie, legacyState(rawProjectId));
    f.db.prepare('INSERT INTO sessions(id,state) VALUES (?,?)').run(otherCookie, legacyState('unrelated-project'));
    service.deleteProject(f.principal, movedProjectId);
    assert.equal((f.db.prepare('SELECT count(*) n FROM images WHERE id=?').get('legacy-image-f26') as any).n, 0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM images WHERE id=?').get('unrelated-image-f26') as any).n, 1);
    assert.equal((f.db.prepare('SELECT reason FROM reports WHERE id=?').get('report-upgraded-f26') as any).reason, '');
    assert.equal((f.db.prepare('SELECT reason FROM reports WHERE id=?').get('report-unrelated-task-f26') as any).reason, 'preserve other report');
    const scrubbed = JSON.parse((f.db.prepare('SELECT state FROM sessions WHERE id=?').get(cookie) as any).state);
    assert.deepEqual(scrubbed.projects, []); assert.deepEqual(scrubbed.tasks, []);
    const unrelated = JSON.parse((f.db.prepare('SELECT state FROM sessions WHERE id=?').get(otherCookie) as any).state);
    assert.equal(unrelated.projects[0].name, 'private project title'); assert.equal(unrelated.tasks[0].id, 'legacy-task');
  } finally { f.close(); }
});

test('a late synthetic worker result cannot recreate content after the deletion transaction', async () => {
  assert.ok(deletionModule);
  const f = databaseFixture(), { service } = deletionFixture(f), job = await liveWorkerTask(f);
  try {
    let started!: () => void, finish!: (result: any) => void;
    const ready = new Promise<void>(resolve => { started = resolve; }), pending = new Promise<any>(resolve => { finish = resolve; });
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: workerConfig(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(TEST_TIME), serverProvider: async () => { started(); return pending; } });
    const run = worker.runTask(job.taskId); await ready;
    const deleted = service.deleteProject(f.principal, job.projectId);
    assert.equal(deleted.detail, 'finance_retention_unknown');
    const bytes = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#bb5533' } }).png().toBuffer();
    finish({ ok: true, image: bytes, mimeType: 'image/png', profileId: 'profile-f26', profileVersion: 'profile-v1', model: 'synthetic-model', templateVersion: 'template-v1', promptSha256: 'a'.repeat(64), providerRequestId: 'synthetic-worker-result', usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: 25_000, attempted: true, quality: 'UNASSESSED' });
    assert.equal((await run).status, 'failed');
    assert.equal((f.db.prepare('SELECT count(*) n FROM versions WHERE project_id=?').get(job.projectId) as any).n, 0);
    assert.equal((f.db.prepare('SELECT deleted_at FROM projects WHERE id=?').get(job.projectId) as any).deleted_at != null, true);
  } finally { f.close(); }
});

test('account deletion checks server-held recent authentication and revokes the complete session family', async () => {
  assert.ok(deletionModule);
  const stale = databaseFixture(new Date(Date.parse(TEST_TIME) - 10 * 60_000).toISOString()), staleJournal = journalFixture();
  try {
    const oldService = deletionModule.createDeletionService({ db: stale.db, journal: deletionModule.createDeletionJournal({ path: staleJournal.path, policy: TEST_POLICY }), clock: () => new Date(TEST_TIME) });
    assert.throws(() => oldService.deleteAccount(stale.principal), (error: any) => error.code === 'SESSION_RECENT_AUTH_REQUIRED');
    assert.equal((stale.db.prepare('SELECT deleted_at FROM users WHERE id=?').get(stale.ownerId) as any).deleted_at, null);
  } finally { stale.close(); staleJournal.close(); }
  const f = databaseFixture(), { service } = deletionFixture(f);
  try {
    const result = service.deleteAccount(f.principal);
    assert.equal(result.status, 'pending_policy');
    assert.ok((f.db.prepare('SELECT deleted_at FROM users WHERE id=?').get(f.ownerId) as any).deleted_at);
    assert.equal(resolveAccessPrincipal(f.db, f.pair.accessToken, new Date(TEST_TIME)), null);
    await assert.rejects(f.sessions.refresh(f.pair.refreshToken), (error: any) => error.code === 'SESSION_UPGRADED' || error.code === 'SESSION_REVOKED');
    assert.ok((f.db.prepare('SELECT revoked_at FROM session_families WHERE owner_id=?').get(f.ownerId) as any).revoked_at);
  } finally { f.close(); }
});

test('tombstones replay onto an older synthetic database snapshot before it serves requests', () => {
  assert.ok(deletionModule);
  const f = databaseFixture();
  try {
    f.db.close(); copyFileSync(f.dbPath, join(f.dir, 'older.sqlite'));
    const oldPath = join(f.dir, 'older.sqlite'), currentDb = openV2Database(f.dbPath), oldDb = openV2Database(oldPath);
    try {
      const journalPath = join(f.dir, 'tombstones.jsonl'); writeFileSync(journalPath, '', { mode: 0o600 });
      const journal = deletionModule.createDeletionJournal({ path: journalPath, policy: TEST_POLICY });
      const principal = resolveAccessPrincipal(currentDb, f.pair.accessToken, new Date(TEST_TIME))!;
      const service = deletionModule.createDeletionService({ db: currentDb, journal, clock: () => new Date(TEST_TIME) });
      const request = service.deleteProject(principal, f.projectId);
      assert.ok('completedAt' in journal.requests()[0]!);
      assert.equal((oldDb.prepare('SELECT deleted_at FROM projects WHERE id=?').get(f.projectId) as any).deleted_at, null);
      const replay = deletionModule.replayDeletionTombstones(oldDb, journal, () => new Date(TEST_TIME));
      assert.deepEqual(replay.replayed, [request.eventId]);
      assert.ok((oldDb.prepare('SELECT deleted_at FROM projects WHERE id=?').get(f.projectId) as any).deleted_at);
      assert.equal((oldDb.prepare('SELECT count(*) n FROM assets WHERE project_id=?').get(f.projectId) as any).n, 0);
      assert.equal(deletionModule.replayDeletionTombstones(oldDb, journal, () => new Date(TEST_TIME)).replayed.length, 1);
    } finally { currentDb.close(); oldDb.close(); }
  } finally { try { f.db.close(); } catch {} rmSync(f.dir, { recursive: true, force: true }); }
});

test('private preview cache is bounded, owner-scoped, and never stores masters or originals', () => {
  assert.ok(cacheModule);
  const cache = cacheModule.createPrivatePreviewCache(5), key = { ownerId: 'owner-a', projectId: 'project-a', assetId: 'asset-a', digest: 'a'.repeat(64) };
  const source = Buffer.from('1234');
  assert.equal(cache.set({ ...key, kind: 'display', bytes: source }), false);
  cache.setActiveOwner('owner-a'); assert.equal(cache.set({ ...key, kind: 'display', bytes: source }), true); source[0] = 0;
  assert.deepEqual(Array.from(cache.get(key)!), Array.from(Buffer.from('1234')));
  assert.equal(cache.set({ ...key, assetId: 'master-a', kind: 'master', bytes: Buffer.from('x') }), false);
  assert.equal(cache.set({ ...key, assetId: 'large', kind: 'thumbnail', bytes: Buffer.from('123456') }), false);
  const second = { ...key, assetId: 'asset-b' };
  assert.equal(cache.set({ ...second, kind: 'thumbnail', bytes: Buffer.from('abc') }), true);
  assert.equal(cache.get(key), null); assert.equal(cache.stats().bytes, 3);
  cache.setActiveOwner('owner-b'); assert.equal(cache.get(second), null);
  assert.equal(cache.stats().bytes, 0);
  const ownerBKey = { ...key, ownerId: 'owner-b' };
  cache.set({ ...ownerBKey, kind: 'thumbnail', bytes: Buffer.from('xy') });
  cache.setActiveOwner(null); assert.equal(cache.stats().bytes, 0);
  assert.throws(() => cacheModule.createPrivatePreviewCache(100 * 1024 * 1024 + 1), /LIMIT/);
});

test('account deletion confirmation is accessible and discloses pending retention and external copies', () => {
  assert.ok(deletionUi);
  const markup = renderToStaticMarkup(createElement(deletionUi.AccountDeletionConfirmation, { requestDeletion: async () => ({ status: 'pending_policy' }) }));
  assert.match(markup, /Delete your FORM account/); assert.match(markup, /type="checkbox"/);
  assert.match(markup, /backup/i); assert.match(markup, /saved copies|Photos/i); assert.match(markup, /aria-live="polite"/);
});

test('unmounted deletion router requires explicit confirmation and returns honest accepted status', async () => {
  assert.ok(deletionRoutes);
  const f = databaseFixture(), { journal } = deletionFixture(f), app = express(); app.use(deletionRoutes.createDeletionRouter({ db: f.db, journal, clock: () => new Date(TEST_TIME) })); const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}/account`;
  try {
    const headers = { authorization: `Bearer ${f.pair.accessToken}`, 'content-type': 'application/json' };
    const invalid = await fetch(endpoint, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: 'DELETE_ACCOUNT', clientRecentAuth: true }) });
    assert.equal(invalid.status, 400); assert.equal((f.db.prepare('SELECT deleted_at FROM users WHERE id=?').get(f.ownerId) as any).deleted_at, null);
    const accepted = await fetch(endpoint, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: 'DELETE_ACCOUNT' }) });
    const body = await accepted.json() as any;
    assert.equal(accepted.status, 202); assert.equal(body.status, 'pending_policy'); assert.match(body.message, /retention|backup/i);
    const progress = await fetch(`http://127.0.0.1:${address.port}/deletion/${body.eventId}`, { headers: { authorization: `Bearer ${f.pair.accessToken}` } });
    assert.equal(progress.status, 401); assert.equal((await progress.json() as any).code, 'AUTH_REQUIRED');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.close(); }
});


test('deletion progress requires a current session and never exposes another owner job', async () => {
  assert.ok(deletionRoutes);
  const f = databaseFixture(), { journal, service } = deletionFixture(f), app = express();
  const job = service.deleteProject(f.principal, f.projectId);
  f.db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run('other-f26', TEST_TIME);
  const other = f.sessions.issue('other-f26');
  app.use(deletionRoutes.createDeletionRouter({ db: f.db, journal, clock: () => new Date(TEST_TIME) }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}/deletion/${job.eventId}`;
  const get = (accessToken: string) => fetch(endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
  try {
    const active = await get(f.pair.accessToken); assert.equal(active.status, 200); assert.equal((await active.json() as any).status, 'pending_policy');
    assert.equal((await get(other.accessToken)).status, 404);
    f.db.prepare('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,?,?,?)').run('tampered-cleanup-status', f.ownerId, 'deletion_cleanup_status', JSON.stringify({ eventId: job.eventId, lastError: 'synthetic private exception', retry: { mode: 'operator_required', nextAttemptAt: null } }), TEST_TIME);
    const corrupt = await get(f.pair.accessToken); assert.equal(corrupt.status, 503);
    const error = await corrupt.json() as any; assert.equal(error.code, 'DELETION_STATUS_INVALID'); assert.doesNotMatch(JSON.stringify(error), /synthetic private exception/);
    f.sessions.logout(f.pair.accessToken); assert.equal((await get(f.pair.accessToken)).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.close(); }
});
