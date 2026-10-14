import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import express from 'express';
import { createLocalJWKSet, exportJWK, SignJWT, type JWTVerifyGetKey } from 'jose';
import test from 'node:test';
import { createAppleAuthService, AuthError, type AppleIdentityTokenPayload } from '../../server/v2/auth-apple.js';
import { createAuthRouter } from '../../server/v2/routes-auth.js';
import {
  createSessionService,
  assertRecentAuthenticationInTransaction,
  isRecentAuthentication,
  revokeOwnerSessionsInTransaction,
  type AccessPrincipal,
} from '../../server/v2/sessions.js';
import { WalletRepository } from '../../server/v2/wallet-repo.js';
import { openV2Database } from '../../server/v2/db.js';
import type { DatabaseSync } from 'node:sqlite';

const NOW = Date.parse('2026-10-13T04:00:00.000Z');
const ISSUER = 'https://appleid.apple.com';
const AUDIENCE = 'com.form.synthetic';
const KID = 'synthetic-rsa-key';
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === expected;

type Fixture = {
  db: DatabaseSync;
  dbPath: string;
  auth: ReturnType<typeof createAppleAuthService>;
  sessions: ReturnType<typeof createSessionService>;
  now: () => Date;
  setTime(value: number): void;
  token(nonce: string, changes?: Partial<AppleIdentityTokenPayload>, header?: Record<string, unknown>, key?: typeof keyPair.privateKey): Promise<string>;
  close(): void;
};

async function fixture(options: { audiences?: readonly string[]; resolver?: JWTVerifyGetKey } = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'form-f20-auth-'));
  const db = openV2Database(join(dir, 'auth.sqlite'));
  let time = NOW;
  const now = () => new Date(time);
  const publicJwk = await exportJWK(keyPair.publicKey);
  const resolver = options.resolver ?? createLocalJWKSet({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] });
  const auth = createAppleAuthService({ db, approvedAudiences: options.audiences ?? [AUDIENCE], keyResolver: resolver, clock: now });
  const sessions = createSessionService({ db, clock: now });
  return {
    db, dbPath: join(dir, 'auth.sqlite'), auth, sessions, now,
    setTime(value) { time = value; },
    async token(nonce, changes = {}, header = {}, key = keyPair.privateKey) {
      const claims: AppleIdentityTokenPayload = {
        iss: ISSUER, aud: AUDIENCE, sub: 'synthetic-apple-subject', nonce,
        iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 120,
        email: 'ignored@example.invalid', ...changes,
      };
      return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: KID, ...header }).sign(key);
    },
    close() { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

async function login(f: Fixture, changes: Partial<AppleIdentityTokenPayload> = {}) {
  const challenge = await f.auth.createChallenge();
  return f.auth.authenticate({ challengeId: challenge.challengeId, identityToken: await f.token(challenge.nonce, changes) });
}

function fixtureTest(name: string, run: (f: Fixture) => Promise<void>, options: { audiences?: readonly string[]; resolver?: JWTVerifyGetKey } = {}): void {
  test(name, async () => {
    const f = await fixture(options);
    try { await run(f); } finally { f.close(); }
  });
}

fixtureTest('closed audiences disable challenge issuance without creating server state', async f => {
    assert.throws(() => f.auth.createChallenge(), code('AUTH_DISABLED'));
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM auth_challenges').get() as { n: number }).n, 0);
}, { audiences: [] });

fixtureTest('native challenge returns a raw high-entropy nonce while the database stores only its digest', async f => {
    const challenge = await f.auth.createChallenge();
    assert.match(challenge.nonce, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(challenge.nonce, 'base64url').length, 32);
    const row = f.db.prepare('SELECT nonce_digest,consumed_at FROM auth_challenges WHERE id=?').get(challenge.challengeId) as { nonce_digest: string; consumed_at: string | null };
    assert.equal(row.nonce_digest, hash(challenge.nonce));
    assert.equal(row.consumed_at, null);
    assert.equal(JSON.stringify(row).includes(challenge.nonce), false);
});

fixtureTest('expired challenge cannot be redeemed even with a freshly signed identity token', async f => {
    const challenge = await f.auth.createChallenge();
    f.setTime(NOW + 5 * 60_000);
    const identityToken = await f.token(challenge.nonce);
    await assert.rejects(() => f.auth.authenticate({ challengeId: challenge.challengeId, identityToken }), code('AUTH_CHALLENGE_INVALID'));
    assert.equal((f.db.prepare('SELECT consumed_at FROM auth_challenges WHERE id=?').get(challenge.challengeId) as { consumed_at: string | null }).consumed_at, null);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n, 0);
});

fixtureTest('verified Apple subject creates a stable UUID identity and returns opaque one-time session tokens', async f => {
    const result = await login(f);
    assert.match(result.ownerId, /^[0-9a-f-]{36}$/i);
    assert.match(result.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.match(result.refreshToken, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(result.accessToken, result.refreshToken);
    assert.ok(Date.parse(result.accessExpiresAt) > NOW);
    assert.ok(Date.parse(result.refreshExpiresAt) > Date.parse(result.accessExpiresAt));
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM identities WHERE provider=\'apple\' AND user_id=? AND subject=?').get(result.ownerId, 'synthetic-apple-subject') as { n: number }).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n, 1);
    const stored = f.db.prepare('SELECT token_digest FROM v2_sessions').all() as { token_digest: string }[];
    assert.equal(stored.length, 2);
    assert.ok(stored.every(row => row.token_digest !== result.accessToken && row.token_digest !== result.refreshToken));
    assert.equal((f.db.prepare("SELECT token_digest FROM v2_sessions WHERE token_kind='access'").get() as { token_digest: string }).token_digest, hash(result.accessToken));
    assert.equal((f.db.prepare("SELECT token_digest FROM v2_sessions WHERE token_kind='refresh'").get() as { token_digest: string }).token_digest, hash(result.refreshToken));
    assert.equal(f.sessions.resolveAccess(result.accessToken)?.ownerId, result.ownerId);
});

fixtureTest('signature, algorithm, issuer, audience, nonce, expiry, issued-at and subject are all verified', async f => {
    const cases: Array<{ name: string; changes?: Partial<AppleIdentityTokenPayload>; header?: Record<string, unknown>; key?: typeof keyPair.privateKey }> = [
      { name: 'wrong issuer', changes: { iss: 'https://attacker.invalid' } },
      { name: 'wrong audience', changes: { aud: 'com.attacker.invalid' } },
      { name: 'wrong raw nonce', changes: { nonce: 'not-the-challenge-nonce' } },
      { name: 'expired token', changes: { exp: Math.floor(NOW / 1000) - 1 } },
      { name: 'future issued-at', changes: { iat: Math.floor(NOW / 1000) + 30 } },
      { name: 'missing subject', changes: { sub: '' } },
      { name: 'algorithm confusion', header: { alg: 'HS256' } },
      { name: 'foreign signing key', key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey },
      { name: 'untrusted key URL', header: { jku: 'https://attacker.invalid/keys.json' } },
    ];
    for (const item of cases) {
      const challenge = await f.auth.createChallenge();
      const algorithmMismatch = item.header?.alg === 'HS256';
      let jwt = await f.token(challenge.nonce, item.changes, algorithmMismatch ? {} : item.header, item.key);
      if (algorithmMismatch) {
        const [, body, signature] = jwt.split('.');
        jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', kid: KID })).toString('base64url')}.${body}.${signature}`;
      }
      await assert.rejects(() => f.auth.authenticate({ challengeId: challenge.challengeId, identityToken: jwt }), error => error instanceof AuthError, item.name);
    }
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: 'forged', nonce: 'x', iat: NOW / 1000, exp: NOW / 1000 + 60 })).toString('base64url')}.`;
    const challenge = await f.auth.createChallenge();
    await assert.rejects(() => f.auth.authenticate({ challengeId: challenge.challengeId, identityToken: unsigned }), error => error instanceof AuthError);
});

fixtureTest('challenge replay and concurrent redemption create at most one identity and token family', async f => {
    const challenge = await f.auth.createChallenge();
    const identityToken = await f.token(challenge.nonce);
    const results = await Promise.allSettled([
      f.auth.authenticate({ challengeId: challenge.challengeId, identityToken }),
      f.auth.authenticate({ challengeId: challenge.challengeId, identityToken }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM identities WHERE provider=\'apple\'').get() as { n: number }).n, 1);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM session_families').get() as { n: number }).n, 1);
    const winner = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof f.auth.authenticate>>>;
    await assert.rejects(() => f.auth.authenticate({ challengeId: challenge.challengeId, identityToken }), code('AUTH_CHALLENGE_REPLAYED'));
    assert.equal(f.sessions.resolveAccess(winner.value.accessToken)?.ownerId, winner.value.ownerId);
});

fixtureTest('deleted Apple identities cannot be recreated under a new owner', async f => {
    f.db.prepare('INSERT INTO users(id,created_at,deleted_at) VALUES(?,?,?)').run('deleted-owner', f.now().toISOString(), f.now().toISOString());
    f.db.prepare('INSERT INTO identities(id,user_id,provider,subject,created_at) VALUES(?,?,?,?,?)').run('old-identity', 'deleted-owner', 'apple', 'synthetic-apple-subject', f.now().toISOString());
    const challenge = await f.auth.createChallenge();
    const identityToken = await f.token(challenge.nonce);
    await assert.rejects(() => f.auth.authenticate({ challengeId: challenge.challengeId, identityToken }), code('AUTH_ACCOUNT_UNAVAILABLE'));
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n, 1);
    assert.ok((f.db.prepare('SELECT consumed_at FROM auth_challenges WHERE id=?').get(challenge.challengeId) as { consumed_at: string | null }).consumed_at);
});

fixtureTest('refresh rotates tokens, preserves family creation time and gives a tokenless short race response', async f => {
    const original = await login(f);
    const family = f.db.prepare('SELECT id,created_at FROM session_families WHERE owner_id=?').get(original.ownerId) as { id: string; created_at: string };
    f.setTime(NOW + 6 * 60_000);
    const rotated = await f.sessions.refresh(original.refreshToken);
    assert.notEqual(rotated.accessToken, original.accessToken);
    assert.notEqual(rotated.refreshToken, original.refreshToken);
    assert.equal(f.sessions.resolveAccess(original.accessToken), null);
    assert.equal(f.sessions.resolveAccess(rotated.accessToken)?.ownerId, original.ownerId);
    assert.equal((f.db.prepare('SELECT created_at FROM session_families WHERE id=?').get(family.id) as { created_at: string }).created_at, family.created_at);
    const recentPrincipal = { ownerId: original.ownerId, sessionId: 'synthetic-session', familyId: family.id, familyCreatedAt: family.created_at } satisfies AccessPrincipal;
    assert.equal(isRecentAuthentication(recentPrincipal, f.now()), false);
    const tx = new WalletRepository(f.db);
    assert.throws(() => tx.transaction(walletTx => assertRecentAuthenticationInTransaction(walletTx, original.ownerId, family.id, f.now().toISOString())), code('SESSION_RECENT_AUTH_REQUIRED'));
    f.setTime(NOW + 6 * 60_000 + 4_999);
    await assert.rejects(() => f.sessions.refresh(original.refreshToken), code('SESSION_REFRESH_RACE'));
    assert.equal((f.db.prepare('SELECT revoked_at FROM session_families WHERE id=?').get(family.id) as { revoked_at: string | null }).revoked_at, null);
    assert.equal(f.sessions.resolveAccess(rotated.accessToken)?.ownerId, original.ownerId);
});

fixtureTest('refresh reuse outside grace commits family revocation before returning an error', async f => {
    const original = await login(f);
    const rotated = await f.sessions.refresh(original.refreshToken);
    f.setTime(NOW + 5_001);
    await assert.rejects(() => f.sessions.refresh(original.refreshToken), code('SESSION_REUSE_DETECTED'));
    const family = f.db.prepare('SELECT id,revoked_at FROM session_families WHERE owner_id=?').get(original.ownerId) as { id: string; revoked_at: string | null };
    assert.ok(family.revoked_at);
    assert.equal(f.sessions.resolveAccess(rotated.accessToken), null);
    await assert.rejects(() => f.sessions.refresh(rotated.refreshToken), code('SESSION_REVOKED'));
});

fixtureTest('concurrent refresh of one token returns one rotation and one tokenless grace conflict', async f => {
  const script = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
    const { register } = await import('tsx/esm/api'); register();
    const [{ openV2Database }, { createSessionService }] = await Promise.all([import(workerData.dbModule), import(workerData.sessionsModule)]);
    const db = openV2Database(workerData.dbPath);
    const sessions = createSessionService({ db, clock: () => new Date(workerData.now) });
    parentPort.postMessage('ready');
    await new Promise(resolve => parentPort.once('message', resolve));
    try { await sessions.refresh(workerData.token); parentPort.postMessage({ kind: 'ok' }); }
    catch (error) { parentPort.postMessage({ kind: 'error', code: error.code }); }
    finally { db.close(); }
    })().catch(error => parentPort.postMessage({ kind: 'worker-error', message: String(error) }));
  `;
  let workers: Worker[] = [];
  try {
    const original = await login(f);
    workers = Array.from({ length: 2 }, () => new Worker(script, {
      eval: true, execArgv: ['--import', 'tsx'], workerData: {
        dbPath: f.dbPath, now: f.now().toISOString(), token: original.refreshToken,
        dbModule: new URL('../../server/v2/db.ts', import.meta.url).href,
        sessionsModule: new URL('../../server/v2/sessions.ts', import.meta.url).href,
      },
    }));
    const waitMessage = (worker: Worker) => new Promise<unknown>((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
    });
    assert.deepEqual(await Promise.all(workers.map(waitMessage)), ['ready', 'ready']);
    const resultPromises = workers.map(waitMessage);
    workers.forEach(worker => worker.postMessage('go'));
    const results = await Promise.all(resultPromises) as Array<{ kind: string; code?: string }>;
    assert.equal(results.filter(result => result.kind === 'ok').length, 1);
    assert.deepEqual(results.filter(result => result.kind === 'error').map(result => result.code), ['SESSION_REFRESH_RACE']);
    assert.equal((f.db.prepare('SELECT revoked_at FROM session_families').get() as { revoked_at: string | null }).revoked_at, null);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});

fixtureTest('owner-wide session revocation immediately rejects access and refresh tokens', async f => {
    const original = await login(f);
    const repo = new WalletRepository(f.db);
    repo.transaction(tx => revokeOwnerSessionsInTransaction(tx, original.ownerId, f.now().toISOString()));
    assert.equal(f.sessions.resolveAccess(original.accessToken), null);
    await assert.rejects(() => f.sessions.refresh(original.refreshToken), code('SESSION_REVOKED'));
});

fixtureTest('expired access and completed-upgrade source sessions cannot resolve as actors', async f => {
    const source = await login(f);
    const target = await login(f, { sub: 'target-subject' });
    const completed = f.now().toISOString();
    f.db.prepare('INSERT INTO owner_upgrades(source_owner_id,target_owner_id,request_digest,created_at,completed_at,status) VALUES(?,?,?,?,?,?)')
      .run(source.ownerId, target.ownerId, 'synthetic-upgrade-digest', completed, completed, 'completed');
    assert.equal(f.sessions.resolveAccess(source.accessToken), null);
    assert.equal(f.sessions.resolveAccess(target.accessToken)?.ownerId, target.ownerId);
    await assert.rejects(() => f.sessions.refresh(source.refreshToken), code('SESSION_UPGRADED'));

    const malformed = await login(f, { sub: 'malformed-expiry-subject' });
    f.db.prepare("UPDATE v2_sessions SET expires_at='zz-invalid' WHERE owner_id=? AND token_kind='access'").run(malformed.ownerId);
    assert.equal(f.sessions.resolveAccess(malformed.accessToken), null);
    f.db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run(completed, target.ownerId);
    assert.equal(f.sessions.resolveAccess(target.accessToken), null);
    await assert.rejects(() => f.sessions.refresh(target.refreshToken), code('SESSION_UPGRADED'));
    const expired = await login(f, { sub: 'expired-subject' });
    f.setTime(NOW + 16 * 60 * 1000);
    assert.equal(f.sessions.resolveAccess(expired.accessToken), null);
});

test('auth routes enforce exact origins, bounded bodies and same-origin web CSRF cookies', async () => {
  const f = await fixture();
  assert.throws(() => createAuthRouter({ apple: f.auth, sessions: f.sessions, nativeOrigins: ['*'] }), /exact origin/);
  const app = express();
  app.use('/api/v2', createAuthRouter({
    apple: f.auth, sessions: f.sessions,
    nativeOrigins: ['capacitor://localhost'], webOrigin: 'https://form.example.invalid',
  }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/v2`;
  try {
    const oversized = await fetch(`${base}/auth/apple`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identityToken: 'x'.repeat(21 * 1024) }) });
    assert.equal(oversized.status, 413);
    assert.doesNotMatch(await oversized.text(), /identityToken|SyntaxError|x{10}/);
    const denied = await fetch(`${base}/auth/challenge`, { method: 'POST', headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const nativeChallenge = await fetch(`${base}/auth/challenge`, { method: 'POST', headers: { origin: 'capacitor://localhost', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(nativeChallenge.status, 201);
    assert.equal(nativeChallenge.headers.get('access-control-allow-origin'), 'capacitor://localhost');
    assert.equal(nativeChallenge.headers.get('access-control-allow-credentials'), null);
    assert.equal(nativeChallenge.headers.get('cache-control'), 'no-store');
    const challenge = await nativeChallenge.json() as { challengeId: string; nonce: string };
    const login = await fetch(`${base}/auth/apple`, {
      method: 'POST', headers: { origin: 'capacitor://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, identityToken: await f.token(challenge.nonce) }),
    });
    assert.equal(login.status, 200);
    const nativeTokens = await login.json() as { accessToken: string; refreshToken: string };
    assert.ok(nativeTokens.accessToken && nativeTokens.refreshToken);
    const nativeLogout = await fetch(`${base}/session/logout`, { method: 'POST', headers: { authorization: `Bearer ${nativeTokens.accessToken}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(nativeLogout.status, 204);
    assert.equal(f.sessions.resolveAccess(nativeTokens.accessToken), null);
    await assert.rejects(() => f.sessions.refresh(nativeTokens.refreshToken), code('SESSION_REVOKED'));

    const webChallengeResponse = await fetch(`${base}/auth/challenge`, { method: 'POST', headers: { origin: 'https://form.example.invalid', 'content-type': 'application/json' }, body: '{}' });
    const webChallenge = await webChallengeResponse.json() as { challengeId: string; nonce: string };
    const webLogin = await fetch(`${base}/auth/apple`, {
      method: 'POST', headers: { origin: 'https://form.example.invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: webChallenge.challengeId, identityToken: await f.token(webChallenge.nonce, { sub: 'web-subject' }) }),
    });
    assert.equal(webLogin.status, 200);
    const cookies = webLogin.headers.getSetCookie();
    assert.equal(cookies.length, 3);
    assert.ok(cookies.filter(value => value.includes('HttpOnly')).length >= 2);
    assert.ok(cookies.every(value => value.includes('Secure') && value.includes('SameSite=Lax') && value.includes('Path=/')));
    const csrf = cookies.find(value => value.includes('__Host-form_csrf='))?.split(';', 1)[0]?.split('=', 2)[1];
    const webRefresh = cookies.find(value => value.includes('__Host-form_refresh='))?.split(';', 1)[0];
    assert.ok(csrf && webRefresh);
    const missingCsrf = await fetch(`${base}/session/refresh`, { method: 'POST', headers: { origin: 'https://form.example.invalid', cookie: `${webRefresh}; ${cookies.find(value => value.includes('__Host-form_access='))?.split(';', 1)[0]}` , 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missingCsrf.status, 403);
    assert.doesNotMatch(await webLogin.clone().text(), /accessToken|refreshToken/);
    const cookieHeader = cookies.map(value => value.split(';', 1)[0]).join('; ');
    const csrfLogout = await fetch(`${base}/session/logout`, { method: 'POST', headers: { origin: 'https://form.example.invalid', cookie: cookieHeader, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(csrfLogout.status, 403);
    const refreshed = await fetch(`${base}/session/refresh`, { method: 'POST', headers: { origin: 'https://form.example.invalid', cookie: cookieHeader, 'x-form-csrf': csrf, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refreshed.status, 200);
    assert.doesNotMatch(await refreshed.clone().text(), /accessToken|refreshToken/);
    const refreshedCookies = refreshed.headers.getSetCookie();
    assert.equal(refreshedCookies.length, 3);
    const refreshedAccess = refreshedCookies.find(value => value.includes('__Host-form_access='))?.split(';', 1)[0]?.split('=', 2)[1];
    const refreshedCsrf = refreshedCookies.find(value => value.includes('__Host-form_csrf='))?.split(';', 1)[0]?.split('=', 2)[1];
    assert.ok(refreshedAccess && refreshedCsrf);
    const logout = await fetch(`${base}/session/logout`, { method: 'POST', headers: { origin: 'https://form.example.invalid', cookie: refreshedCookies.map(value => value.split(';', 1)[0]).join('; '), 'x-form-csrf': refreshedCsrf, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(logout.status, 204);
    assert.equal(f.sessions.resolveAccess(refreshedAccess), null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.close();
  }
});
