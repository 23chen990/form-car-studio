import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Environment, SignedDataVerifier, VerificationException, VerificationStatus } from '@apple/app-store-server-library';
import test from 'node:test';
import { createProductCatalog } from '../../server/v2/catalog.js';
import { applyAppleRevocationInTransaction } from '../../server/v2/refunds.js';
import {
  appleRevocationTombstoneId,
  createApplePurchaseService,
  createAppleSignedDataAdapter,
  PurchaseError,
  type ApplePurchaseConfig, type ApplePurchaseEnvironment,
} from '../../server/v2/purchases.js';
import { createPurchaseRouter } from '../../server/v2/routes-purchases.js';
import { createSessionService } from '../../server/v2/sessions.js';
import { openV2Database } from '../../server/v2/db.js';
import { WalletRepository, type WalletTransaction } from '../../server/v2/wallet-repo.js';
import type { DatabaseSync } from 'node:sqlite';

const BUNDLE = 'com.example.synthetic';
const APPLE_ID = 1234567890;
const PRODUCT_5 = 'com.example.creditpack.small';
const PRODUCT_15 = 'com.example.creditpack.large';
let NOW = new Date();
const isCode = (expected: string) => (error: unknown) => error instanceof PurchaseError && error.code === expected;
const revocationBridge = (wallet: WalletRepository, tx: WalletTransaction, environment: ApplePurchaseEnvironment, transactionId: string, productId: string, now: string): true => (applyAppleRevocationInTransaction(wallet, tx, { environment, transactionId, productId }, now), true);

type SyntheticChain = { rootDer: Buffer; chainDer: Buffer[]; leafKey: ReturnType<typeof createPrivateKey> };
function runOpenSSL(cwd: string, args: string[]): void {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}
function certDer(dir: string, file: string): Buffer {
  const pem = readFileSync(join(dir, file), 'utf8');
  return Buffer.from(pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''), 'base64');
}
function generateChain(dir: string, name: string): SyntheticChain {
  const ext = join(dir, `${name}.ext`);
  writeFileSync(ext, [
    '[root]', 'basicConstraints=critical,CA:TRUE,pathlen:1', 'keyUsage=critical,keyCertSign,cRLSign',
    'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid:always,issuer', '',
    '[intermediate]', 'basicConstraints=critical,CA:TRUE,pathlen:0', 'keyUsage=critical,keyCertSign,cRLSign',
    'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid:always,issuer', '1.2.840.113635.100.6.2.1=DER:05:00', '',
    '[leaf]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature',
    'subjectKeyIdentifier=hash', 'authorityKeyIdentifier=keyid,issuer', '1.2.840.113635.100.6.11.1=DER:05:00', '',
  ].join('\n'));
  const rootKey = `${name}-root.key`, rootCsr = `${name}-root.csr`, rootPem = `${name}-root.pem`;
  const intKey = `${name}-intermediate.key`, intCsr = `${name}-intermediate.csr`, intPem = `${name}-intermediate.pem`;
  const leafKey = `${name}-leaf.key`, leafCsr = `${name}-leaf.csr`, leafPem = `${name}-leaf.pem`;
  runOpenSSL(dir, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', rootKey]);
  runOpenSSL(dir, ['req', '-new', '-key', rootKey, '-subj', `/CN=${name} Synthetic Root`, '-out', rootCsr]);
  runOpenSSL(dir, ['x509', '-req', '-in', rootCsr, '-signkey', rootKey, '-days', '3650', '-sha256', '-extfile', `${name}.ext`, '-extensions', 'root', '-out', rootPem]);
  runOpenSSL(dir, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', intKey]);
  runOpenSSL(dir, ['req', '-new', '-key', intKey, '-subj', `/CN=${name} Synthetic Intermediate`, '-out', intCsr]);
  runOpenSSL(dir, ['x509', '-req', '-in', intCsr, '-CA', rootPem, '-CAkey', rootKey, '-set_serial', '21', '-days', '3650', '-sha256', '-extfile', `${name}.ext`, '-extensions', 'intermediate', '-out', intPem]);
  runOpenSSL(dir, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', leafKey]);
  runOpenSSL(dir, ['req', '-new', '-key', leafKey, '-subj', `/CN=${name} Synthetic Leaf`, '-out', leafCsr]);
  runOpenSSL(dir, ['x509', '-req', '-in', leafCsr, '-CA', intPem, '-CAkey', intKey, '-set_serial', '22', '-days', '3650', '-sha256', '-extfile', `${name}.ext`, '-extensions', 'leaf', '-out', leafPem]);
  return { rootDer: certDer(dir, rootPem), chainDer: [certDer(dir, leafPem), certDer(dir, intPem), certDer(dir, rootPem)], leafKey: createPrivateKey(readFileSync(join(dir, leafKey))) };
}
function signJws(payload: object, chain: SyntheticChain): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'ES256', x5c: chain.chainDer.map(value => value.toString('base64')) });
  const body = b64(payload), input = `${header}.${body}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: chain.leafKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function baseTransaction(ownerId: string, environment: string, changes: Record<string, unknown> = {}) {
  return {
    transactionId: `synthetic-${randomUUID()}`, originalTransactionId: `synthetic-original-${randomUUID()}`,
    bundleId: BUNDLE, productId: PRODUCT_5, purchaseDate: NOW.getTime(), originalPurchaseDate: NOW.getTime(),
    quantity: 1, type: 'Consumable', appAccountToken: ownerId, inAppOwnershipType: 'PURCHASED',
    environment, signedDate: NOW.getTime(), ...changes,
  };
}
function makeConfig(chain: SyntheticChain, overrides: Partial<ApplePurchaseConfig> = {}): ApplePurchaseConfig {
  return {
    bundleId: BUNDLE, appAppleId: APPLE_ID, rootCertificates: [chain.rootDer],
    fiveUnitProductId: PRODUCT_5, fifteenUnitProductId: PRODUCT_15, ...overrides,
  };
}
type PurchaseFixture = { db: DatabaseSync; ownerId: string; accessToken: string; service: ReturnType<typeof createApplePurchaseService>; wallet: WalletRepository; close(): void };
function fixture(root: SyntheticChain, dir: string, config: ApplePurchaseConfig = makeConfig(root)): PurchaseFixture {
  const db = openV2Database(join(dir, `${randomUUID()}.sqlite`));
  const wallet = new WalletRepository(db), sessions = createSessionService({ db, clock: () => NOW });
  const ownerId = randomUUID();
  db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(ownerId, NOW.toISOString());
  db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), ownerId, 'apple', `synthetic-${randomUUID()}`, NOW.toISOString());
  const session = sessions.issue(ownerId);
  const service = createApplePurchaseService({ db, config, enableOnlineChecks: false, clock: () => NOW, onVerifiedRevocationInTransaction: revocationBridge });
  return { db, ownerId, accessToken: session.accessToken, service, wallet, close: () => db.close() };
}
function request(signedTransaction: string, environment = Environment.PRODUCTION) { return { signedTransaction, environment }; }
async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('official signed-data verification gates consumable purchase credit', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'form-f23-'));
  try {
    const trusted = generateChain(dir, 'trusted'), other = generateChain(dir, 'other');
    NOW = new Date();

    await t.test('empty configuration disables catalog and purchase confirmation', async () => {
      const f = fixture(trusted, dir, {});
      try {
        assert.equal(f.service.catalog().enabled, false);
        assert.deepEqual(f.service.catalog().products, []);
        await assert.rejects(() => f.service.confirm(f.accessToken, request('untrusted-input')), isCode('PURCHASES_DISABLED'));
        const noBridge = createApplePurchaseService({ db: f.db, config: makeConfig(trusted), enableOnlineChecks: false, clock: () => NOW });
        const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        assert.equal(noBridge.catalog().enabled, false);
        await assert.rejects(() => noBridge.confirm(f.accessToken, request(signed)), isCode('PURCHASES_DISABLED'));
        const rejectingBridge = createApplePurchaseService({ db: f.db, config: makeConfig(trusted), enableOnlineChecks: false, clock: () => NOW, onVerifiedRevocationInTransaction: () => false as true });
        const signedRevocation = signJws({ ...baseTransaction(f.ownerId, Environment.PRODUCTION), revocationDate: NOW.getTime() }, trusted);
        await assert.rejects(() => rejectingBridge.confirm(f.accessToken, request(signedRevocation)), isCode('PURCHASE_REVOCATION_UNAVAILABLE'));
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
      } finally { f.close(); }
    });

    await t.test('missing and invalid Production app IDs keep the catalog disabled', async () => {
      for (const appAppleId of [undefined, null, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const f = fixture(trusted, dir, makeConfig(trusted, { appAppleId }));
        try {
          assert.equal(f.service.catalog().enabled, false, String(appAppleId));
          const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
          await assert.rejects(() => f.service.confirm(f.accessToken, request(signed)), isCode('PURCHASES_DISABLED'));
          assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
        } finally { f.close(); }
      }
    });

    await t.test('catalog maps only configured logical 5 and 15 unit packs', () => {
      assert.deepEqual(createProductCatalog({ fiveUnitProductId: null, fifteenUnitProductId: PRODUCT_15 }), {
        enabled: true, products: [{ productId: PRODUCT_15, units: 15 }],
      });
      assert.equal(createProductCatalog({}).enabled, false);
      assert.equal(createProductCatalog({ fiveUnitProductId: PRODUCT_5, fifteenUnitProductId: PRODUCT_5 }).enabled, false);
    });

    await t.test('a valid Production JWS grants the configured units once and same-owner retry is recoverable', async () => {
      const f = fixture(trusted, dir);
      try {
        const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        const first = await f.service.confirm(f.accessToken, request(signed));
        const retry = await f.service.confirm(f.accessToken, request(signed));
        assert.equal(first.status, 'credited');
        assert.equal(first.scope, 'live');
        assert.equal(retry.status, 'already-credited');
        assert.equal(retry.scope, 'live');
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 5);
        assert.equal(f.wallet.summary(f.ownerId, 'demo').spendable, 0);
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 1);
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM credit_lots WHERE source_kind=\'purchase\'').get() as { n: number }).n, 1);
        const event = f.db.prepare('SELECT payload_json FROM purchase_events').get() as { payload_json: string };
        assert.equal(event.payload_json.includes(signed), false);
        const large = await f.service.confirm(f.accessToken, request(signJws(baseTransaction(f.ownerId, Environment.PRODUCTION, { productId: PRODUCT_15 }), trusted)));
        assert.equal(large.units, 15);
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 20);
      } finally { f.close(); }
    });

    await t.test('untrusted root, wrong bundle, wrong environment, and signature tampering are rejected', async () => {
      const f = fixture(trusted, dir);
      const wrongRoot = fixture(other, dir);
      try {
        const good = baseTransaction(f.ownerId, Environment.PRODUCTION);
        const valid = signJws(good, trusted);
        const [header, body, signature] = valid.split('.');
        const tampered = `${header}.${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        await assert.rejects(() => f.service.confirm(f.accessToken, request(tampered)), isCode('APPLE_SIGNATURE_INVALID'));
        await assert.rejects(() => wrongRoot.service.confirm(wrongRoot.accessToken, request(valid)), isCode('APPLE_SIGNATURE_INVALID'));
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signJws({ ...good, bundleId: 'com.example.wrong' }, trusted))), isCode('APPLE_SIGNATURE_INVALID'));
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signJws({ ...good, environment: Environment.SANDBOX }, trusted), Environment.PRODUCTION)), isCode('APPLE_SIGNATURE_INVALID'));
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
      } finally { f.close(); wrongRoot.close(); }
    });

    await t.test('signed transaction metadata, product, ownership, quantity and app account token are authoritative', async () => {
      const f = fixture(trusted, dir);
      try {
        const bad = [
          { productId: 'com.example.unknown' }, { quantity: 2 }, { type: 'Auto-Renewable Subscription' },
          { inAppOwnershipType: 'FAMILY_SHARED' }, { appAccountToken: 'not-a-uuid' },
        ];
        for (const change of bad) {
          const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION, change), trusted);
          await assert.rejects(() => f.service.confirm(f.accessToken, request(signed)), isCode('PURCHASE_METADATA_INVALID'));
        }
        const second = randomUUID();
        f.db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(second, NOW.toISOString());
        f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), second, 'apple', `synthetic-${randomUUID()}`, NOW.toISOString());
        const sessions = createSessionService({ db: f.db, clock: () => NOW });
        const secondSession = sessions.issue(second);
        const signedForFirst = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        await assert.rejects(() => f.service.confirm(secondSession.accessToken, request(signedForFirst)), isCode('PURCHASE_ACCOUNT_TOKEN_MISMATCH'));
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM credit_lots').get() as { n: number }).n, 0);
      } finally { f.close(); }
    });

    await t.test('missing Apple identity, deleted owner, revoked session and expired transaction-time session cannot credit', async () => {
      const missingIdentity = fixture(trusted, dir), deleted = fixture(trusted, dir), raced = fixture(trusted, dir);
      try {
        const signedMissing = signJws(baseTransaction(missingIdentity.ownerId, Environment.PRODUCTION), trusted);
        missingIdentity.db.prepare("DELETE FROM identities WHERE user_id=? AND provider='apple'").run(missingIdentity.ownerId);
        await assert.rejects(() => missingIdentity.service.confirm(missingIdentity.accessToken, request(signedMissing)), isCode('AUTH_REQUIRED'));
        const signedDeleted = signJws(baseTransaction(deleted.ownerId, Environment.PRODUCTION), trusted);
        deleted.db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run(NOW.toISOString(), deleted.ownerId);
        await assert.rejects(() => deleted.service.confirm(deleted.accessToken, request(signedDeleted)), isCode('AUTH_REQUIRED'));
        const signedRaced = signJws(baseTransaction(raced.ownerId, Environment.PRODUCTION), trusted);
        const pending = raced.service.confirm(raced.accessToken, request(signedRaced));
        createSessionService({ db: raced.db, clock: () => NOW }).logout(raced.accessToken);
        await assert.rejects(() => pending, isCode('AUTH_REQUIRED'));
        for (const current of [missingIdentity, deleted, raced]) assert.equal((current.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
      } finally { missingIdentity.close(); deleted.close(); raced.close(); }
    });

    await t.test('session expiry is checked using the clock inside the acquired wallet transaction', async () => {
      const f = fixture(trusted, dir);
      try {
        f.db.prepare("UPDATE v2_sessions SET expires_at=? WHERE owner_id=? AND token_kind='access'").run(new Date(NOW.getTime() + 1000).toISOString(), f.ownerId);
        const service = createApplePurchaseService({
          db: f.db, config: makeConfig(trusted), enableOnlineChecks: false,
          clock: () => f.db.isTransaction ? new Date(NOW.getTime() + 2000) : NOW,
          onVerifiedRevocationInTransaction: revocationBridge,
        });
        const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        await assert.rejects(() => service.confirm(f.accessToken, request(signed)), isCode('AUTH_REQUIRED'));
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 0);
      } finally { f.close(); }
    });

    await t.test('transaction uniqueness is global across owners even when each signed token matches its caller', async () => {
      const f = fixture(trusted, dir);
      try {
        const second = randomUUID();
        f.db.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').run(second, NOW.toISOString());
        f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), second, 'apple', `synthetic-${randomUUID()}`, NOW.toISOString());
        const secondSession = createSessionService({ db: f.db, clock: () => NOW }).issue(second);
        const transactionId = 'synthetic-global-transaction';
        const firstJws = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION, { transactionId }), trusted);
        const otherJws = [{}, { revocationDate: NOW.getTime() }].map(revocation => signJws(baseTransaction(second, Environment.PRODUCTION, { transactionId, ...revocation }), trusted));
        await f.service.confirm(f.accessToken, request(firstJws));
        for (const conflictingJws of otherJws) await assert.rejects(() => f.service.confirm(secondSession.accessToken, request(conflictingJws)), isCode('PURCHASE_OWNER_CONFLICT'));
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 5);
        assert.equal(f.wallet.summary(second, 'live').spendable, 0);
      } finally { f.close(); }
    });

    await t.test('a verified revocation commits an anonymous tombstone before rejecting and blocks an older JWS', async () => {
      const f = fixture(trusted, dir);
      try {
        const transactionId = 'synthetic-revoked-transaction';
        const original = baseTransaction(f.ownerId, Environment.PRODUCTION, { transactionId });
        const revoked = signJws({ ...original, revocationDate: NOW.getTime() }, trusted);
        await assert.rejects(() => f.service.confirm(f.accessToken, request(revoked)), isCode('PURCHASE_REVOKED'));
        const tombstoneId = appleRevocationTombstoneId(Environment.PRODUCTION, transactionId);
        const marker = f.db.prepare('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?').get(tombstoneId) as { owner_id: string | null; event_type: string; details_json: string };
        assert.equal(marker.owner_id, null);
        assert.equal(marker.event_type, 'apple_revocation_tombstone');
        assert.equal(marker.details_json.includes(transactionId), false);
        assert.equal(marker.details_json.includes(revoked), false);
        const oldUnrevoked = signJws(original, trusted);
        await assert.rejects(() => f.service.confirm(f.accessToken, request(oldUnrevoked)), isCode('PURCHASE_REVOKED'));
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 0);

        const credited = baseTransaction(f.ownerId, Environment.PRODUCTION, { transactionId: 'synthetic-credit-then-revoked' });
        const signedCredit = signJws(credited, trusted);
        await f.service.confirm(f.accessToken, request(signedCredit));
        const signedRevocation = signJws({ ...credited, revocationDate: NOW.getTime() }, trusted);
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signedRevocation)), isCode('PURCHASE_REVOKED'));
        const revokedLot = f.db.prepare('SELECT available_units,revoked_units FROM credit_lots WHERE purchase_id=(SELECT id FROM purchases WHERE transaction_id=?)').get(credited.transactionId) as { available_units: number; revoked_units: number }; assert.equal(revokedLot.available_units, 0); assert.equal(revokedLot.revoked_units, 5);
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signedRevocation)), isCode('PURCHASE_REVOKED'));
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signedCredit)), isCode('PURCHASE_REVOKED'));
        assert.equal((f.db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='refund'").get() as { n: number }).n, 1);
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 0);
      } finally { f.close(); }
    });

    await t.test('valid Sandbox signatures are verified but cannot create purchases, lots, or live/demo balance', async () => {
      const f = fixture(trusted, dir);
      try {
        const signed = signJws(baseTransaction(f.ownerId, Environment.SANDBOX), trusted);
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signed, Environment.SANDBOX)), isCode('SANDBOX_CREDITING_DISABLED'));
        assert.equal(f.wallet.summary(f.ownerId, 'demo').spendable, 0);
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 0);
        for (const table of ['purchases', 'purchase_events', 'credit_lots', 'ledger_events']) {
          assert.equal((f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
        }
      } finally { f.close(); }
    });

    await t.test('purchase row, purchase event and lot roll back together on a write failure', async () => {
      const f = fixture(trusted, dir);
      try {
        f.db.exec("CREATE TRIGGER synthetic_purchase_event_failure BEFORE INSERT ON purchase_events BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");
        const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        await assert.rejects(() => f.service.confirm(f.accessToken, request(signed)));
        for (const table of ['purchases', 'purchase_events', 'credit_lots', 'ledger_events']) {
          assert.equal((f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
        }
      } finally { f.close(); }
    });

    await t.test('notification and nested transaction are both verified with Apple library APIs', async () => {
      const f = fixture(trusted, dir);
      try {
        const transaction = baseTransaction(f.ownerId, Environment.SANDBOX);
        const signedTransaction = signJws(transaction, trusted);
        const notification = signJws({
          notificationType: 'ONE_TIME_CHARGE', notificationUUID: randomUUID(), version: '2.0', signedDate: NOW.getTime(),
          data: { appAppleId: APPLE_ID, bundleId: BUNDLE, environment: Environment.SANDBOX, signedTransactionInfo: signedTransaction },
        }, trusted);
        const adapter = createAppleSignedDataAdapter({
          bundleId: BUNDLE, appAppleId: APPLE_ID, rootCertificates: [trusted.rootDer],
        }, { enableOnlineChecks: false });
        const decoded = await adapter.verifyNotification(notification, Environment.SANDBOX);
        assert.equal(decoded.notificationType, 'ONE_TIME_CHARGE');
        assert.equal(decoded.environment, Environment.SANDBOX);
        assert.equal('notification' in decoded, false);
        assert.equal(decoded.transaction?.transactionId, transaction.transactionId);
        assert.equal('appAccountToken' in (decoded.transaction ?? {}), false);
        assert.equal(JSON.stringify(decoded).includes(signedTransaction), false);
        const [header, body, signature] = signedTransaction.split('.');
        const tamperedNested = `${header}.${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        const invalidOuter = signJws({
          notificationType: 'ONE_TIME_CHARGE', notificationUUID: randomUUID(), version: '2.0', signedDate: NOW.getTime(),
          data: { appAppleId: APPLE_ID, bundleId: BUNDLE, environment: Environment.SANDBOX, signedTransactionInfo: tamperedNested },
        }, trusted);
        await assert.rejects(() => adapter.verifyNotification(invalidOuter, Environment.SANDBOX), isCode('APPLE_SIGNATURE_INVALID'));
      } finally { f.close(); }
    });

    await t.test('retryable verifier outages preserve same-transaction recovery', async () => {
      const f = fixture(trusted, dir), app = express(), signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
      const transactionVerifier = SignedDataVerifier.prototype.verifyAndDecodeTransaction;
      const notificationVerifier = SignedDataVerifier.prototype.verifyAndDecodeNotification;
      SignedDataVerifier.prototype.verifyAndDecodeTransaction = async () => {
        SignedDataVerifier.prototype.verifyAndDecodeTransaction = transactionVerifier;
        throw new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE);
      };
      SignedDataVerifier.prototype.verifyAndDecodeNotification = async () => { throw new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE); };
      app.use(createPurchaseRouter({ purchases: f.service }));
      const { server, url } = await listen(app), send = (value = signed) => fetch(url + '/purchases/verify', { method: 'POST', headers: {
        authorization: 'Bearer ' + f.accessToken, 'content-type': 'application/json',
      }, body: JSON.stringify(request(value)) });
      try {
        const failed = await send(), failure = await failed.json();
        assert.equal(failed.status, 503); assert.equal(failure.code, 'APPLE_VERIFICATION_UNAVAILABLE'); assert.equal(failure.retryable, true);
        for (const table of ['purchases', 'credit_lots', 'ledger_events']) assert.equal((f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
        await assert.rejects(() => f.service.verifier.verifyNotification('synthetic-outage', Environment.PRODUCTION), error => error instanceof PurchaseError && error.code === 'APPLE_VERIFICATION_UNAVAILABLE' && error.status === 503);
        const recovered = await send(), credited = await recovered.json();
        assert.equal(recovered.status, 200); assert.equal(credited.status, 'credited');
        const replay = await send(); assert.equal((await replay.json()).status, 'already-credited');
        const [header, body, signature] = signed.split('.'), invalid = await send(`${header}.${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`), invalidBody = await invalid.json();
        assert.equal(invalid.status, 400); assert.equal(invalidBody.retryable, false); assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 5);
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 1);
      } finally {
        SignedDataVerifier.prototype.verifyAndDecodeTransaction = transactionVerifier;
        SignedDataVerifier.prototype.verifyAndDecodeNotification = notificationVerifier;
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        f.close();
      }
    });

    await t.test('S02 canonical catalog and verify routes recover an acknowledgment without alternate APIs', async () => {
      const f = fixture(trusted, dir), app = express();
      app.use(createPurchaseRouter({ purchases: f.service }));
      const { server, url } = await listen(app);
      try {
        const catalog = await fetch(url + '/catalog');
        assert.equal(catalog.status, 200);
        assert.equal((await catalog.json() as { enabled: boolean }).enabled, true);
        const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        const send = () => fetch(url + '/purchases/verify', { method: 'POST', headers: {
          authorization: 'Bearer ' + f.accessToken, 'content-type': 'application/json',
        }, body: JSON.stringify(request(signed)) });
        const first = await send(), second = await send();
        assert.equal(first.status, 200); assert.equal(second.status, 200);
        const credited = await first.json() as { purchaseId: string; status: string };
        const replay = await second.json() as { purchaseId: string; status: string };
        assert.equal(credited.status, 'credited'); assert.equal(replay.status, 'already-credited');
        assert.equal(credited.purchaseId, replay.purchaseId);
        assert.equal(f.wallet.summary(f.ownerId, 'live').spendable, 5);
        assert.equal((await fetch(url + '/purchases/catalog')).status, 404);
        assert.equal((await fetch(url + '/purchases/confirm', { method: 'POST' })).status, 404);
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        f.close();
      }
    });

    await t.test('HTTP confirmation rejects client price, owner, and verification flags', async () => {
      const f = fixture(trusted, dir), app = express();
      app.use(createPurchaseRouter({ purchases: f.service }));
      const { server, url } = await listen(app);
      try {
        const signed = signJws(baseTransaction(f.ownerId, Environment.PRODUCTION), trusted);
        const response = await fetch(`${url}/purchases/verify`, {
          method: 'POST', headers: { authorization: `Bearer ${f.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ...request(signed), ownerId: f.ownerId, price: 0, isVerified: true }),
        });
        assert.equal(response.status, 400);
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM purchases').get() as { n: number }).n, 0);
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        f.close();
      }
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
