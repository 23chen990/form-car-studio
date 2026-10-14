import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Environment } from '@apple/app-store-server-library';
import sharp from 'sharp';
import { test } from 'node:test';
import { openV2Database } from '../../server/v2/db.js';
import { createFeedbackService } from '../../server/v2/feedback.js';
import { recordFirstPartyEventInTransaction, recordQualityReviewInTransaction } from '../../server/v2/audit.js';
import { normalizeInput, validateOutputMaster } from '../../server/v2/images.js';
import { applyAppleRevocationInTransaction } from '../../server/v2/refunds.js';
import { appleRevocationTombstoneId } from '../../server/v2/purchases.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { createMergeService } from '../../server/v2/merge.js';
import { issueSessionInTransaction } from '../../server/v2/sessions.js';

const NOW = '2026-10-14T00:00:00.000Z';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
type Category = 'identity_changed' | 'target_not_applied' | 'unwanted_structure' | 'image_artifacts' | 'preference_only' | 'slow_or_failed';
type ReviewDecision = 'accepted' | 'rejected' | 'needs_more_evidence';
const sample = (color = '#397acb') => sharp({ create: { width: 11, height: 5, channels: 4, background: color } }).png().toBuffer();
const codeIs = (code: string) => (error: unknown) => error instanceof Error && (error as { code?: string }).code === code;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'form-f35-')), dbPath = join(dir, 'form.sqlite'), db = openV2Database(dbPath), wallet = new WalletRepository(db);
  for (const owner of ['owner-a', 'owner-b']) {
    db.prepare('INSERT INTO users(id,created_at) VALUES (?,?)').run(owner, NOW);
    db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES (?,?,?)').run(`project-${owner}`, owner, NOW);
  }
  return { dir, dbPath, db, wallet, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function settledTask(f: ReturnType<typeof fixture>, taskId: string, options: { owner?: string; root?: string | null; cost?: number; purchase?: { transactionId: string; productId: string } } = {}) {
  const owner = options.owner ?? 'owner-a', project = `project-${owner}`, cost = options.cost ?? 2;
  let grant: Parameters<WalletRepository['grantInTransaction']>[1];
  if (options.purchase) {
    const environment = Environment.SANDBOX, transactionId = options.purchase.transactionId;
    const purchaseId = `purchase-${taskId}`;
    f.db.prepare('INSERT INTO purchases(id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(purchaseId, owner, environment, transactionId, options.purchase.productId, NOW);
    grant = { ownerId: owner, kind: 'purchased', sourceKind: 'purchase', sourceEventKey: `apple-purchase:v1:${environment}:${sha(transactionId)}`,
      purchaseId, units: cost, scope: 'live' };
  } else grant = { ownerId: owner, kind: 'promo', sourceKind: 'promo', sourceEventKey: `seed:${taskId}`, units: cost, scope: 'live' };
  f.wallet.transaction(tx => f.wallet.grantInTransaction(tx, grant));
  f.db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,root_task_id,request_snapshot_json,created_at)
    VALUES(?,?,?,?,'queued',?,?,?,?)`).run(taskId, owner, project, `submission-${taskId}`, cost, options.root ?? null, JSON.stringify({ scope: 'live' }), NOW);
  f.wallet.transaction(tx => f.wallet.reserveTaskInTransaction(tx, { ownerId: owner, taskId }));
  f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(taskId);
  const versionId = `version-${taskId}`;
  f.db.prepare('INSERT INTO versions(id,owner_id,project_id,task_id,created_at) VALUES (?,?,?,?,?)').run(versionId, owner, project, taskId, NOW);
  f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: owner, taskId, outcome: 'succeeded', resultVersionId: versionId }));
  return { ownerId: owner, projectId: project, taskId, versionId };
}

function taskFromAvailable(f: ReturnType<typeof fixture>, taskId: string, cost: number) {
  const ownerId = 'owner-a', projectId = 'project-owner-a';
  f.db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at)
    VALUES(?,?,?,?,'queued',?,?,?)`).run(taskId, ownerId, projectId, `submission-${taskId}`, cost, JSON.stringify({ scope: 'live' }), NOW);
  f.wallet.transaction(tx => f.wallet.reserveTaskInTransaction(tx, { ownerId, taskId }));
  f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(taskId);
  const versionId = `version-${taskId}`;
  f.db.prepare('INSERT INTO versions(id,owner_id,project_id,task_id,created_at) VALUES (?,?,?,?,?)').run(versionId, ownerId, projectId, taskId, NOW);
  f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId, taskId, outcome: 'succeeded', resultVersionId: versionId }));
  return { ownerId, projectId, taskId, versionId };
}

function failedTask(f: ReturnType<typeof fixture>, taskId: string) {
  const task = reservedTask(f, taskId);
  f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(taskId);
  f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: task.ownerId, taskId, outcome: 'failed' }));
  return task;
}

function reservedTask(f: ReturnType<typeof fixture>, taskId: string) {
  const ownerId = 'owner-a', projectId = 'project-owner-a';
  f.wallet.transaction(tx => f.wallet.grantInTransaction(tx, { ownerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: `seed:${taskId}`, units: 1, scope: 'live' }));
  f.db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at)
    VALUES(?,?,?,?,'queued',1,?,?)`).run(taskId, ownerId, projectId, `submission-${taskId}`, JSON.stringify({ scope: 'live' }), NOW);
  f.wallet.transaction(tx => f.wallet.reserveTaskInTransaction(tx, { ownerId, taskId }));
  return { ownerId, projectId, taskId, versionId: `version-${taskId}` };
}

function submitReviewed(f: ReturnType<typeof fixture>, task: ReturnType<typeof settledTask>, options: { category?: Category; decision?: ReviewDecision; policy?: string } = {}) {
  const category = options.category ?? 'image_artifacts', policy = options.policy ?? 'quality-v1';
  const submitted = createFeedbackService({ db: f.db, clock: () => new Date(NOW) }).submit(task.ownerId, {
    eventKey: `report-${task.taskId}`, taskId: task.taskId, versionId: task.versionId, category,
  });
  const review = { reviewKey: `review-${task.taskId}-${policy}`, taskId: task.taskId, versionId: task.versionId,
    feedbackId: submitted.feedbackId, category, decision: options.decision ?? 'accepted', evidenceReference: 'synthetic-evidence', policyVersion: policy };
  f.wallet.transaction(tx => recordQualityReviewInTransaction(tx, task.ownerId, review, () => ({ actorId: 'operator-test' }), NOW));
  return submitted.feedbackId;
}

function compensationModule() { return import('../../server/v2/compensation.js'); }
function service(f: ReturnType<typeof fixture>, authorized = true) {
  return compensationModule().then(({ createQualityCompensationService }) => createQualityCompensationService({ db: f.db,
    clock: () => new Date(NOW), ...(authorized ? { authorizeOperator: () => ({ actorId: 'operator-test' }) } : {}) }));
}

function count(f: ReturnType<typeof fixture>, sql: string, ...params: (string | number)[]) {
  return (f.db.prepare(sql).get(...params) as { n: number }).n;
}

test('approved operator review grants only the root settled cost and leaves succeeded history unchanged', async () => {
  const f = fixture();
  try {
    const task = settledTask(f, 'task-approved'), feedbackId = submitReviewed(f, task);
    const beforeTask = f.db.prepare('SELECT status,result_version_id,user_cost_units FROM tasks WHERE id=?').get(task.taskId);
    const beforeSettles = f.db.prepare("SELECT ledger_event_key,units,credit_lot_id FROM ledger_events WHERE task_id=? AND event_type='settle' ORDER BY ledger_event_key").all(task.taskId);
    const comp = await service(f);
    assert.equal(comp.compensate(task.ownerId, { taskId: task.taskId, versionId: task.versionId, feedbackId }).status, 'granted');
    assert.deepEqual(f.db.prepare('SELECT status,result_version_id,user_cost_units FROM tasks WHERE id=?').get(task.taskId), beforeTask);
    assert.deepEqual(f.db.prepare("SELECT ledger_event_key,units,credit_lot_id FROM ledger_events WHERE task_id=? AND event_type='settle' ORDER BY ledger_event_key").all(task.taskId), beforeSettles);
    assert.equal(count(f, 'SELECT count(*) AS n FROM versions WHERE task_id=?', task.taskId), 1);
    const compensation = f.db.prepare('SELECT units,owner_id FROM quality_compensations WHERE root_task_id=?').get(task.taskId) as { units: number; owner_id: string };
    assert.equal(compensation.units, 2); assert.equal(compensation.owner_id, task.ownerId);
    assert.equal(count(f, "SELECT count(*) AS n FROM credit_lots WHERE source_kind='quality_compensation' AND source_event_key=?", `quality_compensation:${task.taskId}`), 1);
    assert.equal(count(f, "SELECT count(*) AS n FROM ledger_events WHERE event_type='grant' AND ledger_event_key=?", `grant:quality_compensation:${task.taskId}`), 1);
    assert.equal(count(f, "SELECT count(*) AS n FROM audit_events WHERE event_type='quality.compensation_applied'"), 1);
  } finally { f.close(); }
});

test('review authorization and decisions stay server-controlled; preferences and foreign owners do not compensate', async () => {
  const f = fixture();
  try {
    const first = settledTask(f, 'task-rejected');
    const rejected = submitReviewed(f, first, { decision: 'rejected' });
    const preference = settledTask(f, 'task-preference');
    const subjective = submitReviewed(f, preference, { category: 'preference_only', decision: 'accepted', policy: 'quality-v2' });
    const comp = await service(f);
    assert.equal(comp.compensate('owner-a', { taskId: first.taskId, versionId: first.versionId, feedbackId: rejected }).status, 'not_approved');
    assert.equal(comp.compensate('owner-a', { taskId: preference.taskId, versionId: preference.versionId, feedbackId: subjective }).status, 'not_approved');
    assert.equal(comp.compensate('owner-b', { taskId: first.taskId, versionId: first.versionId, feedbackId: rejected }).status, 'not_eligible');
    const closed = await service(f, false);
    assert.throws(() => closed.compensate('owner-a', { taskId: first.taskId, versionId: first.versionId, feedbackId: rejected }), codeIs('OPERATOR_REQUIRED'));
    assert.throws(() => comp.compensate('owner-a', { taskId: first.taskId, versionId: first.versionId, feedbackId: rejected, approved: true, units: 99 } as never), codeIs('COMPENSATION_INVALID'));
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0);
  } finally { f.close(); }
});

test('a prior quality grant cannot fund an endless remedial compensation chain', async () => {
  const f = fixture();
  try {
    const original = settledTask(f, 'task-original-benefit', { cost: 1 }), originalFeedback = submitReviewed(f, original);
    const comp = await service(f);
    assert.equal(comp.compensate(original.ownerId, { taskId: original.taskId, versionId: original.versionId, feedbackId: originalFeedback }).status, 'granted');
    const remedial = taskFromAvailable(f, 'task-remedial-root-null', 1), remedialFeedback = submitReviewed(f, remedial, { policy: 'quality-v2' });
    const settlement = f.db.prepare(`SELECT lot.source_kind FROM reservations reservation
      JOIN reservation_allocations allocation ON allocation.owner_id=reservation.owner_id AND allocation.reservation_id=reservation.id
      JOIN credit_lots lot ON lot.owner_id=allocation.owner_id AND lot.id=allocation.credit_lot_id WHERE reservation.task_id=?`).get(remedial.taskId) as { source_kind: string };
    assert.equal(settlement.source_kind, 'quality_compensation');
    assert.equal(comp.compensate(remedial.ownerId, { taskId: remedial.taskId, versionId: remedial.versionId, feedbackId: remedialFeedback }).status, 'not_eligible');
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 1);
    assert.equal(count(f, "SELECT count(*) AS n FROM credit_lots WHERE source_kind='quality_compensation'"), 1);
  } finally { f.close(); }
});

test('failed released task can record a technical event but receives no extra benefit', async () => {
  const f = fixture();
  try {
    const failed = failedTask(f, 'task-failed');
    f.wallet.transaction(tx => recordFirstPartyEventInTransaction(tx, failed.ownerId, {
      eventKey: 'failed-technical-report', kind: 'task_technical_failure', taskId: failed.taskId, errorCode: 'PROVIDER_TIMEOUT_UNKNOWN',
    }, NOW));
    assert.throws(() => createFeedbackService({ db: f.db }).submit(failed.ownerId, {
      eventKey: 'failed-quality-report', taskId: failed.taskId, versionId: failed.versionId, category: 'slow_or_failed',
    }), codeIs('FEEDBACK_TARGET_INVALID'));
    const comp = await service(f);
    assert.equal(comp.compensate(failed.ownerId, { taskId: failed.taskId, versionId: failed.versionId, feedbackId: `feedback:${'a'.repeat(64)}` }).status, 'not_eligible');
    assert.equal((f.db.prepare('SELECT status,credit_returned FROM tasks WHERE id=?').get(failed.taskId) as { status: string; credit_returned: number }).status, 'failed');
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(failed.taskId) as { status: string }).status, 'released');
    assert.equal(count(f, "SELECT count(*) AS n FROM audit_events WHERE event_type='first_party_event'"), 1);
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0);
  } finally { f.close(); }
});

test('task cost tampering is rejected against immutable settlement evidence', async () => {
  const f = fixture();
  try {
    const task = settledTask(f, 'task-cost-tamper', { cost: 2 }), feedbackId = submitReviewed(f, task);
    f.db.prepare('UPDATE tasks SET user_cost_units=99 WHERE id=?').run(task.taskId);
    const comp = await service(f);
    assert.throws(() => comp.compensate(task.ownerId, { taskId: task.taskId, versionId: task.versionId, feedbackId }), codeIs('COMPENSATION_FACTS_INVALID'));
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0);
    assert.equal(count(f, "SELECT count(*) AS n FROM credit_lots WHERE source_kind='quality_compensation'"), 0);
  } finally { f.close(); }
});

test('direct completed demo owner upgrade preserves settle provenance and demo compensation scope', async () => {
  const f = fixture();
  try {
    const cookie = 'synthetic-f35-merge-cookie', cookieDigest = sha(cookie), sourceOwnerId = `legacy-owner-${sha(`form:v2:legacy-owner\0${cookie}`).slice(0, 24)}`;
    const targetOwnerId = 'owner-a', projectId = `project-${sourceOwnerId}`, taskId = 'task-merged-origin', familyId = 'source-legacy-family';
    f.db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(sourceOwnerId, NOW);
    f.db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES(?,?,?)').run(projectId, sourceOwnerId, NOW);
    f.db.prepare("INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)").run('source-legacy-identity', sourceOwnerId, 'legacy_cookie', cookieDigest, NOW);
    f.db.prepare('INSERT INTO session_families(id,owner_id,created_at) VALUES(?,?,?)').run(familyId, sourceOwnerId, NOW);
    f.db.prepare(`INSERT INTO v2_sessions(id,owner_id,token_digest,created_at,expires_at,revoked_at,family_id,parent_session_id,token_kind)
      VALUES(?,?,?,?,NULL,NULL,?,NULL,'legacy')`).run('source-legacy-session', sourceOwnerId, cookieDigest, NOW, familyId);
    f.db.prepare("INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)").run('target-apple-identity', targetOwnerId, 'apple', 'synthetic-apple-target', NOW);
    let tokenId = 0;
    const targetSession = f.wallet.transaction(tx => issueSessionInTransaction(tx, targetOwnerId, NOW, { token: () => Buffer.alloc(32, ++tokenId).toString('base64url') }));
    f.wallet.transaction(tx => f.wallet.grantInTransaction(tx, { ownerId: sourceOwnerId, kind: 'promo', sourceKind: 'promo', sourceEventKey: `seed:${taskId}`, units: 1, scope: 'demo' }));
    f.db.prepare(`INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at)
      VALUES(?,?,?,?,'queued',1,?,?)`).run(taskId, sourceOwnerId, projectId, `submission-${taskId}`, JSON.stringify({ scope: 'demo' }), NOW);
    f.wallet.transaction(tx => f.wallet.reserveTaskInTransaction(tx, { ownerId: sourceOwnerId, taskId }));
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(taskId);
    const versionId = `version-${taskId}`;
    f.db.prepare('INSERT INTO versions(id,owner_id,project_id,task_id,created_at) VALUES (?,?,?,?,?)').run(versionId, sourceOwnerId, projectId, taskId, NOW);
    f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: sourceOwnerId, taskId, outcome: 'succeeded', resultVersionId: versionId }));
    const sourceTask = { ownerId: sourceOwnerId, projectId, taskId, versionId }, sourceFeedbackId = submitReviewed(f, sourceTask);
    const comp = await service(f);
    assert.equal(comp.compensate(sourceOwnerId, { taskId, versionId, feedbackId: sourceFeedbackId }).status, 'granted');
    const upgraded = createMergeService({ db: f.db, clock: () => new Date(NOW) }).upgrade({ guestCookie: cookie, targetAccessToken: targetSession.accessToken, idempotencyKey: 'f35-merge-upgrade' });
    assert.equal(upgraded.status, 'completed');
    const settle = f.db.prepare("SELECT owner_id,origin_owner_id FROM ledger_events WHERE ledger_event_key LIKE 'settle:task-merged-origin:%'").get() as { owner_id: string; origin_owner_id: string };
    assert.equal(settle.owner_id, targetOwnerId); assert.equal(settle.origin_owner_id, sourceOwnerId);
    const task = { ownerId: targetOwnerId, projectId, taskId, versionId };
    const feedbackId = submitReviewed(f, task, { policy: 'quality-v2' });
    assert.equal(comp.compensate(targetOwnerId, { taskId, versionId, feedbackId }).status, 'already_compensated');
    const compensationLot = f.db.prepare("SELECT scope FROM credit_lots WHERE source_kind='quality_compensation'").get() as { scope: string };
    assert.equal(compensationLot.scope, 'demo');
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 1);
    const grant = f.db.prepare("SELECT owner_id,origin_owner_id FROM ledger_events WHERE ledger_event_key=?").get('grant:quality_compensation:task-merged-origin') as { owner_id: string; origin_owner_id: string };
    assert.equal(grant.owner_id, targetOwnerId); assert.equal(grant.origin_owner_id, sourceOwnerId);
  } finally { f.close(); }
});

test('fully consumed Apple refund blocks compensation without a refund ledger event', async () => {
  const f = fixture();
  try {
    const transactionId = 'synthetic-consumed-refund', productId = 'com.example.creditpack.small';
    const task = settledTask(f, 'task-refunded', { cost: 1, purchase: { transactionId, productId } }), feedbackId = submitReviewed(f, task);
    f.wallet.transaction(tx => applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.SANDBOX, transactionId, productId }, NOW));
    assert.ok(f.db.prepare('SELECT 1 FROM audit_events WHERE id=? AND event_type=?').get(appleRevocationTombstoneId(Environment.SANDBOX, transactionId), 'apple_revocation_tombstone'));
    assert.equal(count(f, "SELECT count(*) AS n FROM ledger_events WHERE event_type='refund'"), 0);
    assert.equal(count(f, "SELECT count(*) AS n FROM audit_events WHERE event_type='apple_refund_applied'"), 1);
    const comp = await service(f);
    assert.equal(comp.compensate(task.ownerId, { taskId: task.taskId, versionId: task.versionId, feedbackId }).status, 'blocked_refund');
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0);
  } finally { f.close(); }
});

test('a refunded purchased descendant blocks compensation rooted in a separate promo task', async () => {
  const f = fixture();
  try {
    const root = settledTask(f, 'task-promo-root', { cost: 2 });
    const transactionId = 'synthetic-descendant-consumed-refund', productId = 'com.example.creditpack.small';
    const child = settledTask(f, 'task-purchased-child', { cost: 1, root: root.taskId, purchase: { transactionId, productId } });
    f.wallet.transaction(tx => applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.SANDBOX, transactionId, productId }, NOW));
    assert.equal(count(f, "SELECT count(*) AS n FROM ledger_events WHERE event_type='refund'"), 0);
    const feedbackId = submitReviewed(f, child, { policy: 'quality-v2' });
    const comp = await service(f);
    assert.equal(comp.compensate(child.ownerId, { taskId: child.taskId, versionId: child.versionId, feedbackId }).status, 'blocked_refund');
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0);
    assert.equal(count(f, "SELECT count(*) AS n FROM credit_lots WHERE source_kind='quality_compensation'"), 0);
  } finally { f.close(); }
});

test('grant failure rolls back the compensation row and audit atomically', async () => {
  const f = fixture();
  try {
    const task = settledTask(f, 'task-rollback'), feedbackId = submitReviewed(f, task);
    f.db.exec("CREATE TRIGGER f35_fail_compensation BEFORE INSERT ON credit_lots WHEN NEW.source_kind='quality_compensation' BEGIN SELECT RAISE(ABORT,'synthetic grant failure'); END");
    const comp = await service(f);
    assert.throws(() => comp.compensate(task.ownerId, { taskId: task.taskId, versionId: task.versionId, feedbackId }), /synthetic grant failure/);
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0);
    assert.equal(count(f, "SELECT count(*) AS n FROM audit_events WHERE event_type='quality.compensation_applied'"), 0);
    assert.equal(count(f, "SELECT count(*) AS n FROM ledger_events WHERE event_type='grant' AND ledger_event_key LIKE 'grant:quality_compensation:%'"), 0);
  } finally { f.close(); }
});

test('independent SQLite workers racing different policy reviews grant one root benefit', async () => {
  const f = fixture();
  try {
    const root = settledTask(f, 'task-race-root', { cost: 3 });
    const left = settledTask(f, 'task-race-left', { cost: 1, root: root.taskId });
    const right = settledTask(f, 'task-race-right', { cost: 1, root: root.taskId });
    const leftFeedback = submitReviewed(f, left, { policy: 'quality-v1' });
    const rightFeedback = submitReviewed(f, right, { policy: 'quality-v2' });
    const source = `import { parentPort, workerData } from 'node:worker_threads';
      import { DatabaseSync } from 'node:sqlite';
      try {
        const {createQualityCompensationService}=await import(workerData.module);
        const db=new DatabaseSync(workerData.dbPath);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
        const service=createQualityCompensationService({db,clock:()=>new Date(workerData.now),authorizeOperator:()=>({actorId:'operator-race'})});
        parentPort.postMessage('ready');await new Promise(resolve=>parentPort.once('message',value=>value==='go'&&resolve()));
        const result=service.compensate(workerData.ownerId,workerData.input);db.close();parentPort.postMessage({kind:'done',status:result.status});
      } catch(error) { parentPort.postMessage({kind:'error',error:String(error)}); }`;
    const workers = [
      { task: left, feedbackId: leftFeedback }, { task: right, feedbackId: rightFeedback },
    ].map(({ task, feedbackId }) => new Worker(source, { eval: true, execArgv: ['--import', 'tsx/esm'], workerData: {
      dbPath: f.dbPath, module: new URL('../../server/v2/compensation.ts', import.meta.url).href, now: NOW, ownerId: task.ownerId,
      input: { taskId: task.taskId, versionId: task.versionId, feedbackId },
    } }));
    const results: string[] = []; let ready = 0;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('F35 SQLite worker barrier timeout')), 10_000);
      for (const worker of workers) {
        worker.on('message', (message: any) => {
          if (message === 'ready' && ++ready === workers.length) workers.forEach(item => item.postMessage('go'));
          else if (message?.kind === 'done') { results.push(message.status); if (results.length === workers.length) { clearTimeout(timeout); resolve(); } }
          else if (message?.kind === 'error') { clearTimeout(timeout); reject(new Error(message.error)); }
        });
        worker.on('error', reject);
      }
    });
    assert.deepEqual(results.sort(), ['already_compensated', 'granted']);
    assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations WHERE root_task_id=?', root.taskId), 1);
    assert.equal((f.db.prepare('SELECT units FROM quality_compensations WHERE root_task_id=?').get(root.taskId) as { units: number }).units, 3);
    assert.equal(count(f, "SELECT count(*) AS n FROM credit_lots WHERE source_kind='quality_compensation' AND source_event_key=?", `quality_compensation:${root.taskId}`), 1);
    assert.equal(count(f, "SELECT count(*) AS n FROM audit_events WHERE event_type='quality.compensation_applied'"), 1);
    const comp = await service(f);
    assert.equal(comp.compensate(right.ownerId, { taskId: right.taskId, versionId: right.versionId, feedbackId: rightFeedback }).status, 'already_compensated');
  } finally { f.close(); }
});

test('different PNG metadata and compression with identical normalized pixels fail and release', async () => {
  const quality = await import('../../server/v2/quality.js').catch(() => null);
  assert.ok(quality, 'the F35 normalized-image quality adapter is missing');
  const original = await sample();
  const reencoded = await sharp(original).withMetadata({ exif: { IFD0: { ImageDescription: 'SYNTHETIC_F35_METADATA' } } })
    .png({ compressionLevel: 0 }).toBuffer();
  const source = await normalizeInput(original), output = await validateOutputMaster(reencoded);
  assert.notEqual(source.sourceSha256, output.sourceSha256);
  assert.deepEqual(quality.assessImageOutput(source, output, 1), {
    deliver: false, creditAction: 'release', quality: 'rejected', reason: 'OUTPUT_UNCHANGED',
  });
  const f = fixture();
  try {
    const task = reservedTask(f, 'task-identical-pixels');
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(task.taskId);
    const availableBefore = (f.db.prepare('SELECT available_units FROM credit_lots WHERE source_event_key=?').get(`seed:${task.taskId}`) as { available_units: number }).available_units;
    assert.equal(availableBefore, 0);
    const first = f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: task.ownerId, taskId: task.taskId, outcome: 'failed' }));
    assert.deepEqual(first, { status: 'failed', replayed: false, returnedUnits: 1 });
    const second = f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: task.ownerId, taskId: task.taskId, outcome: 'failed' }));
    assert.deepEqual(second, { status: 'failed', replayed: true, returnedUnits: 1 });
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE source_event_key=?').get(`seed:${task.taskId}`) as { available_units: number }).available_units, 1);
    assert.equal(count(f, "SELECT count(*) AS n FROM ledger_events WHERE event_type='release' AND task_id=?", task.taskId), 1);
  } finally { f.close(); }
});

test('valid changed output without an approved output assessment stays unassessed', async () => {
  const quality = await import('../../server/v2/quality.js').catch(() => null);
  assert.ok(quality, 'the F35 normalized-image quality adapter is missing');
  const source = await normalizeInput(await sample());
  const output = await validateOutputMaster(await sample('#cc3344'));
  assert.deepEqual(quality.assessImageOutput(source, output, 1), {
    deliver: true, creditAction: 'settle', quality: 'unassessed', reason: 'OUTPUT_DELIVERABLE',
  });
});


test('deleted owners/projects, cyclic roots, and a mismatched root result cannot compensate', async () => {
  for (const mode of ['owner_deleted', 'project_deleted', 'cyclic_root', 'wrong_root_version'] as const) {
    const f = fixture();
    try {
      const root = settledTask(f, 'task-ineligible-root', { cost: 2 });
      const child = settledTask(f, 'task-ineligible-child', { root: root.taskId });
      const feedbackId = submitReviewed(f, child), comp = await service(f);
      if (mode === 'owner_deleted') f.db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run(NOW, child.ownerId);
      if (mode === 'project_deleted') f.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run(NOW, child.projectId);
      if (mode === 'cyclic_root') f.db.prepare('UPDATE tasks SET root_task_id=? WHERE id=?').run(child.taskId, root.taskId);
      if (mode === 'wrong_root_version') f.db.prepare('UPDATE tasks SET result_version_id=? WHERE id=?').run(child.versionId, root.taskId);
      const apply = () => comp.compensate(child.ownerId, { taskId: child.taskId, versionId: child.versionId, feedbackId });
      if (mode === 'owner_deleted' || mode === 'project_deleted') assert.equal(apply().status, 'not_eligible', mode);
      else assert.throws(apply, codeIs('COMPENSATION_FACTS_INVALID'), mode);
      assert.equal(count(f, 'SELECT count(*) AS n FROM quality_compensations'), 0, mode);
      assert.equal(count(f, "SELECT count(*) AS n FROM credit_lots WHERE source_kind='quality_compensation'"), 0, mode);
    } finally { f.close(); }
  }
});
