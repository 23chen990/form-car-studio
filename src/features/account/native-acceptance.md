# Native account acceptance and integration boundary

Default bindings remain disabled. F32 must supply approved HTTPS apiOrigin and
approvedApiOrigins with enabled=true in the bundled FORMAuth plugin config,
after independent F20–F25/privacy review. No arbitrary JS owner or refresh token
is accepted. Existing F20 routes are reused; no new auth backend is introduced.

F32 must provide purgePrivateData to clear F26/F37 previews, owner submission/draft
pointers, media transients and private image/object URLs before any owner is
published. This module does not perform guest upgrade; reuse the F22 transaction.
Short access tokens are memory-only. Rotated opaque refresh material stays in
Keychain with WhenUnlockedThisDeviceOnly, no synchronization/backups. Network
redirects/cookies are refused; an uncertain refresh is not blindly replayed.

All actual iPhone rows below are NOT_RUN:

| Case | Result |
|---|---|
| Valid Apple Developer team/bundle/provisioned Sign in with Apple capability | NOT_RUN |
| One-time challenge nonce/state, cancelled login, missing name, private relay | NOT_RUN |
| Keychain after kill/restart, locked device, expiry, server revoke/reuse | NOT_RUN |
| Logout/account switch during delayed Apple callback, no former private image | NOT_RUN |
| Offline logout shows local clear and pending server revocation separately | NOT_RUN |
| VoiceOver/large type/native Apple presentation | NOT_RUN |

UI is an unmounted functional control using the current styling. No S05 redesign,
new login provider, trial claim, purchase or release is authorized. Evidence must
name commit/device/OS, actual outcome and private redacted log hash.
