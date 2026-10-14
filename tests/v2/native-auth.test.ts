import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createNativePolicy } from '../../src/platform/ios-shell';
async function load() {
  assert.ok(existsSync(new URL('../../src/platform/native-auth.ts', import.meta.url)), 'native auth controller must exist');
  return import('../../src/platform/native-auth.js');
}
const enabled = () => createNativePolicy({ enabled: true, apiOrigin: 'https://api.form.example', approvedApiOrigins: ['https://api.form.example'] });
const session = (ownerId = 'owner-a') => ({ status: 'signed_in', ownerId, accessToken: 'a'.repeat(43), accessExpiresAt: new Date(Date.now() + 900_000).toISOString() });
const port = (overrides: Record<string, unknown> = {}): any => ({ signIn: async () => session(), restore: async () => ({ status: 'signed_out' }), refresh: async () => session(), logout: async () => ({ status: 'signed_out', revocationPending: false }), ...overrides });
test('missing approved native configuration makes zero login/session calls', async () => {
  const { createNativeAuth } = await load(); let calls = 0;
  const auth = createNativeAuth({ native: port({ signIn: async () => { calls++; return session(); } }), purgePrivateData: async () => {} });
  await auth.signIn(); assert.equal(calls, 0); assert.equal(auth.state().status, 'unavailable');
});
test('server-issued owner publishes only after prior private data is cleared', async () => {
  const { createNativeAuth } = await load(); const order: string[] = [];
  const auth = createNativeAuth({ policy: enabled(), native: port(), purgePrivateData: async () => { order.push('clear'); } });
  auth.subscribe(state => { if (state.status === 'signed_in') order.push(state.ownerId!); });
  await auth.signIn(); assert.deepEqual(order, ['clear','owner-a']); assert.equal(auth.accessToken(), 'a'.repeat(43));
  assert.equal(Object.hasOwn(auth.state(), 'accessToken'), false);
});
test('Apple cancellation/missing name/private relay do not require user PII', async () => {
  const { createNativeAuth } = await load();
  const auth = createNativeAuth({ policy: enabled(), native: port({ signIn: async () => ({ status: 'cancelled' }) }), purgePrivateData: async () => {} });
  await auth.signIn(); assert.equal(auth.state().status, 'signed_out'); assert.equal(auth.accessToken(), null);
});
test('unexpected refresh token or malformed response never becomes an account', async () => {
  const { createNativeAuth } = await load();
  for (const value of [{ ...session(), refreshToken: 'secret' }, { ...session(), ownerId: '../other' }, { ...session(), accessExpiresAt: 'bad' }]) {
    const auth = createNativeAuth({ policy: enabled(), native: port({ signIn: async () => value }), purgePrivateData: async () => {} });
    await assert.rejects(auth.signIn(), /NATIVE_AUTH_FAILED/); assert.equal(auth.accessToken(), null); assert.equal(auth.state().ownerId, null);
  }
});
test('double taps share one in-flight native login', async () => {
  const { createNativeAuth } = await load(); let resolve!: (value: unknown) => void; let calls = 0;
  const auth = createNativeAuth({ policy: enabled(), native: port({ signIn: () => { calls++; return new Promise(r => { resolve = r; }); } }), purgePrivateData: async () => {} });
  const first = auth.signIn(); const second = auth.signIn(); await new Promise(r => setImmediate(r));
  resolve(session()); await Promise.all([first, second]); assert.equal(calls, 1);
});
test('logout invalidates a late sign-in and cannot resurrect private images', async () => {
  const { createNativeAuth } = await load(); let resolve!: (value: unknown) => void;
  const auth = createNativeAuth({ policy: enabled(), native: port({ signIn: () => new Promise(r => { resolve = r; }) }), purgePrivateData: async () => {} });
  const login = auth.signIn(); await new Promise(r => setImmediate(r)); await auth.logout(); resolve(session()); await login;
  assert.equal(auth.state().status, 'signed_out'); assert.equal(auth.accessToken(), null);
});
test('revoked/expired session clears private data and untrusted error text is never displayed', async () => {
  const { createNativeAuth } = await load(); let clears = 0;
  const auth = createNativeAuth({ policy: enabled(), native: port({ refresh: async () => { throw new Error('secret payload'); } }), purgePrivateData: async () => { clears++; } });
  await auth.signIn(); await assert.rejects(auth.refresh(), /NATIVE_AUTH_FAILED/);
  assert.equal(auth.state().ownerId, null); assert.equal(auth.accessToken(), null); assert.ok(clears >= 2);
  assert.doesNotMatch(JSON.stringify(auth.state()), /secret payload/);
});
test('failed private cleanup prevents publishing the new owner', async () => {
  const { createNativeAuth } = await load();
  const auth = createNativeAuth({ policy: enabled(), native: port(), purgePrivateData: async () => { throw Error('failed'); } });
  await assert.rejects(auth.signIn(), /NATIVE_AUTH_FAILED/); assert.equal(auth.state().ownerId, null);
});
test('offline server revocation is reported separately from local logout', async () => {
  const { createNativeAuth } = await load();
  const auth = createNativeAuth({ policy: enabled(), native: port({ logout: async () => ({ status: 'signed_out', revocationPending: true }) }), purgePrivateData: async () => {} });
  await auth.signIn(); await auth.logout(); assert.match(auth.state().message!, /server session/); assert.equal(auth.accessToken(), null);
});
test('a late logout response cannot overwrite a subsequent authenticated owner', async () => {
  const { createNativeAuth } = await load(); let finish!: (x: unknown) => void;
  const auth = createNativeAuth({ policy: enabled(), native: port({ logout: () => new Promise(r => { finish = r; }) }), purgePrivateData: async () => {} });
  const logout = auth.logout(); await new Promise(r => setImmediate(r)); await auth.signIn();
  finish({ status: 'signed_out', revocationPending: true }); await logout;
  assert.equal(auth.state().status, 'signed_in'); assert.equal(auth.state().ownerId, 'owner-a');
});
test('native controller callbacks bind their exact authorization controller after logout', () => {
  const source = readFileSync(new URL('../../ios/App/App/Plugins/FORMAuth.swift', import.meta.url), 'utf8');
  assert.equal((source.match(/guard controller === self.authorization/g) ?? []).length, 2);
  assert.match(source, /if expected == generation \{ current = nil \}/);
});
test('native Apple challenge and Keychain boundaries are explicit', () => {
  const path = new URL('../../ios/App/App/Plugins/FORMAuth.swift', import.meta.url); assert.ok(existsSync(path), 'native Apple plugin must exist');
  const source = readFileSync(path, 'utf8');
  assert.match(source, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/); assert.match(source, /SecItemUpdate/);
  assert.match(source, /\/auth\/challenge/); assert.match(source, /request.nonce/); assert.match(source, /credential.state/);
  assert.match(source, /completionHandler\(nil\)/); assert.doesNotMatch(source, /UserDefaults|print\(|NSLog/);
  const ts = readFileSync(new URL('../../src/platform/native-auth.ts', import.meta.url), 'utf8'); assert.doesNotMatch(ts, /localStorage|console\./);
});
