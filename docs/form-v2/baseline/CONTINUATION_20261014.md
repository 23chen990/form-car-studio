# FORM V2.2 continuation and recovery — 2026-10-14

Implementation snapshot before this documentation-only update: `4e6f7283a3c50e44069597cb30caf61324d0b817`.
Branch: `codex/form-v2-implementation`. Draft PR: https://github.com/23chen990/form-car-studio/pull/3 .
Main remains the audited `3df0b392f4c81364a34d5083dc75284eafbe2eb1`; the original dirty checkout at `3168cac1799da3d0cad00a76c6f930b546efa124` was preserved.

## Outcome and actual runtime boundary

18 tasks are CODE_READY offline; F12/F23 are not ready, and the other19 unfinished cards have unmet dependencies. No further unstarted card has all prerequisites. This is the stop condition of the current frozen graph, not a fixed task quota.
The supplied FORM_PREWORK_DONE_20261013.zip was inspected and its F05/F06 delivery reused, rather than retyped or copied over newer files. Delivered offline tests79 and the frozen43-file manifest were verified; archive instructions remain subordinate to current repository rules.
All original application entries and original tests remain byte-identical to main. The production UI/server still use the legacy application. New V2 backend chains and TaskWait UI are isolated/unmounted pending F32 and independent review. F38 PR CI is the actual connected repository feature; no deployed/iPhone/payment/model feature is claimed.
Live generation/trial are disabled by default; authorized external model spend0, purchases0, production DB writes0, merge/deployment none. Six Luna task workers provided scoped implementation/research/audits with one writer at a time; all their checks are NOT_INDEPENDENT.

## Frozen task status

| Task | Status | Missing prerequisites / note |
|---|---|---|
| F00 | CODE_READY | Offline only; report/source SHA linked below |
| F01 | CODE_READY | Offline only; report/source SHA linked below |
| F02 | CODE_READY | Offline only; report/source SHA linked below |
| F03 | CODE_READY | Offline only; report/source SHA linked below |
| F04 | CODE_READY | Offline only; report/source SHA linked below |
| F05 | CODE_READY | Offline only; report/source SHA linked below |
| F06 | CODE_READY | Offline only; report/source SHA linked below |
| F07 | CODE_READY | Offline only; report/source SHA linked below |
| F08 | CODE_READY | Offline only; report/source SHA linked below |
| F09 | CODE_READY | Offline only; report/source SHA linked below |
| F10 | CODE_READY | Offline only; report/source SHA linked below |
| F11 | CODE_READY | Offline only; report/source SHA linked below |
| F12 | PARTIAL / BLOCKED_TASK_TOO_BIG | Full1098 source >900; local helper/harness foundation alone admitted |
| F13 | DEPENDENCY_BLOCKED | F12 |
| F14 | DEPENDENCY_BLOCKED | F13 |
| F15 | CODE_READY | Offline only; report/source SHA linked below |
| F16 | DEPENDENCY_BLOCKED | F14 |
| F17 | DEPENDENCY_BLOCKED | F16 |
| F18 | DEPENDENCY_BLOCKED | F17 |
| F19 | DEPENDENCY_BLOCKED | F18 |
| F20 | CODE_READY | Offline only; report/source SHA linked below |
| F21 | DEPENDENCY_BLOCKED | F18 |
| F22 | CODE_READY | Offline only; report/source SHA linked below |
| F23 | ARCHIVE ONLY / BLOCKED_TASK_TOO_BIG | Full951 source >900; no purchase source in branch |
| F24 | DEPENDENCY_BLOCKED | F21, F23 |
| F25 | DEPENDENCY_BLOCKED | F23 |
| F26 | DEPENDENCY_BLOCKED | F25 |
| F27 | CODE_READY | Offline only; report/source SHA linked below |
| F28 | DEPENDENCY_BLOCKED | F17 |
| F29 | DEPENDENCY_BLOCKED | F14 |
| F30 | DEPENDENCY_BLOCKED | F24, F29 |
| F31 | DEPENDENCY_BLOCKED | F19, F26, F30 |
| F32 | DEPENDENCY_BLOCKED | F25, F28, F31, F35, F37 |
| F33 | DEPENDENCY_BLOCKED | F32 |
| F34 | DEPENDENCY_BLOCKED | F33 |
| F35 | DEPENDENCY_BLOCKED | F16, F28 |
| F36 | CODE_READY | Offline only; report/source SHA linked below |
| F37 | DEPENDENCY_BLOCKED | F17, F19, F26 |
| F38 | CODE_READY | Offline only; report/source SHA linked below |

The current code SHA, exact commands, logs and hashes are in [task JSON reports](../progress/); baseline evidence predates this continuation, and report histories preserve earlier results. CODE_READY does not mean INTEGRATION_VERIFIED, LIVE_VERIFIED or RELEASE_APPROVED.

## Reused services and defect repairs

- F02/F03: additive schema, durable owner/source constraints, WAL-consistent backup, idempotent migration and actual disposable restore. Original schema/fixtures were preserved.
- F04/F09/F10: exact lot allocations, append-only accounting, immutable accepted plans, cross-connection races, atomic outputs, no-op failure, real worker interruption and bounded fair queued scanning without replaying uncertain upstream calls.
- F05/F06/F07/F08: bounded provider streams, private byte/pixel provenance, consent before upload, quota checks, trusted legacy/upgrade ownership, exact selected bases and immutable edits. Existing delivered code was reused and regression defects fixed.
- F11/F15: persistent actor/operation/submission identity; same-key lost-response recovery; task-only2s→5s polling, hidden pause, real terminal/credit messages, queued-cancel race, one-shot stop and monotonic screen lifetime. Actual RED caught ABA stale callbacks, overwritten status errors and320px/200% overflow; assertions retained.
- F20/F22: local RSA-signed auth fixtures, fixed Apple issuer/JWKS contract, opaque rotating session families, canonical expiry rejection, atomic guest upgrade, true legacy private-source access, direct inherited trial claims and independent SQLite worker races. These are offline proofs, not real Apple sign-in.
- F27/F36: closed default budgets/trials, conservative unknown liabilities, immutable dispatch context, global/account circuit breakers, durable financial hold if audit writes fail; atomic single first-trial funding, same-lot technical release, HTTP lost-ACK recovery, revoked replay rejection and safely consumed asynchronous configuration.

## Actual verification and limits

Final application/service source was tested under Node24.14.0/npm11.9.0 locally, with installed Chromium153, synthetic photos/accounts and disposable SQLite only.

| Verification | Actual result | Source/evidence |
|---|---|---|
| Legacy Node tests | 30/30; no skips | F15/F38 reports |
| V2 tests | 151 reference +306 application =457; no skips | F15 source0c5852e and final Linux F38 sourceb2aac5d |
| Legacy full-application Chromium | 6/6 | F38 local parent008275e and final Linux sourceb2aac5d |
| V2 TaskWait Chromium harness | 9/9 | F15 source0c5852e; F38 final Linux sourceb2aac5d |
| TypeScript/Vite build | PASS | F15/F38 actual logs |
| Guard unit tests / frozen manifest | 42 cases /43 hashes match | recovery report |
| F12 full external candidate | Node4/4, browser15/15, TS/build PASS; scope FAIL | preserved patch/hash, not current photo UI |
| F23 full external candidate | purchase15/15; purchase/wallet/auth44/44; TS PASS; scope FAIL | preserved patch/hash, not branch source |

Final F38 source run [38442750079](https://github.com/23chen990/form-car-studio/actions/runs/38442750079) at b2aac5d passed locked install, read-only policy, all units, build and both browser groups. Immutable Node24 official Action pins and eight policy probes are recorded in [F38](../ci/F38.md). The final report-only HEAD will receive its own PR checks; the recovery artifact records that exact HEAD/run.
The earlier untouched legacy style-save CI failure38406144924 remains archived; later unchanged6/6 passed. No automatic retry, skip or weaker assertion was added. Synthetic visibility events/local RSA signatures/worker kills do not certify a real iPhone, Apple/StoreKit, model quality, production migration or independent review.
Locked npm audit still identifies one inherited high Sharp advisory. A0-advisory candidate was tested outside application scope; dependency/lock/notices maintenance needs its own approved allowlist and recheck against the current lockfile.

## Preserved candidates and proposed reviewed amendments

- F12: folder FORM_F12_BLOCKED_20261014_tenzcolb under local Downloads, ZIP alongside it. Base7da33a1; tested tree60a9c292c302ab6d20dea874ac0b79677d18e6b0; patch SHA25676d543a9e1abaf82c253732902bd35ed88a389313c475c3d16e17d21f788021c. Full source1098 + evidence about60 requires a reviewed1200-line cap or infrastructure/intake split; current cap900 remains unchanged. The unmounted-upload race was genuinely reproduced and fixed in that candidate. Keeping the partial foundation does not authorize resetting the total cap.
- F23: folder FORM_F23_BLOCKED_20261014_y_2wy_z3 under local Downloads, ZIP alongside it. Base5ea1328; tested tree7ae095aeabb8f92553d8bbdc49ccca69bd383450; patch SHA25673db33b4cdac1d7fc819999942b110d873728050717da7db02edc7f23d3dad1b. Source951 + evidence about60 suggests reviewed1100 cap or adapter/verification split; current900 unchanged. Official SDK verification/revocation tombstones are candidates only; valid Sandbox signatures cannot create production credits. Real TestFlight Sandbox accounting still requires reviewed F02/F04 environment-isolation adaptation.
- S02 already requires bootstrap/project/version/history reads, project name/cover/favorite mutations and draft-revision CAS. The current frozen cards do not assign their backend/client implementation sufficiently; do not fake durable save in UI or hide new SQL under F32 thin wiring. Approve an explicit scope/budget assignment preserving the existing architecture before those UI tasks.
- F18 remains dependency-blocked by F17. Preliminary Capacitor template evidence predicts27+ files over its20-file cap, requiring reviewed count/split if confirmed; no generated native shell is in this branch. Full Xcode/real iPhone is absent. No borrowed dirty native files, generated ZIP hiding or assertion removal is permitted.
- Before F32 creates v2-full.spec.ts, revisit F38/config separation: the current component matcher includes v2-* while full-app tests need the assembled Express/Vite app. F32 must run the actual full app, never certify it from a component harness.

## Owner and independent review gates

- Review the proposed F12/F23 budget/split, existing S02 endpoint assignments, later F18 file cap and separate Sharp maintenance scope. No frozen task, manifest or product feature was amended here.
- Arrange actual independent review for migrations/restore, task-wallet-worker/idempotency/trial, identity/upgrades, Apple purchase/refund, deletion/privacy and final F32/F33 integration. Issue#2 remains open; independentReviewer=null. Owner-managed main protection is still absent; executor did not alter it.
- Provide Apple Developer/App Store/Sign in with Apple/StoreKit configuration privately and an actual iPhone/Xcode environment; then perform real Sandbox purchase/restore/refund/order/device tests. Do not put keys, transactions or filled owner facts in the public repository.
- Supply approved entity/contact/processor/storage/retention/backup-deletion facts and licensed imagery. The30-photo evaluation registry remains empty; real quality/cost results and any live-model test budget require separate authorization. No paid calls are implied by credentials.
- TestFlight still needs photo/editor/results/garage, native bridges/login, purchases/refunds/deletion/cache, policy/quality tasks, F32 wiring and independent integration/release review. Commercial charging additionally needs real financial flows, quality/economics and owner release approvals. Synthetic proofs do not clear these gates.

## Resume without losing work

Use the existing implementation branch and Draft PR; never reset/rebase/force-push or overwrite newer shared files. Read FORM_CODEX_START.md and current task card first. After approved scope revisions, continue F12 by reviewing the preserved candidate against current photo-helper/harness files (F15 has extended the same harness), then F13→F14 and eligible dependents. F23 is the separate purchase-chain unblocker after its reviewed amendment; F25/F26 remain blocked until it is CODE_READY.
At later runtime integration, call F10 recovery.markInterrupted() once on writable startup, then bounded runQueuedBatch()/reconciliation on ticks; stop new ticks and finish in-flight settlement before DB close. Do not add a duplicate SQL pump or resend uncertain attempts.
Final source/evidence commits, exact raw logs and hashes, both blocked candidates, synthetic screenshots, reproduction scripts, original-workspace inventory and a verified Git bundle are preserved in the local FORM_AUTONOMOUS_EVIDENCE_20261014_nrz932j9 directory/ZIP. The artifact manifest records the final HEAD and CI run. [Original F00 baseline](F00.md) stays historical/read-only.

Suggested reproduction on the existing Node24 checkout:

```sh
npm ci
npm test
node tools/check-v2.mjs
npm run build
npm run test:e2e -- 'tests/e2e/(?!v2-).*\.spec\.ts'
npx --no-install playwright test --config=playwright.v2.config.ts
python3 docs/form-handoff/tools/guard.py verify-manifest --repo . --manifest docs/form-handoff/MANIFEST.json
python3 docs/form-handoff/tools/guard.py validate
```

For local Mac browser commands set FORM_TEST_CHROMIUM to an already-installed executable. No install/security bypass or real provider/account is needed for these synthetic checks. Keep external gates NOT_RUN until actual evidence exists.
