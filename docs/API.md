# Shared API contract

Types in `shared/types.ts` are canonical. Same-origin JSON requests and JSON responses; errors are `{ error: string }`. A private workspace is identified by an httpOnly, SameSite=Strict `form_session` cookie. Every resource is scoped to that session, including image bytes.

## Routes

| Method / path                | Request                                               | Response / behavior                                                                                                            |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`            | —                                                     | `{ ok: true, mode }`                                                                                                           |
| `GET /api/state`             | —                                                     | `AppState`; creates a session when needed, demo starts with 12 credits, live with 0 unless configured.                         |
| `POST /api/projects`         | `{ name?, source: "sample" \| "upload", imageData? }` | `201 Project`; sample uses the supplied Golf photo.                                                                            |
| `PATCH /api/projects/:id`    | `{ name?, draft?: Draft \| null }`                    | `Project`; rename or update/clear one draft.                                                                                   |
| `DELETE /api/projects/:id`   | —                                                     | `{ ok: true }`; deletes original and version images, blocks while that car has an active task.                                 |
| `PATCH /api/versions/:id`    | `{ favorite?, name? }`                                | `Version`; explicit save is idempotent.                                                                                        |
| `PATCH /api/styles/:id`      | `{ saved: boolean }`                                  | `{ savedStyles: StyleId[] }`; no project, task or credit required.                                                             |
| `POST /api/tasks`            | `GenerateInput`                                       | `202 GenerationTask`, or `200` for an identical existing confirmation.                                                         |
| `GET /api/tasks/:id`         | —                                                     | `GenerationTask`                                                                                                               |
| `POST /api/tasks/:id/cancel` | —                                                     | `GenerationTask`; active tasks become cancelled and release their reservation once. Completed tasks keep their terminal state. |
| `POST /api/tasks/:id/report` | `{ reason: string }`                                  | `201 Report`; records feedback without regeneration or charge.                                                                 |
| `GET /api/images/:id`        | —                                                     | Private PNG, `Cache-Control: no-store`; another owner receives 404.                                                            |

Cross-site mutation requests are rejected. `FORM_WEB_ORIGIN` specifies trusted frontend origins for the development proxy; comma-separated origins are supported. The same API origin is accepted. No wildcard CORS configuration is enabled.

Uploads use a base64 JPEG / PNG / WebP data URL. Maximum decoded file size is 10 MB and maximum image pixel count is 40 million. The server rejects multiple frames, corrects orientation, removes metadata and normalizes to PNG with the long edge at most 2400 px. A session can hold up to 50 cars.

## Styles and edits

`StyleId`: `sport`, `clean`, `dark`, `heritage`, `track`, `rally`, `touring`, `color`.

`Target` has independent `bodyColor` and `wheelColor` fields. `keep` means preserve the actual appearance of the selected base image. Body colors accepted by the API: `keep`, `blue`, `silver`, `green`, `graphite`, `red`. Wheel colors: `keep`, `silver`, `graphite`, `bronze`, `black`; the first UI shows a smaller curated set.

`intent: "explore"` requires `baseVersionId: null` and edits the original photo. `intent: "refine"` requires an existing version of the same project and style; at least one field must be changed. The output's `parentVersionId` is the chosen base version, even when refining a previous branch.

Demo images are deterministic color studies of the supplied sample car. Demo generation on uploaded photographs is rejected before reserving any credit. `Version.verifiedTarget` is available for the deterministic demo; live requests record their requested target without pretending their colors have been visually verified.

## Tasks and internal credit ledger

Statuses are `queued`, `processing`, `uncertain`, `succeeded`, `failed`, `cancelled`. One active task per session. `GenerateInput.idempotencyKey` identifies one explicit confirmation; repeating it with the same payload returns the original task, while reusing it for a different payload returns 409. Retrying a completed failure requires a new confirmation key.

For an explicit retry, send `GenerateInput.retryOfTaskId` with the failed task ID and its original project, style, intent, base version and target. The server requires an owned, confirmed failed task and the identical request snapshot. New tasks return `retryOfTaskId` (null for an independent request); the source failure stays in history. A changed selection is an independent new request, not a retry of the frozen snapshot. Active, uncertain, cancelled and successful tasks cannot be a failure-retry source.

Only validated generation reserves one credit. Browsing, saving, color references, drafts, comparison and export do not create generation tasks or debit credits. Success saves decoded output and a version before settling; failure/cancellation releases the credit once. Cancellation aborts the upstream request where possible and never admits a late result. Upstream providers may still bill work started before cancellation.

SQLite persists sessions, image blobs, projects, versions, tasks, drafts, ledger and reports. Queued tasks resume after restart. Interrupted live processing becomes `uncertain` and releases its reservation after a bounded recovery window (30 seconds by default), without blindly repeating an upstream call. A running provider request has a 180-second default timeout.

live generation requires configured `IMAGE_API_KEY` and `IMAGE_MODEL`. The current adapter sends multipart PNG edits to `IMAGE_BASE_URL/images/edits`, uses AbortSignal, accepts `data[0].b64_json`, validates decoded output, and does not fetch arbitrary returned URLs or automatically retry. No payment or purchase endpoint exists.
