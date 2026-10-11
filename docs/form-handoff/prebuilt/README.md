# Tested pure reference logic, not the delivered app

Six TypeScript modules are provided: edit contract/canonical digest, deterministic provider prompt, task transitions, credit-reservation reference, launch/trial policy and output-quality/compensation policy. Tests run with a locally available TypeScript compiler and Node; no network, provider, SQLite, Apple purchase or deployment is performed.

From repository/package root:

```sh
node docs/form-handoff/prebuilt/tools/check.mjs
```

The runner compiles to a temporary directory, copies Node test files there, runs them and deletes only that temporary output. It does not install anything. Set FORM_TSC_BIN to an existing compiler only when necessary. Source code is real and tested; it is not wired into the original app. F01's dry-run/add-only installer copies these modules to shared/v2 and tests to tests/v2. It checks the branch, origin, clean state and absent targets before any write. Run `node docs/form-handoff/prebuilt/tools/install-reference.mjs`, inspect the eleven paths, then run with `--write`. An equivalent patch and full raw test logs are included in the downloadable archive; they are optional, not required by the self-contained GitHub instructions. After dependencies are installed, run node tools/check-v2.mjs in the application.

No schema migration, receipt verification, image decoder, worker lease or budget transaction is implemented by these pure functions. The task cards/specs define their required integration and tests. Quality code only consumes server-trusted assessments and canonical pixel hashes; it does not see images or detect car identity. Unknown quality stays unassessed. Credit reducer does not perform financial refunds or independently authenticate grants. Trial eligibility is pending an atomic reservation, not approval to spend.

Read evidence/VALIDATION.md for actual test counts/environments. Do not reuse numbers from earlier draft roadmap text. Unit pass counts do not establish product quality or release eligibility.
