import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { test } from 'node:test';
import { migrateLegacyDatabase } from '../../server/v2/migrate.js';
import { openV2Database } from '../../server/v2/db.js';
import { readAuthorizedLegacyBytes, createSqlAssetReader } from '../../server/v2/projects.js';
import type { AssetRow } from '../../server/v2/assets.js';
import { readGenerationBase } from '../../server/v2/assets.js';
import { issueSessionInTransaction, resolveAccessPrincipal } from '../../server/v2/sessions.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { createMergeService, hasDirectCompletedOwnerUpgrade, workspaceTrialProgramsInTransaction } from '../../server/v2/merge.js';

const NOW = '2026-10-13T03:00:00.000Z';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourceOwner = (cookie: string) => `legacy-owner-${hash(`form:v2:legacy-owner\0${cookie}`).slice(0, 24)}`;
const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

type Fixture = { db: DatabaseSync; dbPath: string; dir: string; guestCookie: string; source: string; target: string; accessToken: string; projectId: string; originalId: string; bytes: Buffer; close(): void };

async function fixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'form-f22-'));
  const legacyPath = join(dir, 'legacy.sqlite'), dbPath = join(dir, 'v2.sqlite'), guestCookie = 'synthetic-f03-guest-cookie';
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#365b9a' } }).png().toBuffer();
  const state = { credits: 3, reservedCredits: 0, savedStyles: ['sport'], projects: [{ id: 'legacy-project-one', coverVersionId: 'legacy-version-one', name: 'Synthetic', source: 'upload', originalUrl: '/api/images/legacy-image-one', createdAt: NOW, draft: { styleId: 'sport', baseVersionId: 'legacy-version-one', target: { bodyColor: 'blue' }, updatedAt: NOW }, versions: [{ id: 'legacy-version-one', parentVersionId: null, name: 'Original', imageUrl: '/api/images/legacy-image-one', styleId: 'sport', favorite: true, createdAt: NOW }] }], tasks: [], ledger: [] };
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE images(id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,data BLOB NOT NULL); CREATE TABLE reports(id TEXT PRIMARY KEY,owner TEXT NOT NULL,task_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);');
  legacy.prepare('INSERT INTO sessions VALUES(?,?)').run(guestCookie, JSON.stringify(state));
  legacy.prepare('INSERT INTO images VALUES(?,?,?,?)').run('legacy-image-one', guestCookie, 'legacy-project-one', bytes);
  legacy.close();
  migrateLegacyDatabase({ inputPath: legacyPath, outputPath: dbPath, apply: true });
  const db = openV2Database(dbPath), source = sourceOwner(guestCookie), target = randomUUID();
  db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(target, NOW);
  db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), target, 'apple', `synthetic-apple-${target}`, NOW);
  let token = 0;
  const pair = new WalletRepository(db).transaction(tx => issueSessionInTransaction(tx, target, NOW, { token: () => Buffer.alloc(32, ++token).toString('base64url') }));
  const wallet = new WalletRepository(db);
  wallet.transaction(tx => {
    const repo = wallet;
    repo.grantInTransaction(tx, { ownerId: target, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'target-live-seed', units: 4, scope: 'live' });
    repo.grantInTransaction(tx, { ownerId: target, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'target-demo-seed', units: 7, scope: 'demo' });
  });
  const project = db.prepare('SELECT id,original_asset_id FROM projects WHERE owner_id=?').get(source) as { id: string; original_asset_id: string };
  return { db, dbPath, dir, guestCookie, source, target, accessToken: pair.accessToken, projectId: project.id, originalId: project.original_asset_id, bytes, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function plansAndHistory(f: Fixture) {
  const { db, source, projectId, originalId } = f;
  const planRows = [
    ['plan-orphan', null, '2030-01-01T00:00:00.000Z', '{ "immutable": "orphan" }'],
    ['plan-task-linked', null, '2029-01-01T00:00:00.000Z', '{ "semantic": {"ownerId":"source"}, "immutable":"task" }'],
    ['plan-confirmed-linked', NOW, '2028-01-01T00:00:00.000Z', '{"immutable":"confirmed"}'],
    ['plan-confirmed-alone', NOW, '2027-01-01T00:00:00.000Z', '{"immutable":"confirmed-alone"}'],
  ] as const;
  for (const [id, confirmed, expires, snapshot] of planRows) db.prepare(`INSERT INTO plans(id,owner_id,project_id,source_asset_id,plan_digest,snapshot_json,user_cost_units,confirmed_at,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, source, projectId, originalId, hash(snapshot), snapshot, 1, confirmed, expires, NOW);
  const task = db.prepare(`INSERT INTO tasks(id,owner_id,project_id,plan_id,confirmed_plan_id,submission_id,status,user_cost_units,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  task.run('history-task-linked', source, projectId, 'plan-task-linked', null, 'history-submission-one', 'succeeded', 1, NOW, NOW);
  task.run('history-task-confirmed', source, projectId, null, 'plan-confirmed-linked', 'history-submission-two', 'failed', 1, NOW, NOW);
  const lot = db.prepare('SELECT id FROM credit_lots WHERE owner_id=?').get(source) as { id: string };
  db.prepare('INSERT INTO reservations(id,owner_id,task_id,units,status,created_at) VALUES(?,?,?,?,?,?)').run('history-reservation', source, 'history-task-linked', 1, 'settled', NOW);
  db.prepare('INSERT INTO reservation_allocations(owner_id,reservation_id,credit_lot_id,units) VALUES(?,?,?,?)').run(source, 'history-reservation', lot.id, 1);
  db.prepare(`INSERT INTO ledger_events(id,owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id,created_at)
    VALUES(?,?,?,?,?,'settle',1,?,?)`).run('history-settle-event', source, 'history-settle-key', 'history-task-linked', lot.id, source, NOW);
  db.prepare('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES(?,?,?,?,?)').run('source-trial-one', source, 'trial-first', 1, NOW);
  db.prepare('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES(?,?,?,?,?)').run('source-trial-two', source, 'trial-second', 1, NOW);
  db.prepare('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES(?,?,?,?,?)').run('target-trial-two', f.target, 'trial-second', 1, NOW);
  db.prepare('INSERT INTO consents(id,owner_id,policy_version,purposes_json,provider_id,created_at) VALUES(?,?,?,?,?,?)').run('source-consent', source, 'historic-policy', '[]', 'historic-provider', NOW);
  db.prepare("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,'legacy.historic','{\"owner\":\"opaque\"}',?)").run('source-audit', source, NOW);
}

function service(f: Fixture) { return createMergeService({ db: f.db, clock: () => new Date(NOW) }); }
function request(f: Fixture, idempotencyKey = 'upgrade-request-001') { return { guestCookie: f.guestCookie, targetAccessToken: f.accessToken, idempotencyKey }; }
function extraSession(db: DatabaseSync, apple: boolean) {
  const owner = randomUUID(); db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(owner, NOW);
  if (apple) db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), owner, 'apple', `synthetic-apple-${owner}`, NOW);
  return new WalletRepository(db).transaction(tx => issueSessionInTransaction(tx, owner, NOW, { token: () => randomBytes(32).toString('base64url') })).accessToken;
}

async function raceWorkers(f: Fixture, requests: ReturnType<typeof request>[]): Promise<any[]> {
  const workers = requests.map(input => new Worker(`
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';
    const { createMergeService } = await import(workerData.moduleUrl);
    const db = new DatabaseSync(workerData.dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
    parentPort.postMessage({kind:'ready'});
    await new Promise(resolve => parentPort.once('message', resolve));
    try { parentPort.postMessage({kind:'result',result:createMergeService({db,clock:()=>new Date(workerData.now)}).upgrade(workerData.request)}); }
    catch(error) { parentPort.postMessage({kind:'error',code:error.code??null,message:error.message}); }
    finally { db.close(); }
  `, { eval: true, execArgv: ['--import','tsx/esm'], workerData: { dbPath: f.dbPath, moduleUrl: new URL('../../server/v2/merge.ts', import.meta.url).href, now: NOW, request: input } }));
  try {
    const ready = workers.map(worker => new Promise<void>((resolve, reject) => {
      worker.on('message', message => { if (message.kind === 'ready') resolve(); }); worker.once('error', reject);
    }));
    const outcomes = workers.map(worker => new Promise<any>((resolve, reject) => {
      worker.on('message', message => { if (message.kind === 'result') resolve(message); else if (message.kind === 'error') resolve(message); }); worker.once('error', reject);
    }));
    await Promise.all(ready); for (const worker of workers) worker.postMessage('go');
    return await Promise.all(outcomes);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

test('merge keeps F03 assets and versions readable through F07 after a one-time upgrade', async () => {
  const f = await fixture();
  try {
    plansAndHistory(f);
    const coverBefore = (f.db.prepare('SELECT cover_version_id FROM projects WHERE id=?').get(f.projectId) as any).cover_version_id;
    assert.equal(typeof coverBefore, 'string');
    assert.equal((f.db.prepare('SELECT owner_id FROM versions WHERE id=?').get(coverBefore) as any).owner_id, f.source);
    const beforePlans = f.db.prepare('SELECT id,plan_digest,snapshot_json,user_cost_units,confirmed_at,expires_at,created_at FROM plans WHERE owner_id=? ORDER BY id').all(f.source) as Record<string, unknown>[];
    const beforeEvents = f.db.prepare('SELECT id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id,created_at FROM ledger_events WHERE owner_id=?').all(f.source) as Record<string, unknown>[];
    const beforeVersions = f.db.prepare('SELECT id,parent_version_id,master_asset_id,display_asset_id,task_id,name,favorite,created_at FROM versions WHERE owner_id=?').all(f.source);
    const result = service(f).upgrade(request(f));
    assert.equal(result.status, 'completed');
    assert.equal(result.sourceOwnerId, f.source); assert.equal(result.targetOwnerId, f.target);
    assert.equal(hasDirectCompletedOwnerUpgrade(f.db, f.source, f.target), true);
    assert.equal((f.db.prepare('SELECT owner_id,original_asset_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.target);
    assert.equal((f.db.prepare('SELECT original_asset_id FROM projects WHERE id=?').get(f.projectId) as any).original_asset_id, f.originalId);
    assert.equal((f.db.prepare('SELECT cover_version_id FROM projects WHERE id=?').get(f.projectId) as any).cover_version_id, coverBefore);
    assert.equal((f.db.prepare('SELECT owner_id FROM versions WHERE id=?').get(coverBefore) as any).owner_id, f.target);
    assert.deepEqual(f.db.prepare('SELECT id,parent_version_id,master_asset_id,display_asset_id,task_id,name,favorite,created_at FROM versions WHERE owner_id=?').all(f.target), beforeVersions);
    assert.equal((f.db.prepare('SELECT owner_id,source_ref,edits_json FROM drafts WHERE project_id=?').get(f.projectId) as any).owner_id, f.target);
    const keptPlans = f.db.prepare('SELECT id,owner_id,plan_digest,snapshot_json,user_cost_units,confirmed_at,expires_at,created_at FROM plans WHERE project_id=? ORDER BY id').all(f.projectId) as Record<string, unknown>[];
    assert.equal(f.db.prepare('SELECT 1 FROM plans WHERE id=?').get('plan-orphan'), undefined);
    assert.equal(keptPlans.length, 3);
    for (const row of keptPlans) {
      const before = beforePlans.find(item => item.id === row.id)!;
      assert.equal(row.owner_id, f.target);
      for (const key of ['plan_digest','snapshot_json','user_cost_units','confirmed_at','expires_at','created_at']) assert.equal(row[key], before[key]);
    }
    assert.equal((f.db.prepare('SELECT plan_id FROM tasks WHERE id=?').get('history-task-linked') as any).plan_id, 'plan-task-linked');
    assert.equal((f.db.prepare('SELECT confirmed_plan_id FROM tasks WHERE id=?').get('history-task-confirmed') as any).confirmed_plan_id, 'plan-confirmed-linked');
    assert.deepEqual(f.db.prepare('SELECT user_id,trial_program_id FROM trial_claims ORDER BY id').all().map(row => ({ ...row })), [
      { user_id: f.source, trial_program_id: 'trial-first' }, { user_id: f.source, trial_program_id: 'trial-second' }, { user_id: f.target, trial_program_id: 'trial-second' },
    ]);
    assert.deepEqual(new WalletRepository(f.db).transaction(tx => workspaceTrialProgramsInTransaction(tx, f.target)), ['trial-first', 'trial-second']);
    assert.deepEqual(f.db.prepare('SELECT scope,sum(available_units) AS units FROM credit_lots WHERE owner_id=? GROUP BY scope ORDER BY scope').all(f.target).map(row => ({ ...row })), [{ scope: 'demo', units: 10 }, { scope: 'live', units: 4 }]);
    const transferredEvents = f.db.prepare('SELECT id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id,created_at FROM ledger_events WHERE owner_id=?').all(f.target).filter(row => beforeEvents.some(event => event.id === row.id)).map(row => ({ ...row }));
    assert.deepEqual(transferredEvents, beforeEvents.map(row => ({ ...row })));
    assert.equal((f.db.prepare('SELECT owner_id FROM consents WHERE id=?').get('source-consent') as any).owner_id, f.source);
    assert.equal((f.db.prepare('SELECT owner_id FROM audit_events WHERE id=?').get('source-audit') as any).owner_id, f.source);
    assert.equal((f.db.prepare('SELECT revoked_at FROM v2_sessions WHERE token_kind=? AND owner_id=?').get('legacy', f.source) as any).revoked_at, NOW);
    assert.equal((f.db.prepare('SELECT revoked_at FROM session_families WHERE owner_id=?').get(f.source) as any).revoked_at, NOW);
    assert.equal(resolveAccessPrincipal(f.db, f.accessToken, new Date(NOW))?.ownerId, f.target);
    const rows = f.db.prepare("SELECT id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at FROM assets WHERE project_id=? AND kind IN ('original','master') ORDER BY kind").all(f.projectId) as unknown as AssetRow[];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.owner_id, f.target); assert.match(row.storage_key, new RegExp(`^legacy://${f.source}/`));
      assert.deepEqual(readAuthorizedLegacyBytes(f.db, row), f.bytes);
      const read = await readGenerationBase(createSqlAssetReader(f.db), row.id, f.target, f.projectId);
      assert.equal(read.provenance.rawSha256, hash(f.bytes));
    }
    assert.equal((f.db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);

    const counts = ['projects','assets','versions','drafts','plans','tasks','credit_lots','reservations','reservation_allocations','ledger_events','trial_claims'].map(table => count(f.db, table));
    const replay = service(f).upgrade(request(f));
    assert.equal(replay.status, 'replayed');
    f.db.prepare("UPDATE v2_sessions SET expires_at=? WHERE owner_id=? AND token_kind='legacy'").run('2026-10-13T02:59:59.999Z', f.source);
    assert.equal(service(f).upgrade(request(f)).status, 'replayed');
    assert.throws(() => service(f).upgrade(request(f, 'upgrade-request-002')), code('UPGRADE_CONFLICT'));
    assert.deepEqual(['projects','assets','versions','drafts','plans','tasks','credit_lots','reservations','reservation_allocations','ledger_events','trial_claims'].map(table => count(f.db, table)), counts);
  } finally { f.close(); }
});

test('active work in either workspace is deferred without moving or cancelling it', async () => {
  for (const activeOwner of ['source','target'] as const) {
    const f = await fixture();
    try {
      const owner = activeOwner === 'source' ? f.source : f.target;
      let project = f.projectId;
      if (owner === f.target) {
        project = 'target-active-project';
        f.db.prepare('INSERT INTO projects(id,owner_id,name,created_at) VALUES(?,?,?,?)').run(project, owner, 'Target', NOW);
      }
      f.db.prepare("INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at,updated_at) VALUES(?,?,?,?, 'uncertain',1,?,?)").run(`active-${activeOwner}`, owner, project, `active-submission-${activeOwner}`, NOW, NOW);
      const result = service(f).upgrade(request(f));
      assert.equal(result.status, 'deferred');
      assert.equal((f.db.prepare('SELECT owner_id,status FROM tasks WHERE id=?').get(`active-${activeOwner}`) as any).owner_id, owner);
      assert.equal((f.db.prepare('SELECT revoked_at FROM v2_sessions WHERE owner_id=? AND token_kind=?').get(f.source, 'legacy') as any).revoked_at, null);
      assert.equal((f.db.prepare('SELECT status FROM owner_upgrades WHERE source_owner_id=?').get(f.source) as any).status, 'deferred');
      assert.equal(count(f.db, 'tasks'), 1);
      f.db.prepare("UPDATE tasks SET status='failed' WHERE id=?").run(`active-${activeOwner}`);
      assert.equal(service(f).upgrade(request(f)).status, 'completed');
      assert.equal(f.db.prepare("SELECT count(*) n FROM tasks WHERE status IN ('queued','processing','uncertain')").get() && (f.db.prepare("SELECT count(*) n FROM tasks WHERE status IN ('queued','processing','uncertain')").get() as any).n, 0);
    } finally { f.close(); }
  }
});

test('unresolved supplier exposure or cost defers source and target upgrades', async () => {
  for (const side of ['source', 'target'] as const) for (const state of ['started', 'uncertain', 'unknown-cost'] as const) {
    const f = await fixture();
    try {
      const owner = side === 'source' ? f.source : f.target;
      let project = f.projectId;
      if (side === 'target') {
        project = `supplier-${side}-${state}-project`;
        f.db.prepare('INSERT INTO projects(id,owner_id,name,created_at) VALUES(?,?,?,?)').run(project, owner, 'Synthetic supplier', NOW);
      }
      const task = `supplier-${side}-${state}-task`;
      f.db.prepare("INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at,updated_at) VALUES(?,?,?,?,'failed',1,?,?)").run(task, owner, project, `${task}-submission`, NOW, NOW);
      const exposureStatus = state === 'started' ? 'started' : state === 'uncertain' ? 'uncertain' : 'settled';
      const attemptStatus = state === 'started' ? 'started' : state === 'uncertain' ? 'uncertain' : 'failed';
      const endedAt = state === 'started' ? null : NOW;
      f.db.prepare(`INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at)
        VALUES(?,?,?,?,?,100,'USD','profile_max_cost_usd_micros',?,?,?)`).run(`${task}-exposure`, owner, task, 'synthetic-profile', 'v1', exposureStatus, NOW, NOW);
      f.db.prepare(`INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,estimated_cost_usd_micros,reconciled_cost_usd_micros,started_at,ended_at,provider_profile_version)
        VALUES(?,?,?,?,?,100,NULL,?,?,?)`).run(`${task}-attempt`, owner, task, 'synthetic-profile', attemptStatus, NOW, endedAt, 'v1');
      assert.equal(service(f).upgrade(request(f)).status, 'deferred');
      assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
      assert.equal((f.db.prepare("SELECT revoked_at FROM v2_sessions WHERE owner_id=? AND token_kind='legacy'").get(f.source) as any).revoked_at, null);
      assert.equal((f.db.prepare('SELECT status FROM owner_upgrades WHERE source_owner_id=?').get(f.source) as any).status, 'deferred');
      f.db.prepare("UPDATE supplier_attempts SET status='failed',reconciled_cost_usd_micros=0,ended_at=? WHERE id=?").run(NOW, `${task}-attempt`);
      f.db.prepare("UPDATE supplier_exposures SET status='settled',updated_at=? WHERE id=?").run(NOW, `${task}-exposure`);
      assert.equal(service(f).upgrade(request(f)).status, 'completed');
    } finally { f.close(); }
  }
});

test('cross-account, forged owner IDs and non-Apple sessions cannot authorize an upgrade', async () => {
  const f = await fixture();
  try {
    assert.throws(() => service(f).upgrade({ ...request(f), targetOwnerId: f.source } as any), code('INVALID_MERGE_REQUEST'));
    assert.throws(() => service(f).upgrade(Object.assign(request(f), { [Symbol('extra')]: true })), code('INVALID_MERGE_REQUEST'));
    assert.throws(() => service(f).upgrade({ ...request(f), targetAccessToken: 'not-a-session' }), code('AUTH_REQUIRED'));
    assert.throws(() => service(f).upgrade({ ...request(f), targetAccessToken: extraSession(f.db, false) }), code('AUTH_REQUIRED'));
    assert.throws(() => service(f).upgrade({ ...request(f), guestCookie: 'some-other-cookie' }), code('GUEST_AUTH_REQUIRED'));
    assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
    assert.equal(count(f.db, 'owner_upgrades'), 0);
    assert.equal(service(f).upgrade(request(f)).status, 'completed');
    assert.throws(() => service(f).upgrade({ ...request(f), targetAccessToken: extraSession(f.db, true) }), code('UPGRADE_CONFLICT'));
    assert.equal(count(f.db, 'owner_upgrades'), 1);
  } finally { f.close(); }
});

test('new upgrades require a live legacy family and canonical nonexpired optional cookie expiry', async () => {
  for (const invalidExpiry of ['2026-10-13T02:59:59.999Z', 'not-a-date']) {
    const f = await fixture();
    try {
      f.db.prepare("UPDATE v2_sessions SET expires_at=? WHERE owner_id=? AND token_kind='legacy'").run(invalidExpiry, f.source);
      assert.throws(() => service(f).upgrade(request(f)), code('GUEST_AUTH_REQUIRED'));
      assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
      assert.equal(count(f.db, 'owner_upgrades'), 0);
    } finally { f.close(); }
  }
  const f = await fixture();
  try {
    f.db.prepare('UPDATE session_families SET revoked_at=? WHERE owner_id=?').run(NOW, f.source);
    assert.throws(() => service(f).upgrade(request(f)), code('GUEST_AUTH_REQUIRED'));
    assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
    assert.equal(count(f.db, 'owner_upgrades'), 0);
  } finally { f.close(); }
});

test('purchase or unresolved deletion state fails closed before any account mutation', async () => {
  for (const reason of ['purchase','deletion'] as const) {
    const f = await fixture();
    try {
      if (reason === 'purchase') f.db.prepare(`INSERT INTO purchases(id,owner_id,environment,transaction_id,product_id,created_at) VALUES(?,?,?,?,?,?)`).run('source-purchase', f.source, 'sandbox', 'synthetic-transaction', 'synthetic-product', NOW);
      else f.db.prepare('INSERT INTO deletion_jobs(id,owner_id,status,created_at) VALUES(?,?,?,?)').run('source-deletion', f.source, 'queued', NOW);
      if (reason === 'purchase') assert.throws(() => service(f).upgrade(request(f)), code('PURCHASE_TRANSFER_UNSUPPORTED'));
      else assert.equal(service(f).upgrade(request(f)).status, 'deferred');
      assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
      assert.equal((f.db.prepare('SELECT revoked_at FROM v2_sessions WHERE owner_id=? AND token_kind=?').get(f.source, 'legacy') as any).revoked_at, null);
      assert.equal(count(f.db, 'owner_upgrades'), reason === 'deletion' ? 1 : 0);
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { f.close(); }
  }
});

test('owner-scoped ledger key collision rejects the whole transfer', async () => {
  const f = await fixture();
  try {
    const sourceEvent = f.db.prepare("SELECT ledger_event_key FROM ledger_events WHERE owner_id=? AND event_type='grant'").get(f.source) as { ledger_event_key: string };
    const targetLot = f.db.prepare("SELECT id FROM credit_lots WHERE owner_id=? AND scope='demo'").get(f.target) as { id: string };
    f.db.prepare(`INSERT INTO ledger_events(id,owner_id,ledger_event_key,credit_lot_id,event_type,units,origin_owner_id,created_at)
      VALUES(?,?,?,?,'grant',1,?,?)`).run('target-conflicting-event', f.target, sourceEvent.ledger_event_key, targetLot.id, f.target, NOW);
    assert.throws(() => service(f).upgrade(request(f)), code('MERGE_COLLISION'));
    assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
    assert.equal((f.db.prepare('SELECT revoked_at FROM v2_sessions WHERE owner_id=? AND token_kind=?').get(f.source, 'legacy') as any).revoked_at, null);
    assert.equal(count(f.db, 'owner_upgrades'), 0);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('legacy empty grant keys merge while nonempty owner-scoped grant collisions reject', async () => {
  for (const key of ['', 'same-nonempty-grant-key']) {
    const f = await fixture();
    try {
      f.db.prepare("UPDATE credit_lots SET source_event_key=? WHERE scope='demo' AND owner_id IN (?,?)").run(key, f.source, f.target);
      if (key) assert.throws(() => service(f).upgrade(request(f)), code('MERGE_COLLISION'));
      else {
        assert.equal(service(f).upgrade(request(f)).status, 'completed');
        assert.equal((f.db.prepare("SELECT count(*) n FROM credit_lots WHERE owner_id=? AND source_event_key=''").get(f.target) as any).n, 2);
      }
      assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, key ? f.source : f.target);
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { f.close(); }
  }
});

test('one guest credential racing two Apple targets can complete only one mapping', async () => {
  const f = await fixture();
  try {
    const second = extraSession(f.db, true);
    const outcomes = await raceWorkers(f, [request(f), { guestCookie: f.guestCookie, targetAccessToken: second, idempotencyKey: 'upgrade-request-002' }]);
    assert.equal(outcomes.filter(item => item.kind === 'result' && item.result.status === 'completed').length, 1);
    assert.equal(outcomes.filter(item => item.kind === 'error' && item.code === 'UPGRADE_CONFLICT').length, 1);
    assert.equal(count(f.db, 'owner_upgrades'), 1);
    const projectOwner = (f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id;
    assert.ok([f.target, (f.db.prepare("SELECT user_id FROM identities WHERE provider='apple' AND subject LIKE 'synthetic-apple-%' AND user_id<>?").get(f.target) as any).user_id].includes(projectOwner));
    assert.equal(hasDirectCompletedOwnerUpgrade(f.db, f.source, projectOwner), true);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('a late transaction failure rolls ownership and revocation back together', async () => {
  const f = await fixture();
  try {
    plansAndHistory(f);
    f.db.exec("CREATE TRIGGER reject_completed_upgrade BEFORE INSERT ON owner_upgrades WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    assert.throws(() => service(f).upgrade(request(f)), code('MERGE_FAILED'));
    assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
    assert.equal((f.db.prepare('SELECT revoked_at FROM v2_sessions WHERE owner_id=? AND token_kind=?').get(f.source, 'legacy') as any).revoked_at, null);
    assert.equal(count(f.db, 'owner_upgrades'), 0);
    assert.ok(f.db.prepare('SELECT 1 FROM plans WHERE id=?').get('plan-orphan'));
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('two SQLite workers serialize the same upgrade into one completion and one replay', async () => {
  const f = await fixture();
  try {
    const outcomes = await raceWorkers(f, [request(f), request(f)]);
    assert.deepEqual(outcomes.map(item => item.result.status).sort(), ['completed','replayed']);
    assert.equal(count(f.db, 'owner_upgrades'), 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM projects WHERE owner_id=?').get(f.target) as any).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM credit_lots WHERE owner_id=? AND scope=?').get(f.target, 'demo') as any).n, 2);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('target access expiry is rechecked after waiting for the SQLite write lock', async () => {
  const f = await fixture();
  const blocker = new Worker(`
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(workerData.dbPath); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    parentPort.postMessage('ready');
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); parentPort.postMessage('released'); }, 150);
  `, { eval: true, workerData: { dbPath: f.dbPath } });
  try {
    await new Promise<void>((resolve, reject) => { blocker.on('message', message => { if (message === 'ready') resolve(); }); blocker.once('error', reject); });
    const times = [new Date(NOW), new Date(Date.parse(NOW) + 16 * 60_000)];
    let call = 0;
    assert.throws(() => createMergeService({ db: f.db, clock: () => times[Math.min(call++, times.length - 1)] }).upgrade(request(f)), code('AUTH_REQUIRED'));
    await new Promise<void>((resolve, reject) => { blocker.on('message', message => { if (message === 'released') resolve(); }); blocker.once('error', reject); });
    assert.equal((f.db.prepare('SELECT owner_id FROM projects WHERE id=?').get(f.projectId) as any).owner_id, f.source);
    assert.equal(count(f.db, 'owner_upgrades'), 0);
    assert.equal((f.db.prepare("SELECT revoked_at FROM v2_sessions WHERE owner_id=? AND token_kind='legacy'").get(f.source) as any).revoked_at, null);
  } finally { await blocker.terminate(); f.close(); }
});
