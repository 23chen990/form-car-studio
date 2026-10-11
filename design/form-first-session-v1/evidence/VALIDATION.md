# Validation record — FORM first-session design V1

Date: 2026-10-12. Reference UI and test fixtures only. Author-run verification, NOT an independent security or product acceptance review.

## Actual results

| Check | Command | Actual result |
|---|---|---|
| Standalone artifact | `python3 tools/build_standalone.py /mnt/data/FORM_FIRST_SESSION.html` | Exit 0; inline HTML built from the supplied source |
| Unit suites | `node --test tests/*.test.mjs` | Exit 0; **63 distinct tests passed**, 0 failed |
| UI adapter declarations | `tsc --noEmit --strict --lib ES2023,DOM contracts.d.ts` | Exit 0 |
| Browser scenarios | `FORM_STUDY_HTML=/mnt/data/FORM_FIRST_SESSION.html python3 tests/browser_test.py` | Exit 0; **30 browser cases passed**, 0 failed |
| Runtime/network | Collected by browser suite | No JavaScript errors; no HTTP(S) requests |
| Screens | Captured by browser suite | Eight 390×844 states and one desktop capture; WebP previews and overview derived from these PNGs |

Unit split: 33 prototype-state cases + 30 UI-policy cases = 63, not 151 legacy project tests. Browser split includes 7 viewport variants. Total 93 distinct automated cases across these two kinds. Repeated runs are not added to the total.

## Environment and limitations

Node 22.16.0; TypeScript compiler on PATH; Python 3.13.5; Python Playwright with preinstalled `/usr/bin/chromium`.
The review environment blocks ordinary page navigation. Tests used Playwright `page.set_content` to load the exact inline artifact in memory. No restriction was bypassed. This verifies DOM interactions, rendered layout, dialogs, keyboard focus, example state transitions and no outbound HTTP(S) under the tested scenarios. It does not establish hosted navigation, real page refresh storage, actual app lifecycle, or full production API behavior.

Seven layout sizes: 320×568, 360×740, 375×667, 390×844, 430×932, 844×390, 1440×1100. CSS button target check and reduced-motion check executed. A separate CSS 200% text reflow stress check ran; this is NOT actual iPhone Dynamic Type/VoiceOver certification.

## Explicit NOT_RUN

WebKit; native iPhone; actual native Dynamic Type and VoiceOver; AuthenticationServices; StoreKit purchase/receipt verification; server API integration; real upload/generation/credits/refunds/deletion; real model image quality/latency; participant usability study; production build/deployment/App Store review.

A local selected PNG was synthetic fixture data. It was shown locally and refused simulated generation. No real user's photo, payment information or API credential was used. Illustrative 6.5-second simulator timing has no relationship to model performance. No third-party app was installed, purchased or reverse-engineered.

## Evidence

`unit.tap`: raw unit test TAP.
`browser-results.json`: actual case results and limitations. Any `blob:null/...` identifiers are local synthetic test-image handles, not third-party URLs or personal data.
`01-home` through `08-failure`, `desktop`: actual reference screenshots, included as PNG and WebP in the downloadable archive and reproducible with the supplied browser test. Only the compact overview is committed to GitHub.
`overview.webp`: compact contact sheet derived from the actual captures; the high-resolution overview is provided separately.
`../MANIFEST.json`: integrity of the committed reference files, not proof of correctness or authorization. Generated per-screen captures, the self-contained HTML and the manifest itself are outside that list.

A future developer must rerun these tests on the extracted/reference source, then test the real implementation independently. Do not mark F12–F37 or product release complete merely because this reference passed.
