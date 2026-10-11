# FORM: start here (V2.2, 2026-10-11)

Repository: `23chen990/form-car-studio`. Audited application baseline: `3df0b392f4c81364a34d5083dc75284eafbe2eb1`.
This handoff is self-contained. Do not require an unprovided V2/V2.1 ZIP, regenerate the specification, or use an earlier conversation as the authority. V2.2 supersedes conflicting draft handoff instructions; it does not delete the original PRD or historical product data.

## Read in this order

1. Existing repository AGENTS.md, if present; then this file.
2. `docs/form-handoff/DECISIONS.md` and `GITHUB_WORKFLOW.md`.
3. `docs/form-handoff/TASK_ROADMAP.md`; load just the current task using `tools/guard.py show F00`.
4. The specific `specs/` documents named by the task, plus existing affected code/tests.
5. `docs/form-handoff/evidence/VALIDATION.md` to distinguish tested reference logic from unverified application work.

## Work order and autonomy

Use one implementation branch `codex/form-v2-implementation` and one continuously updated Draft PR into main. Commit each task separately with its report. Read main and the handoff branch first; do not overwrite a newer implementation. When the handoff is not merged, branch from its verified final commit and explain the combined diff. Do not make 39 stacked PRs or wait for a separate human merge after every routine step.

Start with F00, then F01. Follow the dependency graph, not numerical order. In particular F35-F38 precede F32. Work on one task at a time. Continue to the next eligible offline task after code checks; missing external credentials/evidence block the relevant live verification and final release, not unrelated safe implementation. A code failure blocks its dependents. Two focused failed repair attempts => record a minimal reproduction; do not expand scope.

Allowed: modify the permitted paths, run local synthetic tests, commit/push this implementation branch, create/update its Draft PR. Forbidden: direct writes to main/master, force-push, merge, deploy, alter branch protection, buy subscriptions, invoke paid AI without separate budget approval, change App Store availability, use production databases or expose secrets. The monthly research automation stays read-only.

## Fixed product boundaries

English iPhone first; React/TypeScript/Vite + Express retained; Node24 application runtime; Capacitor bridge for iOS. US is the first recommended public storefront; AU and GB require separate expansion checks. All release approvals remain pending.

One explicit confirmation => one logical job => at most one official version. Keep originals/history. No generation for browsing, preview, draft selection, undo, comparison, favorite or export. Direct editing of an original is supported by a new contract, not disguised as a full style. Eight old style IDs remain readable.

First commercial version: one-off credit packs only. No subscriptions, ads, video, special training, community, 3D, exact part fitment or arbitrary reference uploads. Trial defaults off, paid generation defaults off, authorized external spend defaults zero. Never claim 4K, recognition, no data collection, on-device AI or exact vehicle fidelity without evidence.

## Finish every task honestly

Report code SHA (not a self-referential SHA), changed files, actual command/exit code, test environment, evidence hashes, unresolved problems, and external verification still required. CODE_READY is not LIVE_VERIFIED or RELEASE_APPROVED. Do not delete or weaken tests to obtain green checks. An agent cannot approve its own security/payment/privacy work as an independent reviewer.

Run the read-only guard before committing. The guard is an accident detector, not a security boundary. Public GitHub may contain only synthetic fixtures, redacted evidence, specifications and code. Never commit real car photos, Apple credentials, complete payment payloads or filled private owner facts.
