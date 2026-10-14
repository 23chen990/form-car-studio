import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import express from 'express';
import sharp from 'sharp';
import { openV2Database } from '../../server/v2/db.js';
import { createConsentService, type ConsentCatalog } from '../../server/v2/consents.js';
import { createProjectService } from '../../server/v2/projects.js';
import { createPlanService, type PlanConfiguration, type PlanSnapshot } from '../../server/v2/plans.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { createTaskService, readTaskSnapshot, supplierLiability, TaskError, type BeforeAcceptHook, type TaskRequest, type TrustedFundingHook } from '../../server/v2/tasks.js';
import { createTasksRouter } from '../../server/v2/routes-tasks.js';

const now = '2026-10-13T03:00:00.000Z';
const catalog: ConsentCatalog = { providers: ['provider-test'], policies: [{ id: 'policy-test', version: 'consent-v7', providerId: 'provider-test', purposes: { photoRights: 'photo-rights', uploadStorage: 'private-storage', sharing: 'model-precheck' } }] };
const image = (color: string) => sharp({ create: { width: 64, height: 40, channels: 4, background: color } }).png().toBuffer();
function config(budget = 30_000, maxCost: number | null = 25_000): PlanConfiguration {
  return { liveEnabled: true, liveCandidates: ['profile-test'], profiles: [{ providerId: 'provider-test', profile: { id: 'profile-test', version: 'profile-v1', protocol: 'openai-images-edits', endpoint: 'https://api.openai.com/v1/images/edits', model: 'synthetic-model', templateVersion: 'template-v1', fields: ['bodyColor', 'wheelColor'], originalReference: true, approvedForLive: true, officialEvidence: 'https://developers.openai.com/synthetic-evidence', qualityEvidence: 'synthetic-quality-review', maxCostMicrosUSD: maxCost, timeoutMs: 1000, maxInputBytes: 1_000_000, maxOutputBytes: 2_000_000, maxResponseBytes: 3_000_000, output: { format: 'png', size: '1024x1024', quality: 'low' } } }], policyVersion: 'processing-v1', requiredGenerationPurpose: 'model-precheck', budget: { maxSupplierCostMicrosUSD: budget }, sourcePolicy: { version: 'source-v1', allowedKinds: ['user_upload'] } };
}
type Owner = { id: string; projectId: string; consentId: string; demoProjectId: string; demoConsentId: string };
type Fixture = { db: DatabaseSync; dir: string; dbPath: string; owners: Record<string, Owner>; registry: { id: string; bytes: Buffer; licenseEvidence: string }[]; close(): void };
type FundingHook = TrustedFundingHook;
if (false) {
  // @ts-expect-error Trusted funding must remain synchronous.
  const asyncHook: TrustedFundingHook = async () => ({ sourceEventKey: 'async' });
  void asyncHook;
  // @ts-expect-error Admission decisions must remain synchronous.
  const asyncAdmission: BeforeAcceptHook = async () => true;
  void asyncAdmission;
}
async function fixture(options: { credits?: boolean; apple?: boolean } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'form-submit-')), dbPath = join(dir, 'form.sqlite');
  const db = openV2Database(dbPath);
  const owners: Record<string, Owner> = {};
  const samples = [{ id: 'demo-approved', bytes: await image('#39744b'), licenseEvidence: 'synthetic-license-record' }];
  for (const [index, id] of ['owner-a', 'owner-b'].entries()) {
    db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(id, now);
    if (options.apple !== false) db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run(`identity-${id}`, id, 'apple', `subject-${id}`, now);
    const consentId = createConsentService(db, catalog).issue(id, { policyId: 'policy-test', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: true }).consentRecordId;
    const demoConsentId = createConsentService(db, catalog).issue(id, { policyId: 'policy-test', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: false }).consentRecordId;
    const projects = createProjectService({ db, consentCatalog: catalog, storageQuotaBytes: 300_000_000, demoRegistry: samples });
    const project = await projects.create(id, consentId, await image(index ? '#542984' : '#144c88'), 'Synthetic project', 'user_upload');
    const demoProject = await projects.create(id, demoConsentId, samples[0]!.bytes, 'Synthetic licensed sample', 'licensed_demo', samples[0]!.id);
    owners[id] = { id, projectId: project.projectId, consentId, demoProjectId: demoProject.projectId, demoConsentId };
    if (options.credits !== false) {
      const repo = new WalletRepository(db); repo.transaction(tx => {
        repo.grantInTransaction(tx, { ownerId: id, kind: 'promo', sourceKind: 'promo', sourceEventKey: `seed:${id}:live`, units: 3, scope: 'live' });
        repo.grantInTransaction(tx, { ownerId: id, kind: 'promo', sourceKind: 'promo', sourceEventKey: `seed:${id}:demo`, units: 3, scope: 'demo' });
      });
    }
  }
  return { db, dir, dbPath, owners, registry: samples, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const livePlan = (f: Fixture, owner: Owner, cfg = config()) => createPlanService({ db: f.db, consentCatalog: catalog, config: cfg, clock: () => new Date(now) }).quote(owner.id, owner.projectId, owner.consentId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } });
const demoConfig = (registry: Fixture['registry']): PlanConfiguration => ({ demoEnabled: true, demoPolicy: { version: 'demo-v1', registry, fields: ['bodyColor', 'wheelColor'] } });
const demoPlan = (f: Fixture, owner: Owner) => createPlanService({ db: f.db, consentCatalog: catalog, config: demoConfig(f.registry), clock: () => new Date(now) }).quote(owner.id, owner.demoProjectId, owner.demoConsentId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } });
function service(f: Fixture, overrides: { config?: PlanConfiguration; getConfig?: () => PlanConfiguration; storageQuotaBytes?: number | null; clock?: () => Date; trustedFunding?: FundingHook; beforeAccept?: BeforeAcceptHook } = {}) {
  return createTaskService({ db: f.db, consentCatalog: catalog, config: overrides.config ?? config(), getConfig: overrides.getConfig, storageQuotaBytes: overrides.storageQuotaBytes === undefined ? 300_000_000 : overrides.storageQuotaBytes, clock: overrides.clock ?? (() => new Date(now)), ...(overrides.trustedFunding ? { trustedFunding: overrides.trustedFunding } : {}), ...(overrides.beforeAccept ? { beforeAccept: overrides.beforeAccept } : {}) });
}
const request = (plan: PlanSnapshot, owner: Owner, submissionId = `submission-${randomUUID()}`): TaskRequest => ({ planId: plan.planId, submissionId, consentRecordId: owner.consentId });
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
function code(expected: string) { return (error: unknown) => error instanceof Error && (error as { code?: string }).code === expected; }
type WorkerResult = { ok: true; taskId: string; replayed: boolean } | { ok: false; code: string };
async function raceTaskWorkers(f: Fixture, work: { owner: Owner; input: TaskRequest }[], cfg = config(), admissionGate = false): Promise<WorkerResult[]> {
  const source = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';
    let db;
    (async () => {
      const { createTaskService } = await import(workerData.tasksModule);
      db = new DatabaseSync(workerData.dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const beforeAccept = workerData.admissionGate ? ({ tx }) => {
        const row = tx.get('SELECT accepted FROM test_admission_gate WHERE id=1');
        if (!row || row.accepted >= 1) return false;
        tx.run('UPDATE test_admission_gate SET accepted=accepted+1 WHERE id=1'); return true;
      } : undefined;
      const service = createTaskService({ db, consentCatalog: workerData.catalog, config: workerData.config, storageQuotaBytes: 300000000, clock: () => new Date(workerData.now), ...(beforeAccept ? { beforeAccept } : {}) });
      parentPort.postMessage('ready'); await new Promise(resolve => parentPort.once('message', value => value === 'go' && resolve()));
      try { const result = await service.submit(workerData.owner.id, workerData.input); parentPort.postMessage({ ok: true, taskId: result.task.id, replayed: result.replayed }); }
      catch (error) { parentPort.postMessage({ ok: false, code: error.code || 'REQUEST_FAILED' }); }
    })().catch(error => parentPort.postMessage({ ok: false, code: error.code || 'WORKER_FAILED' })).finally(() => { db?.close(); parentPort.close(); });
  `;
  const workers = work.map(item => new Worker(source, { eval: true, execArgv: ['--import', 'tsx/esm'], workerData: {
    dbPath: f.dbPath, tasksModule: new URL('../../server/v2/tasks.ts', import.meta.url).href, catalog, config: cfg, now, admissionGate, ...item,
  } }));
  return new Promise((resolve, reject) => {
    let ready = 0, exited = 0; const results: WorkerResult[] = [];
    for (const worker of workers) {
      worker.on('message', message => {
        if (message === 'ready') { if (++ready === workers.length) for (const peer of workers) peer.postMessage('go'); return; }
        results.push(message as WorkerResult);
      });
      worker.on('error', reject);
      worker.on('exit', code => { if (code !== 0) reject(new Error(`F09 worker exit ${code}`)); if (++exited === workers.length) resolve(results); });
    }
  });
}

test('F09 exposes a task submission service before accepting submissions', () => {
  assert.equal(typeof createTaskService, 'function');
  assert.equal(typeof readTaskSnapshot, 'function');
});

test('same submission replays before quote expiry and returns no internal snapshot', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner, 'persisted-submit-1');
    const first = await service(f).submit(owner.id, input);
    const replay = await service(f, { clock: () => new Date(Date.parse(plan.expiresAt) + 1) }).submit(owner.id, input);
    assert.equal(first.task.id, replay.task.id); assert.equal(replay.replayed, true); assert.equal(replay.task.status, 'queued');
    assert.equal(Object.hasOwn(replay.task, 'request_snapshot_json'), false);
    assert.equal(readTaskSnapshot((f.db.prepare('SELECT request_snapshot_json FROM tasks WHERE id=?').get(first.task.id) as { request_snapshot_json: string }).request_snapshot_json).scope, 'live');
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as { n: number }).n, 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
  } finally { f.close(); }
});

test('changed semantics under one key conflicts and a new key cannot confirm the same plan twice', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner, 'same-key');
    const first = await service(f).submit(owner.id, input);
    await assert.rejects(() => service(f).submit(owner.id, { ...input, consentRecordId: 'other-consent' }), code('SUBMISSION_CONFLICT'));
    await assert.rejects(() => service(f).submit(owner.id, request(plan, owner, 'new-key')), code('PLAN_ALREADY_CONFIRMED'));
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE source_event_key=?').get('seed:owner-a:live') as { available_units: number }).available_units, 2);
    assert.ok(first.task.id);
  } finally { f.close(); }
});

test('owner scope hides another owner submission and task', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), accepted = await service(f).submit(owner.id, request(plan, owner, 'private-submit'));
    assert.throws(() => service(f).readBySubmission('owner-b', 'private-submit'), code('TASK_NOT_FOUND'));
    assert.throws(() => service(f).readTask('owner-b', accepted.task.id), code('TASK_NOT_FOUND'));
  } finally { f.close(); }
});

test('submission rejects missing storage quota, insufficient credits, and failed final mutation without partial rows', async () => {
  const f = await fixture({ credits: false }); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner);
    await assert.rejects(() => service(f, { storageQuotaBytes: null }).submit(owner.id, input), code('STORAGE_QUOTA_UNAVAILABLE'));
    await assert.rejects(() => service(f).submit(owner.id, input), code('INSUFFICIENT_CREDITS'));
    f.db.exec("CREATE TRIGGER fail_plan_confirm BEFORE UPDATE OF confirmed_at ON plans BEGIN SELECT RAISE(ABORT,'injected final write failure'); END");
    await assert.rejects(() => service(f).submit(owner.id, input));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'reservation_allocations'), 0); assert.equal(count(f.db, 'ledger_events'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
    assert.equal((f.db.prepare('SELECT confirmed_at FROM plans WHERE id=?').get(plan.planId) as { confirmed_at: string | null }).confirmed_at, null);
  } finally { f.close(); }
});

test('server admission gate runs after validation, before funding, and never runs on replay', async () => {
  const f = await fixture({ credits: false }); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner, 'admission-gate-replay'), auditBefore = count(f.db, 'audit_events'); let deniedCalls = 0, allowedCalls = 0, fundingCalls = 0;
    const trustedFunding: FundingHook = ({ tx, ownerId, plan: frozen }) => {
      fundingCalls++; tx.run('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)', `admission-${ownerId}`, ownerId, 'synthetic-admission', frozen.semantic.userCostUnits, now);
      return { sourceEventKey: `trial:admission:${ownerId}` };
    };
    const denied: BeforeAcceptHook = context => {
      deniedCalls++; assert.deepEqual(Object.keys(context).sort(), ['currentLiabilityMicrosUSD','maximumExposureMicrosUSD','ownerId','plan','projectId','taskId','tx']);
      assert.equal(context.ownerId, owner.id); assert.equal(context.projectId, owner.projectId); assert.ok(context.taskId); assert.equal(context.plan.planId, plan.planId);
      assert.equal(context.maximumExposureMicrosUSD, 25_000); assert.equal(context.currentLiabilityMicrosUSD, 0n);
      context.tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?,?,?,?)', 'denied-admission-audit', owner.id, 'test.admission.denied', '{}', now);
      return false;
    };
    await assert.rejects(() => service(f, { trustedFunding, beforeAccept: denied }).submit(owner.id, input), code('TASK_ADMISSION_REJECTED'));
    assert.equal(deniedCalls, 1); assert.equal(fundingCalls, 0); assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
    assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0); assert.equal(count(f.db, 'audit_events'), auditBefore);
    assert.equal((f.db.prepare('SELECT confirmed_at FROM plans WHERE id=?').get(plan.planId) as {confirmed_at:string|null}).confirmed_at, null);

    const beforeAccept: BeforeAcceptHook = context => { allowedCalls++; assert.equal(context.currentLiabilityMicrosUSD, 0n); return true; };
    const accepted = await service(f, { trustedFunding, beforeAccept }).submit(owner.id, input);
    assert.equal(accepted.task.status, 'queued'); assert.equal(allowedCalls, 1); assert.equal(fundingCalls, 1);
    const replay = await service(f, { trustedFunding, beforeAccept, clock: () => new Date(Date.parse(plan.expiresAt) + 1) }).submit(owner.id, input);
    assert.equal(replay.task.id, accepted.task.id); assert.equal(replay.replayed, true); assert.equal(allowedCalls, 1); assert.equal(fundingCalls, 1);
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'trial_claims'), 1);
  } finally { f.close(); }
});

test('admission gate preserves TaskError status and consumes async late transaction use after rollback', async () => {
  const f = await fixture({ credits: false }); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner, 'admission-async'), auditBefore = count(f.db, 'audit_events');
    const typed: BeforeAcceptHook = ({ tx }) => { tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?,?,?,?)', 'typed-admission-audit', owner.id, 'test.admission.typed', '{}', now); throw new TaskError('SYNTHETIC_REVIEW_REQUIRED', 429); };
    await assert.rejects(() => service(f, { beforeAccept: typed }).submit(owner.id, input), (error: unknown) => error instanceof TaskError && error.code === 'SYNTHETIC_REVIEW_REQUIRED' && error.status === 429);
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'audit_events'), auditBefore);

    let started!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const asyncGate = (async ({ tx }: Parameters<BeforeAcceptHook>[0]) => {
      tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?,?,?,?)', 'async-admission-audit', owner.id, 'test.admission.async', '{}', now);
      started(); await barrier;
      tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?,?,?,?)', 'late-admission-audit', owner.id, 'test.admission.late', '{}', now);
      return true;
    }) as unknown as BeforeAcceptHook;
    const pending = service(f, { beforeAccept: asyncGate }).submit(owner.id, input); await entered;
    await assert.rejects(() => pending, code('TASK_ADMISSION_ASYNC_FORBIDDEN')); release(); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(count(f.db, 'audit_events'), auditBefore); assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
  } finally { f.close(); }
});

test('server trusted funding grants and reserves a live trial atomically; expired replay never calls it again', async () => {
  const f = await fixture({ credits: false }); try {
    const owner = f.owners['owner-a']!, cfg = config(), plan = await livePlan(f, owner, cfg); let calls = 0;
    const trustedFunding: FundingHook = ({ tx, ownerId, plan: frozen }) => {
      calls++;
      tx.run('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)', `claim-${ownerId}`, ownerId, 'synthetic-first-task', frozen.semantic.userCostUnits, now);
      return { sourceEventKey: `trial:${ownerId}:synthetic-first-task` };
    };
    const input = request(plan, owner, 'trusted-trial');
    const accepted = await service(f, { config: cfg, trustedFunding }).submit(owner.id, input);
    assert.equal(accepted.task.status, 'queued'); assert.equal(calls, 1);
    const lot = f.db.prepare('SELECT owner_id,kind,source_kind,units,scope FROM credit_lots WHERE source_event_key=?').get(`trial:${owner.id}:synthetic-first-task`) as {owner_id:string;kind:string;source_kind:string;units:number;scope:string};
    assert.deepEqual({ ...lot }, { owner_id: owner.id, kind: 'promo', source_kind: 'trial', units: plan.semantic.userCostUnits, scope: 'live' });
    assert.equal((f.db.prepare('SELECT units,status FROM reservations WHERE task_id=?').get(accepted.task.id) as {units:number;status:string}).units, plan.semantic.userCostUnits);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='grant'").get() as {n:number}).n, 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as {n:number}).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM supplier_exposures WHERE task_id=?').get(accepted.task.id) as {n:number}).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM trial_claims WHERE user_id=?').get(owner.id) as {n:number}).n, 1);
    const replay = await service(f, { config: cfg, clock: () => new Date(Date.parse(plan.expiresAt) + 1), trustedFunding }).submit(owner.id, input);
    assert.equal(replay.task.id, accepted.task.id); assert.equal(replay.replayed, true); assert.equal(calls, 1);
    assert.equal(count(f.db, 'credit_lots'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'trial_claims'), 1);
  } finally { f.close(); }
});

test('trial funding cannot leave its grant unused behind an older promo allocation', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner);
    f.db.prepare("UPDATE credit_lots SET created_at='2026-10-12T03:00:00.000Z' WHERE scope='live'").run();
    const trustedFunding: TrustedFundingHook = ({ tx, ownerId }) => {
      tx.run('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)', 'older-promo-claim', ownerId, 'synthetic-first-task', 1, now);
      return { sourceEventKey: 'trial:older-promo' };
    };
    await assert.rejects(() => service(f, { trustedFunding }).submit(owner.id, request(plan, owner, 'older-promo-trial')), code('TRUSTED_FUNDING_ALLOCATION_CONFLICT'));
    assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0);
    assert.equal(f.db.prepare("SELECT 1 FROM credit_lots WHERE source_event_key='trial:older-promo'").get(), undefined);
    assert.equal((f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='seed:owner-a:live'").get() as {available_units:number}).available_units, 3);
  } finally { f.close(); }
});

test('trusted funding SQL, trial grant, reservation and exposure roll back on final plan write failure', async () => {
  const f = await fixture({ credits: false }); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner); let calls = 0;
    const trustedFunding: FundingHook = ({ tx, ownerId, plan: frozen }) => {
      calls++;
      tx.run('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)', `rollback-${ownerId}`, ownerId, 'synthetic-first-task', frozen.semantic.userCostUnits, now);
      return { sourceEventKey: `trial:${ownerId}:rollback` };
    };
    f.db.exec("CREATE TRIGGER fail_trial_plan_confirm BEFORE UPDATE OF confirmed_at ON plans BEGIN SELECT RAISE(ABORT,'injected trial confirmation failure'); END");
    await assert.rejects(() => service(f, { trustedFunding }).submit(owner.id, request(plan, owner, 'trial-rollback')));
    assert.equal(calls, 1); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'reservation_allocations'), 0);
    assert.equal(count(f.db, 'ledger_events'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
    assert.equal((f.db.prepare('SELECT confirmed_at FROM plans WHERE id=?').get(plan.planId) as {confirmed_at:string|null}).confirmed_at, null);
  } finally { f.close(); }
});

test('async trusted funding hook is rejected, late guarded SQL is consumed, and no task money remains', async () => {
  const f = await fixture({ credits: false }); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner);
    const trustedFunding = (async ({ tx, ownerId, plan: frozen }: Parameters<FundingHook>[0]) => {
      await new Promise(resolve => setTimeout(resolve, 0));
      tx.run('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)', 'late-claim', ownerId, 'late-program', frozen.semantic.userCostUnits, now);
      return { sourceEventKey: 'trial:late' };
    }) as unknown as FundingHook;
    await assert.rejects(() => service(f, { trustedFunding }).submit(owner.id, request(plan, owner, 'async-trial')), code('TRUSTED_FUNDING_ASYNC_FORBIDDEN'));
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0); assert.equal(count(f.db, 'tasks'), 0);
    assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'ledger_events'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
  } finally { f.close(); }
});

test('live global budget counts reserved exposure across owners and rejects unknown supplier caps', async () => {
  const f = await fixture(); try {
    const a = f.owners['owner-a']!, b = f.owners['owner-b']!, pa = await livePlan(f, a), pb = await livePlan(f, b);
    await service(f).submit(a.id, request(pa, a));
    await assert.rejects(() => service(f).submit(b.id, request(pb, b)), code('SUPPLIER_BUDGET_EXCEEDED'));
    assert.equal((f.db.prepare("SELECT count(*) n FROM tasks WHERE owner_id='owner-b'").get() as { n: number }).n, 0);
    const closed = config(30_000, null);
    await assert.rejects(() => livePlan(f, b, closed), code('PLAN_UNAVAILABLE'));
    assert.equal(count(f.db, 'supplier_exposures'), 1);
  } finally { f.close(); }
});

test('two concurrent new plans for one owner cannot create two active tasks or reservations', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, p1 = await livePlan(f, owner), p2 = await createPlanService({ db: f.db, consentCatalog: catalog, config: config(), clock: () => new Date(now) }).quote(owner.id, owner.projectId, owner.consentId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { wheelColor: { action: 'set', value: 'bronze' } } });
    const results = await Promise.allSettled([service(f).submit(owner.id, request(p1, owner, 'race-a')), service(f).submit(owner.id, request(p2, owner, 'race-b'))]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(results.filter(x => x.status === 'rejected').length, 1);
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as { n: number }).n, 1);
  } finally { f.close(); }
});

test('SQLite worker barrier makes same-key requests converge on one task and reservation', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner, 'worker-same-key');
    const results = await raceTaskWorkers(f, [{ owner, input }, { owner, input }]);
    assert.equal(results.filter(x => x.ok).length, 2, JSON.stringify(results)); assert.equal(new Set(results.filter((x): x is Extract<WorkerResult, { ok: true }> => x.ok).map(x => x.taskId)).size, 1);
    assert.deepEqual(results.filter((x): x is Extract<WorkerResult, { ok: true }> => x.ok).map(x => x.replayed).sort(), [false, true]);
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as { n: number }).n, 1);
  } finally { f.close(); }
});

test('SQLite worker barrier allows only one new plan for an owner with two devices', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, p1 = await livePlan(f, owner), p2 = await createPlanService({ db: f.db, consentCatalog: catalog, config: config(), clock: () => new Date(now) }).quote(owner.id, owner.projectId, owner.consentId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { wheelColor: { action: 'set', value: 'bronze' } } });
    const results = await raceTaskWorkers(f, [{ owner, input: request(p1, owner, 'worker-new-plan-a') }, { owner, input: request(p2, owner, 'worker-new-plan-b') }]);
    assert.equal(results.filter(x => x.ok).length, 1, JSON.stringify(results)); assert.equal(results.filter(x => !x.ok && x.code === 'ACTIVE_TASK_EXISTS').length, 1, JSON.stringify(results));
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as { n: number }).n, 1);
  } finally { f.close(); }
});

test('SQLite worker barrier prevents different owners from oversubscribing global supplier budget', async () => {
  const f = await fixture(); try {
    const a = f.owners['owner-a']!, b = f.owners['owner-b']!, pa = await livePlan(f, a), pb = await livePlan(f, b);
    const results = await raceTaskWorkers(f, [{ owner: a, input: request(pa, a, 'budget-race-a') }, { owner: b, input: request(pb, b, 'budget-race-b') }]);
    assert.equal(results.filter(x => x.ok).length, 1, JSON.stringify(results)); assert.equal(results.filter(x => !x.ok && x.code === 'SUPPLIER_BUDGET_EXCEEDED').length, 1, JSON.stringify(results));
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as { n: number }).n, 1);
  } finally { f.close(); }
});

test('SQLite worker barrier enforces a server admission ceiling across different owners', async () => {
  const f = await fixture(); try {
    const a = f.owners['owner-a']!, b = f.owners['owner-b']!, cfg = config(100_000), pa = await livePlan(f, a, cfg), pb = await livePlan(f, b, cfg);
    f.db.exec('CREATE TABLE test_admission_gate(id INTEGER PRIMARY KEY,accepted INTEGER NOT NULL); INSERT INTO test_admission_gate VALUES (1,0)');
    const results = await raceTaskWorkers(f, [{ owner: a, input: request(pa, a, 'admission-race-a') }, { owner: b, input: request(pb, b, 'admission-race-b') }], cfg, true);
    assert.equal(results.filter(x => x.ok).length, 1, JSON.stringify(results)); assert.equal(results.filter(x => !x.ok && x.code === 'TASK_ADMISSION_REJECTED').length, 1, JSON.stringify(results));
    assert.equal((f.db.prepare('SELECT accepted FROM test_admission_gate WHERE id=1').get() as {accepted:number}).accepted, 1);
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'reservation_allocations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE event_type='reserve'").get() as {n:number}).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) n FROM plans WHERE confirmed_at IS NOT NULL').get() as {n:number}).n, 1);
  } finally { f.close(); }
});

test('live submission fails closed on a breached or unknown prior supplier liability', async () => {
  const f = await fixture(); try {
    const a = f.owners['owner-a']!, b = f.owners['owner-b']!, cfg = config(100_000), pa = await livePlan(f, a, cfg), pb = await livePlan(f, b, cfg);
    const accepted = await service(f, { config: cfg }).submit(a.id, request(pa, a, 'liability-source'));
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,started_at,reconciled_cost_usd_micros) VALUES (?,?,?,?,?,?,?)").run('attempt-liability', a.id, accepted.task.id, 'profile-test', 'succeeded', now, 25_001);
    await assert.rejects(() => service(f, { config: cfg }).submit(b.id, request(pb, b, 'liability-breached')), code('SUPPLIER_COST_CAP_BREACHED'));
    f.db.prepare('UPDATE supplier_attempts SET ended_at=? WHERE id=?').run(now, 'attempt-liability');
    f.db.prepare('DELETE FROM supplier_exposures WHERE owner_id=? AND task_id=?').run(a.id, accepted.task.id);
    await assert.rejects(() => service(f, { config: cfg }).submit(b.id, request(pb, b, 'liability-cap-lost')), code('SUPPLIER_LIABILITY_UNKNOWN'));
    f.db.prepare('UPDATE supplier_attempts SET reconciled_cost_usd_micros=NULL WHERE id=?').run('attempt-liability');
    await assert.rejects(() => service(f, { config: cfg }).submit(b.id, request(pb, b, 'liability-unknown')), code('SUPPLIER_LIABILITY_UNKNOWN'));
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1); assert.equal(count(f.db, 'supplier_exposures'), 0);
  } finally { f.close(); }
});

test('unresolved attempts retain their worst-case exposure even with a partial zero cost record', async () => {
  const f=await fixture();try{const a=f.owners['owner-a']!,b=f.owners['owner-b']!,pa=await livePlan(f,a),pb=await livePlan(f,b);
    const accepted=await service(f).submit(a.id,request(pa,a));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(accepted.task.id);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,started_at,reconciled_cost_usd_micros) VALUES (?,?,?,'profile-test','uncertain',?,0)").run('attempt-open',a.id,accepted.task.id,now);
    f.db.prepare("UPDATE tasks SET status='uncertain' WHERE id=?").run(accepted.task.id);
    f.db.prepare("UPDATE supplier_exposures SET status='uncertain' WHERE task_id=?").run(accepted.task.id);
    await assert.rejects(()=>service(f).submit(b.id,request(pb,b)),code('SUPPLIER_BUDGET_EXCEEDED'));
    assert.equal(count(f.db,'tasks'),1);assert.equal(count(f.db,'reservations'),1);assert.equal(count(f.db,'supplier_exposures'),1);
  }finally{f.close();}
});

test('settled supplier expense is counted once and does not add its old maximum exposure again',async()=>{
  const f=await fixture();try{const a=f.owners['owner-a']!,b=f.owners['owner-b']!,cfg=config(40_000),pa=await livePlan(f,a,cfg),pb=await livePlan(f,b,cfg);
    const accepted=await service(f,{config:cfg}).submit(a.id,request(pa,a));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(accepted.task.id);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,started_at,ended_at,reconciled_cost_usd_micros) VALUES (?,?,?,'profile-test','failed',?,?,10_000)").run('attempt-final',a.id,accepted.task.id,now,now);
    f.db.prepare("UPDATE supplier_exposures SET status='settled' WHERE task_id=?").run(accepted.task.id);
    const wallet=new WalletRepository(f.db);const released=wallet.transaction(tx=>wallet.finalizeTaskInTransaction(tx,{ownerId:a.id,taskId:accepted.task.id,outcome:'failed'}));assert.equal(released.returnedUnits,1);
    let seenLiability=-1n;const next=await service(f,{config:cfg,beforeAccept:context=>{seenLiability=context.currentLiabilityMicrosUSD;assert.equal(context.maximumExposureMicrosUSD,25_000);return undefined;}}).submit(b.id,request(pb,b));assert.equal(next.task.status,'queued');assert.equal(seenLiability,10_000n);assert.equal(count(f.db,'supplier_exposures'),2);
  }finally{f.close();}
});

test('owner-scoped supplier liability partitions settled and open exposure without changing the global total',async()=>{
  const f=await fixture();try{const a=f.owners['owner-a']!,b=f.owners['owner-b']!,cfg=config(100_000),pa=await livePlan(f,a,cfg),pb=await livePlan(f,b,cfg);
    const settled=await service(f,{config:cfg}).submit(a.id,request(pa,a,'liability-account-a')),open=await service(f,{config:cfg}).submit(b.id,request(pb,b,'liability-account-b'));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(settled.task.id);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,started_at,ended_at,reconciled_cost_usd_micros) VALUES (?,?,?,'profile-test','failed',?,?,10_000)").run('account-attempt-a',a.id,settled.task.id,now,now);
    f.db.prepare("UPDATE supplier_exposures SET status='settled' WHERE owner_id=? AND task_id=?").run(a.id,settled.task.id);
    const wallet=new WalletRepository(f.db);wallet.transaction(tx=>{
      const global=supplierLiability(tx),accountA=supplierLiability(tx,a.id),accountB=supplierLiability(tx,b.id);
      assert.equal(accountA,10_000n);assert.equal(accountB,25_000n);assert.equal(accountA+accountB,global);assert.equal(global,35_000n);
      assert.throws(()=>supplierLiability(tx,''),code('SUPPLIER_LIABILITY_UNKNOWN'));
    });assert.equal(open.task.status,'queued');
  }finally{f.close();}
});

test('owner-scoped supplier liability fails closed on cross-owner task references',async()=>{
  const f=await fixture();try{const a=f.owners['owner-a']!,b=f.owners['owner-b']!,cfg=config(100_000),pa=await livePlan(f,a,cfg),pb=await livePlan(f,b,cfg);
    const taskA=await service(f,{config:cfg}).submit(a.id,request(pa,a,'liability-cross-owner-a')),taskB=await service(f,{config:cfg}).submit(b.id,request(pb,b,'liability-cross-owner-b'));
    f.db.exec('PRAGMA foreign_keys=OFF');
    f.db.prepare('DELETE FROM supplier_exposures WHERE owner_id=? AND task_id=?').run(a.id,taskA.task.id);
    f.db.prepare('UPDATE supplier_exposures SET task_id=? WHERE owner_id=? AND task_id=?').run(taskA.task.id,b.id,taskB.task.id);
    f.db.exec('PRAGMA foreign_keys=ON');
    const wallet=new WalletRepository(f.db);wallet.transaction(tx=>{
      assert.throws(()=>supplierLiability(tx,a.id),code('SUPPLIER_LIABILITY_UNKNOWN'));
      assert.throws(()=>supplierLiability(tx,b.id),code('SUPPLIER_LIABILITY_UNKNOWN'));
    });
  }finally{f.close();}
});

test('owner-scoped supplier liability isolates another account from a missing-cap unknown attempt',async()=>{
  const f=await fixture();try{const a=f.owners['owner-a']!,b=f.owners['owner-b']!,cfg=config(100_000),pa=await livePlan(f,a,cfg),pb=await livePlan(f,b,cfg);
    const taskA=await service(f,{config:cfg}).submit(a.id,request(pa,a,'liability-unknown-account-a')),taskB=await service(f,{config:cfg}).submit(b.id,request(pb,b,'liability-clean-account-b'));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(taskA.task.id);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,started_at) VALUES (?,?,?,'profile-test','uncertain',?)").run('unknown-account-attempt-a',a.id,taskA.task.id,now);
    f.db.prepare("UPDATE tasks SET status='uncertain' WHERE id=?").run(taskA.task.id);
    f.db.prepare("DELETE FROM supplier_exposures WHERE owner_id=? AND task_id=?").run(a.id,taskA.task.id);
    const wallet=new WalletRepository(f.db);wallet.transaction(tx=>{
      assert.throws(()=>supplierLiability(tx,a.id),code('SUPPLIER_LIABILITY_UNKNOWN'));
      assert.equal(supplierLiability(tx,b.id),25_000n);
      assert.throws(()=>supplierLiability(tx),code('SUPPLIER_LIABILITY_UNKNOWN'));
    });assert.equal(taskB.task.status,'queued');
  }finally{f.close();}
});

test('safe task DTOs suppress arbitrary database error text and preserve known safe codes',async()=>{
  const f=await fixture();try{const owner=f.owners['owner-a']!,plan=await livePlan(f,owner),input=request(plan,owner),tasks=service(f),accepted=await tasks.submit(owner.id,input);
    f.db.prepare('UPDATE tasks SET safe_error_code=? WHERE id=?').run('synthetic-secret-path-and-cookie-marker',accepted.task.id);
    assert.equal(tasks.readTask(owner.id,accepted.task.id).safeErrorCode,null);
    assert.doesNotMatch(JSON.stringify(await tasks.submit(owner.id,input)),/synthetic-secret-path-and-cookie-marker/);
    f.db.prepare('UPDATE tasks SET safe_error_code=? WHERE id=?').run('PROVIDER_TIMEOUT_UNKNOWN',accepted.task.id);
    assert.equal(tasks.readBySubmission(owner.id,input.submissionId).safeErrorCode,'PROVIDER_TIMEOUT_UNKNOWN');
  }finally{f.close();}
});

test('licensed demo reserves only its virtual wallet units and creates no supplier exposure', async () => {
  const f = await fixture({ apple: false }); try {
    const owner = f.owners['owner-a']!, plan = await demoPlan(f, owner); let fundingCalls = 0;
    const accepted = await service(f, { config: demoConfig(f.registry), trustedFunding: () => { fundingCalls++; return { sourceEventKey: 'forbidden-demo-trial' }; } }).submit(owner.id, request(plan, { ...owner, consentId: owner.demoConsentId }));
    assert.equal(accepted.task.status, 'queued'); assert.equal(accepted.task.userCostUnits, 1);
    assert.equal(fundingCalls, 0); assert.equal(count(f.db, 'trial_claims'), 0);
    assert.equal(readTaskSnapshot((f.db.prepare('SELECT request_snapshot_json FROM tasks WHERE id=?').get(accepted.task.id) as { request_snapshot_json: string }).request_snapshot_json).scope, 'demo');
    assert.equal(count(f.db, 'supplier_exposures'), 0); assert.equal((f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='seed:owner-a:demo'").get() as { available_units: number }).available_units, 2);
    assert.equal((f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='seed:owner-a:live'").get() as { available_units: number }).available_units, 3);
  } finally { f.close(); }
});

test('zero-cost demo admission stays available when an unrelated live liability is unknown', async () => {
  const f = await fixture(); try {
    const owner=f.owners['owner-a']!,live=await livePlan(f,owner),accepted=await service(f).submit(owner.id,request(live,owner,'unknown-live-before-demo'));
    service(f).cancel(owner.id,accepted.task.id);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,started_at) VALUES (?,?,?,'profile-test','uncertain',?)").run('unknown-live-attempt',owner.id,accepted.task.id,now);
    f.db.prepare('DELETE FROM supplier_exposures WHERE owner_id=? AND task_id=?').run(owner.id,accepted.task.id);
    const plan=await demoPlan(f,owner),demoOwner={...owner,consentId:owner.demoConsentId};
    const result=await service(f,{config:demoConfig(f.registry),beforeAccept:context=>{assert.equal(context.maximumExposureMicrosUSD,0);assert.equal(context.currentLiabilityMicrosUSD,0n);return true;}}).submit(owner.id,request(plan,demoOwner,'demo-with-unknown-live-liability'));
    assert.equal(result.task.status,'queued');assert.equal(readTaskSnapshot((f.db.prepare('SELECT request_snapshot_json FROM tasks WHERE id=?').get(result.task.id) as {request_snapshot_json:string}).request_snapshot_json).scope,'demo');
    assert.equal(count(f.db,'supplier_attempts'),1);assert.equal(count(f.db,'supplier_exposures'),0);
  } finally { f.close(); }
});

test('live acceptance requires Apple identity while an unsafe quote cap and insufficient storage fail closed', async () => {
  const noApple = await fixture({ apple: false }); try {
    const owner = noApple.owners['owner-a']!, plan = await livePlan(noApple, owner), input = request(plan, owner); let fundingCalls = 0;
    await assert.rejects(() => service(noApple, { trustedFunding: () => { fundingCalls++; return { sourceEventKey: 'trial:no-apple' }; } }).submit(owner.id, input), code('LIVE_IDENTITY_REQUIRED'));
    assert.equal(fundingCalls, 0);
    assert.equal(count(noApple.db, 'tasks'), 0);
  } finally { noApple.close(); }
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, owner);
    await assert.rejects(() => service(f, { storageQuotaBytes: 1 }).submit(owner.id, input), code('STORAGE_QUOTA_EXCEEDED'));
    await assert.rejects(() => livePlan(f, owner, config(30_000, null)), code('PLAN_UNAVAILABLE'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
  } finally { f.close(); }
});

test('queued cancellation releases the reservation and only the unattempted exposure once', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), accepted = await service(f).submit(owner.id, request(plan, owner, 'cancel-queued'));
    const first = service(f).cancel(owner.id, accepted.task.id), replay = service(f).cancel(owner.id, accepted.task.id);
    assert.equal(first.task.status, 'cancelled'); assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
    assert.equal((f.db.prepare("SELECT status FROM reservations WHERE task_id=?").get(accepted.task.id) as { status: string }).status, 'released');
    assert.equal((f.db.prepare("SELECT status FROM supplier_exposures WHERE task_id=?").get(accepted.task.id) as { status: string }).status, 'released');
    assert.equal((f.db.prepare("SELECT available_units FROM credit_lots WHERE source_event_key='seed:owner-a:live'").get() as { available_units: number }).available_units, 3);
  } finally { f.close(); }
});

test('revocation while stored-plan validation is awaiting prevents acceptance', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), pending = service(f).submit(owner.id, request(plan, owner, 'revoked-during-await'));
    f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(now, owner.consentId);
    await assert.rejects(() => pending, code('CONSENT_INVALID'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
  } finally { f.close(); }
});

test('project tombstone during stored-plan reads prevents task acceptance', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), pending = service(f).submit(owner.id, request(plan, owner, 'deleted-during-await'));
    f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(now, owner.projectId);
    await assert.rejects(() => pending, code('PROJECT_NOT_FOUND'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'reservations'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
  } finally { f.close(); }
});

test('task routes enforce actor scope, exact request fields, and private no-store responses', async () => {
  const f = await fixture(); let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), app = express(); let admissionCalls = 0, fundingCalls = 0;
    app.use('/api/v2', createTasksRouter({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, clock: () => new Date(now), actorResolver: req => req.header('X-Test-Owner'), beforeAccept: () => { admissionCalls++; return undefined; }, trustedFunding: () => { fundingCalls++; return undefined; } }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/api/v2`;
    const body = request(plan, owner, 'route-submit');
    const posted = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Test-Owner': owner.id }, body: JSON.stringify(body) });
    const postedText = await posted.text(); assert.equal(posted.status, 202, postedText); assert.equal(posted.headers.get('cache-control'), 'private, no-store');
    assert.equal(admissionCalls, 1); assert.equal(fundingCalls, 1);
    const dto = JSON.parse(postedText) as Record<string, unknown>; assert.equal(Object.hasOwn(dto, 'request_snapshot_json'), false);
    const hidden = await fetch(`${base}/submissions/route-submit`, { headers: { 'X-Test-Owner': 'owner-b' } }); assert.equal(hidden.status, 404);
    const extra = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Test-Owner': owner.id }, body: JSON.stringify({ ...body, ownerId: 'owner-b' }) }); assert.equal(extra.status, 400);
    for (const injected of [{ beforeAccept: true }, { trustedFunding: { sourceEventKey: 'client-trial' } }, { money: { units: 1 } }]) {
      const rejected = await fetch(`${base}/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Test-Owner': owner.id }, body: JSON.stringify({ ...body, ...injected }) }); assert.equal(rejected.status, 400);
    }
    assert.equal(admissionCalls, 1); assert.equal(fundingCalls, 1);
  } finally { if (server) { server.close(); await once(server, 'close'); } f.close(); }
});
