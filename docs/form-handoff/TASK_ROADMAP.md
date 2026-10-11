# Task roadmap / V2.2

One implementation branch and Draft PR; one task per atomic commit. Dependency code-readiness enables offline work; external verification still blocks release. Read detailed current card with `python docs/form-handoff/tools/guard.py show Fxx`. All tasks are NOT_STARTED at handoff; the references do not complete application tasks.

| Task | Deliverable | Depends on |
|---|---|---|
| F00 | Baseline and recovery inventory | none |
| F01 | Install prewritten pure reference modules | F00 |
| F02 | Additive V2 database schema | F01 |
| F03 | Legacy migration and rollback rehearsal | F02 |
| F04 | Transactional credit lots and allocations | F02 |
| F05 | Structured provider adapter and prompt profile | F01 |
| F06 | Input, master and display asset separation | F02 |
| F07 | Versioned consent and private photo creation | F02, F06 |
| F08 | Owned source resolution and immutable edit quotes | F04, F05, F06, F07 |
| F09 | Idempotent submissions and atomic reservations | F08 |
| F10 | Worker completion, interruption and deletion races | F09 |
| F11 | V2 client API and persistent submit identity | F09 |
| F12 | Local photo preparation and consent UI | F07, F11 |
| F13 | Direct case entry and original single-edit entry | F12 |
| F14 | Explicit draft, restore and confirmation flow | F08, F11, F13 |
| F15 | Truthful wait screen and task recovery | F10, F11 |
| F16 | Result comparison, favorites and feedback entry | F14, F15 |
| F17 | Garage covers, history and honest exports | F16 |
| F18 | Capacitor iOS shell with disabled live bindings | F17 |
| F19 | Native image import, save and share bridges | F18 |
| F20 | Server Apple identity and safe session verification | F02 |
| F21 | Native Apple login and Keychain sessions | F18, F20 |
| F22 | Guest upgrade without duplicated entitlements | F03, F20 |
| F23 | Verified consumable purchases and catalog | F04, F20 |
| F24 | StoreKit purchase, finish and balance recovery | F21, F23 |
| F25 | Apple refund notifications and reconciliation | F23 |
| F26 | Deletion tombstones, sessions and cache lifecycle | F10, F22, F25 |
| F27 | Bounded cost exposure and circuit breakers | F10, F22 |
| F28 | Minimal diagnostics and feedback audit | F17, F27 |
| F29 | Authorized evaluation registry and release quality | F14, F27 |
| F30 | US storefront and product-release configuration | F24, F29 |
| F31 | Licensed assets and truthful policy pages | F19, F26, F30 |
| F32 | Wire isolated modules behind V2 release flag | F03, F15, F20, F22, F25, F27, F28, F31, F35, F36, F37, F38 |
| F33 | Independent integration and security review | F32 |
| F34 | Evidence-complete submission packet, no publish | F33 |
| F35 | No-change result and unique quality compensation | F10, F16, F28 |
| F36 | Closed-by-default trial eligibility and budget | F04, F20, F27 |
| F37 | Zero-generation example preview and owner cache | F15, F17, F19, F26 |
| F38 | Read-only GitHub PR checks | F01 |

Dependencies override numbering: F35, F36, F37 and F38 must precede F32. F00/F01 are first. The old T01-T10 plan is superseded by these small cards. Application acceptance conditions are plans, not reported passes.

This version contains 39 tasks and 156 explicit acceptance conditions.
