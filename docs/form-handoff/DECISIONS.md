# Frozen decisions and scope / V2.2

The latest user request permits a reviewable GitHub implementation. Earlier draft restrictions on all pushes are superseded only for an isolated implementation branch and Draft PR. No permission to merge or spend is implied. Earlier draft references to missing packages and unverified test counts are replaced by this tree and its actual VALIDATION.md.

| ID | Decision | Must not be silently substituted |
|---|---|---|
| D01 | Ordinary car owners; visual styling concepts | Engineering fitment, performance or road legality advice |
| D02 | One result after explicit confirmation | Multi-image bundles or hidden pre-generation |
| D03 | Case-first primary path; direct single-edit secondary path | Mandatory vehicle questionnaire or blank prompt box |
| D04 | Preserve original, selected base and all completed versions | Editing latest version regardless of selection |
| D05 | Preserve means current base; restore original is explicit | Treat last request as proven image appearance |
| D06 | Four visible directions only after quality evidence; all eight legacy IDs retained | Deleting old style records/history |
| D07 | Color and finish separate; generic wheel design behind capability gate | Brand/SKU/wheel diameter accuracy claims |
| D08 | No arbitrary second reference photo at first launch | Silently ignoring unsupported references |
| D09 | Legacy API remains behavior-compatible during migration | Editing old fixtures to conceal a breaking migration |
| D10 | V2 queued jobs may cancel; started jobs continue/recover | Claiming upstream cancellation costs nothing |
| D11 | User credits and supplier financial exposure are different ledgers | Counting timeout/cancel as zero supplier cost |
| D12 | Append-only accounting with idempotent events | Client supplied balances, receipt price or review verdict |
| D13 | Paid credits do not expire; promo terms separately disclosed | Zeroing purchased balance at a month boundary |
| D14 | One-off packs; proposed catalog 5 and 15 units | Inventing real product IDs, prices or subscription entitlements |
| D15 | Stable account for purchase and trial; guests may browse/demo | Device fingerprints/GPS to replace account integrity |
| D16 | Trial disabled, zero units and budget until separately approved | Copying a competitor's two-free or unlimited offer |
| D17 | Six prebuilt TS modules are reference code, not integrated features | Claiming their unit tests verify AI, iPhone or IAP |
| D18 | Server-side asynchronous jobs, bounded worker concurrency | Running a generation job in the app background process |
| D19 | Mobile cache is explicitly limited and owner-scoped | Advertising local inference or guaranteed offline originals |
| D20 | US first; AU then GB candidates; NZ optional; CA/EU later | Automatically enabling all English locales/storefronts |
| D21 | Capacitor native bridges; StoreKit2; Sign in with Apple only initially | Whole application rewrite or new auth vendors by preference |
| D22 | Keep current dependency versions until an isolated need is demonstrated | Installing latest everything or paid managed services without approval |
| D23 | Minimal first-party diagnostics, no advertising/tracking SDK | Copying competitor privacy labels |
| D24 | Deploy one writable application/worker instance initially | Pretending a process-local lock works across multiple workers |
| D25 | Signed owner facts and legal/privacy review are external gates | Fabricated company identity, policy, DPA, keys or approval |
| D26 | One implementation branch/PR, atomic task commits | Force-push, many stacked PRs, or self-merge |

## Evidence precedence

User's explicit authorization > actual current repository instructions > this frozen specification > older research suggestions > competitor statements. Legal/platform constraints remain applicable. If actual code or an external rule conflicts materially, stop that dependent behavior and document the conflict rather than inventing a rule. Research conclusions are hypotheses; do not replace missing usage data with ratings or revenues inferred from reviews.

## Normal defaults that do not need another product question

UI copy uses en-US, normal English sentence case, full-car containment, accessible native controls and a three-quarter photo example. Standard task cost: 1 user credit per accepted logical result; no paid resolution upgrade in V1. Input <=10MiB and <=40MP after actual decode. A standard paid output must meet the supplier profile's explicit minimum dimensions; the profile is missing until assessed. Output hard safety ceiling: 32MiB, 40MP; this is a resource cap, not a quality promise. Client polling starts at 2s, backs off to 5s after 30s, pauses while hidden and refreshes on foreground; max one in-flight poll per task. Server timeout initial target 180s with profile override; uncertain recovery deadline initial target 30s. These are engineering defaults, not promised generation duration.

Cache target 100MiB of thumbnails/display images; LRU, no masters by default. Default new capabilities disabled outside demo. No data-retention duration is silently invented: staged-upload TTL, backup retention and required finance retention need an approved policy before production. Development uses disposable fixtures. Project limit50 retained; add explicit asset/storage quotas before release.
