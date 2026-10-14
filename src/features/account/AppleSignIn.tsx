import { useEffect, useState } from 'react';
import type { NativeAuthController } from '../../platform/native-auth';
export function AppleSignIn({ auth }: { auth: NativeAuthController }) {
  const [state, setState] = useState(auth.state());
  useEffect(() => auth.subscribe(setState), [auth]);
  const busy = state.status === 'signing_in' || state.status === 'syncing';
  return <section aria-label="Account" aria-busy={busy}>
    {state.status === 'signed_in'
      ? <button type="button" onClick={() => { void auth.logout().catch(() => {}); }}>Sign out</button>
      : <button type="button" disabled={busy || state.status === 'unavailable'} onClick={() => { void auth.signIn().catch(() => {}); }}>Continue with Apple</button>}
    {busy && <p role="status">Checking your session…</p>}
    {(state.message || state.status === 'unavailable') && <p role="status">{state.message ?? 'Sign in is unavailable until the app is configured.'}</p>}
  </section>;
}
