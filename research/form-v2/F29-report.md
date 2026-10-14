# F29 evaluation readiness

Candidate status: local tooling verified; real evaluation `NOT_RUN`.

## Candidate snapshot
- Branch: `codex/form-v2-implementation`; candidate baseline HEAD: `9506aabbfedcf398787fad6e7b8aba9569b35854`.
- Candidate scope snapshot: 6 authorized files, 807 lines; root performs the final guard after commit.
- This note is candidate evidence; final source/evidence pointer: `docs/form-v2/progress/F29.json` (root-owned after commit).
- Registry has 30 planned empty slots: 18 development and 12 heldout; no real photos or rights data are present.
- Three profiles remain unselected; no model, prompt, quality, cost, participant, or authorization result is asserted.
- Dry-run plans 162 development + 54 sequential + 36 heldout outputs = 252; costs and ceilings remain null.
- Heldout rows must match locked candidate/provider/model/profile/prompt/hash; every attempt must start after lock time.
- Overlap is checked only from a complete 30-slot SHA map; supplied status flags are ignored.
- Missing heldout pairs count as unknown; duplicates do not inflate quality yield.
- Cost overruns remain in settled/open liability totals and are flagged with a `PAUSE` recommendation.
- Unsafe integer totals and contradictory `not_exposed` entries fail closed.
- The local CLI compares the supplied first attempt with its attempt-array entry only; it cannot ensure append-only storage, private retention, or tamper resistance.
- A passing quality gate yields `ELIGIBLE_FOR_OWNER_REVIEW`, never automatic publication.

## Candidate verification
- Focused tests: 14/14 passed; `/private/tmp/form-owner-resume-20261014-zb7351_9/F29-review-final-final-tests.log`.
- Test log SHA-256: `d5fa0ba584ac566bf54f930180d098585546ca8da7ce7857db94ce736dab9697`.
- Dry-run exited 0 with zero external or paid calls; `/private/tmp/form-owner-resume-20261014-zb7351_9/F29-review-final-final-cli.log`.
- `node --check tools/evaluate-form.mjs` and `./node_modules/.bin/tsc --noEmit` passed.
- Candidate scope guard passed; it is not code review or external approval.

## Pending external evidence
- Owner-authorized photo set and private rights/consent records.
- Approved provider/profile, per-attempt exposure budget, actual blind human assessments, and overlap run.
- Independent owner review; until then release capability and real quality remain `NOT_ASSESSED`.
