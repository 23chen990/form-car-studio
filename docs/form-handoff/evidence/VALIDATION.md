# Actual validation and explicit limits / 2026-10-11

This package is authored reference code, specifications and task control. It is not the assembled FORM application. The original application baseline remains `3df0b392f4c81364a34d5083dc75284eafbe2eb1`.

## Executed here

- `node docs/form-handoff/prebuilt/tools/check.mjs`: TypeScript5.8.3 compilation plus **151 synthetic Node tests passed**, 0 failed/skipped, Node22.16.0. No installation/network/provider/database/purchase. Summary: `run-summary.txt`; full raw TAP is retained in the downloadable archive.
- `python -m unittest -v test_guard` in tools: **42 synthetic tests passed**. Temporary Git repos, scope/budget/config/manifest/release-record checks; no remote mutation. Summary: `run-summary.txt`; full raw log is retained in the downloadable archive.
- `python docs/form-handoff/tools/guard.py validate`: 39 tasks; dependency graph valid; 156 acceptance statements are planned application verification, not executed tests.
- Add-only patch: `git apply --check` and `git apply` in a fresh temporary Git repo; all11 installed files byte-equivalent except the documented test import relocation. Patched runner repeated the same151 reference tests successfully. This is a repeat, **not151 additional distinct tests**. `patch-check.json` records the check; raw repeated TAP and the optional patch are retained in the archive. The add-only installer was also exercised (dry-run, write, replay refusal and the same151 tests); see `installer-check.json`.
- Total distinct executed automated cases: **193** (151+42). This replaces unverified counts in any draft V2.1 notes.

## Not executed / not proven

No full application npm install, original test suite, integration, SQLite migration, browser UI, real image generation, paid competitor usage, iPhone, StoreKit purchase, server transaction verification, independent security review, deployed service or legal review was completed by this package. The original server needs Node24; this environment's Node22 reference test run is not a Node24 server validation.

No30 real photos were acquired; registry entries are empty planned slots. No216/252-call experiment was run or authorized. All owner facts, product IDs, live capabilities, budget and country approvals remain pending/disabled. Tests of evidence formats cannot establish evidence truth, independent identity or release approval.

Pure quality code does not inspect images; it consumes trusted review records/pixel digests. The wallet reference is not a receipt verifier or transactional ledger. The guard is not branch protection and does not inspect every secret pattern. All these integrations remain explicit tasks.

## Reproduce

Use an existing local TypeScript compiler. Run the prebuilt command and Python suite above, then `guard.py validate`. Run the release checker on its unfilled template: it must refuse. Use the add-only installer after F00/F01 and handoff manifest validation, in the implementation branch, never overwriting existing files. The optional archive patch was independently checked for equivalent output. Do not update checksums to hide an unauthorized edit.
