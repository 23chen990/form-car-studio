import { registerPlugin } from '@capacitor/core';
import { createNativePolicy, NATIVE_PLUGINS, type NativePolicy } from './ios-shell';
export interface NativeAuthPlugin {
  signIn(): Promise<unknown>; restore(): Promise<unknown>; refresh(): Promise<unknown>; logout(): Promise<unknown>;
}
export type NativeAuthState = { status: 'unavailable' | 'signed_out' | 'signing_in' | 'syncing' | 'signed_in' | 'error'; ownerId: string | null; message: string | null };
type Session = { status: 'signed_in'; ownerId: string; accessToken: string; accessExpiresAt: string };
const plugin = registerPlugin<NativeAuthPlugin>(NATIVE_PLUGINS.auth);
function parse(value: unknown): Session | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('NATIVE_AUTH_FAILED');
  const v = value as Record<string, unknown>;
  if (v.status === 'signed_out' || v.status === 'cancelled') return null;
  if (Object.keys(v).length !== 4 || v.status !== 'signed_in' || typeof v.ownerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.ownerId) || typeof v.accessToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.accessToken) || typeof v.accessExpiresAt !== 'string' || !Number.isFinite(Date.parse(v.accessExpiresAt)) || Date.parse(v.accessExpiresAt) <= Date.now()) throw Error('NATIVE_AUTH_FAILED');
  return { status: 'signed_in', ownerId: v.ownerId, accessToken: v.accessToken, accessExpiresAt: v.accessExpiresAt };
}
/** Refresh material never crosses the JS bridge. F32 supplies owner-aware cache/pointer cleanup. */
export function createNativeAuth(options: { native?: NativeAuthPlugin; policy?: NativePolicy; purgePrivateData: () => Promise<void> }) {
  const native = options.native ?? plugin, policy = options.policy ?? createNativePolicy();
  let current: Session | null = null, epoch = 0, job: Promise<void> | null = null;
  let state: NativeAuthState = { status: policy.available ? 'signed_out' : 'unavailable', ownerId: null, message: null };
  const listeners = new Set<(state: NativeAuthState) => void>();
  function publish(status: NativeAuthState['status'], ownerId: string | null = null, message: string | null = null) {
    state = { status, ownerId, message }; for (const listener of listeners) listener({ ...state });
  }
  function run(action: 'signIn' | 'restore' | 'refresh') {
    if (!policy.available) { publish('unavailable', null, 'Sign in is unavailable until the app is configured.'); return Promise.resolve(); }
    if (job) return job;
    const generation = ++epoch; current = null; publish(action === 'signIn' ? 'signing_in' : 'syncing');
    const work = (async () => {
      await options.purgePrivateData(); if (generation !== epoch) return;
      const result = await native[action](); if (generation !== epoch) return;
      current = parse(result); publish(current ? 'signed_in' : 'signed_out', current?.ownerId ?? null);
    })().catch(async () => {
      if (generation !== epoch) return;
      current = null; try { await options.purgePrivateData(); } catch { /* Keep all private content hidden. */ }
      try { await native.logout(); } catch { /* Native failure never permits account publication. */ }
      if (generation !== epoch) return;
      publish('error', null, 'Your session could not be verified. Sign in again.'); throw Error('NATIVE_AUTH_FAILED');
    });
    const promise = work.finally(() => { if (job === promise) job = null; }); job = promise; return promise;
  }
  return Object.freeze({
    state: () => ({ ...state }), subscribe(listener: (value: NativeAuthState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: () => run('signIn'), restore: () => run('restore'), refresh: () => run('refresh'),
    accessToken: () => current && Date.parse(current.accessExpiresAt) > Date.now() ? current.accessToken : null,
    async logout() {
      const generation = ++epoch; job = null; current = null; publish('signed_out');
      try {
        await options.purgePrivateData(); const result = await native.logout();
        if (generation !== epoch) return;
        if (result && typeof result === 'object' && (result as { revocationPending?: unknown }).revocationPending === true) publish('signed_out', null, 'Signed out on this device. The server session could not yet be revoked.');
      } catch { if (generation !== epoch) return; publish('error', null, 'Signed out locally. Session cleanup needs to be retried.'); throw Error('NATIVE_AUTH_FAILED'); }
    },
  });
}
export type NativeAuthController = ReturnType<typeof createNativeAuth>;
