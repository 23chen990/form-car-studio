# FORM | Targeted client trace audit | 2026-10-14

**Independent research only. No production changes, model calls, billing, credentials, source dumps or app assets.**

Based on fixed PR #7 research commit `2b25588cfea868d0f27626d68565bd6f94827061`. Do not merge into PR #3 automatically.

Local follow-up based on PR #8 commit `07ed7aefa5be96ca363edaa5883a4e51671ba2d2`:

- `CLIENT_TRACE_OWNER_SUMMARY_ZH.md`: findings and practical FORM implications from the existing local client artifacts.
- `ACTUAL_LOCAL_TRACE_MATRIX.csv`: version-bound option, state, request and edit-base mappings.
- `MODYFY_LOCAL_CATALOG.csv`: embedded fallback catalog; remote success responses can replace it.
- `WRAPR_LOCAL_OPTIONS.csv`: local modification categories, parameter keys and concrete options.
- `LOCAL_TRACE_EVIDENCE.json`: redacted code locations, data-flow edges and remaining limits.
- `LOCAL_TRACE_INPUTS.json`: input identities and hashes; source artifacts remain private.
- `UNRESOLVED_GATES.md`: unresolved server, runtime and cross-version questions.
- `OFFLINE_VALIDATION.md`: actual commands, tool regressions and verification limits.
- `MODY_COMPOSITION_DETAIL_ZH.md` and `WRAPR_PARAMETERS_DETAIL_ZH.md`: branch-by-branch receivers, event values, exact locations and request edges.

- `01_OWNER_DECISION_ZH.md`: updated plain-language conclusions after auditing 228 redacted evidence rows.
- `02_CODEX_LOCAL_PROMPT_ZH.md`: standalone exact-scope Codex prompt for existing private Mac research material.
- `trace_matrix.json`: source-attributed client trace graph; cross-source hypotheses are **not** proved runtime call edges.
- `observed_modyfy_options.csv`: 24 recorded Style labels and 10 recorded Extra labels, with a separately version-unmatched Extra label from third-party in-app captures.
- `offline_hermes_slicer.py` and `offline_aot_slicer.py`: offline private-file indexers from the prior research artifact, with additional output redaction warning. Never publish their actual scans without manual review.
- `tools/audit_trace.py`: checks evidence IDs/statuses and detects UI/bytecode overclaiming. Pure stdlib; reads existing **redacted public ledger** only.
- `tests/test_audit_trace.py`: independent synthetic unit tests for the audit tool.

Run: `python3 -m unittest discover -v -s tests` from this folder.

With PR #7 JSONL saved locally, run:

```sh
python3 tools/audit_trace.py \
  --ledger ../deep-dive-20261012/09_EVIDENCE_LEDGER.jsonl \
  --matrix trace_matrix.json
```

Pass means the **ledger references and proof labels agree**, not that a car transformation, UI-to-code link, server model, or real result was tested. The existing audit checks `trace_matrix.json` against the historical ledger; new local findings have separate evidence and input indexes above.

All source binaries/HASM/long prompts/internal hosts are private to the original authorized researcher. No third-party source code or image was published here. Current video observations are archived secondary notes, not newly watched recordings. The 252-model-call plan remains **NOT_EXECUTED** and does not authorize cost.
