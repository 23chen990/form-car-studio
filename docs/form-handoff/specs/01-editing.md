# S01: editing, capabilities and frozen plans

## New API, not a silent reinterpretation of legacy requests

Keep `/api/*` legacy routes compatible while the old data exists. Add `/api/v2/*` for the new contract. Legacy explore/refine semantics and recorded target remain readable. Do not rewrite an old target into a verified observation. A legacy client cannot use new unsupported fields. The V2 UI switches only after migration, recovery and integration tests pass.

New request is the exact shape validated by prebuilt/shared/edit-plan.ts: schemaVersion2, source original or explicit version ID, operation explore or detail, optional style only for explore, and a field->action map. Omitted/preserve fields mean preserve the current selected base. `set` uses controlled choices. `restore_original` on a version requires actual original-reference capability and access to the correct original; otherwise reject before charging. On an original it is a no-op. Do not insert literal `keep` as a color.

First-launch fields: bodyColor, wheelColor; bodyFinish and generic wheelDesign remain capability-gated pending evidence. No free prompt, arbitrary URL, make/year inference or brand part catalog. Eight historical style IDs stay valid; visible candidates clean/sport/heritage/color are proposals, not approvals. Presets expand on the server into explicit changes with immutable presetVersion. Client cannot replace preset JSON. An explore plan includes all preset edits, then permitted user overrides only if the frozen UI contract supports them; V1 UI does not expose pre-generation expert overrides.

## Snapshot vs observation

Store requestEdits, desiredRecipe, and observedRecipe separately. DesiredRecipe inherits desired intent; observedRecipe contains only evaluated/verified facts, with evaluator/version/evidence and timestamp. Unknown stays unknown. No-op elimination is permitted only using verified base observations. A repeated requested blue does not prove the current pixels are blue. Hash/reference equality of unchanged output is a later quality rule, not a reason to guess preflight success.

## Quote and submission

`POST /api/v2/projects/:id/plans` authorizes project/source ownership, validates active consent, expands preset, checks capability/provider/storage and produces planId, sourceAssetId+digest, canonical semantic JSON, planDigest, templateVersion, presetVersion, supplierProfileId/model identifier, output profile, userCostUnits=1, policy versions, and expiresAt (default 10min). Plan is stored immutable. Never send a supplied remote URL directly to a provider; retrieve owned asset bytes internally.

`POST /api/v2/tasks` accepts only {planId,submissionId,consentRecordId}. Persist submissionId locally before the first request. Server uses UNIQUE(owner,submissionId), and UNIQUE(owner,planId) for confirmed plans. Check existing submission before expired-quote/balance checks. Same key + same fingerprint returns the same task; different semantics409. A new key for an already-confirmed plan returns existing task or409 PLAN_ALREADY_CONFIRMED, never a second charge. Actual plan change requires new quote and confirmation; refresh/timeout does not.

Task snapshot includes all image-affecting and charge-affecting semantics plus source digest, owner, consent/policy versions and output count1. Exclude mutable display-only project name. prebuilt semanticDigest provides canonical JSON SHA256, not authorization or uniqueness. Do not derive idempotency from a hash alone: the user's explicit submission identity and DB constraints are required.

Once accepted, the task keeps its quoted user cost even if a later catalog changes. Emergency provider shutdown may fail/release it; no silent model switch, price increase or extra output. Standard vs large output is not a first-launch paid upgrade. No automatic retry/fallback on a supplier timeout with unknown billable status.

## Prompt design

Use prebuilt provider-prompt as an initial deterministic builder, not a quality guarantee. Preserve vehicle identity, lights, windows, doors, scene and camera; permit only resolved changes. A wheel-design edit must not simultaneously instruct 'keep all wheel structure exactly'. Keep wheel positions/outer size/tires/stance while permitting spoke appearance. No adding bodykits/spoilers in first-launch contract. Drop project name and raw user text from provider instruction. Reference images are declared with explicit roles and must actually be supplied or the request is rejected.

Prebuilt prompt does not choose a provider/model or send network traffic. Each provider profile records supported request fields and endpoint behavior from that provider's current official docs. Tests mock error/usage bodies; do not infer unsupported options from an OpenAI-compatible URL alone.

## Failures

400 malformed/unknown schema;403 invalid consent/forbidden action;404 unauthorized or missing resource (avoid cross-owner existence leaks);409 source/plan/submission conflict;422 unsupported/no-effective-change/unreadable-photo;429 rate limit;503 disabled/capacity/provider unavailable. Error JSON is {code,message,retryable,requestId}; no raw exception, key, prompt, full upstream payload or private image URL. RequestId is an opaque support reference, not a token.
