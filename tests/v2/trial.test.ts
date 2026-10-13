import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import sharp from 'sharp';
import { openV2Database } from '../../server/v2/db.js';
import { createBudgetService, type ApprovedBudgetPolicy } from '../../server/v2/budget.js';
import { createConsentService, type ConsentCatalog } from '../../server/v2/consents.js';
import { createProjectService } from '../../server/v2/projects.js';
import { createPlanService, type PlanConfiguration, type PlanSnapshot } from '../../server/v2/plans.js';
import { createSessionService, revokeOwnerSessionsInTransaction } from '../../server/v2/sessions.js';
import { createTaskService, supplierLiability, type TaskRequest } from '../../server/v2/tasks.js';
import { createWorkerService } from '../../server/v2/worker.js';
import { createTasksRouter } from '../../server/v2/routes-tasks.js';
import { createTrialRouter } from '../../server/v2/routes-trial.js';
import { createTrialService, DEFAULT_TRIAL_POLICY, FIRST_TRIAL_PROGRAM_ID, type TrialCampaignPolicy } from '../../server/v2/trial.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { createSubmissionStore } from '../../src/lib/submission-store.js';
import { createV2Api, type PlanQuoteDTO } from '../../src/lib/api-v2.js';
import { trialPresentation } from '../../src/features/purchase/trial.js';

const now = '2026-10-13T03:00:00.000Z';
const profile = { supplierProfileId: 'profile-test', profileVersion: 'profile-v1', providerId: 'provider-test', protocol: 'openai-images-edits' as const,
  endpoint: 'https://api.openai.com/v1/images/edits', model: 'synthetic-model', templateVersion: 'template-v1', maxSupplierCostMicrosUSD: 25_000,
  output: { format: 'png' as const, size: '1024x1024' as const, quality: 'low' as const }, qualityEvidence: 'synthetic-quality-review', timeoutMs: 1000,
  maxInputBytes: 1_000_000, maxOutputBytes: 2_000_000, maxResponseBytes: 3_000_000 };
const catalog: ConsentCatalog = { providers: ['provider-test'], policies: [{ id: 'policy-test', version: 'consent-v7', providerId: 'provider-test', purposes: { photoRights: 'photo-rights', uploadStorage: 'private-storage', sharing: 'model-precheck' } }] };
const planConfig = (): PlanConfiguration => ({ liveEnabled: true, liveCandidates: ['profile-test'], profiles: [{ providerId: profile.providerId, profile: {
  id: profile.supplierProfileId, version: profile.profileVersion, protocol: profile.protocol, endpoint: profile.endpoint, model: profile.model,
  templateVersion: profile.templateVersion, fields: ['bodyColor', 'wheelColor'], originalReference: true, approvedForLive: true,
  officialEvidence: 'https://developers.openai.com/synthetic-evidence', qualityEvidence: profile.qualityEvidence, maxCostMicrosUSD: profile.maxSupplierCostMicrosUSD,
  timeoutMs: profile.timeoutMs, maxInputBytes: profile.maxInputBytes, maxOutputBytes: profile.maxOutputBytes, maxResponseBytes: profile.maxResponseBytes, output: profile.output,
} }], policyVersion: 'processing-v1', requiredGenerationPurpose: 'model-precheck', budget: { maxSupplierCostMicrosUSD: 100_000 }, sourcePolicy: { version: 'source-v1', allowedKinds: ['user_upload'] } });
const budgetPolicy = (overrides: Partial<ApprovedBudgetPolicy> = {}): ApprovedBudgetPolicy => ({ externalSpendApproved: true, profile,
  globalBudgetMicrosUSD: 100_000, accountBudgetMicrosUSD: 50_000, maxActiveTasksGlobal: 8, maxActiveTasksPerAccount: 1,
  maxConcurrentAttemptsGlobal: 4, maxConcurrentAttemptsPerAccount: 2, maxAcceptedPerWindowGlobal: 20, maxAcceptedPerWindowPerAccount: 10,
  maxAttemptsPerWindowGlobal: 20, maxAttemptsPerWindowPerAccount: 10, windowMs: 60_000, ...overrides });
const campaign = (overrides: Partial<TrialCampaignPolicy> = {}): TrialCampaignPolicy => ({ approved: true, enabled: true,
  campaignId: 'campaign-one', units: 1, budgetUnits: 1, maxSupplierCostMicrosUSD: profile.maxSupplierCostMicrosUSD, ...overrides });
const image = (color: string) => sharp({ create: { width: 64, height: 40, channels: 4, background: color } }).png().toBuffer();
type Owner = { id: string; projectId: string; consentId: string; accessToken: string; familyId: string };
type Fixture = { db: DatabaseSync; dbPath: string; dir: string; owners: Record<string, Owner>; close(): void };
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'form-trial-')), dbPath = join(dir, 'form.sqlite'), db = openV2Database(dbPath), owners: Record<string, Owner> = {};
  const sessions = createSessionService({ db, clock: () => new Date(now) });
  for (const [index, id] of ['owner-a', 'owner-b', 'owner-target'].entries()) {
    db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(id, now);
    db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run(`identity-${id}`, id, 'apple', `subject-${id}`, now);
    const consentId = createConsentService(db, catalog).issue(id, { policyId: 'policy-test', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: true }).consentRecordId;
    const project = await createProjectService({ db, consentCatalog: catalog, storageQuotaBytes: 300_000_000 }).create(id, consentId, await image(index ? '#542984' : '#144c88'), 'Synthetic trial project', 'user_upload');
    const session = sessions.issue(id);
    owners[id] = { id, projectId: project.projectId, consentId, accessToken: session.accessToken, familyId: session.familyId };
  }
  return { db, dbPath, dir, owners, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } } satisfies Fixture;
}
function budget(db: DatabaseSync) { return createBudgetService({ db, approvedPolicy: budgetPolicy(), clock: () => new Date(now) }); }
function trial(f: Fixture, options: { policy?: unknown; getPolicy?: () => unknown; approvedBudget?: boolean; clock?: () => Date } = {}) {
  return createTrialService({ db: f.db, campaign: options.policy === undefined ? null : options.policy,
    ...(options.getPolicy ? { getCampaign: options.getPolicy } : {}), budget: options.approvedBudget === false ? undefined : budget(f.db),
    consentCatalog: catalog, config: planConfig(), storageQuotaBytes: 300_000_000, clock: options.clock ?? (() => new Date(now)) });
}
const livePlan = (f: Fixture, owner: Owner) => createPlanService({ db: f.db, consentCatalog: catalog, config: planConfig(), clock: () => new Date(now) })
  .quote(owner.id, owner.projectId, owner.consentId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } });
const request = (plan: PlanSnapshot, id: string): TaskRequest => ({ planId: plan.planId, submissionId: id, consentRecordId: plan.semantic.consent.recordId });
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const errorCode = (code: string) => (error: unknown) => error instanceof Error && (error as { code?: string }).code === code;
const addOneLiveCredit = (db: DatabaseSync, ownerId: string) => {
  const repo = new WalletRepository(db);
  return repo.transaction(tx => repo.grantInTransaction(tx, { ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: `seed:${ownerId}:existing`, units: 1, scope: 'live', createdAt: now }));
};

test('default trial policy and F27 budget both fail closed without writes; availability defaults closed', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), service = trial(f);
    assert.deepEqual({ ...DEFAULT_TRIAL_POLICY }, { approved: false, enabled: false, campaignId: 'disabled', units: 0, budgetUnits: 0, maxSupplierCostMicrosUSD: 0 });
    assert.deepEqual(service.availability(owner.accessToken), { status: 'disabled' });
    await assert.rejects(() => service.submit(owner.accessToken, request(plan, 'closed-trial')), errorCode('TRIAL_UNAVAILABLE'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
    await assert.rejects(() => trial(f, { policy: campaign(), approvedBudget: false }).submit(owner.accessToken, request(plan, 'budget-closed')), errorCode('TRIAL_BUDGET_CLOSED'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0);
  } finally { f.close(); }
});

test('trial requires zero live spendable balance and never creates a second grant over existing credits', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner); addOneLiveCredit(f.db, owner.id);
    assert.deepEqual(trial(f, { policy: campaign() }).availability(owner.accessToken), { status: 'use_existing_balance' });
    await assert.rejects(() => trial(f, { policy: campaign() }).submit(owner.accessToken, request(plan, 'existing-balance')), errorCode('TRIAL_USE_EXISTING_CREDITS'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 1);
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots').get() as { available_units: number }).available_units, 1);
  } finally { f.close(); }
});

test('trial compares its approved per-call cap to the frozen provider quote', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner);
    await assert.rejects(() => trial(f, { policy: campaign({ maxSupplierCostMicrosUSD: 26_000 }) }).submit(owner.accessToken, request(plan, 'cap-mismatch')), errorCode('TRIAL_UNAVAILABLE'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
  } finally { f.close(); }
});

test('F20 session revocation is checked again inside F09 acceptance transaction', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner); let calls = 0, revokedInsideTransaction = false;
    const clock = () => {
      calls++;
      if (calls === 4 && f.db.isTransaction) {
        revokedInsideTransaction = true;
        f.db.prepare('UPDATE session_families SET revoked_at=? WHERE owner_id=? AND id=?').run(now, owner.id, owner.familyId);
      }
      return new Date(now);
    };
    await assert.rejects(() => trial(f, { policy: campaign(), clock }).submit(owner.accessToken, request(plan, 'session-race')),
      (error: unknown) => errorCode('AUTH_REQUIRED')(error));
    assert.equal(revokedInsideTransaction, true); assert.equal(f.db.isTransaction, false);
    assert.equal((f.db.prepare('SELECT revoked_at FROM session_families WHERE owner_id=? AND id=?').get(owner.id, owner.familyId) as { revoked_at: string | null }).revoked_at, null, 'rejected transaction rolls back its synthetic revocation');
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
  } finally { f.close(); }
});

test('Apple identity is rechecked within acceptance and a failed check writes nothing', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner); let removedInsideTransaction = false;
    const service = createTrialService({ db: f.db, campaign: campaign(), budget: budget(f.db), consentCatalog: catalog, config: planConfig(),
      storageQuotaBytes: 300_000_000, clock: () => new Date(now), getCampaign: () => {
        if (f.db.isTransaction && !removedInsideTransaction) {
          removedInsideTransaction = true;
          f.db.prepare("DELETE FROM identities WHERE user_id=? AND provider='apple'").run(owner.id);
        }
        return campaign();
      } });
    await assert.rejects(() => service.submit(owner.accessToken, request(plan, 'identity-race')), errorCode('TRIAL_APPLE_IDENTITY_REQUIRED'));
    assert.equal(removedInsideTransaction, true); assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
    assert.equal(count(f.db, 'identities'), 3, 'identity deletion in the rejected acceptance transaction rolls back');
  } finally { f.close(); }
});

test('real SQLite workers atomically admit only one trial within a global one-unit budget', async () => {
  const f = await fixture(); try {
    const a = f.owners['owner-a']!, b = f.owners['owner-b']!, pa = await livePlan(f, a), pb = await livePlan(f, b);
    const workerSource = `
      import { parentPort, workerData } from 'node:worker_threads';
      import { DatabaseSync } from 'node:sqlite';
      (async () => {
        const [{ createTrialService }, { createBudgetService }] = await Promise.all([import(workerData.trialModule), import(workerData.budgetModule)]);
        const db = new DatabaseSync(workerData.dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        const budget = createBudgetService({ db, approvedPolicy: workerData.approvedPolicy, clock: () => new Date(workerData.now) });
        const service = createTrialService({ db, campaign: workerData.campaign, budget, consentCatalog: workerData.catalog,
          config: workerData.config, storageQuotaBytes: 300000000, clock: () => new Date(workerData.now) });
        parentPort.postMessage('ready'); await new Promise(resolve => parentPort.once('message', value => value === 'go' && resolve()));
        try { const result = await service.submit(workerData.token, workerData.input); parentPort.postMessage({ ok: true, taskId: result.task.id, ownerId: workerData.ownerId }); }
        catch (error) { parentPort.postMessage({ ok: false, code: error.code || 'WORKER_FAILED' }); }
        finally { db.close(); parentPort.close(); }
      })().catch(error => parentPort.postMessage({ ok: false, code: error.code || 'WORKER_FAILED' }));
    `;
    const jobs = [{ owner: a, input: request(pa, 'budget-race-a') }, { owner: b, input: request(pb, 'budget-race-b') }];
    const workers = jobs.map(item => new Worker(workerSource, { eval: true, execArgv: ['--import', 'tsx/esm'], workerData: {
      dbPath: f.dbPath, trialModule: new URL('../../server/v2/trial.ts', import.meta.url).href,
      budgetModule: new URL('../../server/v2/budget.ts', import.meta.url).href, catalog, config: planConfig(), campaign: campaign(),
      approvedPolicy: budgetPolicy(), now, token: item.owner.accessToken, ownerId: item.owner.id, input: item.input,
    } }));
    const results: Array<{ ok: boolean; code?: string; taskId?: string; ownerId?: string }> = []; let ready = 0, exited = 0;
    await new Promise<void>((resolve, reject) => {
      for (const worker of workers) {
        worker.on('message', message => {
          if (message === 'ready') { if (++ready === workers.length) for (const peer of workers) peer.postMessage('go'); }
          else results.push(message as { ok: boolean; code?: string; taskId?: string; ownerId?: string });
        });
        worker.on('error', reject);
        worker.on('exit', code => { if (code !== 0) reject(new Error(`trial worker exited ${code}`)); if (++exited === workers.length) resolve(); });
      }
    });
    assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
    assert.equal(results.filter(result => !result.ok && result.code === 'TRIAL_BUDGET_EXHAUSTED').length, 1, JSON.stringify(results));
    assert.equal(count(f.db, 'trial_claims'), 1); assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'reservations'), 1);
    assert.equal(count(f.db, 'credit_lots'), 1); assert.equal(count(f.db, 'supplier_exposures'), 1);
    const winner = results.find(result => result.ok)!;
    assert.deepEqual({ ...(f.db.prepare('SELECT id,user_id,trial_program_id,units FROM trial_claims').get() as object) }, { id: winner.taskId, user_id: winner.ownerId, trial_program_id: FIRST_TRIAL_PROGRAM_ID, units: 1 });
  } finally { f.close(); }
});

test('failed plan confirmation rolls back task, claim, trial grant, reservation and exposure together', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner);
    f.db.exec("CREATE TRIGGER fail_trial_plan_confirm BEFORE UPDATE OF confirmed_at ON plans BEGIN SELECT RAISE(ABORT,'synthetic final write'); END");
    await assert.rejects(() => trial(f, { policy: campaign() }).submit(owner.accessToken, request(plan, 'trigger-rollback')));
    for (const table of ['tasks', 'trial_claims', 'credit_lots', 'reservations', 'reservation_allocations', 'ledger_events', 'supplier_exposures']) assert.equal(count(f.db, table), 0, table);
    assert.equal((f.db.prepare('SELECT confirmed_at FROM plans WHERE id=?').get(plan.planId) as { confirmed_at: string | null }).confirmed_at, null);
  } finally { f.close(); }
});

test('ordinary task replay through trial endpoint is rejected without a claim marker', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, 'regular-collision'); addOneLiveCredit(f.db, owner.id);
    const regular = await createTaskService({ db: f.db, consentCatalog: catalog, config: planConfig(), storageQuotaBytes: 300_000_000, clock: () => new Date(now) }).submit(owner.id, input);
    await assert.rejects(() => trial(f, { policy: campaign() }).submit(owner.accessToken, input), errorCode('TRIAL_CLAIM_REQUIRED'));
    assert.equal(regular.task.status, 'queued'); assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 1);
  } finally { f.close(); }
});

test('F22 completed guest-source lifetime claim blocks the target Apple account', async () => {
  const f = await fixture(); try {
    const source = f.owners['owner-a']!, target = f.owners['owner-target']!, plan = await livePlan(f, target);
    f.db.prepare('INSERT INTO trial_claims(id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)').run('guest-prior-claim', source.id, 'prior-program', 1, now);
    f.db.prepare("INSERT INTO owner_upgrades(source_owner_id,target_owner_id,request_digest,created_at,completed_at,status) VALUES (?,?,?,?,?,'completed')").run(source.id, target.id, 'a'.repeat(64), now, now);
    assert.deepEqual(trial(f, { policy: campaign() }).availability(target.accessToken), { status: 'already_claimed' });
    await assert.rejects(() => trial(f, { policy: campaign() }).submit(target.accessToken, request(plan, 'source-claim-block')), errorCode('TRIAL_ALREADY_CLAIMED'));
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 1); assert.equal(count(f.db, 'credit_lots'), 0);
  } finally { f.close(); }
});

test('same accepted trial replays after campaign closure and keeps the stable first-trial program', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), input = request(plan, 'closed-replay'); let active: unknown = campaign();
    const service = trial(f, { getPolicy: () => active });
    const first = await service.submit(owner.accessToken, input); active = { approved: false, enabled: false, campaignId: 'closed', units: 0, budgetUnits: 0, maxSupplierCostMicrosUSD: 0 };
    const replay = await service.submit(owner.accessToken, input);
    assert.equal(first.task.id, replay.task.id); assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
    assert.deepEqual({ ...(f.db.prepare('SELECT id,user_id,trial_program_id,units FROM trial_claims').get() as object) }, { id: first.task.id, user_id: owner.id, trial_program_id: FIRST_TRIAL_PROGRAM_ID, units: 1 });
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'credit_lots'), 1); assert.equal(count(f.db, 'ledger_events'), 2);
  } finally { f.close(); }
});

test('accepted replay rechecks a session revoked while its response is pending', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), service = trial(f, { policy: campaign() });
    const input = request(plan, 'revoked-replay'), accepted = await service.submit(owner.accessToken, input);
    const pending = service.submit(owner.accessToken, input);
    new WalletRepository(f.db).transaction(tx => revokeOwnerSessionsInTransaction(tx, owner.id, now));
    await assert.rejects(pending, errorCode('AUTH_REQUIRED'));
    assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'trial_claims'), 1); assert.equal(count(f.db, 'credit_lots'), 1);
    assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get(accepted.task.id)?.status, 'queued');
  } finally { f.close(); }
});

test('a malformed asynchronous budget guard is refused and its rejection cannot escape the closed transaction', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner);
    const service = createTrialService({ db: f.db, campaign: campaign(), consentCatalog: catalog, config: planConfig(),
      storageQuotaBytes: 300_000_000, clock: () => new Date(now), budget: {
        beforeAccept: () => Promise.reject(new Error('synthetic asynchronous budget')) as never,
      } });
    await assert.rejects(() => service.submit(owner.accessToken, request(plan, 'async-budget-refused')), errorCode('TRIAL_BUDGET_CLOSED'));
    await new Promise(resolve => setImmediate(resolve));
    for (const table of ['tasks', 'trial_claims', 'credit_lots', 'reservations', 'supplier_exposures']) assert.equal(count(f.db, table), 0, table);
  } finally { f.close(); }
});

test('F11 lost acknowledgment recovers through shared GET or the same trial endpoint before and after durable acceptance', async () => {
  for (const acceptedBeforeLoss of [false, true]) {
  const f = await fixture(); let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), app = express();
    const actorResolver = (req: express.Request) => {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') ?? '')?.[1];
      return token ? createSessionService({ db: f.db, clock: () => new Date(now) }).resolveAccess(token)?.ownerId ?? null : null;
    };
    app.use('/api/v2', createTasksRouter({ db: f.db, actorResolver, consentCatalog: catalog, config: planConfig(), storageQuotaBytes: 300_000_000, clock: () => new Date(now) }));
    app.use('/api/v2', createTrialRouter({ db: f.db, campaign: campaign(), budget: budget(f.db), consentCatalog: catalog, config: planConfig(), storageQuotaBytes: 300_000_000, clock: () => new Date(now) }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`, storage = new Map<string, string>();
    const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
    const firstStore = createSubmissionStore({ storage: localStorage, createId: () => 'lost-trial-id', now: () => now }); firstStore.activateActor(owner.id);
    const paths: string[] = [];
    const first = createV2Api({ store: firstStore, fetcher: async (input, init) => {
      paths.push(`${String(input)} POST`);
      if (acceptedBeforeLoss) {
        const headers = new Headers(init?.headers); headers.set('authorization', `Bearer ${owner.accessToken}`);
        const response = await fetch(new URL(String(input), base), { ...init, headers });
        assert.equal(response.status, 202); await response.arrayBuffer();
      }
      throw new TypeError('synthetic lost acknowledgment');
    } });
    await assert.rejects(() => first.submitConfirmedPlan(owner.id, plan as unknown as PlanQuoteDTO, owner.consentId, { operation: 'trial_claim' }));
    if (!acceptedBeforeLoss) assert.equal(count(f.db, 'tasks'), 0);
    else { assert.equal(count(f.db, 'tasks'), 1); assert.equal(count(f.db, 'trial_claims'), 1); }
    assert.equal(paths[0], '/api/v2/trial/claim POST');
    const refreshed = createSubmissionStore({ storage: localStorage, createId: () => 'must-not-be-used', now: () => now }); refreshed.activateActor(owner.id);
    const replay = createV2Api({ store: refreshed, fetcher: async (input, init) => {
      const path = String(input); paths.push(`${path} ${init?.method}`); const headers = new Headers(init?.headers); headers.set('authorization', `Bearer ${owner.accessToken}`);
      return fetch(new URL(path, base), { ...init, headers });
    } });
    const result = await replay.resumeSubmission(owner.id, 'lost-trial-id');
    assert.equal(result.status, 'queued'); assert.equal(result.userCostUnits, 1);
    if (!acceptedBeforeLoss) assert.deepEqual(paths, ['/api/v2/trial/claim POST', '/api/v2/submissions/lost-trial-id GET', '/api/v2/trial/claim POST']);
    else assert.deepEqual(paths, ['/api/v2/trial/claim POST', '/api/v2/submissions/lost-trial-id GET']);
    assert.equal((f.db.prepare('SELECT id FROM trial_claims').get() as { id: string }).id, result.id);
    const body = await f.db.prepare('SELECT submission_id FROM tasks WHERE id=?').get(result.id) as { submission_id: string };
    assert.equal(body.submission_id, 'lost-trial-id'); assert.equal(count(f.db, 'tasks'), 1);
    assert.equal(count(f.db, 'trial_claims'), 1); assert.equal(count(f.db, 'credit_lots'), 1); assert.equal(count(f.db, 'ledger_events'), 2);
  } finally { if (server) { server.close(); await once(server, 'close'); } f.close(); }
  }
});

test('failed trial releases its original lot while unknown supplier exposure stays held and eligibility remains claimed', async () => {
  const f = await fixture(); try {
    const owner = f.owners['owner-a']!, firstPlan = await livePlan(f, owner), service = trial(f, { policy: campaign() });
    const first = await service.submit(owner.accessToken, request(firstPlan, 'failed-trial-once'));
    const lot = f.db.prepare("SELECT id,available_units FROM credit_lots WHERE source_kind='trial'").get() as { id: string; available_units: number };
    const repo = new WalletRepository(f.db);
    const assetCount = count(f.db, 'assets'); let calls = 0;
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: planConfig(), storageQuotaBytes: 300_000_000,
      clock: () => new Date(now), liveDispatchEnabled: true, concurrency: 1, dispatchGuard: budget(f.db).dispatchGuard,
      serverProvider: async () => { calls++; return { ok: false, error: { code: 'PROVIDER_TIMEOUT_UNKNOWN', category: 'uncertain', retryable: false },
        attempted: true, providerRequestId: null, usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: profile.maxSupplierCostMicrosUSD }; } });
    assert.equal((await worker.runTask(first.task.id)).status, 'failed');
    assert.equal((await worker.runTask(first.task.id)).status, 'not_claimed');
    assert.equal(calls, 1); assert.equal(count(f.db, 'supplier_attempts'), 1); assert.equal(count(f.db, 'versions'), 0);
    assert.equal(count(f.db, 'assets'), assetCount);
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(first.task.id) as { status: string }).status, 'uncertain');
    assert.equal(repo.transaction(tx => supplierLiability(tx)), BigInt(profile.maxSupplierCostMicrosUSD));
    const released = f.db.prepare('SELECT id,available_units FROM credit_lots WHERE source_kind=\'trial\'').get() as { id: string; available_units: number };
    assert.equal(released.id, lot.id); assert.equal(released.available_units, 1);
    const nextPlan = await livePlan(f, owner);
    await assert.rejects(() => service.submit(owner.accessToken, request(nextPlan, 'failed-trial-no-refill')), errorCode('TRIAL_ALREADY_CLAIMED'));
    assert.equal(count(f.db, 'trial_claims'), 1); assert.equal(count(f.db, 'credit_lots'), 1); assert.equal(count(f.db, 'tasks'), 1);
  } finally { f.close(); }
});

test('route rejects missing or revoked Apple session tokens and returns only private no-store errors', async () => {
  const f = await fixture(); let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  try {
    const owner = f.owners['owner-a']!, plan = await livePlan(f, owner), app = express();
    app.use('/api/v2', createTrialRouter({ db: f.db, campaign: campaign(), budget: budget(f.db), consentCatalog: catalog, config: planConfig(), storageQuotaBytes: 300_000_000, clock: () => new Date(now) }));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/v2/trial/claim`, body = request(plan, 'unauth-trial');
    const missing = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(missing.status, 401); assert.equal(missing.headers.get('cache-control'), 'private, no-store');
    const extra = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` }, body: JSON.stringify({ ...body, ownerId: 'owner-b' }) });
    assert.equal(extra.status, 400); assert.equal(extra.headers.get('cache-control'), 'private, no-store');
    new WalletRepository(f.db).transaction(tx => revokeOwnerSessionsInTransaction(tx, owner.id, now));
    const revoked = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` }, body: JSON.stringify(body) });
    assert.equal(revoked.status, 401); assert.equal(revoked.headers.get('cache-control'), 'private, no-store');
    assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
  } finally { if (server) { server.close(); await once(server, 'close'); } f.close(); }
});

test('trial presentation defaults closed and shows balance-aware copy from trusted availability', () => {
  assert.deepEqual(trialPresentation(undefined), { label: 'Trial unavailable', message: 'Trial availability is currently disabled.', disabled: true });
  assert.deepEqual(trialPresentation({ status: 'use_existing_balance' }), { label: 'Use existing balance', message: 'Use your existing credits for this generation.', disabled: true });
  assert.deepEqual(trialPresentation({ status: 'check_required' }), { label: 'Check trial availability', message: 'The server checks eligibility when you confirm this plan.', disabled: false });
});

test('asynchronous campaign configuration closes availability without an unhandled rejection or grant', async () => {
  const f = await fixture(); try {
    for (const source of ['campaign', 'getter']) {
      const rejected = () => Promise.reject(new Error('synthetic rejected campaign callback'));
      const service = createTrialService({ db: f.db, clock: () => new Date(now),
        ...(source === 'campaign' ? { campaign: rejected() } : { getCampaign: rejected }) });
      assert.deepEqual(service.availability(f.owners['owner-a']!.accessToken), { status: 'disabled' });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(count(f.db, 'tasks'), 0); assert.equal(count(f.db, 'trial_claims'), 0); assert.equal(count(f.db, 'credit_lots'), 0);
    }
  } finally { f.close(); }
});
