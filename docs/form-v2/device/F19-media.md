# F19 native media device acceptance

All device rows are NOT_RUN. Interface tests use synthetic bytes and plugin ports;
Swift parse is not an iOS SDK build. No real photos are committed.

Prepare Xcode26+, iOS15+ simulator and a trusted iPhone, then run
`npm run cap:sync`, `npm run cap:build` and `npm run cap:run`. V2 features remain
unmounted until reviewed F32 wiring. Use a private diagnostic harness or the final
approved integration to invoke the native bridges, with live generation disabled.

| Case | Required observation | Result |
|---|---|---|
| JPEG/PNG selection | Single selection; local preview before consent/upload | NOT_RUN |
| HEIC portrait, rotated and mirrored | Real decode, upright dimensions; no MIME-only rename | NOT_RUN |
| iCloud-only photo | Actual download phase; Cancel resolves cancellation; late callback ignored | NOT_RUN |
| iCloud offline/error | Recoverable error; no upload or substituted photo | NOT_RUN |
| Picker cancel/reopen, repeated taps | No success, no second selector, can retry | NOT_RUN |
| Camera first tap/denial/revocation | Just-in-time video permission; no microphone/GPS permission | NOT_RUN |
| Large >40MP or converted >10MiB | Error before unsafe decode/upload; no silent crop | NOT_RUN |
| Photos denied/add-only access | Save only after explicit action; truthful denial/success | NOT_RUN |
| Master/comparison/recipe save | Compare private actual file hash and dimensions, upright, no reencoding | NOT_RUN |
| Share cancelled/completed/error | Sheet opened distinct from completion; never claim social post | NOT_RUN |
| Share app death/relaunch | Protected excluded-from-backup temporary file removed at next launch | NOT_RUN |
| Logout/deletion during import/share | Discard transient selection/temp files; already exported user Photos copies remain | NOT_RUN |
| Memory pressure/large text/VoiceOver | Recover without stuck modal; accessible OS controls | NOT_RUN |

Record commit, device/OS/Xcode, exact actions, outcome and private evidence hash.
Keep real image bytes, names, license records and device identifiers private.
Official API references: [PHPicker](https://developer.apple.com/documentation/photosui/phpickerviewcontroller),
[Photos authorization](https://developer.apple.com/documentation/photokit/phphotolibrary),
[share completion](https://developer.apple.com/documentation/uikit/uiactivityviewcontroller).
