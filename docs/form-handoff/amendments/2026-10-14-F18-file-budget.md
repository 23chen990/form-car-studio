# Owner-approved F18 file budget — 2026-10-14

Authorization: the FORM Owner explicitly approved in this chat: “现批准 F18 的文件上限按实际必要范围最多从 20 调整至 27”; maxLines=2500 remains unchanged.

Read-only preflight measured the preserved Capacitor8.5.3 SPM reference:20 nonignored native files,678 text lines,234341 template PNG bytes. The additive exact-pinned package/lock delta is1037 lines; measured baseline total1715. Reserve650 lines for shell policy, registration, checks and cumulative reports: prospective2365 <=2500. This projection is not a native build pass. Existing dependency versions/integrities stay unchanged (tslib2.8.1 only loses its devOptional marker when required by Capacitor).

The original27-path plan counted20 native files, config, two packages, platform module, test and two reports. Omit only duplicate CapApp-SPM/README.md (provenance goes in F18 report) and generated IDEWorkspaceChecks.plist (IDE metadata recreated by Xcode), then add one shared FORMPluginRegistry.swift containing the custom bridge subclass. Complete prospective scope:26 paths. Keep every referenced source, storyboard, asset catalog, template PNG and test. No file is removed from either existing worktree.

Only F18.maxFiles changes20→26. All39 IDs, dependencies, allowlists, maxLines, binary budget, acceptance and safety rules are identical. Guard source/tests stay unchanged. Only the tasks/tasks.json entry changes in the43-file manifest.

Old task-config SHA-256: `40a0ad5af7c290fcce8d075ab94325a26298c09b77ec1e37285935d627dee66b`.
New task-config SHA-256: `d475cb1009fef48bd278077ca894dc788cd3c0b6258fe01b737d0c019680739f`.

Preserve original dirty detached3168cac checkout privately with file hashes; continue on clean codex/form-v2-implementation at758477e. Its legacy CORS/API/UI changes are outside F18 scope. Native bundle ID is an explicit non-shippable placeholder; signing/team/API facts remain absent. Create new checkpoint after amendment commit; never overwrite old checkpoints.

This is Owner-authorized budget review, NOT_INDEPENDENT. No auth/payment/privacy gate, S05 redesign, F32 wiring, main change, merge, production migration, deployment, paid call, purchase or release is approved. Xcode/simulator/iPhone/Apple checks remain NOT_RUN when unavailable. Record actual final guard size and tests in F18.json.

Actual verification: manifest43/43, DAG39/39, guard42 synthetic tests, diff whitespace and semantic-only amendment PASS (exit0).
- `python3 docs/form-handoff/tools/guard.py verify-manifest --repo . --manifest docs/form-handoff/MANIFEST.json` exit0; log SHA-256 `323bf43aa407389e1f21b00e69095f4a862a2b634a0a24a1d5d65379db01d37c`.
- `python3 docs/form-handoff/tools/guard.py validate` exit0; log SHA-256 `b7885ff3d62353a5117a975faef87b58de1b0eb533e98cf3d2dc72d8b9e1747f`.
- `python3 -m unittest discover -s docs/form-handoff/tools -p test_guard.py` exit0; log SHA-256 `84f730c1a22376069d455782c64c28962271039f9b71f92c080f5c266ca210c0`.
- `git diff --check` exit0; log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
