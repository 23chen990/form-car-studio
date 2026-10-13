import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { openV2Database } from '../../server/v2/db.js';
import { createConsentService, type ConsentCatalog } from '../../server/v2/consents.js';
import { createProjectService } from '../../server/v2/projects.js';
import { createPlanService, providerEditRequest, type PlanConfiguration, type PlanSnapshot } from '../../server/v2/plans.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { createTaskService, supplierLiability, type TaskRequest } from '../../server/v2/tasks.js';
import { createWorkerService } from '../../server/v2/worker.js';
import { createRecoveryService } from '../../server/v2/recovery.js';
import { validateOutputMaster } from '../../server/v2/images.js';
import { canonicalJson } from '../../shared/v2/edit-plan.js';

const NOW = '2026-10-13T03:00:00.000Z';
const catalog: ConsentCatalog = { providers: ['provider-test'], policies: [{ id: 'policy-test', version: 'consent-v7', providerId: 'provider-test', purposes: { photoRights: 'photo-rights', uploadStorage: 'private-storage', sharing: 'model-precheck' } }] };
const colorImage = (color: string, width = 64, height = 40) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
const code = (value: string) => (error: unknown) => error instanceof Error && (error as { code?: string }).code === value;
function waitForWorkerMessage(worker: Worker, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`worker did not reach ${expected}`)); }, 10_000);
    const onMessage = (message: any) => {
      if (message === expected) { cleanup(); resolve(); }
      else if (message?.kind === 'error') { cleanup(); reject(new Error(message.error)); }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (exitCode: number) => { cleanup(); reject(new Error(`worker exited ${exitCode} before ${expected}`)); };
    worker.on('message', onMessage); worker.once('error', onError); worker.once('exit', onExit);
  });
}

function config(): PlanConfiguration {
  return { liveEnabled: true, liveCandidates: ['profile-test'], profiles: [{ providerId: 'provider-test', profile: { id: 'profile-test', version: 'profile-v1', protocol: 'openai-images-edits', endpoint: 'https://api.openai.com/v1/images/edits', model: 'synthetic-model', templateVersion: 'template-v1', fields: ['bodyColor', 'wheelColor'], originalReference: true, approvedForLive: true, officialEvidence: 'https://developers.openai.com/synthetic-evidence', qualityEvidence: 'synthetic-quality-review', maxCostMicrosUSD: 25_000, timeoutMs: 1000, maxInputBytes: 1_000_000, maxOutputBytes: 2_000_000, maxResponseBytes: 3_000_000, output: { format: 'png', size: '1024x1024', quality: 'low' } } }], policyVersion: 'processing-v1', requiredGenerationPurpose: 'model-precheck', budget: { maxSupplierCostMicrosUSD: 100_000 }, sourcePolicy: { version: 'source-v1', allowedKinds: ['user_upload'] } };
}
type Owner = { id: string; projectId: string; consentId: string; demoProjectId: string; demoConsentId: string; demoSourcePixel: string; demoSourceAssetId: string };
type Fixture = { db: DatabaseSync; dbPath: string; dir: string; owner: Owner; demoRegistry: { id: string; bytes: Buffer; licenseEvidence: string }[]; close(): void };
async function fixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'form-f10-')), dbPath = join(dir, 'form.sqlite'), db = openV2Database(dbPath), ownerId = 'owner-f10';
  db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(ownerId, NOW);
  db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run('identity-f10', ownerId, 'apple', 'synthetic-subject-f10', NOW);
  const consentId = createConsentService(db, catalog).issue(ownerId, { policyId: 'policy-test', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: true }).consentRecordId;
  const demoConsentId = createConsentService(db, catalog).issue(ownerId, { policyId: 'policy-test', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: false }).consentRecordId;
  const demoRegistry = [{ id: 'licensed-demo-f10', bytes: await colorImage('#39744b'), licenseEvidence: 'synthetic-license-evidence' }];
  const projects = createProjectService({ db, consentCatalog: catalog, storageQuotaBytes: 300_000_000, demoRegistry });
  const project = await projects.create(ownerId, consentId, await colorImage('#144c88'), 'Synthetic live project', 'user_upload');
  const demoProject = await projects.create(ownerId, demoConsentId, demoRegistry[0]!.bytes, 'Synthetic licensed project', 'licensed_demo', demoRegistry[0]!.id);
  const demoSource = db.prepare("SELECT a.id,a.private_bytes FROM assets a JOIN projects p ON p.original_asset_id=a.id WHERE p.id=?").get(demoProject.projectId) as { id: string; private_bytes: Uint8Array };
  const { normalizeInput } = await import('../../server/v2/images.js');
  const demoSourcePixel = (await normalizeInput(Buffer.from(demoSource.private_bytes))).pixelSha256;
  const repo = new WalletRepository(db);
  repo.transaction(tx => {
    repo.grantInTransaction(tx, { ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'seed:f10:live', units: 3, scope: 'live' });
    repo.grantInTransaction(tx, { ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'seed:f10:demo', units: 3, scope: 'demo' });
  });
  return { db, dbPath, dir, owner: { id: ownerId, projectId: project.projectId, consentId, demoProjectId: demoProject.projectId, demoConsentId, demoSourcePixel, demoSourceAssetId: demoSource.id }, demoRegistry, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const demoConfig = (f: Fixture): PlanConfiguration => ({ demoEnabled: true, demoPolicy: { version: 'demo-v1', registry: f.demoRegistry, fields: ['bodyColor', 'wheelColor'] } });
async function accepted(f: Fixture, scope: 'live' | 'demo' = 'live', liveConfig: PlanConfiguration = config()) {
  const owner = f.owner, isDemo = scope === 'demo', plan = await createPlanService({ db: f.db, consentCatalog: catalog, config: isDemo ? demoConfig(f) : liveConfig, clock: () => new Date(NOW) }).quote(owner.id, isDemo ? owner.demoProjectId : owner.projectId, isDemo ? owner.demoConsentId : owner.consentId, { schemaVersion: 2, source: { kind: 'original' }, operation: 'detail', edits: { bodyColor: { action: 'set', value: 'blue' } } });
  const request: TaskRequest = { planId: plan.planId, submissionId: `f10-${randomUUID()}`, consentRecordId: isDemo ? owner.demoConsentId : owner.consentId };
  const task = await createTaskService({ db: f.db, consentCatalog: catalog, config: isDemo ? demoConfig(f) : liveConfig, storageQuotaBytes: 300_000_000, clock: () => new Date(NOW) }).submit(owner.id, request);
  return { plan, task: task.task };
}
const fixtureResult = async (color = '#cc3344') => ({ ok: true as const, image: await colorImage(color, 1024, 1024), mimeType: 'image/png' as const, profileId: 'profile-test', profileVersion: 'profile-v1', model: 'synthetic-model', templateVersion: 'template-v1', promptSha256: 'a'.repeat(64), providerRequestId: 'synthetic-request', usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: 25_000, attempted: true as const, quality: 'UNASSESSED' as const });
const failureResult = () => ({ ok: false as const, error: { code: 'PROVIDER_HTTP_ERROR', category: 'upstream' as const, retryable: false as const }, attempted: true, providerRequestId: null, usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: 25_000 });

test('worker defaults closed and leaves a queued task unclaimed', async () => {
  const f = await fixture(); try {
    const job = await accepted(f), worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, liveDispatchEnabled: true, serverProvider: async () => failureResult(), clock: () => new Date(NOW) });
    assert.equal((await worker.runTask(job.task.id)).status, 'disabled');
    assert.equal((f.db.prepare('SELECT status FROM tasks WHERE id=?').get(job.task.id) as { status: string }).status, 'queued');
    assert.equal(count(f.db, 'supplier_attempts'), 0);
  } finally { f.close(); }
});

test('live success uses frozen F08 request and commits one private result/version/settlement atomically', async () => {
  const f = await fixture(); try {
    const job = await accepted(f), assetsBefore = count(f.db, 'assets'), generated = await fixtureResult(), expectedMaster = await validateOutputMaster(generated.image); let dispatches = 0, liability = -1n;
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), dispatchGuard: context => { liability = context.currentLiabilityMicrosUSD; assert.equal(context.maximumExposureMicrosUSD, 25_000); return undefined; }, serverProvider: async input => { dispatches++; assert.deepEqual(input.editRequest, providerEditRequest(job.plan)); assert.equal(input.primary.assetId, job.plan.semantic.source.assetId); assert.equal(input.originalReference, undefined); return generated; } });
    const result = await worker.runTask(job.task.id); assert.equal(result.status, 'succeeded'); assert.equal(dispatches, 1);
    assert.equal(liability, 25_000n);
    const task = f.db.prepare('SELECT status,result_version_id,credit_returned FROM tasks WHERE id=?').get(job.task.id) as { status: string; result_version_id: string; credit_returned: number };
    assert.equal(task.status, 'succeeded'); assert.ok(task.result_version_id); assert.equal(task.credit_returned, 0);
    assert.equal(count(f.db, 'versions'), 1); assert.equal(count(f.db, 'assets'), assetsBefore + 2);
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(job.task.id) as { status: string }).status, 'settled');
    assert.equal((f.db.prepare('SELECT status,reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { status: string; reconciled_cost_usd_micros: number | null }).reconciled_cost_usd_micros, null);
    assert.equal((f.db.prepare('SELECT status,max_cost_usd_micros FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string; max_cost_usd_micros: number }).status, 'uncertain');
    assert.equal((f.db.prepare('SELECT private_bytes FROM assets WHERE kind=\'master\'').get() as { private_bytes: Uint8Array }).private_bytes.length > 0, true);
    const recipe = f.db.prepare('SELECT recipe_json FROM versions WHERE task_id=?').get(job.task.id) as { recipe_json: string };
    const recipeJson = JSON.parse(recipe.recipe_json) as { schemaVersion?: number; requestEdits?: unknown; desiredRecipe?: unknown; observedRecipe?: unknown; qualityAssessment?: { status?: string } };
    assert.deepEqual(Object.keys(recipeJson).sort(), ['desiredRecipe','observedRecipe','qualityAssessment','requestEdits','schemaVersion']);
    assert.equal(recipeJson.schemaVersion, 2);
    assert.deepEqual(recipeJson.requestEdits, job.plan.semantic.requestEdits);
    assert.deepEqual(recipeJson.desiredRecipe, job.plan.semantic.desiredRecipe);
    assert.deepEqual(recipeJson.observedRecipe, job.plan.semantic.observedRecipe);
    assert.equal(recipeJson.qualityAssessment?.status, 'unassessed');
    assert.doesNotMatch(recipe.recipe_json, /qualityPassed/);
    const audit = f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='version.output.created' AND owner_id=?").get(f.owner.id) as {details_json:string}|undefined;
    assert.ok(audit, 'Accepted output needs durable source/canonical geometry and hash evidence');
    const provenance = JSON.parse(audit.details_json);
    assert.equal(provenance.taskId, job.task.id); assert.equal(provenance.versionId, result.resultVersionId);
    assert.deepEqual(provenance.sourceGeometry, {width:expectedMaster.sourceWidth,height:expectedMaster.sourceHeight});
    assert.deepEqual(provenance.canonicalGeometry, {width:expectedMaster.width,height:expectedMaster.height});
    assert.equal(provenance.sourceSha256, expectedMaster.sourceSha256); assert.equal(provenance.canonicalSha256, expectedMaster.sha256);
    assert.equal(provenance.pixelSha256, expectedMaster.pixelSha256); assert.equal(provenance.normalizerVersion, expectedMaster.normalizerVersion);
  } finally { f.close(); }
});

test('canonical unchanged pixels take precedence over provider minimum and release once without assets', async () => {
  const f = await fixture(); try {
    const job = await accepted(f), assetsBefore = count(f.db, 'assets');
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async input => ({ ...(await fixtureResult()), image: input.primary.bytes }) });
    const result = await worker.runTask(job.task.id); assert.equal(result.status, 'failed');
    const task = f.db.prepare('SELECT status,safe_error_code,credit_returned FROM tasks WHERE id=?').get(job.task.id) as { status: string; safe_error_code: string; credit_returned: number };
    assert.equal(task.safe_error_code, 'OUTPUT_UNCHANGED'); assert.equal(task.status, 'failed'); assert.equal(task.credit_returned, 1);
    assert.equal(count(f.db, 'assets'), assetsBefore); assert.equal(count(f.db, 'versions'), 0);
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE source_event_key=?').get('seed:f10:live') as { available_units: number }).available_units, 3);
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string }).status, 'uncertain');
  } finally { f.close(); }
});

test('changed output below the frozen live profile minimum is rejected without storage', async () => {
  const f = await fixture(); try {
    const job = await accepted(f), assetsBefore = count(f.db, 'assets');
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => ({ ...(await fixtureResult()), image: await colorImage('#cc3344') }) });
    assert.equal((await worker.runTask(job.task.id)).status, 'failed');
    assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(job.task.id) as { safe_error_code: string }).safe_error_code, 'OUTPUT_INVALID');
    assert.equal(count(f.db, 'assets'), assetsBefore); assert.equal(count(f.db, 'versions'), 0);
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(job.task.id) as { status: string }).status, 'released');
  } finally { f.close(); }
});

test('a provider success beyond its frozen byte cap is rejected before delivery', async () => {
  const f = await fixture(); try {
    const cfg = config(); (cfg.profiles![0]!.profile as {maxOutputBytes:number}).maxOutputBytes = 32;
    const job = await accepted(f, 'live', cfg), assetsBefore = count(f.db, 'assets');
    const worker = createWorkerService({db:f.db,consentCatalog:catalog,config:cfg,storageQuotaBytes:300_000_000,concurrency:1,liveDispatchEnabled:true,clock:()=>new Date(NOW),serverProvider:async()=>fixtureResult()});
    assert.equal((await worker.runTask(job.task.id)).status, 'failed');
    assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(job.task.id) as {safe_error_code:string}).safe_error_code, 'OUTPUT_INVALID');
    assert.equal(count(f.db, 'versions'), 0); assert.equal(count(f.db, 'assets'), assetsBefore);
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(job.task.id) as {status:string}).status, 'released');
  } finally { f.close(); }
});

test('a SQLite storage trigger rolls back all result rows and refunds exactly once', async () => {
  const f = await fixture(); try {
    const job = await accepted(f), assetsBefore = count(f.db, 'assets');
    f.db.exec("CREATE TRIGGER fail_f10_version BEFORE INSERT ON versions WHEN NEW.task_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => fixtureResult() });
    const result = await worker.runTask(job.task.id); assert.equal(result.status, 'failed');
    assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(job.task.id) as { safe_error_code: string }).safe_error_code, 'STORAGE_WRITE_FAILED');
    assert.equal(count(f.db, 'assets'), assetsBefore); assert.equal(count(f.db, 'versions'), 0);
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(job.task.id) as { status: string }).status, 'released');
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE task_id=? AND event_type='reserve'").get(job.task.id) as { n: number }).n, 1);
    assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE task_id=? AND event_type='release'").get(job.task.id) as { n: number }).n, 1);
  } finally { f.close(); }
});

test('known pre-send failure settles the recorded attempt at zero while attempted failure holds max exposure', async () => {
  const f = await fixture(); try {
    const noSend = await accepted(f), workerNoSend = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => ({ ok: false, error: { code: 'PROVIDER_DISABLED', category: 'disabled', retryable: false }, attempted: false, providerRequestId: null, usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: 25_000 }) });
    await workerNoSend.runTask(noSend.task.id);
    assert.equal((f.db.prepare('SELECT reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(noSend.task.id) as { reconciled_cost_usd_micros: number | null }).reconciled_cost_usd_micros, 0);
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(noSend.task.id) as { status: string }).status, 'settled');
    const attempted = await accepted(f), workerAttempted = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => failureResult() });
    await workerAttempted.runTask(attempted.task.id);
    assert.equal((f.db.prepare('SELECT reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(attempted.task.id) as { reconciled_cost_usd_micros: number | null }).reconciled_cost_usd_micros, null);
    assert.equal((f.db.prepare('SELECT status,max_cost_usd_micros FROM supplier_exposures WHERE task_id=?').get(attempted.task.id) as { status: string; max_cost_usd_micros: number }).status, 'uncertain');
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(attempted.task.id) as { status: string }).status, 'released');
  } finally { f.close(); }
});

test('revoked consent before dispatch prevents the call and reconciles the persisted no-send attempt to zero', async () => {
  const f = await fixture(); try {
    const job = await accepted(f); f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(NOW, f.owner.consentId); let dispatches = 0;
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => { dispatches++; return fixtureResult(); } });
    const result = await worker.runTask(job.task.id); assert.equal(result.status, 'failed'); assert.equal(dispatches, 0);
    assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(job.task.id) as { safe_error_code: string }).safe_error_code, 'CONSENT_INVALID');
    assert.equal((f.db.prepare('SELECT reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { reconciled_cost_usd_micros: number }).reconciled_cost_usd_micros, 0);
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string }).status, 'settled');
  } finally { f.close(); }
});

test('late provider output after project deletion cannot create a version or revive the task', async () => {
  const f = await fixture(); try {
    const job = await accepted(f); let started!: () => void, finish!: (value: Awaited<ReturnType<typeof fixtureResult>>) => void;
    const ready = new Promise<void>(resolve => { started = resolve; }), pending = new Promise<Awaited<ReturnType<typeof fixtureResult>>>(resolve => { finish = resolve; });
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => { started(); return pending; } });
    const run = worker.runTask(job.task.id); await ready; f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(NOW, f.owner.projectId); finish(await fixtureResult());
    assert.equal((await run).status, 'failed'); assert.equal(count(f.db, 'versions'), 0);
    assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(job.task.id) as { safe_error_code: string }).safe_error_code, 'TASK_DELETED');
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string }).status, 'uncertain');
  } finally { f.close(); }
});

test('revoked consent prevents even the local quality hook from receiving a late output', async () => {
  const f = await fixture(); try {
    const job = await accepted(f); let release!: () => void, entered!: () => void, reviews = 0;
    const sent = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const worker = createWorkerService({db:f.db,consentCatalog:catalog,config:config(),storageQuotaBytes:300_000_000,concurrency:1,liveDispatchEnabled:true,clock:()=>new Date(NOW),qualityReview:()=>{reviews++;},serverProvider:async()=>{entered();await barrier;return fixtureResult();}});
    const pending = worker.runTask(job.task.id); await sent;
    f.db.prepare('UPDATE consents SET revoked_at=? WHERE id=?').run(NOW, f.owner.consentId); release();
    assert.equal((await pending).status, 'failed'); assert.equal(reviews, 0);
    assert.equal(count(f.db, 'versions'), 0); assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(job.task.id) as {safe_error_code:string}).safe_error_code, 'CONSENT_INVALID');
  } finally { f.close(); }
});

test('licensed demo requires a matching server result registry and never calls the server provider', async () => {
  const f = await fixture(); try {
    const job = await accepted(f, 'demo'); let external = 0;
    const closed = createWorkerService({ db: f.db, consentCatalog: catalog, config: demoConfig(f), concurrency: 1, storageQuotaBytes: 300_000_000, serverProvider: async () => { external++; return fixtureResult(); } });
    assert.equal((await closed.runTask(job.task.id)).status, 'disabled'); assert.equal(external, 0);
    const { normalizeInput } = await import('../../server/v2/images.js');
    const editRequestSha256 = (await import('node:crypto')).createHash('sha256').update(canonicalJson(providerEditRequest(job.plan))).digest('hex');
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: demoConfig(f), concurrency: 1, storageQuotaBytes: 300_000_000, licensedDemoResults: [{ registryId: 'licensed-demo-f10', licenseEvidence: 'synthetic-result-license', sourcePixelSha256: f.owner.demoSourcePixel, editRequestSha256, bytes: await colorImage('#cc3344') }] });
    const result = await worker.runTask(job.task.id); assert.equal(result.status, 'succeeded'); assert.equal(external, 0);
    assert.equal(count(f.db, 'supplier_attempts'), 0); assert.equal(count(f.db, 'supplier_exposures'), 0);
    assert.equal(count(f.db, 'versions'), 1); assert.equal((await normalizeInput(Buffer.from(f.demoRegistry[0]!.bytes))).pixelSha256, f.owner.demoSourcePixel);
  } finally { f.close(); }
});

test('recovery marks processing uncertain, expires after 30 seconds without resend, and keeps max exposure', async () => {
  const f = await fixture(); try {
    const job = await accepted(f); let release!: (value: ReturnType<typeof failureResult>) => void, started!: () => void;
    const pending = new Promise<ReturnType<typeof failureResult>>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => { calls++; started(); return pending; } });
    const run = worker.runTask(job.task.id); await ready; f.db.prepare('UPDATE supplier_attempts SET reconciled_cost_usd_micros=0 WHERE task_id=?').run(job.task.id);
    const recovery = createRecoveryService({ db: f.db, clock: () => new Date(NOW) });
    assert.equal(recovery.markInterrupted().uncertain, 1);
    assert.equal((f.db.prepare('SELECT status FROM tasks WHERE id=?').get(job.task.id) as { status: string }).status, 'uncertain');
    assert.equal((f.db.prepare('SELECT status,max_cost_usd_micros FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string; max_cost_usd_micros: number }).status, 'uncertain');
    const late = createRecoveryService({ db: f.db, clock: () => new Date(Date.parse(NOW) + 30_000) });
    assert.equal(late.reconcileExpired().failed, 1); release(failureResult());
    assert.equal((await run).status, 'discarded'); assert.equal(calls, 1); assert.equal(count(f.db, 'versions'), 0);
    assert.equal((f.db.prepare('SELECT status FROM tasks WHERE id=?').get(job.task.id) as { status: string }).status, 'failed');
    assert.equal((f.db.prepare('SELECT e.status,a.reconciled_cost_usd_micros FROM supplier_exposures e JOIN supplier_attempts a USING(owner_id,task_id) WHERE e.task_id=?').get(job.task.id) as { status: string; reconciled_cost_usd_micros: number | null }).status, 'uncertain');
    assert.equal((f.db.prepare('SELECT max_cost_usd_micros FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { max_cost_usd_micros: number }).max_cost_usd_micros, 25_000);
    assert.equal((f.db.prepare('SELECT reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { reconciled_cost_usd_micros: number | null }).reconciled_cost_usd_micros, 0);
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(job.task.id) as { status: string }).status, 'released');
  } finally { f.close(); }
});

test('two SQLite workers race duplicate claims and queued cancellation with a ready/go barrier', async () => {
  const f = await fixture(); try {
    const job = await accepted(f);
    const source = `
      import { parentPort, workerData } from 'node:worker_threads';
      import { DatabaseSync } from 'node:sqlite';

      const send = async () => {
        const { createWorkerService } = await import(workerData.workerModule);
        const { createTaskService } = await import(workerData.taskModule);
        const db = new DatabaseSync(workerData.dbPath);
        db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        parentPort.postMessage('ready');
        await new Promise(resolve => parentPort.once('message', value => value === 'go' && resolve()));

        if (workerData.mode === 'cancel') {
          let message;
          try {
            const result = createTaskService({ db, consentCatalog: workerData.catalog, config: workerData.config, storageQuotaBytes: 300000000 })
              .cancel(workerData.ownerId, workerData.taskId);
            message = { kind: 'done', mode: 'cancel', status: result.task.status };
          } catch (error) {
            message = { kind: 'done', mode: 'cancel', error: error.code };
          }
          db.close();
          parentPort.postMessage(message);
          return;
        }

        const worker = createWorkerService({
          db,
          consentCatalog: workerData.catalog,
          config: workerData.config,
          storageQuotaBytes: 300000000,
          concurrency: 1,
          liveDispatchEnabled: true,
          clock: () => new Date('2026-10-13T03:00:00.000Z'),
          serverProvider: async () => {
            parentPort.postMessage({ kind: 'dispatch' });
            await new Promise(resolve => parentPort.once('message', value => value === 'release' && resolve()));
            return {
              ok: false,
              error: { code: 'PROVIDER_HTTP_ERROR', category: 'upstream', retryable: false },
              attempted: true,
              providerRequestId: null,
              usage: null,
              actualCostMicrosUSD: null,
              maxExposureMicrosUSD: 25000
            };
          }
        });
        const result = await worker.runTask(workerData.taskId);
        db.close();
        parentPort.postMessage({ kind: 'done', mode: 'run', status: result.status });
      };

      send().catch(error => parentPort.postMessage({ kind: 'error', error: error.message }));`;
    async function race(mode: 'duplicate' | 'cancel', taskId = job.task.id) {
      const countWorkers = 2, workers = Array.from({ length: countWorkers }, (_, i) => new Worker(source, { eval: true, execArgv: ['--import', 'tsx/esm'], workerData: { mode: mode === 'cancel' && i === 1 ? 'cancel' : 'run', dbPath: f.dbPath, workerModule: new URL('../../server/v2/worker.ts', import.meta.url).href, taskModule: new URL('../../server/v2/tasks.ts', import.meta.url).href, taskId, ownerId: f.owner.id, catalog, config: config() } }));
      const messages: any[] = []; let ready = 0, done = 0, dispatched = 0;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { for (const w of workers) void w.terminate(); reject(new Error('SQLite worker barrier timed out')); }, 10_000);
        for (const w of workers) {
          w.on('message', (m: any) => { messages.push(m); if (m === 'ready' && ++ready === workers.length) workers.forEach(x => x.postMessage('go')); if (m?.kind === 'dispatch') { dispatched++; workers.forEach(x => x.postMessage('release')); } if (m?.kind === 'done' && ++done === workers.length) { clearTimeout(timeout); resolve(); } if (m?.kind === 'error') { clearTimeout(timeout); for (const x of workers) void x.terminate(); reject(new Error(m.error)); } });
          w.on('error', error => { clearTimeout(timeout); for (const x of workers) void x.terminate(); reject(error); });
        }
      });
      return { messages, dispatched };
    }
    const duplicate = await race('duplicate'); assert.equal(duplicate.dispatched, 1); assert.equal(count(f.db, 'supplier_attempts'), 1);
    const second = await accepted(f); assert.ok(second.task.id);
    // The first task has failed by now; race cancel against a fresh queued task.
    const cancelRace = await race('cancel', second.task.id), task = f.db.prepare('SELECT status FROM tasks WHERE id=?').get(second.task.id) as { status: string };
    if (cancelRace.dispatched) {
      assert.equal(task.status, 'failed');
      assert.equal(cancelRace.messages.find(x => x?.mode === 'cancel')?.error, 'TASK_NOT_CANCELLABLE');
      assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(second.task.id) as { status: string }).status, 'uncertain');
    } else {
      assert.equal(task.status, 'cancelled');
      assert.equal(cancelRace.messages.find(x => x?.mode === 'cancel')?.status, 'cancelled');
      assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(second.task.id) as { status: string }).status, 'released');
    }
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(second.task.id) as { status: string }).status, 'released');
    assert.equal(count(f.db, 'supplier_attempts'), cancelRace.dispatched ? 2 : 1);
  } finally { f.close(); }
});

test('SQLite claim gate enforces concurrency across distinct worker instances', async () => {
  const f = await fixture(); try {
    const first = await accepted(f), ownerId = 'owner-f10-concurrency-b';
    f.db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(ownerId, NOW);
    f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run('identity-f10-concurrency-b', ownerId, 'apple', 'synthetic-subject-f10-concurrency-b', NOW);
    const consentId = createConsentService(f.db, catalog).issue(ownerId, { policyId: 'policy-test', acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: true }).consentRecordId;
    const project = await createProjectService({ db: f.db, consentCatalog: catalog, storageQuotaBytes: 300_000_000 }).create(ownerId, consentId, await colorImage('#164d89'), 'Synthetic second owner project', 'user_upload');
    const wallet = new WalletRepository(f.db);
    wallet.transaction(tx => { wallet.grantInTransaction(tx, { ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: 'seed:f10:live:concurrency-b', units: 3, scope: 'live' }); });
    const secondOwnerFixture = { ...f, owner: { ...f.owner, id: ownerId, projectId: project.projectId, consentId } };
    const second = await accepted(secondOwnerFixture);
    const source = `
      import { parentPort, workerData } from 'node:worker_threads';
      import { DatabaseSync } from 'node:sqlite';

      const run = async () => {
        const { createWorkerService } = await import(workerData.workerModule);
        const db = new DatabaseSync(workerData.dbPath);
        db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        parentPort.postMessage('ready');
        await new Promise(resolve => parentPort.once('message', value => value === 'go' && resolve()));

        const worker = createWorkerService({
          db,
          consentCatalog: workerData.catalog,
          config: workerData.config,
          storageQuotaBytes: 300000000,
          concurrency: 1,
          liveDispatchEnabled: true,
          clock: () => new Date('2026-10-13T03:00:00.000Z'),
          serverProvider: async () => {
            parentPort.postMessage({ kind: 'dispatch' });
            await new Promise(resolve => parentPort.once('message', value => value === 'release' && resolve()));
            return {
              ok: false,
              error: { code: 'PROVIDER_HTTP_ERROR', category: 'upstream', retryable: false },
              attempted: true,
              providerRequestId: null,
              usage: null,
              actualCostMicrosUSD: null,
              maxExposureMicrosUSD: 25000
            };
          }
        });
        const result = await worker.runTask(workerData.taskId);
        db.close();
        parentPort.postMessage({ kind: 'done', status: result.status });
      };

      run().catch(error => parentPort.postMessage({ kind: 'error', error: error.message }));`;
    const workers = [first.task.id, second.task.id].map(taskId => new Worker(source, { eval: true, execArgv: ['--import', 'tsx/esm'], workerData: { dbPath: f.dbPath, workerModule: new URL('../../server/v2/worker.ts', import.meta.url).href, taskId, catalog, config: config() } }));
    const messages: any[] = []; let ready = 0, done = 0, dispatched = 0, released = false;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { for (const worker of workers) void worker.terminate(); reject(new Error(`SQLite concurrency barrier timed out: ${JSON.stringify({ ready, done, dispatched, messages })}`)); }, 10_000);
      const release = () => { if (released) return; released = true; workers.forEach(worker => worker.postMessage('release')); };
      for (const worker of workers) {
        worker.on('message', (message: any) => {
          messages.push(message);
          if (message === 'ready' && ++ready === workers.length) workers.forEach(x => x.postMessage('go'));
          if (message?.kind === 'dispatch') { dispatched++; if (dispatched > 1 || done > 0) release(); }
          if (message?.kind === 'done') { done++; if (dispatched === 1) release(); if (done === workers.length) { clearTimeout(timeout); resolve(); } }
          if (message?.kind === 'error') { clearTimeout(timeout); release(); reject(new Error(message.error)); }
        });
        worker.on('error', error => { clearTimeout(timeout); release(); reject(error); });
      }
    });
    assert.equal(dispatched, 1);
    assert.equal(messages.filter(message => message?.kind === 'done').filter(message => message.status === 'not_claimed').length, 1);
    assert.equal(count(f.db, 'supplier_attempts'), 1);
    assert.equal(count(f.db, 'versions'), 0);
  } finally { f.close(); }
});

test('real worker termination before and after provider send recovers without resend or exposure release', async () => {
  for (const phase of ['before_send', 'after_send'] as const) {
    const f = await fixture(); let child: Worker | undefined;
    try {
      const job = await accepted(f), barrier = new SharedArrayBuffer(4);
      const source = `
        import { parentPort, workerData } from 'node:worker_threads';
        import { DatabaseSync } from 'node:sqlite';

        const { createWorkerService } = await import(workerData.workerModule);
        const db = new DatabaseSync(workerData.dbPath);
        db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        const gate = new Int32Array(workerData.barrier);
        let stoppedBeforeSend = false;

        const getConfig = () => {
          if (workerData.phase === 'before_send' && !stoppedBeforeSend && db.isTransaction === false) {
            const task = db.prepare('SELECT status FROM tasks WHERE id=?').get(workerData.taskId);
            const attempt = db.prepare('SELECT status FROM supplier_attempts WHERE task_id=?').get(workerData.taskId);
            if (task?.status === 'processing' && attempt?.status === 'started') {
              stoppedBeforeSend = true;
              parentPort.postMessage('before_send');
              Atomics.wait(gate, 0, 0);
            }
          }
          return workerData.config;
        };

        const worker = createWorkerService({
          db,
          consentCatalog: workerData.catalog,
          config: workerData.config,
          getConfig,
          storageQuotaBytes: 300000000,
          concurrency: 1,
          liveDispatchEnabled: true,
          clock: () => new Date('2026-10-13T03:00:00.000Z'),
          serverProvider: async () => {
            parentPort.postMessage('sent');
            Atomics.wait(gate, 0, 0);
            return {
              ok: false,
              error: { code: 'PROVIDER_HTTP_ERROR', category: 'upstream', retryable: false },
              attempted: true,
              providerRequestId: null,
              usage: null,
              actualCostMicrosUSD: null,
              maxExposureMicrosUSD: 25000
            };
          }
        });

        worker.runTask(workerData.taskId).catch(error => parentPort.postMessage({ kind: 'error', error: error.message }));`;
      child = new Worker(source, {
        eval: true,
        execArgv: ['--import', 'tsx/esm'],
        workerData: {
          dbPath: f.dbPath,
          workerModule: new URL('../../server/v2/worker.ts', import.meta.url).href,
          taskId: job.task.id,
          phase,
          barrier,
          catalog,
          config: config()
        }
      });
      const reached = waitForWorkerMessage(child, phase === 'before_send' ? 'before_send' : 'sent');
      await reached;
      const { status } = f.db.prepare('SELECT status FROM tasks WHERE id=?').get(job.task.id) as { status: string };
      assert.equal(status, 'processing');
      assert.equal((f.db.prepare('SELECT status FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { status: string }).status, 'started');
      assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string }).status, 'started');
      await child.terminate(); child = undefined;

      const recovery = createRecoveryService({ db: f.db, clock: () => new Date(NOW) });
      assert.deepEqual(recovery.markInterrupted(), { uncertain: 1 });
      assert.equal((f.db.prepare('SELECT status FROM tasks WHERE id=?').get(job.task.id) as { status: string }).status, 'uncertain');
      assert.equal((f.db.prepare('SELECT status,reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { status: string; reconciled_cost_usd_micros: number | null }).status, 'uncertain');
      const afterDeadline = createRecoveryService({ db: f.db, clock: () => new Date(Date.parse(NOW) + 30_000) });
      assert.deepEqual(afterDeadline.reconcileExpired(), { failed: 1 });
      const recoveredTask = f.db.prepare('SELECT status,credit_returned FROM tasks WHERE id=?').get(job.task.id) as { status: string; credit_returned: number };
      assert.equal(recoveredTask.status, 'failed'); assert.equal(recoveredTask.credit_returned, 1);
      assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(job.task.id) as { status: string }).status, 'released');
      assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE task_id=? AND event_type='reserve'").get(job.task.id) as { n: number }).n, 1);
      assert.equal((f.db.prepare("SELECT count(*) n FROM ledger_events WHERE task_id=? AND event_type='release'").get(job.task.id) as { n: number }).n, 1);
      assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE source_event_key=?').get('seed:f10:live') as { available_units: number }).available_units, 3);
      assert.equal(count(f.db, 'versions'), 0); assert.equal(count(f.db, 'supplier_attempts'), 1);
      const attempt = f.db.prepare('SELECT status,reconciled_cost_usd_micros FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { status: string; reconciled_cost_usd_micros: number | null };
      assert.equal(attempt.status, 'uncertain'); assert.equal(attempt.reconciled_cost_usd_micros, null);
      const exposure = f.db.prepare('SELECT status,max_cost_usd_micros FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string; max_cost_usd_micros: number };
      assert.equal(exposure.status, 'uncertain'); assert.equal(exposure.max_cost_usd_micros, 25_000);
      assert.equal(new WalletRepository(f.db).transaction(tx => supplierLiability(tx)), 25_000n);

      let resends = 0;
      const restarted = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => { resends++; return fixtureResult(); } });
      assert.equal((await restarted.runTask(job.task.id)).status, 'not_claimed');
      assert.equal(resends, 0); assert.equal(count(f.db, 'supplier_attempts'), 1); assert.equal(count(f.db, 'versions'), 0);
    } finally {
      if (child) await child.terminate();
      f.close();
    }
  }
});

test('F05 profile tokens with dots validate and bind to the frozen supplier', async () => {
  const f = await fixture(); try {
    const dotted = config(); dotted.liveCandidates = ['profile.test'];
    const dottedProfile = dotted.profiles?.[0]?.profile; assert.ok(dottedProfile);
    dottedProfile.id = 'profile.test'; dottedProfile.version = 'profile.v1';
    dottedProfile.model = 'synthetic.model'; dottedProfile.templateVersion = 'template.v1';
    const job = await accepted(f, 'live', dotted);
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: dotted, storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => ({ ...(await fixtureResult()), profileId: 'profile.test', profileVersion: 'profile.v1', model: 'synthetic.model', templateVersion: 'template.v1' }) });
    assert.equal((await worker.runTask(job.task.id)).status, 'succeeded');
    assert.equal((f.db.prepare('SELECT status FROM supplier_attempts WHERE task_id=?').get(job.task.id) as { status: string }).status, 'succeeded');
    const mismatched = await accepted(f, 'live', dotted), before = count(f.db, 'assets');
    const mismatchWorker = createWorkerService({ db: f.db, consentCatalog: catalog, config: dotted, storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => ({ ...(await fixtureResult()), profileId: 'profile.test', profileVersion: 'profile.v1', model: 'different.model', templateVersion: 'template.v1' }) });
    assert.equal((await mismatchWorker.runTask(mismatched.task.id)).status, 'failed');
    assert.equal((f.db.prepare('SELECT safe_error_code FROM tasks WHERE id=?').get(mismatched.task.id) as { safe_error_code: string }).safe_error_code, 'GENERATION_FAILED');
    assert.equal(count(f.db, 'assets'), before); assert.equal(count(f.db, 'versions'), 1);
  } finally { f.close(); }
});

test('version-source restore dispatch binds both the exact parent master and original reference', async () => {
  const f = await fixture(); try {
    const first = await accepted(f);
    const firstWorker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => fixtureResult() });
    const firstResult = await firstWorker.runTask(first.task.id); assert.equal(firstResult.status, 'succeeded'); assert.ok(firstResult.resultVersionId);
    const originalAssetId = (f.db.prepare('SELECT original_asset_id FROM projects WHERE id=?').get(f.owner.projectId) as { original_asset_id: string }).original_asset_id;
    const parentAsset = f.db.prepare('SELECT master_asset_id FROM versions WHERE id=?').get(firstResult.resultVersionId) as { master_asset_id: string };
    const plan = await createPlanService({ db: f.db, consentCatalog: catalog, config: config(), clock: () => new Date(NOW) }).quote(f.owner.id, f.owner.projectId, f.owner.consentId, { schemaVersion: 2, source: { kind: 'version', versionId: firstResult.resultVersionId }, operation: 'detail', edits: { bodyColor: { action: 'restore_original' } } });
    const submitted = await createTaskService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, clock: () => new Date(NOW) }).submit(f.owner.id, { planId: plan.planId, submissionId: `f10-restore-${randomUUID()}`, consentRecordId: f.owner.consentId });
    let dispatches = 0;
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async input => {
      dispatches++; assert.deepEqual(input.editRequest, providerEditRequest(plan));
      assert.deepEqual(input.primary.source, { kind: 'version', versionId: firstResult.resultVersionId });
      assert.equal(input.primary.assetId, parentAsset.master_asset_id);
      assert.deepEqual(input.originalReference?.source, { kind: 'original' });
      assert.equal(input.originalReference?.assetId, originalAssetId);
      assert.equal(input.primary.sha256, (f.db.prepare('SELECT digest FROM assets WHERE id=?').get(parentAsset.master_asset_id) as { digest: string }).digest);
      assert.equal(input.originalReference?.sha256, (f.db.prepare('SELECT digest FROM assets WHERE id=?').get(originalAssetId) as { digest: string }).digest);
      return fixtureResult('#2266aa');
    } });
    assert.equal((await worker.runTask(submitted.task.id)).status, 'succeeded'); assert.equal(dispatches, 1);
    const child = f.db.prepare('SELECT parent_version_id FROM versions WHERE task_id=?').get(submitted.task.id) as { parent_version_id: string };
    assert.equal(child.parent_version_id, firstResult.resultVersionId);
  } finally { f.close(); }
});

test('async dispatch guard is rejected and cannot consume its transaction after rollback', async () => {
  const f = await fixture(); try {
    const job = await accepted(f); let lateWriteRejected = false, dispatches = 0;
    const worker = createWorkerService({ db: f.db, consentCatalog: catalog, config: config(), storageQuotaBytes: 300_000_000, concurrency: 1, liveDispatchEnabled: true, clock: () => new Date(NOW), serverProvider: async () => { dispatches++; return failureResult(); }, dispatchGuard: context => {
      const pending = (async () => {
        context.tx.run("UPDATE tasks SET safe_error_code='GENERATION_FAILED' WHERE id=?", context.taskId);
        await Promise.resolve();
        try { context.tx.run("UPDATE tasks SET safe_error_code='OUTPUT_INVALID' WHERE id=?", context.taskId); }
        catch { lateWriteRejected = true; }
        return true;
      })();
      return pending as unknown as boolean | undefined;
    } });
    assert.equal((await worker.runTask(job.task.id)).status, 'disabled');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(lateWriteRejected, true); assert.equal(dispatches, 0);
    assert.equal((f.db.prepare('SELECT status,safe_error_code FROM tasks WHERE id=?').get(job.task.id) as { status: string; safe_error_code: string | null }).status, 'queued');
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(job.task.id) as { status: string }).status, 'reserved');
    assert.equal(count(f.db, 'supplier_attempts'), 0);
  } finally { f.close(); }
});
