# S02: persistent data and route contracts

## Storage architecture

Retain Express and Node24 SQLite for the first single writable instance. Move database operations out of giant handlers into repository/services modules one task at a time. WAL and busy timeout remain; foreign_keys=ON per connection. No DB transaction across awaits/network. Plan/credit/job acceptance and result/asset/version/settlement are each atomic. Worker claims use conditional update even with one process; restart recovery must work. A second writable worker/replica is explicitly unsupported until leases and distributed cost limits are tested.

Introduce migration_version and additive v2_ tables (names may follow these exact nouns): users, sessions, identities, projects, assets, versions, drafts, plans, tasks, supplier_attempts, credit_lots, reservations, reservation_allocations, ledger_events, purchases, purchase_events, consents, feedback, quality_compensations, trial_claims, deletion_jobs, audit_events. Keep original tables untouched until a separately approved retirement. Typed validated JSON can hold immutable plan/preset snapshots, not authoritative unvalidated balance state.

All owned objects carry owner_id. Composite uniqueness/FKs must prevent project/version/asset/task references across owners, not just validate UUID syntax. Index owner+createdAt and task status; use bounded pagination (default20 max100) instead of whole-workspace state every poll. Private asset fetches authorize owner on every read; no public static user-image directory. Browser no-store + private response headers retained. A file ID is not an access credential.

Keys: UNIQUE(owner_id,submission_id); UNIQUE(owner_id,confirmed_plan_id); one official version per successful task; one active V2 task per user (queued/processing/uncertain) via checked transaction/partial index; UNIQUE(environment,transaction_id); UNIQUE(owner_id,ledger_event_key); UNIQUE(root_task_id) for quality compensation; UNIQUE(user_id,trial_program_id) for lifetime first-trial eligibility. A campaign ID cannot reset that trial program. State columns and integer units get CHECK constraints. Price is stored in integer minor units with currency where actual verified, cost estimates in integer USD micro-units plus source; unknown=null.

## Migration procedure (offline/disposable first)

F00 records source commit, runtime, actual schema and tests. F02 adds schema and synthetic fixtures. F03 takes a consistent backup using SQLite backup facilities or a clean stopped/checkpointed DB; do not copy only a live .sqlite file while ignoring WAL. Compute input hashes, run integrity_check and foreign_key_check; migrate in a transaction; schema version advances only after success. Failure leaves old DB intact. Repeating migration does not create users/grants/assets twice. Recovery rehearsal restores an independent copy and compares every legacy object/parent, image bytes, favorite/name/draft, available/reserved credit and ledger totals.

Legacy cookie maps to a guest identity through a private server-side mapping, not to a guessed email. Import its starting balance as a distinct migration event with provenance; do not replay old grant rows a second time. Legacy active live tasks retain uncertainty behavior and user refunds but never automatically resubmit upstream. Legacy current chosen version remains chosen. Do not delete the old schema to make tests pass. Paid production migration requires backup/rollback approval; until then only fixtures and temporary data.

## V2 endpoints (explicit controller/service boundaries)

GET /api/v2/bootstrap -> actor mode, capability IDs/versions, approved catalog metadata, owned task summaries, small latest-project list; no secrets or cost internals.
POST /api/v2/consents -> policyVersion, purposes, provider identity disclosed and acknowledgments; returns opaque consentRecordId. Validate server publication and actor, record timestamp; do not accept arbitrary provider/version from UI.
POST /api/v2/projects -> multipart image + validated consent record, source kind/name; validates image, persists original privately; no generation. Demo source uses licensed sample only, never user's image as fake output.
GET/PATCH/DELETE /api/v2/projects/:id -> name, coverVersionId and explicit delete. For DELETE active tasks use deletion tombstone path, not file removal races.
GET /api/v2/projects/:id/versions?cursor= -> immutable versions and references, favorites metadata separate.
PUT /api/v2/projects/:id/draft -> draftRevision optimistic concurrency, sourceRef, edits; stale revision409 returns revision info, not auto overwrite from another tab.
POST /api/v2/projects/:id/plans and POST /api/v2/tasks -> S01.
GET /api/v2/submissions/:submissionId -> owned accepted task or404; after a lost response client may replay same POST to resolve race. Do not create a new ID automatically.
GET /api/v2/tasks/:id -> status, stage code, immutable cost, resultVersionId, safe error, created/updatedAt; never all history.
POST /api/v2/tasks/:id/cancel -> V2 queued only; race with worker CAS produces either cancelled+release or409 already submitted. Existing legacy route remains covered by old tests.
POST /api/v2/tasks/:id/feedback -> controlled category + optional short text<=1000, owned task; creates case, no immediate wallet grant from client claims.
PATCH /api/v2/versions/:id -> favorite/name only. Cannot replace image/source/preset from this route.
GET /api/v2/assets/:id -> owner-authorized bytes, actual mime/dimensions, no-store/private.
POST /api/v2/auth/apple -> challenge/code/id_token flow verified server-side, S04.
POST /api/v2/session/refresh and POST /api/v2/session/logout -> rotation/revocation, never cookie reset grants.
GET /api/v2/wallet -> spendable/reserved/purchased/promo summaries from ledger, server authority.
GET /api/v2/catalog -> approved IDs+unit quantities; localized price comes from StoreKit, not server guess.
POST /api/v2/purchases/verify -> signed transaction or server-verifiable ID; S04.
POST /api/v2/webhooks/apple -> signature-authenticated Apple notification endpoint, no browser-auth shortcut.
POST /api/v2/trial/claim -> stable account, server policy and atomic budget+eligibility check, S03.
DELETE /api/v2/account -> recent-auth confirmation and tombstoned deletion job, S04.
GET /api/v2/deletion/:id -> owned progress without retaining photos to show a thumbnail.

No web purchase checkout in first iOS release. No '/admin/grant?user=...' endpoint protected only by a client flag. Operator commands use a separate authenticated server environment and audit trail, with dry-run default.

## Images and quotas

Local preview until upload consent. Input decoder validates bytes, not MIME alone; strip metadata, fix orientation, reject animation/decompression bombs. HEIC handling is an explicit native conversion path with iCloud download failure UX. Do not merely expand an accept attribute when the decoder lacks support.

Split normalizeInput, validateOutputMaster, createDisplayAsset, export. Keep provider-native output dimensions in a lossless master after approved safety/metadata processing; record before/after dimensions+hashes. Display thumbnails have separate IDs. 4096px synthetic output must not silently become2400px; unvalidated upscales cannot be sold as native4K. Reject output using output-specific messages. PNG/JPEG encoded bytes may differ while pixels match; compare canonical oriented sRGB RGBA digest when declaring exact unchanged output. Do not use perceptual similarity alone for automatic refunds.

Estimate storage headroom before reserving a task. Active task retains temporary output bytes only to persist/reconcile safely; on account/project tombstone no completed output may resurrect the data. Quota error is recoverable and clear; it must not overwrite older favorites. Max data sizes are enforced on proxies and Express routes as well as client UI. Long-running assets are not returned inside huge JSON base64 responses.
