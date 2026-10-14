import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { openV2Database } from '../../server/v2/db.js';
import { createBudgetService, type ApprovedBudgetPolicy } from '../../server/v2/budget.js';
import { createConsentService, type ConsentCatalog } from '../../server/v2/consents.js';
import { createProjectService } from '../../server/v2/projects.js';
import { createPlanService, providerEditRequest, type PlanConfiguration, type PlanSnapshot } from '../../server/v2/plans.js';
import { createTaskService, readTaskSnapshot, supplierLiability } from '../../server/v2/tasks.js';
import { WalletRepository, type WalletTransaction } from '../../server/v2/wallet-repo.js';
import type { ProviderInput, ProviderResult } from '../../server/v2/provider.js';

const NOW = '2026-10-13T03:00:00.000Z';
const profile = { supplierProfileId: 'profile-test', profileVersion: 'profile-v1', providerId: 'provider-test', protocol: 'openai-images-edits' as const,
  endpoint: 'https://api.openai.com/v1/images/edits', model: 'synthetic-model', templateVersion: 'template-v1', maxSupplierCostMicrosUSD: 25_000,
  output: { format: 'png' as const, size: '1024x1024' as const, quality: 'low' as const }, qualityEvidence: 'synthetic-quality-review', timeoutMs: 1000,
  maxInputBytes: 1_000_000, maxOutputBytes: 2_000_000, maxResponseBytes: 3_000_000 };
const catalog: ConsentCatalog = { providers: ['provider-test'], policies: [{ id: 'policy-test', version: 'consent-v7', providerId: 'provider-test', purposes: { photoRights: 'photo-rights', uploadStorage: 'private-storage', sharing: 'model-precheck' } }] };
const policy = (overrides: Partial<ApprovedBudgetPolicy> = {}): ApprovedBudgetPolicy => ({ externalSpendApproved: true, profile,
  globalBudgetMicrosUSD: 100_000, accountBudgetMicrosUSD: 50_000, maxActiveTasksGlobal: 8, maxActiveTasksPerAccount: 1,
  maxConcurrentAttemptsGlobal: 4, maxConcurrentAttemptsPerAccount: 2, maxAcceptedPerWindowGlobal: 20,
  maxAcceptedPerWindowPerAccount: 10, maxAttemptsPerWindowGlobal: 20, maxAttemptsPerWindowPerAccount: 10, windowMs: 60_000, ...overrides });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'form-f27-')), dbPath = join(dir, 'form.sqlite'), db = openV2Database(dbPath);
  for (const id of ['owner-a', 'owner-b']) { db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(id, NOW); db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES (?,?,?)').run(`project-${id}`, id, NOW); }
  return { dir, dbPath, db, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function addTask(db: DatabaseSync, ownerId: string, taskId: string, status = 'queued', createdAt = NOW) {
  db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at,request_snapshot_json)
    VALUES (?,?,?,?,?,1,?,'{}')`).run(taskId, ownerId, `project-${ownerId}`, `submission-${taskId}`, status, createdAt);
}
function addExposure(db: DatabaseSync, ownerId: string, taskId: string, status = 'reserved', max = profile.maxSupplierCostMicrosUSD, createdAt = NOW) {
  db.prepare(`INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'USD','profile_max_cost_usd_micros',?,?,?)`).run(`exposure-${taskId}`, ownerId, taskId, profile.supplierProfileId, profile.profileVersion, max, status, createdAt, NOW);
}
function addAttempt(db: DatabaseSync, ownerId: string, taskId: string, status = 'uncertain', cost: number | null = null, startedAt = NOW) {
  db.prepare(`INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,provider_profile_version,status,estimated_cost_usd_micros,reconciled_cost_usd_micros,started_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(`attempt-${taskId}`, ownerId, taskId, profile.supplierProfileId, profile.profileVersion, status, profile.maxSupplierCostMicrosUSD, cost, startedAt);
}
const livePlan = (ownerId: string, supplier: (typeof profile & { approvedBudgetMicrosUSD: number }) | null = { ...profile, approvedBudgetMicrosUSD: 100_000 }) => ({ planId: `plan-${ownerId}`, semantic: {
  ownerId, projectId: `project-${ownerId}`, walletScope: 'live', executionMode: 'live', supplier,
  supplierExposureMicrosUSD: supplier?.maxSupplierCostMicrosUSD ?? 0,
} } as unknown as PlanSnapshot);
function acceptContext(tx: WalletTransaction, ownerId = 'owner-a', cost = profile.maxSupplierCostMicrosUSD, plan = livePlan(ownerId)) {
  return { tx, ownerId, projectId: `project-${ownerId}`, taskId: `new-${randomUUID()}`, plan,
    maximumExposureMicrosUSD: cost, currentLiabilityMicrosUSD: supplierLiability(tx) };
}
function dispatchContext(tx: WalletTransaction, ownerId = 'owner-a', taskId = 'queued-task') {
  return { tx, ownerId, projectId: `project-${ownerId}`, taskId, maximumExposureMicrosUSD: profile.maxSupplierCostMicrosUSD,
    currentLiabilityMicrosUSD: supplierLiability(tx) };
}

test('budget defaults closed, leaves demo admission outside supplier budget, and accepts only explicit approved policy', () => {
  const f = fixture(); try {
    const repo = new WalletRepository(f.db), closed = createBudgetService({ db: f.db });
    assert.equal(repo.transaction(tx => closed.beforeAccept(acceptContext(tx))), false);
    assert.equal(repo.transaction(tx => closed.dispatchGuard(dispatchContext(tx))), false);
    assert.equal(repo.transaction(tx => closed.beforeAccept(acceptContext(tx, 'owner-a', 0, livePlan('owner-a', null)))), false);
    const explicit = createBudgetService({ db: f.db, approvedPolicy: policy(), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => explicit.beforeAccept(acceptContext(tx))), true);
    const frozen = livePlan('owner-a'), changedProfile = { ...frozen.semantic.supplier!, output: { ...frozen.semantic.supplier!.output, quality: 'high' as const } };
    const changed = { ...frozen, semantic: { ...frozen.semantic, supplier: changedProfile } } as unknown as PlanSnapshot;
    assert.equal(repo.transaction(tx => explicit.beforeAccept({ ...acceptContext(tx), plan: changed })), false, 'approved output profile must match the complete frozen supplier profile');
    const demoPlan = { ...livePlan('owner-a'), semantic: { ...livePlan('owner-a').semantic, walletScope: 'demo', executionMode: 'licensed_demo', supplier: null, supplierExposureMicrosUSD: 0 } } as unknown as PlanSnapshot;
    assert.equal(repo.transaction(tx => explicit.beforeAccept({ ...acceptContext(tx), plan: demoPlan, maximumExposureMicrosUSD: 0 })), undefined);
  } finally { f.close(); }
});

test('budget includes unknown failed-task attempts and pending exposure in account/global ceilings', () => {
  const f = fixture(); try {
    addTask(f.db, 'owner-a', 'old-failed', 'failed'); addExposure(f.db, 'owner-a', 'old-failed', 'uncertain', 30_000); addAttempt(f.db, 'owner-a', 'old-failed');
    const repo = new WalletRepository(f.db);
    assert.equal(repo.transaction(tx => supplierLiability(tx)), 30_000n);
    assert.equal(repo.transaction(tx => supplierLiability(tx, 'owner-a')), 30_000n);
    assert.throws(() => repo.transaction(tx => supplierLiability(tx, 'bad owner')), { code: 'SUPPLIER_LIABILITY_UNKNOWN' });
    const exact = createBudgetService({ db: f.db, approvedPolicy: policy({ globalBudgetMicrosUSD: 55_000, accountBudgetMicrosUSD: 55_000, maxAcceptedPerWindowPerAccount: 2 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => exact.beforeAccept({ ...acceptContext(tx), currentLiabilityMicrosUSD: supplierLiability(tx) })), true);
    const belowGlobal = createBudgetService({ db: f.db, approvedPolicy: policy({ globalBudgetMicrosUSD: 54_999, accountBudgetMicrosUSD: 100_000, maxAcceptedPerWindowPerAccount: 2 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => belowGlobal.beforeAccept({ ...acceptContext(tx), currentLiabilityMicrosUSD: supplierLiability(tx) })), false);
    const belowAccount = createBudgetService({ db: f.db, approvedPolicy: policy({ globalBudgetMicrosUSD: 100_000, accountBudgetMicrosUSD: 54_999, maxAcceptedPerWindowPerAccount: 2 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => belowAccount.beforeAccept({ ...acceptContext(tx), currentLiabilityMicrosUSD: supplierLiability(tx) })), false);
  } finally { f.close(); }
});

test('task caps and accepted/attempt windows are checked inside the supplied transaction', () => {
  const f = fixture(); try {
    addTask(f.db, 'owner-b', 'active-b', 'processing');
    const repo = new WalletRepository(f.db), capped = createBudgetService({ db: f.db, approvedPolicy: policy({ maxActiveTasksGlobal: 1 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => capped.beforeAccept(acceptContext(tx))), false);
    f.db.prepare("UPDATE tasks SET status='failed' WHERE id='active-b'").run();
    addTask(f.db, 'owner-a', 'accepted-a', 'failed'); addExposure(f.db, 'owner-a', 'accepted-a', 'released');
    const acceptedRate = createBudgetService({ db: f.db, approvedPolicy: policy({ maxAcceptedPerWindowGlobal: 1, maxAcceptedPerWindowPerAccount: 1 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => acceptedRate.beforeAccept(acceptContext(tx))), false);
    addTask(f.db, 'owner-a', 'old-start', 'failed'); addExposure(f.db, 'owner-a', 'old-start', 'uncertain'); addAttempt(f.db, 'owner-a', 'old-start', 'uncertain');
    addTask(f.db, 'owner-a', 'queued-task', 'queued'); addExposure(f.db, 'owner-a', 'queued-task', 'reserved');
    const attemptCap = createBudgetService({ db: f.db, approvedPolicy: policy({ maxConcurrentAttemptsGlobal: 1, maxConcurrentAttemptsPerAccount: 1, maxActiveTasksGlobal: 2 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => attemptCap.dispatchGuard(dispatchContext(tx))), false, 'an uncertain attempt still occupies supplier concurrency after its user task failed');
    const attemptRate = createBudgetService({ db: f.db, approvedPolicy: policy({ maxAttemptsPerWindowGlobal: 1, maxAttemptsPerWindowPerAccount: 1, maxActiveTasksGlobal: 2 }), clock: () => new Date(NOW) });
    assert.equal(repo.transaction(tx => attemptRate.dispatchGuard(dispatchContext(tx))), false);
    const older='2026-10-13T02:58:00.000Z'; addTask(f.db,'owner-b','old-window','failed',older); addExposure(f.db,'owner-b','old-window','settled',profile.maxSupplierCostMicrosUSD,older); addAttempt(f.db,'owner-b','old-window','failed',0,older);
    addTask(f.db,'owner-b','window-candidate','queued'); addExposure(f.db,'owner-b','window-candidate','reserved');
    const afterWindow=createBudgetService({db:f.db,approvedPolicy:policy({maxAttemptsPerWindowGlobal:2,maxAttemptsPerWindowPerAccount:1,maxActiveTasksGlobal:3}),clock:()=>new Date(NOW)});
    assert.equal(repo.transaction(tx=>afterWindow.dispatchGuard(dispatchContext(tx,'owner-b','window-candidate'))),true,'completed calls outside the rolling window do not consume its rate slot');
  } finally { f.close(); }
});

test('dispatch uses the reserved candidate exposure exactly once at the financial boundary', () => {
  const f=fixture(); try {
    addTask(f.db,'owner-a','dispatch-candidate','queued'); addExposure(f.db,'owner-a','dispatch-candidate','reserved');
    const repo=new WalletRepository(f.db), service=createBudgetService({db:f.db,approvedPolicy:policy({globalBudgetMicrosUSD:25_000,accountBudgetMicrosUSD:25_000,maxActiveTasksGlobal:1,maxActiveTasksPerAccount:1}),clock:()=>new Date(NOW)});
    assert.equal(repo.transaction(tx=>service.dispatchGuard(dispatchContext(tx,'owner-a','dispatch-candidate'))),true);
  } finally { f.close(); }
});

test('pause controls require a trusted actor and append scoped rowid-ordered audit events', async () => {
  const f = fixture(); try {
    const repo = new WalletRepository(f.db), missing = createBudgetService({ db: f.db, approvedPolicy: policy() });
    assert.throws(() => missing.pause({ scope: 'global' }, 'operator_request'), { code: 'BUDGET_OPERATOR_REQUIRED' });
    const invalid = createBudgetService({ db: f.db, approvedPolicy: policy(), authorizeOperator: () => true as never });
    assert.throws(() => invalid.pause({ scope: 'global' }, 'operator_request'), { code: 'BUDGET_OPERATOR_REQUIRED' });
    const rejected: unknown[] = [], listener = (error: unknown) => rejected.push(error); process.on('unhandledRejection', listener);
    const asynchronous = createBudgetService({ db: f.db, approvedPolicy: policy(), authorizeOperator: () => Promise.reject(new Error('late rejection')) as never });
    assert.throws(() => asynchronous.pause({ scope: 'global' }, 'operator_request'), { code: 'BUDGET_OPERATOR_REQUIRED' });
    await new Promise(resolve => setTimeout(resolve, 0)); process.off('unhandledRejection', listener); assert.deepEqual(rejected, []);
    const service = createBudgetService({ db: f.db, approvedPolicy: policy(), authorizeOperator: () => ({ actorId: 'operator-1' }), clock: () => new Date(NOW), id: randomUUID });
    service.pause({ scope: 'account', ownerId: 'owner-a' }, 'operator_request');
    f.db.prepare("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES ('noise',NULL,'other.event','{}',?)").run(NOW);
    assert.equal(repo.transaction(tx => service.beforeAccept(acceptContext(tx, 'owner-a'))), false);
    assert.equal(repo.transaction(tx => service.beforeAccept(acceptContext(tx, 'owner-b'))), true);
    service.pause({ scope: 'global' }, 'operator_request'); service.resume({ scope: 'global' }, 'operator_request');
    assert.equal(repo.transaction(tx => service.beforeAccept(acceptContext(tx, 'owner-a'))), false);
    service.resume({ scope: 'account', ownerId: 'owner-a' }, 'operator_request');
    assert.equal(repo.transaction(tx => service.beforeAccept(acceptContext(tx, 'owner-a'))), true);
    const events = f.db.prepare("SELECT rowid,owner_id,event_type,details_json FROM audit_events WHERE event_type='budget.control' ORDER BY rowid").all() as { rowid: number; owner_id: string | null; event_type: string; details_json: string }[];
    assert.deepEqual(events.map(event => JSON.parse(event.details_json).action), ['pause', 'pause', 'resume', 'resume']);
    assert.equal(events[0]!.owner_id, 'owner-a'); assert.equal(events[1]!.owner_id, null); assert.ok(events[3]!.rowid > events[0]!.rowid);
  } finally { f.close(); }
});

function racePlan(ownerId: string) { return { planId: `plan-${ownerId}`, semantic: { ownerId, projectId: `project-${ownerId}`, walletScope: 'live', executionMode: 'live', supplier: profile, supplierExposureMicrosUSD: profile.maxSupplierCostMicrosUSD } }; }
test('two independent SQLite worker connections cannot oversubscribe the global approved spend', async () => {
  const f = fixture(); try {
    const policyInput = policy({ maxActiveTasksGlobal: 8, globalBudgetMicrosUSD: profile.maxSupplierCostMicrosUSD });
    const source = `import { parentPort, workerData } from 'node:worker_threads';
      import { DatabaseSync } from 'node:sqlite';
      const [{createBudgetService},{WalletRepository},{supplierLiability}] = await Promise.all([import(workerData.budgetModule),import(workerData.walletModule),import(workerData.tasksModule)]);
      const db = new DatabaseSync(workerData.dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
      const service=createBudgetService({db,approvedPolicy:workerData.policy,clock:()=>new Date(workerData.now)}),repo=new WalletRepository(db);
      parentPort.postMessage('ready'); await new Promise(resolve=>parentPort.once('message',value=>value==='go'&&resolve()));
      const ownerId=workerData.ownerId,taskId=workerData.taskId,projectId='project-'+ownerId;
      const admitted=repo.transaction(tx=>{ const result=service.beforeAccept({tx,ownerId,projectId,taskId,plan:{planId:'plan-'+ownerId,semantic:{ownerId,projectId,walletScope:'live',executionMode:'live',supplier:{...workerData.policy.profile,approvedBudgetMicrosUSD:100000},supplierExposureMicrosUSD:workerData.policy.profile.maxSupplierCostMicrosUSD}},maximumExposureMicrosUSD:workerData.policy.profile.maxSupplierCostMicrosUSD,currentLiabilityMicrosUSD:supplierLiability(tx)}); if(result===false)return false;
        tx.run("INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,created_at,request_snapshot_json) VALUES(?,?,?,?,'queued',1,?,'{}')",taskId,ownerId,projectId,'submission-'+taskId,workerData.now);
        tx.run("INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'USD','profile_max_cost_usd_micros','reserved',?,?)",'exposure-'+taskId,ownerId,taskId,workerData.policy.profile.supplierProfileId,workerData.policy.profile.profileVersion,workerData.policy.profile.maxSupplierCostMicrosUSD,workerData.now,workerData.now); return true; });
      db.close(); parentPort.postMessage({kind:'done',admitted});`;
    const workers = ['owner-a','owner-b'].map((ownerId,i) => new Worker(source, { eval: true, execArgv: ['--import','tsx/esm'], workerData: { dbPath: f.dbPath, budgetModule: new URL('../../server/v2/budget.ts', import.meta.url).href, walletModule: new URL('../../server/v2/wallet-repo.ts', import.meta.url).href, tasksModule: new URL('../../server/v2/tasks.ts', import.meta.url).href, policy: policyInput, now: NOW, ownerId, taskId: `race-${i}` } }));
    const results: boolean[] = []; let ready = 0;
    await new Promise<void>((resolve,reject) => { const timeout=setTimeout(()=>reject(new Error('budget worker barrier timeout')),10_000); for(const worker of workers) worker.on('message',message=>{ if(message==='ready'&&++ready===workers.length) workers.forEach(item=>item.postMessage('go')); if(message?.kind==='done'){results.push(message.admitted);if(results.length===workers.length){clearTimeout(timeout);resolve();}} if(message?.kind==='error'){clearTimeout(timeout);reject(new Error(message.error));} }); for(const worker of workers)worker.on('error',reject); });
    assert.deepEqual(results.sort(), [false,true]);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM tasks').get() as {n:number}).n,1);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM supplier_exposures').get() as {n:number}).n,1);
  } finally { f.close(); }
});

const image = (color: string) => sharp({ create: { width: 64, height: 40, channels: 4, background: color } }).png().toBuffer();
const liveConfig = (): PlanConfiguration => ({ liveEnabled: true, liveCandidates: ['profile-test'], profiles: [{ providerId: profile.providerId, profile: { id: profile.supplierProfileId, version: profile.profileVersion, protocol: profile.protocol,
  endpoint: profile.endpoint, model: profile.model, templateVersion: profile.templateVersion, fields: ['bodyColor'], originalReference: true, approvedForLive: true, officialEvidence: 'https://developers.openai.com/synthetic-evidence', qualityEvidence: profile.qualityEvidence, maxCostMicrosUSD: profile.maxSupplierCostMicrosUSD, timeoutMs: profile.timeoutMs, maxInputBytes: profile.maxInputBytes, maxOutputBytes: profile.maxOutputBytes, maxResponseBytes: profile.maxResponseBytes, output: profile.output } }], policyVersion: 'processing-v1', requiredGenerationPurpose: 'model-precheck', budget: { maxSupplierCostMicrosUSD: 100_000 }, sourcePolicy: { version: 'source-v1', allowedKinds: ['user_upload'] } });
async function providerFixture() {
  const f=fixture(), ownerId='owner-provider'; f.db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(ownerId,NOW); f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)').run('identity-provider',ownerId,'apple','synthetic-apple-subject',NOW);
  const consentId=createConsentService(f.db,catalog).issue(ownerId,{policyId:'policy-test',acknowledgePhotoRights:true,acknowledgeUploadStorage:true,acknowledgeSharing:true}).consentRecordId;
  const project=await createProjectService({db:f.db,consentCatalog:catalog,storageQuotaBytes:300_000_000}).create(ownerId,consentId,await image('#2468ad'),'Synthetic budget project','user_upload');
  const plans=createPlanService({db:f.db,consentCatalog:catalog,config:liveConfig(),clock:()=>new Date(NOW)}), plan=await plans.quote(ownerId,project.projectId,consentId,{schemaVersion:2,source:{kind:'original'},operation:'detail',edits:{bodyColor:{action:'set',value:'blue'}}});
  const repo=new WalletRepository(f.db); repo.transaction(tx=>repo.grantInTransaction(tx,{ownerId,kind:'promo',sourceKind:'promo',sourceEventKey:'budget-credit',units:2,scope:'live'}));
  const task=(await createTaskService({db:f.db,consentCatalog:catalog,config:liveConfig(),storageQuotaBytes:300_000_000,clock:()=>new Date(NOW)}).submit(ownerId,{planId:plan.planId,submissionId:'budget-submission',consentRecordId:consentId})).task;
  const attemptId='budget-attempt'; f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(task.id); f.db.prepare("UPDATE supplier_exposures SET status='started' WHERE task_id=?").run(task.id);
  f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,provider_profile_version,status,estimated_cost_usd_micros,started_at) VALUES (?,?,?,?,?,'started',?,?)").run(attemptId,ownerId,task.id,profile.supplierProfileId,profile.profileVersion,profile.maxSupplierCostMicrosUSD,NOW);
  const inputs=await plans.readCurrentInputs(plan), source=plan.semantic.source, primary={ownerId,projectId:project.projectId,assetId:inputs.source.row.id,source:source.kind==='version'?{kind:'version' as const,versionId:source.versionId!}:{kind:'original' as const},mimeType:'image/png' as const,sha256:inputs.source.image.sha256,bytes:inputs.source.image.bytes};
  const providerInput:ProviderInput={ownerId,projectId:project.projectId,editRequest:providerEditRequest(plan),primary};
  return {...f,ownerId,plan,task,attemptId,providerInput,repo,profilePolicy:policy({profile})};
}
const providerResult = (overrides: Record<string,unknown> = {}): ProviderResult => ({ok:true,image:Buffer.from('synthetic-image'),mimeType:'image/png',profileId:profile.supplierProfileId,profileVersion:profile.profileVersion,model:profile.model,templateVersion:profile.templateVersion,promptSha256:'a'.repeat(64),providerRequestId:'synthetic-provider-call',usage:null,actualCostMicrosUSD:null,maxExposureMicrosUSD:profile.maxSupplierCostMicrosUSD,attempted:true,quality:'UNASSESSED',...overrides}) as ProviderResult;

test('provider decorator captures canonical frozen input and persists a minimal pause without changing task cost', async () => {
  const f=await providerFixture(); try {
    assert.equal(f.providerInput.primary.sha256,f.plan.semantic.source.canonicalSha256);
    assert.equal(createHash('sha256').update(f.providerInput.primary.bytes).digest('hex'),f.plan.semantic.source.canonicalSha256);
    const budget=createBudgetService({db:f.db,approvedPolicy:f.profilePolicy,clock:()=>new Date(NOW),id:randomUUID}), result=providerResult({model:'unapproved-model'}); let calls=0;
    const protectedCall=budget.protectProvider(async input=>{calls++;assert.deepEqual(input.editRequest,providerEditRequest(f.plan));return result;});
    const before=(f.db.prepare('SELECT user_cost_units FROM tasks WHERE id=?').get(f.task.id) as {user_cost_units:number}).user_cost_units, ledger=(f.db.prepare('SELECT count(*) AS n FROM ledger_events').get() as {n:number}).n;
    const returned=await protectedCall(f.providerInput); assert.strictEqual(returned,result); assert.equal(calls,1);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM audit_events WHERE event_type=\'budget.case\'').get() as {n:number}).n,1);
    const caseRow=f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='budget.case' LIMIT 1").get() as {details_json:string};
    assert.deepEqual(Object.keys(JSON.parse(caseRow.details_json)).sort(),['actualCostMicrosUSD','attemptId','expectedProfile','expectedVersion','observedMaximumMicrosUSD','observedModel','observedProfile','observedTemplate','observedVersion','reason','taskId','v'].sort());
    const control=f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='budget.control' ORDER BY rowid DESC LIMIT 1").get() as {details_json:string};
    assert.equal(JSON.parse(control.details_json).action,'pause'); assert.equal(JSON.parse(control.details_json).scope,'global');
    assert.equal((f.db.prepare('SELECT user_cost_units FROM tasks WHERE id=?').get(f.task.id) as {user_cost_units:number}).user_cost_units,before);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM ledger_events').get() as {n:number}).n,ledger);
    assert.equal(f.repo.transaction(tx=>budget.beforeAccept(acceptContext(tx,f.ownerId))),false);
  } finally { f.close(); }
});

test('provider decorator treats known over-cap cost as a pause and refuses mismatched frozen context without calling upstream', async () => {
  const f=await providerFixture(); try {
    const budget=createBudgetService({db:f.db,approvedPolicy:f.profilePolicy,clock:()=>new Date(NOW)}), over=providerResult({actualCostMicrosUSD:profile.maxSupplierCostMicrosUSD+1}); let calls=0;
    const returned=await budget.protectProvider(async()=>{calls++;return over;})(f.providerInput);
    assert.strictEqual(returned,over); assert.equal(calls,1);
    const missing=createBudgetService({db:f.db,approvedPolicy:f.profilePolicy,clock:()=>new Date(NOW)}); let missingCalls=0;
    const tampered={...f.providerInput,primary:{...f.providerInput.primary,assetId:'not-the-frozen-asset'}};
    const refused=await missing.protectProvider(async()=>{missingCalls++;return providerResult();})(tampered);
    assert.equal(missingCalls,0); assert.equal(refused.ok,false); if(!refused.ok)assert.equal(refused.attempted,false);
    assert.equal(missing.locallyFailClosed(),false);
  } finally { f.close(); }
});

test('provider decorator refuses a started attempt whose stored estimate no longer matches the frozen profile', async () => {
  const f=await providerFixture(); try {
    f.db.prepare('UPDATE supplier_attempts SET estimated_cost_usd_micros=? WHERE id=?').run(profile.maxSupplierCostMicrosUSD-1,f.attemptId);
    const budget=createBudgetService({db:f.db,approvedPolicy:f.profilePolicy,clock:()=>new Date(NOW)}); let calls=0;
    const result=await budget.protectProvider(async()=>{calls++;return providerResult();})(f.providerInput);
    assert.equal(calls,0); assert.equal(result.ok,false); if(!result.ok)assert.equal(result.attempted,false);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='budget.case'").get() as {n:number}).n,1);
  } finally { f.close(); }
});

test('provider decorator permits the attempt that already consumed the last window slot', async () => {
  const f=await providerFixture(); try {
    const budget=createBudgetService({db:f.db,approvedPolicy:policy({maxAttemptsPerWindowGlobal:1,maxAttemptsPerWindowPerAccount:1}),clock:()=>new Date(NOW)});
    const expected=providerResult(); let calls=0;
    const result=await budget.protectProvider(async()=>{calls++;return expected;})(f.providerInput);
    assert.equal(calls,1,'the started attempt already passed the atomic dispatch rate check'); assert.strictEqual(result,expected);
  } finally { f.close(); }
});

test('audit persistence failure closes this service instance and does not claim a durable pause', async () => {
  const f=await providerFixture(); try {
    f.db.exec("CREATE TRIGGER reject_budget_case BEFORE INSERT ON audit_events WHEN NEW.event_type='budget.case' BEGIN SELECT RAISE(FAIL,'synthetic audit failure'); END;");
    const budget=createBudgetService({db:f.db,approvedPolicy:f.profilePolicy,clock:()=>new Date(NOW)}); let calls=0;
    const tampered={...f.providerInput,primary:{...f.providerInput.primary,assetId:'not-the-frozen-asset'}};
    const result=await budget.protectProvider(async()=>{calls++;return providerResult();})(tampered);
    assert.equal(calls,0); assert.equal(result.ok,false); assert.equal(budget.locallyFailClosed(),true);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='budget.control'").get() as {n:number}).n,0);
    assert.equal(f.repo.transaction(tx=>budget.beforeAccept(acceptContext(tx,f.ownerId))),false);
  } finally { f.close(); }
});

test('an actual supplier limit incident remains closed across connections and restart when audit insertion fails', async () => {
  for (const blockedType of ["NEW.event_type='budget.case'", '1']) {
    const f = await providerFixture(); let siblingDb: DatabaseSync | undefined;
    try {
      siblingDb = openV2Database(f.dbPath);
      const siblingRepo = new WalletRepository(siblingDb);
      const sibling = createBudgetService({ db: siblingDb, approvedPolicy: f.profilePolicy, clock: () => new Date(NOW) });
      assert.equal(siblingRepo.transaction(tx => sibling.beforeAccept(acceptContext(tx, 'owner-b'))), true);
      f.db.exec(`CREATE TRIGGER reject_incident_audit BEFORE INSERT ON audit_events WHEN ${blockedType} BEGIN SELECT RAISE(FAIL,'synthetic audit failure'); END;`);
      const ledgerBefore = f.db.prepare('SELECT * FROM ledger_events ORDER BY id').all();
      const budget = createBudgetService({ db: f.db, approvedPolicy: f.profilePolicy, clock: () => new Date(NOW) });
      const result = providerResult({ model: 'unapproved-model' }); let calls = 0;
      assert.strictEqual(await budget.protectProvider(async () => { calls++; return result; })(f.providerInput), result);
      assert.equal(calls, 1); assert.equal(budget.locallyFailClosed(), true);
      assert.equal(siblingRepo.transaction(tx => sibling.beforeAccept(acceptContext(tx, 'owner-b'))), false,
        'a second writable connection must see that the supplier maximum is no longer defensible');
      const exposure = f.db.prepare('SELECT estimate_basis,max_cost_usd_micros FROM supplier_exposures WHERE task_id=?').get(f.task.id);
      assert.equal(exposure?.estimate_basis, 'unverifiable_provider_limit');
      assert.equal(exposure?.max_cost_usd_micros, profile.maxSupplierCostMicrosUSD);
      assert.deepEqual(f.db.prepare('SELECT * FROM ledger_events ORDER BY id').all(), ledgerBefore);
      assert.equal(f.db.prepare('SELECT user_cost_units FROM tasks WHERE id=?').get(f.task.id)?.user_cost_units, 1);
      f.db.prepare("UPDATE supplier_exposures SET status='settled',updated_at=? WHERE task_id=?").run(NOW, f.task.id);
      f.db.prepare("UPDATE supplier_attempts SET status='succeeded',reconciled_cost_usd_micros=?,ended_at=? WHERE id=?").run(10_000, NOW, f.attemptId);
      f.db.exec('DROP TRIGGER reject_incident_audit');
      siblingDb.close(); siblingDb = openV2Database(f.dbPath);
      const restarted = createBudgetService({ db: siblingDb, approvedPolicy: f.profilePolicy, clock: () => new Date(NOW),
        authorizeOperator: () => ({ actorId: 'synthetic-operator' }) });
      assert.equal(new WalletRepository(siblingDb).transaction(tx => restarted.beforeAccept(acceptContext(tx, 'owner-b'))), false);
      assert.throws(() => restarted.resume({ scope: 'global' }, 'operator_request'), { code: 'BUDGET_REPAIR_REQUIRED' });
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='budget.control'").get()?.n, 0);
    } finally { siblingDb?.close(); f.close(); }
  }
});
