# Proposed S05 UI RFC — FORM V2.1 direction

Status: PROPOSED, awaiting separate Owner approval. Date: 2026-10-14 (Asia/Shanghai).
The Owner accepted the dark automotive workspace as a design direction, while
expressly withholding automatic approval of S05 changes. This document makes no
change to frozen S01/S05, task scopes, capabilities, pricing or release gates.

Reference: local `FORM_V2_1_POLISH_20261014.zip`, especially its offline HTML and
design decision document. Its concepts are research art, without verified
same-car results or production asset rights. No HTML or image is imported here.
The existing light presentation remains the implementation baseline until this
RFC is approved; the component harness remains separate from production entry.

| Existing task | Existing contract to retain | Proposed visual treatment | Interaction/spec decision needing approval |
|---|---|---|---|
| F13 Discover/navigation | Direct try-case to photo, optional detail, original detail-edit path; own recent/favorite context; server capability gates | Full-car hero, less marketing copy, graphite surfaces and restrained lime accents | Final labels/navigation and dark S05 replacement. Three research categories cannot replace D06's quality-gated release menu or its one licensed real case. |
| F14 Editor/confirm | Explicit original/version source; draft-only color controls; undo/reset; revision CAS, failed-save retry; immutable server quote and one explicit submission | Keep selected car visible, use contextual panels and a readable summary | Panel-local staged options; Apply alone updates draft, close/ESC/back discards staging. S01 forbids pre-generation expert overrides of explore presets: Style/Paint/Details must respect explore/detail modes. Proposed `Not generated yet` copy needs reconciliation with S05's frozen messages. |
| F16 Result | Only succeeded task's real owned version is a result; exact selected version for refine; original is explicit; save/favorite/device actions differ | Contained car, comparison primary, quieter metadata | New panel/navigation labels only. Existing source semantics and durable-save rules remain mandatory. Concept references can never appear as generated user results. |
| F17 Garage | Stable project/version IDs, independent favorites, selected older cover, same-project history/comparison, honest owned-asset exports | Image-first collection and clear branches | `My Ideas` rename/information architecture, any changed cover/deletion UX. Prototype per-style session sets cannot implement persisted per-version favorites. |

Pure presentation changes comprise color tokens, type scale, spacing, containment,
control placement and reduced motion. They do not alter bytes of the selected
image, recipe meaning, credits, output count or backend authority. They are still
proposals because S05 currently says to reuse the existing visual direction.

Panel staging changes when autosave happens, so it is an interaction contract,
not merely CSS. Navigation must preserve photo/style intent on picker cancellation,
and warn before losing committed but unsaved draft changes. No CSS paint preview
may imply generation. No open prompt or arbitrary reference upload is proposed.
Body kits, lowered stance, widebody, suspension, lights, branded parts, video and
3D remain outside the approved generation contract. Concept art adds no capability.

## Existing service contracts and unresolved implementation assignment

Reuse F07 photo/consent, F08 immutable quotes, F09/F11 persistent submission,
F15 task recovery, and the existing owner/project/version schema. No second
wallet, draft database, task service or purchase API may be introduced.

S02 already specifies bootstrap/project/history reads, draft-revision CAS,
project cover/name and version favorite/name mutations. The current implementation
does not yet provide these complete service/client bindings; frozen UI allowlists
do not authorize new server files. A synthetic component adapter cannot prove
durable save, owner isolation or a real project read. Any missing binding must be
reported explicitly and its existing-task scope/budget assigned before backend
implementation. F32 cannot silently absorb new repositories/SQL as thin wiring.

## Acceptance if approved

- Test 320/375/390/430px, large text, safe areas, visible focus, 44px minimum
  primary targets and Reduce Motion; real VoiceOver/device checks stay pending.
- Test Apply versus close/ESC/back, cancelled/replaced photo selection,
  interrupted/failed saves and explicit original/older-version source selection.
- Confirmation must display actual quote cost and one output; repeated taps,
  refresh and lost acknowledgment retain the same persisted submission identity.
- Browse, preview, comparison, favorites and export invoke no generation.
- Publish only licensed, same-car quality-verified cases/capabilities. Empty or
  disabled release capabilities remain unavailable, including restored views.
- Production entry stays unchanged until F32 prerequisites and independent review.

Approval requested later: amend S05 presentation and the specifically described
panel staging/navigation copy after reviewing this mapping. Do not infer approval
of missing backend scope, asset rights, AI capability, spending or release.
