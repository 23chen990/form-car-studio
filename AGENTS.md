# FORM repository agent instructions

These instructions apply to any Codex or other coding agent operating in `23chen990/form-car-studio`.

1. **Read `FORM_CODEX_START.md` first**, then the V2.2 decisions, GitHub workflow, task roadmap, current task card, specs, and actual application code. If anything conflicts, report the exact file paths and stop that dependent work. Do not invent missing AGENTS files or external approvals.
2. **Historical archive is read-only context**, not an implementation command. `docs/form-handoff/archive/2026-10-11/v1/Codex_handoff.md` and the archived ZIPs predate V2.2. Never execute an old task series T01–T10 in place of the current F00–F38 task graph; V2.2 supersedes it.
3. Follow the exact task scope and allowlists. Preserve the current Git HEAD and existing user data. Do not erase, reset, clean, force-push, rewrite main/master, merge, deploy, spend money, launch paid model calls, purchase IAPs, fill owner facts, or change App Store availability without separate authorization.
4. Develop only on `codex/form-v2-implementation` and an **unmerged Draft PR**. Verify branch identity and task preconditions. Each task gets a distinct commit and actual test evidence. Do not treat a successful synthetic test as a real model/StoreKit/iPhone pass.
5. **Review gates:** prior to wiring dependent high-risk work, arrange independent verification for migrations, wallet/worker/idempotency, identity, Apple purchase/refund, deletion, and F32 integration. Read `docs/form-handoff/REVIEW_GATES.md` and the open audit issue #2. Continue independent safe offline tasks when external facts are missing; do not silently mark risky gates approved.
6. Never copy real car photos, personal information, credentials, Apple signed transactions, or filled owner-facts files into this public repository. Use only synthetic fixtures and redacted evidence.
7. F32 cannot evade size budgets by weakening tests, skipping migration, or writing out-of-scope files. If the frozen cap is too small, record `BLOCKED_TASK_TOO_BIG` and propose a reviewed spec amendment/split.

**Spec boundary:** the existing V2.2 `docs/form-handoff/MANIFEST.json` covers the original frozen handoff files. Later archive additions are governed by Git content hashes and the archive manifest; they do not grant new product features or spending authority.
