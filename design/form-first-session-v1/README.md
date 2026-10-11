# FORM first-session design

Start with [00_START_HERE.md](00_START_HERE.md).

This add-only design package includes a runnable mobile reference, six detailed product/development documents, 80 English copy entries, typed adapter contracts, unit/browser tests and an actual screenshot overview. Per-screen PNG captures and the self-contained HTML are included in the accompanying download and can be regenerated from source. It does not modify the active FORM implementation or authorize live purchases, trial credits, uploads, generation or release.

![Eight actual reference UI captures](evidence/overview.webp)

## Quick local preview

From repository root:

```sh
python3 design/form-first-session-v1/tools/build_standalone.py /tmp/FORM_FIRST_SESSION.html
```

Open the generated HTML in a browser. It is self-contained, uses original vector examples and has no network dependency. Reviewer controls are alongside the phone on desktop and below it on mobile. Personal photo selection is local-only and cannot produce a fake result.

## Implementation

Read `02_EXPERIENCE_SPEC.md`, `03_STATE_CONTRACT.md`, `04_IMPLEMENTATION.md`, `05_QA_AND_STUDY.md`.
`prototype/model.mjs` is a simulator, never a production wallet or authorizer.
`prototype/flow-policy.mjs` and `contracts.d.ts` are implementation references requiring verified server/native adapters.
`copy.en.json` is the production-copy candidate source; approved prices, provider identities and policies are still required.

See `evidence/VALIDATION.md` for the exact 63 unit / 30 browser checks and everything NOT_RUN. Paid flow, one-trial hypothesis and returning-user scenarios are separate; trial remains disabled by default.
