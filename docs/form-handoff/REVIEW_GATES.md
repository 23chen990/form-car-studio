# Independent review checkpoints — V2.2 companion guard (2026-10-11)

Purpose: close findings in [GitHub Issue #2](https://github.com/23chen990/form-car-studio/issues/2). This guard does not replace `FORM_CODEX_START.md`, the 39 frozen task definitions or existing acceptance criteria. It requires evidence before claiming critical functionality independently verified.

## Required checkpoints

- **Migration (F02/F03):** old data fixture preservation, idempotent replay, rollback and actual backup restore. No production migration without separate approval.
- **Task, idempotency and ledger (F04/F09/F10/F35/F36):** reserve/settle/release exactly once under concurrency, task cancellation/late completion, no-op detection, no uncontrolled free-trial claims and root-task unique compensation. Unit reducers do not prove DB atomicity.
- **Identity and purchases (F20–F25):** external token verification, signed StoreKit transactions, duplicate notification replay, purchase/restoration/refund ordering, stable owners and traceable credit ledgers. No live item or Apple Sandbox claim based on mocks alone.
- **Deletion/privacy (F07/F21/F22/F26/F37):** consent before uploads where necessary, provider sharing disclosure, race with active workers, backup/retention policy, cache isolation across accounts and verified deletion. Do not guess operator facts.
- **Final integration (F32/F33):** run original and V2 test suites, Node24 app build, browser/real iPhone/StoreKit and model-quality gates where applicable. If the integration exceeds the frozen changed-files/changed-lines cap, require a formally reviewed split; no budget bypass or weakened tests.
- **CI and repository safety (F38):** owner must approve Actions compute/runner costs and enable meaningful protections on main. A prompt rule does not create GitHub branch protection.

## Acceptable evidence and progress

For every gate record: actual code commit, actual command or device, exit/result, synthetic vs real, logs/evidence hash, real independent reviewer identity or `NOT_INDEPENDENT`, and unresolved conditions. `CODE_READY` permits only safe offline next tasks, never implies `INTEGRATION_VERIFIED`, `QUALITY_VERIFIED` or `RELEASE_APPROVED`.

If a blocking review cannot yet be performed, do not claim it passed. Continue only independently safe work, and keep critical dependent wiring disabled. This is a safety review requirement, **not a new release or spending authorization**.
