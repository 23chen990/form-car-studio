# S04: identity, Apple purchases and personal data

## Stable identity with limited scope

Guests can explore demo and prepare an image locally. Require Sign in with Apple for purchase, real trial eligibility and cross-device cloud workspace. Do not claim that a guest cookie survives reinstall. For launch do not add Google/Facebook/password auth. Preserve guest work via an explicit upgrade transaction. Defer merge if either workspace has an active task; do not create two active jobs in one user or cancel one silently. Demo and paid production balances never merge. Projects retain IDs/source history; migration/merge is idempotent. Trial eligibility is unioned, not summed.

Native Apple login uses current official AuthenticationServices mechanisms and a server-issued one-time challenge. Server validates issuer, signature using current Apple keys, audience from approved bundle/service configuration, nonce, expiry and challenge reuse; never trust decoded JWT claims without verification. Use Apple's stable subject for identity, not email (private relay and name may not always return). Do not build custom JWT cryptography when an approved maintained library is available. Library identity/version and official documentation are recorded and lockfile pinned in that isolated task.

Native access tokens short-lived; refresh token opaque random and rotated, hashed at rest, stored in Keychain, not localStorage. Detect reuse and revoke token family; handle concurrent refresh without creating account loss. Web same-origin session cookie remains httpOnly, Secure in production, SameSite appropriate and CSRF-protected. Configure a known reverse proxy trust boundary, not blanket trust of arbitrary X-Forwarded headers. Native CORS origins explicitly permitted; '*' with credentials is forbidden. CORS does not authorize an actor. Every owned resource read/write still checks owner.

## StoreKit2 flow

Products are approved consumables only (proposal:5-unit and15-unit packs). Actual bundle ID, product IDs, price tiers, storefronts and agreements remain owner facts; null/unknown disables purchase, never a fake live product. UI price uses StoreKit localized displayPrice. Show product unit count from the approved server catalog; if ID/type/units cannot be reconciled, hide purchase and report catalog mismatch. No assumed exchange rates or hard-coded '$' outside test fixtures.

Authenticate before purchase and supply a stable, non-PII UUID appAccountToken associated with that user. Listen to Transaction.updates and unfinished transactions at app start; handle purchase success, pending/Ask to Buy, cancellation and failure distinctly. Send verified transaction material to the server; do not credit from client success alone. Server uses Apple's official verification approach/library, verifies certificate chain/signature, bundle, environment, application/product identity, transaction ID, quantity, account token and revocation status. Development sandbox data never credits production. A raw transaction ID is not proof by itself; verify against Apple where required.

In one transaction persist verified transaction and grant configured units exactly once (respect verified quantity within permitted catalog limits). UNIQUE(environment,transactionId) prevents crediting the same purchase to two app users. If account token conflicts, return an account-resolution message; do not migrate purchase ownership based on a caller's claim. Client calls finish only after server has durably acknowledged credited/already-credited outcome. Lost ack => resend same transaction; it must not duplicate balance. Receipt/server verification outage => show purchase awaiting confirmation, retain transaction, do not ask for payment again.

Consumable balance recovery comes from the user's own account ledger, not 'restore all purchases' re-granting historical packs. Provide 'Sync balance', transaction status and platform refund help. Do not claim Apple automatically restores consumed consumables. Deleting app/account, cancelling generation and requesting monetary refund are separate actions. There are no subscriptions to manage in first launch; do not display a misleading cancellation page. If subscriptions are added later, their lifecycle is a new reviewed scope.

## Apple notifications and money reversal

Verify signed Apple server notifications and transaction payloads before state changes. NotificationUUID/event IDs and transaction IDs are idempotent; process durably then acknowledge. Refund/revoke arriving before purchase creates a revocation tombstone so later purchase verification does not grant usable credits. Duplicated/out-of-order notifications must converge on the same ledger. Reconcile transactions with authoritative server information when event order is insufficient. Support a bounded operator repair action with dry-run, role authorization and audit, never an unauthenticated credit edit endpoint.

## Data flow and consent

Before upload: local photo selector/preview, clear upload/storage explanation, rights acknowledgment; opt-out leaves bytes local. Before any third-party model or automated image precheck: disclose the actual processor/purpose and capture an applicable permission record. 'I own this photo' is not interchangeable with AI-sharing consent. Provider changes require checking the existing scope and requesting fresh consent if not covered; no hidden fallback to a new processor. At task execution recheck deletion/revocation and consent applicability. Check current Apple guidance at release, not a cached rule from this report.

Approved data map must list local import, cloud storage, provider generation/precheck, operational logs, analytics, Apple verification, support review and caches. For each: fields, purpose, recipient, hosting/transfer locations, user linkage, access, retention, deletion and policy disclosure. Unknown fields are a release blocker. Do not copy competitor labels or claim 'No data collected', 'On-device AI' or 'We never upload your photos' for this architecture. Do not claim a provider never trains/retains until its actual contract/config is reviewed.

No advertising SDK, cross-app tracking, contact/location permission or undisclosed device fingerprinting in launch scope. Necessary rate limiting is purpose-limited and documented. Logs exclude raw photos, full tokens/JWS, user names, plates, IPs in general analytics and free-text reports; support obtains least-privilege access and audit. App Privacy answers, privacy manifest/required reason APIs and legal pages must match actual SDKs and data flows.

## Deletion

Project deletion creates an owner/project tombstone first, blocks new work and asset reads, cancels queued work and stops/discards processing output safely. Delete originals, versions, drafts, display assets and derived caches. Already shared/downloaded user copies cannot be remotely guaranteed deleted. App logout/account switch wipes that owner's private cache and tokens; it does not delete server history without request.

Account deletion requires clear confirmation and recent authentication, but not cancellation of a non-existent subscription. Accept a deletion job, revoke active sessions, block new transactions/tasks and remove personal content; revoke Sign in with Apple tokens using approved server-held credentials where applicable. Keep only a legally justified minimized financial/security record for the approved retention schedule, and disclose this exception. Do not preserve complete photos/prompt text as accounting evidence. Anonymous tombstones preventing replay must also have a reviewed purpose/retention; no hidden permanent user tracking.

Deletion state/last error/retry schedule visible to support. After backup restore, replay deletion tombstones before serving traffic so deleted images do not reappear. Storage cleanup is idempotent and error-tolerant; HTTP 'accepted' is not 'all backups erased'. No hard-coded legal promise of immediate erasure unless implementation and provider support it.

## External facts Codex must not invent

Team/bundle/app IDs, Apple keys, agreements/bank/tax details, publisher address/entity, deployment domain, support contact, privacy/terms, approved processor/subprocessor and retention, authentic photo licenses, model quality evidence, budget and release approval. Keep completed owner facts in a private approved location; public files carry null and evidence references only. Implement disabled adapters and tests now, but leave real integration marked NOT_RUN until its facts exist.

## Official sources for release re-check

Apple review: https://developer.apple.com/app-store/review/guidelines/
App Privacy: https://developer.apple.com/app-store/app-privacy-details/
Deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
StoreKit: https://developer.apple.com/documentation/storekit
Server library: https://github.com/apple/app-store-server-library-node
These are reference entrypoints, not proof that this handoff has completed Apple verification or a jurisdiction-specific legal review.
