# S05: screens, native boundaries and exact interaction copy

## Overall presentation

Reuse the present visual direction. Do not redesign the brand while implementing contracts. English first; no mandatory onboarding carousel, login before browsing, VIN/model/year form, push permission at startup or sign-in wall before demo. Keep the full visible car in image containers. Fit controls to smaller iPhones and large text; support VoiceOver labels, logical focus, sufficient contrast and Reduce Motion. Do not use gesture-only functions.

Discover: one real licensed before/after case, 'Try this look on my car' primary action, optional style detail, 'Change one detail' secondary action. Returning user sees recent own projects and active work before long marketing copy. Eight legacy IDs remain reachable in old history even when not available for new generation. Disabled capabilities cannot be navigated to by stale local view state.

Preview: long press may enlarge a licensed example, with a visible 'View example' alternative. Preview label 'Example' or 'Demo color study' is preserved. No photo upload, plan, credit reserve or provider call. Never replace the selected user result with a stock photo while pretending an edit happened.

Photo: local photo picker preview before transmission. Camera permission only when tapping Camera; limited-library/iCloud states handled. HEIC orientation/conversion is native/decoded rather than a guessed MIME change. Show file safety errors and practical composition advice, not fake car-recognition results. 'Remove selection' only changes local choice; 'Delete from my garage' deletes server data through confirmed flow. Abandoned uploaded assets follow approved TTL and visible retention policy.

Editor: selected original/version is clearly shown; choosing colors changes controls/recipe draft only. Show 'Preview has not been updated yet' and a readable change list. Keep current vs Restore original have distinct semantics; restore hidden when unsupported. Default original direct edit does not force a full style. Undo affects draft; reset does not delete history. Debounce persisted drafts, use revision check, retain failed local draft and explicit retry; do not drop changes on another screen's refresh.

Confirmation: show actual selected base thumbnail, requested changes, what remains protected, one output and exact unit cost. Show approved provider disclosure if needed. No disabled button without reason (missing consent, unsupported photo, no balance, no effective change, offline, active job). Persist submission ID then POST; multiple taps/refresh cannot submit twice. Native toolbar or OS Back respects unsaved-change confirmation without trapping the user.

Task: show real queued/processing/uncertain/terminal states, not fabricated percentages or model-stage names. 'You can leave this screen. Your task will continue.' means server persistence, not guaranteed mobile background execution. Queued-only 'Cancel before processing' action; started state has navigation, no free-cancel promise. App background/termination/foreground recovers same task by stable account+submission. Notification permission not required; completion is available on next open. Production queue estimates only when backed by measured queue data.

Result: image and original/current comparison primary. Optional parent-version comparison and arbitrary same-project two-version comparison, no AI calls. Whole car remains visible. 'Saved to your garage' indicates persistence; 'Add to favorites' is distinct; 'Save to Photos' invokes device action. Show desired recipe and verification status honestly. 'Refine this look' starts from selected version, not latest. A problem report retains output/ledger history.

Garage: user-selected cover, favorites view and clear branches/history. Latest is not automatically favorite. Rename doesn't enter model prompt. Deleting cover chooses a safe surviving cover/original by documented rule, without deleting the rest. Cross-project comparison is not part of V1.

Export: clean image, side-by-side before/after, portrait recipe card. Exact dimensions named only after real asset size known. Contain instead of clipping wheels/bumper; static canvas/export does not call AI. Optional user-requested plate hiding can be a manual overlay tool later, not falsely labelled automatic redaction. Never upload to social networks without user action. Record share_sheet_opened and platform outcome when exposed; don't infer that someone posted on Instagram.

## Native implementation

Capacitor app loads bundled web assets, not an arbitrary remote website. Native network/auth bridge uses approved HTTPS host list, correct API base URL and secure token storage; no wildcard CORS shortcut. Native bridges for photos/camera/share/save, Sign in with Apple and StoreKit. No universal links required for public recipe sharing at V1; do not add an unverified domain entitlement. Handle safe areas, keyboard, modal focus, orientation, memory pressure, iCloud downloads and OS cancellation.

Minimum iOS deployment version is set after checking the selected Capacitor/plugins and Apple requirements. Do not guess it from competitor minimum OS. Xcode/iOS SDK requirements are rechecked before upload; absence of a Mac runner is NOT_RUN, not a reason to fake xcodebuild success. Chromium/WebKit emulation cannot certify a real iPhone purchase or permission.

## Cache isolation

Cache only explicitly fetched display/thumbnail assets, target100MiB LRU per active user, no indefinite master/original caching. Key by ownerId+assetId+contentHash; never a globally reused '/latest.png'. Clear on logout/account change; purge project entries on deletion. Offline may show only already-cached authorized local content while session policy permits it; cannot promise all history offline. If actor is unknown after logout, show no previous private thumbnail. OS protected app storage and appropriate backup exclusion reviewed for cached data.

## Fixed user-facing messages (replace tokens from trusted state)

| Code/context | Copy |
|---|---|
| Original direct path | Change one detail |
| Example | Example - not your car |
| Demo | Demo color study |
| Plan confirmation | Create 1 look - {units} credit |
| Draft selection | Your changes are selected. Generate to update the image. |
| NO_EFFECTIVE_CHANGE | Choose at least one change before generating. |
| queued | Waiting to start. You can leave this screen. |
| processing | Creating your look. You can leave this screen. |
| uncertain | Checking an interrupted request. We will not submit it again automatically. |
| submitted cancellation conflict | This look has already started. You can leave and return later. |
| OUTPUT_UNCHANGED | This request did not produce a changed image. Your credit was returned. |
| technical failure with confirmed release | We could not complete this look. Your credit was returned. |
| payment pending | Your purchase is awaiting confirmation. Please do not buy it again. |
| syncing balance | Syncing your balance with your account. |
| report accepted | Your report was saved. This does not automatically issue a refund. |
| approved quality compensation | We added {units} replacement credit for this result. Your original result remains in history. |
| offline | You are offline. Already downloaded previews may be available. Reconnect to create a new look. |
| purchase storefront unknown | Purchases are not available right now. Retry or contact support. |
| deletion accepted | Deletion has started. New work on this project is blocked. |
| conceptual boundary | AI styling concept. No guarantee of real-world fitment, material color accuracy or road legality. |

Only say 'returned' after durable release, 'saved' after durable save, or 'deleted' after the claimed scope actually finishes. Do not reuse success messages as loading placeholders.

## Marketing copy candidates (not permission to publish)

Name candidate: FORM: AI Car Styling. Subtitle candidate: Try paint, wheels and new looks. Trademark availability unverified: remove registration symbol unless owner supplies applicable registration evidence. Screenshots must come from actual release features and authorized cases; never simulate disabled wheel design, 4K or training. Privacy/terms pages need real entity, recipients and retention, not placeholder links.

## Isolated UI verification before final integration

F12 creates `tests/harness/v2.html`, `src/testing/v2-harness.tsx`, `playwright.v2.config.ts` and `tools/dev-test-v2.mjs`. They mount the new feature components against deterministic synthetic service adapters, using Vite only in dev/test. Later UI tasks extend the same harness; production `index.html`, `src/main.tsx` and server routes stay untouched until F32. No production bundle entry may import the harness, and no real credentials or photo data may be loaded. Pure logic uses Node tests; DOM interactions use the existing Playwright tool. A second DOM test dependency is not required. F32/F33 additionally test the actual assembled application; component-harness passes are not a substitute.

F18 may contain only template-generated icon PNGs with provenance; F31 adds independently authorized production imagery and icons. Scope/size checks do not prove an asset license. Add no competitor images or real user photos to the repository.
