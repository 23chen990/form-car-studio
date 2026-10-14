# Owner-approved F14 line budget — 2026-10-14

Authorization: the FORM Owner replied in this chat, “批准 F14 上限调整至 1000”,
after receiving the full candidate package and measured guard rejection. This
supersedes only the F14 line cap; it grants no UI RFC or additional capability.

| Task | Before | Approved | Measured reason |
|---|---:|---:|---|
| F14 maxLines | 900 | 1000 | 885 source;916 source+current reports;937 cumulative guard lines. |

Only this numeric field changes. All39 task IDs, dependencies, file allowlists,
maxFiles, safety requirements and acceptance conditions remain identical.
F12 stays1200 and F23 stays1100. Guard source/tests remain unchanged. Only the
existing task-config entry changes in the43-file frozen manifest.
Old task-config SHA-256: `a4e23873ae1b6e2a23587f65c332ca4e745be5ece802e2490c1b3a59c5cbf568`.
New task-config SHA-256: `40a0ad5af7c290fcce8d075ab94325a26298c09b77ec1e37285935d627dee66b`.

The complete candidate at `FORM_F14_BLOCKED_20261014_myhrlifv` remains intact:
source patch SHA-256 d0b735a7e72349e755efc3b4211a35017833153e4ff8c4c35c57469d4fb5d760,
tested source tree3e5da28556d3d783590401ba73ae43b30b0f708f. Its unit6/6,
proper-config browser45/45 and build are historical candidate evidence. Restore
those files without rewriting; retest current source before codeReady=true.

Create a fresh clean F14 checkpoint after committing this amendment. Earlier
F14/F25 checkpoints retain their old hashes; none is overwritten. F25 had no
source edits/tests when paused, so its later restart must record that fact.
No task source budget is reset; include the full recovered F14 source+evidence.

Missing S02 runtime bindings, proposed S05 design/staging, actual iPhone,
independent review and F32 integration remain separate gates. Owner approval
here is not independent security/payment review, merge, deployment, production
migration, real purchase, external model call or release authorization.

## Actual amendment verification

- `python3 docs/form-handoff/tools/guard.py verify-manifest --repo . --manifest docs/form-handoff/MANIFEST.json`: exit0; log SHA-256 `323bf43aa407389e1f21b00e69095f4a862a2b634a0a24a1d5d65379db01d37c`.
- `python3 docs/form-handoff/tools/guard.py validate`: exit0; log SHA-256 `b7885ff3d62353a5117a975faef87b58de1b0eb533e98cf3d2dc72d8b9e1747f`.
- `python3 -m unittest -v test_guard`: exit0; log SHA-256 `1a19e170bb6d824dab715c2b8ccb805242c0391d2e7a0774d05dea66001fad7b`.
- Semantic comparison: only F14.maxLines changes;42 other frozen hashes remain identical. Guard42 synthetic cases passed; no review gate is approved.
