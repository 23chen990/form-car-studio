import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Environment } from '@apple/app-store-server-library';
import { test } from 'node:test';
import { createAppleNotificationRouter } from '../../server/v2/apple-notifications.js';
import { openV2Database } from '../../server/v2/db.js';
import { createApplePurchaseService, appleRevocationTombstoneId, PurchaseError, type ApplePurchaseConfig, type ApplePurchaseEnvironment } from '../../server/v2/purchases.js';
import { applyAppleRevocationInTransaction, applyRefundReconciliation, createAppleRefundService, previewRefundReconciliation } from '../../server/v2/refunds.js';
import { createSessionService } from '../../server/v2/sessions.js';
import { WalletRepository, type WalletTransaction } from '../../server/v2/wallet-repo.js';
import type { DatabaseSync } from 'node:sqlite';

const BUNDLE = 'com.example.synthetic';
const APPLE_ID = 1234567890;
const PRODUCT = 'com.example.creditpack.small';
let NOW = new Date();
const isCode = (expected: string) => (error: unknown) => error instanceof PurchaseError && error.code === expected;

type SyntheticChain = { rootDer: Buffer; chainDer: Buffer[]; leafKey: ReturnType<typeof createPrivateKey> };
function runOpenSSL(cwd: string, args: string[]): void { execFileSync('openssl', args, { cwd, stdio: 'ignore' }); }
function certDer(dir: string, file: string): Buffer {
  const pem = readFileSync(join(dir, file), 'utf8');
  return Buffer.from(pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''), 'base64');
}
function generateChain(dir: string): SyntheticChain {
  const prefix = 'synthetic-f25', ext = join(dir, `${prefix}.ext`);
  writeFileSync(ext, [
    '[root]', 'basicConstraints=critical,CA:TRUE,pathlen:1', 'keyUsage=critical,keyCertSign,cRLSign', 'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid:always,issuer', '',
    '[intermediate]', 'basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign', 'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid:always,issuer', '1.2.840.113635.100.6.2.1=DER:05:00', '',
    '[leaf]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid,issuer', '1.2.840.113635.100.6.11.1=DER:05:00', '',
  ].join('\n'));
  const rootKey = `${prefix}-root.key`, rootCsr = `${prefix}-root.csr`, rootPem = `${prefix}-root.pem`;
  const intKey = `${prefix}-intermediate.key`, intCsr = `${prefix}-intermediate.csr`, intPem = `${prefix}-intermediate.pem`;
  const leafKey = `${prefix}-leaf.key`, leafCsr = `${prefix}-leaf.csr`, leafPem = `${prefix}-leaf.pem`;
  runOpenSSL(dir, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', rootKey]);
  runOpenSSL(dir, ['req', '-new', '-key', rootKey, '-subj', '/CN=F25 Synthetic Root', '-out', rootCsr]);
  runOpenSSL(dir, ['x509', '-req', '-in', rootCsr, '-signkey', rootKey, '-days', '3650', '-sha256', '-extfile', `${prefix}.ext`, '-extensions', 'root', '-out', rootPem]);
  runOpenSSL(dir, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', intKey]);
  runOpenSSL(dir, ['req', '-new', '-key', intKey, '-subj', '/CN=F25 Synthetic Intermediate', '-out', intCsr]);
  runOpenSSL(dir, ['x509', '-req', '-in', intCsr, '-CA', rootPem, '-CAkey', rootKey, '-set_serial', '21', '-days', '3650', '-sha256', '-extfile', `${prefix}.ext`, '-extensions', 'intermediate', '-out', intPem]);
  runOpenSSL(dir, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', leafKey]);
  runOpenSSL(dir, ['req', '-new', '-key', leafKey, '-subj', '/CN=F25 Synthetic Leaf', '-out', leafCsr]);
  runOpenSSL(dir, ['x509', '-req', '-in', leafCsr, '-CA', intPem, '-CAkey', intKey, '-set_serial', '22', '-days', '3650', '-sha256', '-extfile', `${prefix}.ext`, '-extensions', 'leaf', '-out', leafPem]);
  return { rootDer: certDer(dir, rootPem), chainDer: [certDer(dir, leafPem), certDer(dir, intPem), certDer(dir, rootPem)], leafKey: createPrivateKey(readFileSync(join(dir, leafKey))) };
}
function signJws(payload: object, chain: SyntheticChain): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'ES256', x5c: chain.chainDer.map(value => value.toString('base64')) });
  const body = b64(payload), input = `${header}.${body}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: chain.leafKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function config(chain: SyntheticChain): ApplePurchaseConfig {
  return { bundleId: BUNDLE, appAppleId: APPLE_ID, rootCertificates: [chain.rootDer], fiveUnitProductId: PRODUCT, fifteenUnitProductId: 'com.example.creditpack.large' };
}
function signedRefund(chain: SyntheticChain, ownerId: string, options: { environment?: string; transactionId?: string; productId?: string; notificationUUID?: string; revocationDate?: number | null } = {}) {
  const environment = options.environment ?? Environment.PRODUCTION;
  const transaction = {
    transactionId: options.transactionId ?? `synthetic-${randomUUID()}`, originalTransactionId: `synthetic-original-${randomUUID()}`,
    bundleId: BUNDLE, productId: options.productId ?? PRODUCT, purchaseDate: NOW.getTime(), originalPurchaseDate: NOW.getTime(),
    quantity: 1, type: 'Consumable', appAccountToken: ownerId, inAppOwnershipType: 'PURCHASED', environment, signedDate: NOW.getTime(),
    revocationDate: options.revocationDate === null ? undefined : options.revocationDate ?? NOW.getTime(),
  };
  const signedTransaction = signJws(transaction, chain);
  const signedPayload = signJws({ notificationType: 'REFUND', notificationUUID: options.notificationUUID ?? randomUUID(), version: '2.0', signedDate: NOW.getTime(),
    data: { appAppleId: APPLE_ID, bundleId: BUNDLE, environment, signedTransactionInfo: signedTransaction } }, chain);
  return { transaction, signedTransaction, signedPayload, environment };
}
type Fixture = { db: DatabaseSync; dir: string; path: string; ownerId: string; wallet: WalletRepository; chain: SyntheticChain; config: ApplePurchaseConfig; refunds: ReturnType<typeof createAppleRefundService>; close(): void };
function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'form-f25-')), path = join(dir, 'refunds.sqlite'), db = openV2Database(path);
  const ownerId = randomUUID(), wallet = new WalletRepository(db), chain = generateChain(dir), appleConfig = config(chain);
  // The official verifier checks each synthetic certificate at the signedDate.
  NOW = new Date(Date.now() + 10_000);
  db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(ownerId, NOW.toISOString());
  db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), ownerId, 'apple', `synthetic-${randomUUID()}`, NOW.toISOString());
  const refunds = createAppleRefundService({ db, config: appleConfig, environment: Environment.PRODUCTION, enableOnlineChecks: false, clock: () => NOW });
  return { db, dir, path, ownerId, wallet, chain, config: appleConfig, refunds, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function purchase(f: Fixture, transactionId: string, productId = PRODUCT, units = 5): { purchaseId: string; lotId: string } {
  const purchaseId = randomUUID();
  f.db.prepare('INSERT INTO purchases(id,owner_id,environment,transaction_id,product_id,created_at) VALUES(?,?,?,?,?,?)').run(purchaseId, f.ownerId, Environment.PRODUCTION, transactionId, productId, NOW.toISOString());
  const grant = f.wallet.transaction(tx => f.wallet.grantInTransaction(tx, { ownerId: f.ownerId, kind: 'purchased', sourceKind: 'purchase', sourceEventKey: `apple-purchase:v1:${Environment.PRODUCTION}:${importHash(transactionId)}`, purchaseId, units, scope: 'live', createdAt: NOW.toISOString() }));
  return { purchaseId, lotId: grant.lotId };
}
function importHash(value: string) { return requireHash(value); }
function requireHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function queuedTask(f: Fixture, taskId: string, units = 1) {
  f.db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES(?,?,?)').run(`project-${taskId}`, f.ownerId, NOW.toISOString());
  f.db.prepare('INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(taskId, f.ownerId, `project-${taskId}`, `submission-${taskId}`, 'queued', units, JSON.stringify({ scope: 'live' }), NOW.toISOString(), NOW.toISOString());
  f.db.prepare("INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'USD','profile_max_cost_usd_micros','reserved',?,?)")
    .run(randomUUID(), f.ownerId, taskId, 'synthetic-provider', 'synthetic-v1', 1000, NOW.toISOString(), NOW.toISOString());
  return f.wallet.transaction(tx => f.wallet.reserveTaskInTransaction(tx, { ownerId: f.ownerId, taskId }));
}
function count(db: DatabaseSync, table: string) { return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n; }

test('refund repairs a purchase lot even when its durable tombstone already exists', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const seeded = purchase(f, transactionId);
    f.wallet.transaction(tx => {
      assert.equal(appleRevocationTombstoneId(Environment.PRODUCTION, transactionId).startsWith('apple-revocation:v1:'), true);
      // F23 can leave this tombstone before the F25 repair callback runs.
      tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,NULL,?,?,?)', appleRevocationTombstoneId(Environment.PRODUCTION, transactionId), 'apple_revocation_tombstone', JSON.stringify({ version: 1, environment: Environment.PRODUCTION, transactionDigest: importHash(transactionId) }), NOW.toISOString());
      const result = applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId, productId: PRODUCT }, NOW.toISOString());
      assert.deepEqual(result, { matchedPurchase: true, revokedUnits: 5, consumedLossUnits: 0, exposedUnits: 0, cancelledTaskIds: [] });
    });
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE id=?').get(seeded.lotId) as { available_units: number }).available_units, 0);
    assert.equal((f.db.prepare('SELECT revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId) as { revoked_units: number }).revoked_units, 5);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='refund' AND credit_lot_id=?").get(seeded.lotId) as { n: number }).n, 1);
  } finally { f.close(); }
});

test('queued cancellation atomically revokes only its purchase lot and releases pre-attempt exposure', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const target = purchase(f, transactionId), unrelated = purchase(f, `synthetic-${randomUUID()}`);
    const taskId = `queued-${randomUUID()}`;
    f.db.prepare('INSERT INTO projects(id,owner_id,created_at) VALUES(?,?,?)').run(`project-${taskId}`, f.ownerId, NOW.toISOString());
    f.db.prepare('INSERT INTO tasks(id,owner_id,project_id,submission_id,status,user_cost_units,request_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(taskId, f.ownerId, `project-${taskId}`, `submission-${taskId}`, 'queued', 1, JSON.stringify({scope:'live'}), NOW.toISOString(), NOW.toISOString());
    f.db.prepare("INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'USD','profile_max_cost_usd_micros','reserved',?,?)").run(randomUUID(), f.ownerId, taskId, 'synthetic-provider', 'synthetic-v1', 1000, NOW.toISOString(), NOW.toISOString());
    // Keep target lot first in deterministic FIFO order; reservation consumes only that lot.
    f.db.prepare('UPDATE credit_lots SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', target.lotId);
    const reserved = f.wallet.transaction(tx => f.wallet.reserveTaskInTransaction(tx, { ownerId: f.ownerId, taskId }));
    assert.equal((f.db.prepare('SELECT credit_lot_id FROM reservation_allocations WHERE reservation_id=?').get(reserved.reservationId) as {credit_lot_id:string}).credit_lot_id, target.lotId);
    f.wallet.transaction(tx => {
      const result = applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId, productId: PRODUCT }, NOW.toISOString());
      assert.deepEqual(result.cancelledTaskIds, [taskId]);
      assert.equal(result.revokedUnits, 5);
    });
    assert.equal((f.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as {status:string}).status, 'cancelled');
    assert.equal((f.db.prepare('SELECT status FROM reservations WHERE task_id=?').get(taskId) as {status:string}).status, 'released');
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(taskId) as {status:string}).status, 'released');
    assert.equal(count(f.db, 'supplier_attempts'), 0);
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE id=?').get(target.lotId) as {available_units:number}).available_units, 0);
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE id=?').get(unrelated.lotId) as {available_units:number}).available_units, 5);
  } finally { f.close(); }
});

test('processing exposure stays open, late failure cannot release refunded units, and success history is untouched', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const target = purchase(f, transactionId), failedTask = `processing-${randomUUID()}`;
    queuedTask(f, failedTask, 2);
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(failedTask);
    f.db.prepare("UPDATE supplier_exposures SET status='started' WHERE task_id=?").run(failedTask);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,estimated_cost_usd_micros,started_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), f.ownerId, failedTask, 'synthetic-provider', 'started', 1000, NOW.toISOString());
    f.wallet.transaction(tx => {
      const result = applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId, productId: PRODUCT }, NOW.toISOString());
      assert.equal(result.exposedUnits, 2);
      assert.deepEqual(result.cancelledTaskIds, []);
    });
    assert.equal((f.db.prepare('SELECT status FROM supplier_exposures WHERE task_id=?').get(failedTask) as {status:string}).status, 'started');
    const failed = f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: f.ownerId, taskId: failedTask, outcome: 'failed' }));
    assert.equal(failed.returnedUnits, 0);
    assert.equal(f.wallet.summary(f.ownerId, 'live').available.purchased, 0);

    const secondId = `synthetic-${randomUUID()}`, second = purchase(f, secondId), succeededTask = `succeeded-${randomUUID()}`;
    queuedTask(f, succeededTask, 1);
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(succeededTask);
    f.db.prepare("UPDATE supplier_exposures SET status='started' WHERE task_id=?").run(succeededTask);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,estimated_cost_usd_micros,started_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), f.ownerId, succeededTask, 'synthetic-provider', 'started', 1000, NOW.toISOString());
    const versionId = randomUUID();
    f.db.prepare('INSERT INTO versions(id,owner_id,project_id,task_id,created_at) VALUES(?,?,?,?,?)').run(versionId, f.ownerId, `project-${succeededTask}`, succeededTask, NOW.toISOString());
    f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: f.ownerId, taskId: succeededTask, outcome: 'succeeded', resultVersionId: versionId }));
    f.wallet.transaction(tx => applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId: secondId, productId: PRODUCT }, NOW.toISOString()));
    assert.equal((f.db.prepare('SELECT status,result_version_id FROM tasks WHERE id=?').get(succeededTask) as {status:string;result_version_id:string}).status, 'succeeded');
    assert.equal((f.db.prepare('SELECT result_version_id FROM tasks WHERE id=?').get(succeededTask) as {result_version_id:string}).result_version_id, versionId);
    assert.equal((f.db.prepare('SELECT revoked_units FROM credit_lots WHERE id=?').get(second.lotId) as {revoked_units:number}).revoked_units, 4);
    assert.equal((f.db.prepare('SELECT available_units FROM credit_lots WHERE id=?').get(second.lotId) as {available_units:number}).available_units, 0);
    assert.equal((f.db.prepare('SELECT revoked_units FROM reservation_allocations WHERE reservation_id=(SELECT id FROM reservations WHERE task_id=?) AND credit_lot_id=?').get(succeededTask, second.lotId) as {revoked_units:number}).revoked_units, 0);
    assert.equal((f.db.prepare("SELECT units FROM ledger_events WHERE event_type='settle' AND task_id=?").get(succeededTask) as {units:number}).units, 1);
    assert.equal((f.db.prepare("SELECT units FROM ledger_events WHERE event_type='refund' AND credit_lot_id=?").get(second.lotId) as {units:number}).units, 4);
    assert.equal((f.db.prepare("SELECT details_json FROM audit_events WHERE event_type='apple_refund_applied' AND details_json LIKE ?").get(`%${importHash(secondId)}%`) as {details_json:string}).details_json.includes('"consumedLossUnits":1'), true);
  } finally { f.close(); }
});

test('all-consumed refunds record loss once without changing settled allocations or writing zero-unit ledger events', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const seeded = purchase(f, transactionId, PRODUCT, 1), taskId = `consumed-${randomUUID()}`;
    queuedTask(f, taskId, 1);
    f.db.prepare("UPDATE tasks SET status='processing' WHERE id=?").run(taskId);
    f.db.prepare("UPDATE supplier_exposures SET status='started' WHERE task_id=?").run(taskId);
    f.db.prepare("INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,status,estimated_cost_usd_micros,started_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(), f.ownerId, taskId, 'synthetic-provider', 'started', 1000, NOW.toISOString());
    const versionId = randomUUID();
    f.db.prepare('INSERT INTO versions(id,owner_id,project_id,task_id,created_at) VALUES(?,?,?,?,?)').run(versionId, f.ownerId, `project-${taskId}`, taskId, NOW.toISOString());
    f.wallet.transaction(tx => f.wallet.finalizeTaskInTransaction(tx, { ownerId: f.ownerId, taskId, outcome: 'succeeded', resultVersionId: versionId }));
    const apply = () => f.wallet.transaction(tx => applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId, productId: PRODUCT }, NOW.toISOString()));
    assert.equal(apply().consumedLossUnits, 1);
    assert.equal(apply().consumedLossUnits, 1);
    assert.equal((f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId) as {available_units:number;revoked_units:number}).revoked_units, 0);
    assert.equal((f.db.prepare('SELECT revoked_units FROM reservation_allocations WHERE reservation_id=(SELECT id FROM reservations WHERE task_id=?) AND credit_lot_id=?').get(taskId, seeded.lotId) as {revoked_units:number}).revoked_units, 0);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='refund' AND credit_lot_id=?").get(seeded.lotId) as {n:number}).n, 0);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='settle' AND task_id=? AND units=1").get(taskId) as {n:number}).n, 1);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='apple_refund_applied'").get() as {n:number}).n, 1);
  } finally { f.close(); }
});

test('refund replay rejects missing durable ledger evidence while current schema protects ledger facts', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const seeded = purchase(f, transactionId);
    const apply = () => f.wallet.transaction(tx => applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId, productId: PRODUCT }, NOW.toISOString()));
    assert.equal(apply().revokedUnits, 5);
    assert.throws(() => f.db.prepare("UPDATE ledger_events SET units=4 WHERE event_type='refund' AND credit_lot_id=?").run(seeded.lotId), /immutable/);
    f.db.prepare("DELETE FROM ledger_events WHERE event_type='refund' AND credit_lot_id=?").run(seeded.lotId);
    const before = f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId) as {available_units:number;revoked_units:number};
    assert.throws(apply, isCode('REFUND_LEDGER_CONFLICT'));
    assert.deepEqual(f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId), before);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='refund' AND credit_lot_id=?").get(seeded.lotId) as {n:number}).n, 0);
  } finally { f.close(); }
});

test('refund replay rejects conflicting applied audit amounts without changing credits', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const seeded = purchase(f, transactionId);
    const apply = () => f.wallet.transaction(tx => applyAppleRevocationInTransaction(f.wallet, tx, { environment: Environment.PRODUCTION, transactionId, productId: PRODUCT }, NOW.toISOString()));
    assert.equal(apply().revokedUnits, 5);
    const auditId = `apple-refund-applied:v1:${importHash(`${Environment.PRODUCTION}:${transactionId}`)}`;
    const audit = f.db.prepare('SELECT details_json FROM audit_events WHERE id=?').get(auditId) as { details_json: string };
    const details = JSON.parse(audit.details_json) as Record<string, unknown>;
    details.revokedUnits = 4;
    f.db.prepare('UPDATE audit_events SET details_json=? WHERE id=?').run(JSON.stringify(details), auditId);
    assert.equal(previewRefundReconciliation(f.db, { limit: 1 }).items[0]?.status, 'invalid');
    const before = f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId) as {available_units:number;revoked_units:number};
    assert.throws(apply, isCode('REFUND_AUDIT_CONFLICT'));
    assert.deepEqual(f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId), before);
  } finally { f.close(); }
});

test('signed refund notifications verify both JWS layers, converge on replay, and tombstone before later purchase grant', async () => {
  const f = fixture();
  try {
    const notification = signedRefund(f.chain, f.ownerId), result = await f.refunds.processSignedNotification(notification.signedPayload);
    assert.equal(result.status, 'accepted');
    assert.equal(result.revokedUnits, 0);
    const duplicate = await f.refunds.processSignedNotification(notification.signedPayload);
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(count(f.db, 'audit_events'), 2);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM audit_events WHERE event_type=?').get('apple_revocation_tombstone') as {n:number}).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM audit_events WHERE event_type=?').get('apple_notification_received') as {n:number}).n, 1);

    const sessions = createSessionService({ db: f.db, clock: () => NOW }), session = sessions.issue(f.ownerId);
    const purchaseOptions: Parameters<typeof createApplePurchaseService>[0] & {
      onVerifiedRevocationInTransaction?: (wallet: WalletRepository, tx: WalletTransaction, environment: ApplePurchaseEnvironment, transactionId: string, productId: string, now: string) => true;
    } = {
      db: f.db, config: f.config, enableOnlineChecks: false, clock: () => NOW,
      onVerifiedRevocationInTransaction: (wallet, tx, environment, transactionId, productId, now): true => {
        applyAppleRevocationInTransaction(wallet, tx, { environment, transactionId, productId }, now);
        return true;
      },
    };
    const purchases = createApplePurchaseService(purchaseOptions);
    const old = { ...notification.transaction, revocationDate: undefined };
    const signedOriginal = signJws(old, f.chain);
    await assert.rejects(() => purchases.confirm(session.accessToken, { signedTransaction: signedOriginal, environment: Environment.PRODUCTION }), isCode('PURCHASE_REVOKED'));
    assert.equal(count(f.db, 'purchases'), 0);
    assert.equal(count(f.db, 'credit_lots'), 0);

    const [header, body, signature] = notification.signedTransaction.split('.');
    const invalidNested = `${header}.${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    const signedOuterWithBadNested = signJws({ notificationType: 'REFUND', notificationUUID: randomUUID(), version: '2.0', signedDate: NOW.getTime(),
      data: { appAppleId: APPLE_ID, bundleId: BUNDLE, environment: Environment.PRODUCTION, signedTransactionInfo: invalidNested } }, f.chain);
    await assert.rejects(() => f.refunds.processSignedNotification(signedOuterWithBadNested), isCode('APPLE_SIGNATURE_INVALID'));
    assert.equal(count(f.db, 'audit_events'), 2);

    const existingTransactionId = `synthetic-${randomUUID()}`;
    const existingPurchase = purchase(f, existingTransactionId);
    const firstReversal = signedRefund(f.chain, f.ownerId, { transactionId: existingTransactionId });
    assert.equal((await f.refunds.processSignedNotification(firstReversal.signedPayload)).revokedUnits, 5);
    const laterReversal = signedRefund(f.chain, f.ownerId, { transactionId: existingTransactionId });
    assert.equal((await f.refunds.processSignedNotification(laterReversal.signedPayload)).revokedUnits, 0);
    assert.equal((f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE id=?').get(existingPurchase.lotId) as {available_units:number;revoked_units:number}).revoked_units, 5);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='refund' AND credit_lot_id=?").get(existingPurchase.lotId) as {n:number}).n, 1);
  } finally { f.close(); }
});

test('conflicting UUID payload fails closed and product mismatch has no tombstone side effect', async () => {
  const f = fixture();
  try {
    const firstId = randomUUID(), first = signedRefund(f.chain, f.ownerId, { notificationUUID: firstId });
    // Re-sign the conflicting event with the first notification UUID, changing the verified transaction identity.
    const conflict = signedRefund(f.chain, f.ownerId, { notificationUUID: randomUUID(), transactionId: `other-${randomUUID()}` });
    const originalBody = JSON.parse(Buffer.from(first.signedPayload.split('.')[1]!, 'base64url').toString());
    originalBody.data.signedTransactionInfo = conflict.signedTransaction;
    const conflictingSigned = signJws(originalBody, f.chain);
    await f.refunds.processSignedNotification(first.signedPayload);
    await assert.rejects(() => f.refunds.processSignedNotification(conflictingSigned), /conflict/i);
    assert.equal(count(f.db, 'audit_events'), 2);

    const unknownProduct = signedRefund(f.chain, f.ownerId, { productId: 'unapproved.product' });
    await assert.rejects(() => f.refunds.processSignedNotification(unknownProduct.signedPayload), /product|metadata/i);
    assert.equal(count(f.db, 'audit_events'), 2);
  } finally { f.close(); }
});

test('canonical webhook route needs Apple signature only and exposes no alias', async () => {
  const f = fixture(), app = express();
  app.use('/api/v2', createAppleNotificationRouter({ refunds: f.refunds }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const notification = signedRefund(f.chain, f.ownerId);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/webhooks/apple`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedPayload: notification.signedPayload }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { status: string }).status, 'accepted');
    const alias = await fetch(`http://127.0.0.1:${address.port}/api/v2/apple-notifications`, { method: 'POST' });
    assert.equal(alias.status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); f.close(); }
});

test('reconciliation is dry-run/read-only by default; bounded apply requires an injected trusted authorizer', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`;
  try {
    const seeded = purchase(f, transactionId);
    f.wallet.transaction(tx => tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,NULL,?,?,?)', appleRevocationTombstoneId(Environment.PRODUCTION, transactionId), 'apple_revocation_tombstone', JSON.stringify({version:1,environment:Environment.PRODUCTION,transactionDigest:importHash(transactionId)}), NOW.toISOString()));
    const before = count(f.db, 'ledger_events'), beforeAudit = count(f.db, 'audit_events');
    assert.equal(previewRefundReconciliation(f.db, { limit: 1 }).items[0]?.status, 'needs_reconciliation');
    assert.equal(count(f.db, 'ledger_events'), before);
    const cli = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../tools/reconcile-purchases.mjs', import.meta.url)), '--database', f.path], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /"mode":\s*"dry-run"/);
    assert.equal(count(f.db, 'ledger_events'), before);
    assert.equal(count(f.db, 'audit_events'), beforeAudit);
    const missingCursor = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../tools/reconcile-purchases.mjs', import.meta.url)), '--database', f.path, '--cursor'], { encoding: 'utf8' });
    assert.notEqual(missingCursor.status, 0);
    assert.match(missingCursor.stderr, /cursor/i);
    const denied = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../tools/reconcile-purchases.mjs', import.meta.url)), '--database', f.path, '--apply', '--role', 'admin'], { encoding: 'utf8' });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /trusted.*authoriz|apply/i);
    assert.equal(count(f.db, 'ledger_events'), before);
    const moduleUrl = new URL('../../tools/reconcile-purchases.mjs', import.meta.url).href;
    const script = `import { runReconciliationCli } from ${JSON.stringify(moduleUrl)}; const result = runReconciliationCli(['--database', ${JSON.stringify(f.path)}, '--limit', '1', '--apply'], { authorize: () => ({ actorId: 'synthetic-operator' }), clock: () => new Date(${JSON.stringify(NOW.toISOString())}) }); process.stdout.write(JSON.stringify(result));`;
    const authorizedApply = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(authorizedApply.status, 0, authorizedApply.stderr);
    assert.match(authorizedApply.stdout, /"applied":true/);
    assert.equal((f.db.prepare('SELECT revoked_units FROM credit_lots WHERE id=?').get(seeded.lotId) as {revoked_units:number}).revoked_units, 5);
    assert.equal(count(f.db, 'ledger_events'), before + 1);
    assert.equal(count(f.db, 'audit_events'), 3);
  } finally { f.close(); }
});

test('bounded reconciliation cursors advance past the first page without mutating dry-run state', () => {
  const f = fixture();
  try {
    const ids = Array.from({ length: 26 }, () => `synthetic-${randomUUID()}`);
    f.wallet.transaction(tx => ids.forEach((transactionId, index) => tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,NULL,?,?,?)',
      appleRevocationTombstoneId(Environment.PRODUCTION, transactionId), 'apple_revocation_tombstone', JSON.stringify({ version: 1, environment: Environment.PRODUCTION, transactionDigest: importHash(transactionId) }), new Date(Date.parse(NOW.toISOString()) + index).toISOString())));
    const before = count(f.db, 'ledger_events'), beforeAudit = count(f.db, 'audit_events'), firstPage = previewRefundReconciliation(f.db, { limit: 25 });
    assert.equal(firstPage.items.length, 25);
    assert.equal(firstPage.truncated, true);
    assert.ok(firstPage.nextCursor);
    assert.equal(count(f.db, 'ledger_events'), before);
    const cli = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../tools/reconcile-purchases.mjs', import.meta.url)), '--database', f.path, '--limit', '25', '--cursor', firstPage.nextCursor!], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /"items":\s*\[/);
    assert.equal(count(f.db, 'audit_events'), beforeAudit);
    const secondPage = previewRefundReconciliation(f.db, { limit: 25, cursor: firstPage.nextCursor });
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.truncated, false);
    const appliedFirst = applyRefundReconciliation(f.db, f.wallet, { limit: 25, authorize: () => ({ actorId: 'synthetic-operator' }) });
    assert.equal(appliedFirst.applied.length, 0);
    assert.ok(appliedFirst.nextCursor);
    const appliedSecond = applyRefundReconciliation(f.db, f.wallet, { limit: 25, cursor: appliedFirst.nextCursor, authorize: () => ({ actorId: 'synthetic-operator' }) });
    assert.equal(appliedSecond.applied.length, 0);
    assert.equal(count(f.db, 'ledger_events'), before);
    assert.equal(count(f.db, 'audit_events'), beforeAudit);
  } finally { f.close(); }
});

test('reconciliation authorization audit is keyed by environment and transaction digest', () => {
  const f = fixture(), transactionId = `synthetic-${randomUUID()}`, transactionDigest = importHash(transactionId);
  try {
    purchase(f, transactionId);
    const sandboxPurchaseId = randomUUID();
    f.db.prepare('INSERT INTO purchases(id,owner_id,environment,transaction_id,product_id,created_at) VALUES(?,?,?,?,?,?)').run(sandboxPurchaseId, f.ownerId, Environment.SANDBOX, transactionId, PRODUCT, NOW.toISOString());
    const environments: ApplePurchaseEnvironment[] = [Environment.PRODUCTION, Environment.SANDBOX];
    f.wallet.transaction(tx => {
      f.wallet.grantInTransaction(tx, { ownerId: f.ownerId, kind: 'purchased', sourceKind: 'purchase', sourceEventKey: `apple-purchase:v1:${Environment.SANDBOX}:${transactionDigest}`, purchaseId: sandboxPurchaseId, units: 5, scope: 'live', createdAt: NOW.toISOString() });
      for (const environment of environments) tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,NULL,?,?,?)',
        appleRevocationTombstoneId(environment, transactionId), 'apple_revocation_tombstone', JSON.stringify({ version: 1, environment, transactionDigest }), NOW.toISOString());
    });
    const result = applyRefundReconciliation(f.db, f.wallet, { limit: 2, clock: () => NOW, authorize: request => ({ actorId: request.environment }) });
    assert.equal(result.applied.length, 2);
    for (const environment of environments) {
      const audit = f.db.prepare('SELECT details_json FROM audit_events WHERE id=?').get(`apple-refund-reconcile:v1:${environment}:${transactionDigest}`) as { details_json: string };
      assert.equal((JSON.parse(audit.details_json) as { actorId: string }).actorId, environment);
    }
  } finally { f.close(); }
});
