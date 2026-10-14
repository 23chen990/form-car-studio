# Owner-approved task line budgets — 2026-10-14

Authorization source: the FORM Owner's explicit instruction in this chat on
2026-10-14 (Asia/Shanghai), following the read-only audit of PR #3 at
`2cef4a24960361706db7efa472dc5402da00e90c`.

The Owner explicitly approved: “F12：maxLines 从 900 调整为 1200” and
“F23：maxLines 从 900 调整为 1100”, limited to these line budgets and necessary
audit records. The Owner also authorized recovery of the preserved candidates,
current-source regression tests, and eligible original tasks on the same branch.

| Task | Previous maxLines | Approved maxLines | Reason |
|---|---:|---:|---|
| F12 | 900 | 1200 | Preserved complete candidate 1098 lines plus evidence and reconciliation with the later F15 harness. |
| F23 | 900 | 1100 | Preserved purchase candidate 951 lines plus evidence; real Apple/security gates remain pending. |

Only these two numeric fields change in `tasks/tasks.json`. The 39-card graph,
allowlists, dependencies, acceptance criteria, maxFiles and safety rules remain
identical. `tools/guard.py` and its tests are unchanged. The existing 43-entry
manifest updates only the task-config hash; other frozen hashes remain intact.
Old task-config SHA-256: `4f2725be6b2338da31ca7cb38f0f282511bba9ccf132c9642d765b8cd4287ffa`.
New task-config SHA-256: `a4e23873ae1b6e2a23587f65c332ca4e745be5ece802e2490c1b3a59c5cbf568`.

Resume checkpoints must be newly created after this committed spec revision;
old checkpoints retain their old config hashes and are never overwritten.
The F12 partial foundation does not reset its total budget: evidence must also
account for the complete recovered candidate and F12-specific harness changes.
F15 changes and assertions must be preserved. Archived passes are historical;
code readiness requires actual tests against the new source commit.

This amendment is Owner-authorized, not an independent security review.
S05 and all product capabilities are unchanged. The deep automotive workspace
requires a separate proposed UI RFC. No merge, main write, deployment, production
migration, paid model call, real purchase or release approval is authorized.

## Actual amendment verification

- `python3 docs/form-handoff/tools/guard.py validate` (cwd `.`): exit 0; SHA-256 `b7885ff3d62353a5117a975faef87b58de1b0eb533e98cf3d2dc72d8b9e1747f`.
- `python3 docs/form-handoff/tools/guard.py verify-manifest --repo . --manifest docs/form-handoff/MANIFEST.json` (cwd `.`): exit 0; SHA-256 `323bf43aa407389e1f21b00e69095f4a862a2b634a0a24a1d5d65379db01d37c`.
- `python3 -m unittest -v test_guard` (cwd `docs/form-handoff/tools`): exit 0; SHA-256 `ea9f4f4c7df0f547248fa2da67f761ea8368b38d7d32182295e3aa859a463025`.
- `git diff --check` (cwd `.`): exit 0; SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Guard suite: 42 synthetic cases; no independent/live/device approval.
- A semantic before/after comparison confirms exactly the two approved numeric changes; other task fields and 42 other frozen manifest entries match.
