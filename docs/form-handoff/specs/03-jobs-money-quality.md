# S03: jobs, credits, supplier cost, quality and trial

## Three independent records

A user task is a logical confirmed action, a supplier attempt is a possibly billable network call, and a version is one accepted delivered image. Do not use one count for all three. A task has <=1 official version; an attempt count is not necessarily a user charge. Initial policy allows one upstream attempt, no hidden automatic rescue generation. Future bounded retries require separate specification and budget.

States: queued -> processing -> succeeded/failed; processing after process loss -> uncertain -> failed after a bounded reconciliation window if no safe supported reconciliation is possible. Queued -> cancelled is allowed. Terminal states never transition back. A late provider output for failed/cancelled/deleted task is discarded, no image/version/settlement. A late persisted local success recovered from an atomic transaction is read as existing success, not generated again.

The reference task-policy module is V2-only and describes decisions, not durable scheduling. A DB compare-and-swap claim, transaction boundaries and worker cancellation/deletion checks must be implemented in F09/F10. Single active per actor is enforced transactionally. Every async completion reloads task/user/project tombstones; it never commits a stale full session object. A lease expiry does not authorize a second upstream call with an unknown first result.

## Acceptance transaction

Before accepting a task, validate owner/source/consent/capabilities, quote and storage room; find an existing owner-scoped submission first. In one transaction insert task and submission, reserve exact user-credit lot allocations, reserve a conservative worst-case supplier-cost exposure and append ledger events. Either all succeed or none. No network call until transaction commit. At claim record attempt+provider profile and start timestamp before sending exactly once.

If shutdown occurs between persisting attempt and actual send, the call status is uncertain, not known free. Record this ambiguity and bound new spend. The HTTP request timeout does not prove supplier cancellation. No fallback provider is selected on timeout. A supplier profile without a defensible cost upper bound cannot enable live mode.

## Completion transaction

Validate output safely; classify known errors and exact unchanged pixels; apply approved quality gate if one exists. In one transaction reload authorization/tombstones and task state, store master/display assets, create version once, settle original reserved user credits once, mark task succeeded and append events. If decoding/storage fails before atomic commit, no orphan result or credit settlement. Cleanup temp assets; release user reservation once. Supplier expense is still recorded from its own attempt.

Exact unchanged output: compare normalized oriented sRGB RGBA dimensions and SHA256 under a recorded normalizerVersion. PNG file bytes and perceptual similarity thresholds are not exact equality. Return OUTPUT_UNCHANGED, release reservation, keep input unchanged. A valid image that is not assessed is `unassessed`, not `qualityPassed=true`. Published capabilities require prior quality evidence, but individual production results need not falsely claim a human assessment.

## Credit ledger and purchase lots

All units integer, bounded safe range. Purchased and promotional balance shown separately and combined for spendable total; reserved not spendable. Allocate promo first, then purchased, deterministic oldest-lot order within bucket. Persist allocation per task and per originating grant/purchase so release restores the same source. Never grant a fresh trial on failure. Reservation reserve/settle/release has unique task constraints and append-only event keys. Prebuilt credit-reservations is a trusted-event reference; it does not implement purchase-lot DB transactions, refunds, concurrency or authorization.

Paid transaction uniqueness is global within environment, not merely per user. A refund revokes unused units from its own purchase lot; never arbitrarily subtract another purchased pack. Queued allocations on a revoked lot are cancelled/reconciled; processing jobs cannot be called back, so finalize against recorded lot policy. A failure after a lot was revoked must not revive spendable refunded units. Already consumed refunded units are recorded as refund loss/risk for manual review, not an invented negative financial debt or silent seizure of unrelated credits. Cross-order notification tests are mandatory. Existing works remain available unless actual legal/security reasons require action.

## Supplier money ledger

Each attempt records task/root ID, configuration/version, provider request ID if available, start/end, error category, declared output, actual dimensions, usage nullable, estimated cost nullable, reconciled cost nullable, estimate basis and outstanding worst-case exposure. All costs use a named currency and integer representation. A user-credit release does not release an unknown upstream liability. Overall budget check includes settled expense plus unresolved reserved exposure. No raw API response, secret or photo is sent to analytics.

Initial authorized external spend0. Live test budget is an owner-approved amount, time window, model/profile, max calls and max cost per call. Both total-spend and concurrency circuit breakers are required; application and provider-side limits supplement each other. An exceeded cost estimate stops new tasks and raises an operator case, it does not increase user charge. An emergency generation pause must leave viewing/export and wallet history available.

## Quality feedback and compensation

Categories: identity_changed, target_not_applied, unwanted_structure, image_artifacts, preference_only, slow_or_failed. No-effective-change feedback is a case, not proof. Save a bounded optional description; do not send it into a new model request without confirmation. Review record includes actor, task/version, category, decision, evidence reference and policyVersion. Client cannot approve itself.

Before-delivery confirmed technical/quality rejection => fail + exact reservation release, no extra promotional grant. Already succeeded task remains succeeded; an approved compensation creates a separate promotional grant for the frozen original cost. At most one compensation benefit per root task across policy versions, enforced by DB uniqueness inside the grant transaction. prebuilt planCompensation is a calculation only. Check account/project/transaction validity and prior refunds; no automatic duplicate compensation after a monetary refund, no unlimited remedial chain. Subjective preference is a new voluntary edit, not automatic reimbursement. The server never calls Apple compensation a refund unless Apple actually refunded payment.

## Trial policy

Disabled by default. Proposed experiment uses at most1 qualifying generation per stable account under a lifetime first-trial program; count and economics require a separate signed approval. This is not the competitor's two-free claim. Eligibility and cost exposure reservation are one atomic operation; concurrent requests, reinstall, cookie reset, campaign change and account merge cannot grant again. Multiple new Apple accounts remain a potential abuse path: stable identity is not complete anti-abuse, so enforce global budget/rate caps and monitor without prohibited fingerprinting.

Success uses the trial unit. Technical failure returns that same allocation; it does not reset trial eligibility or grant an additional bundle. Before provisioning public marketing, confirm live eligibility and budget; use 'Check trial availability' when eligibility is genuinely conditional. Avoid displaying a promised free result and imposing an undisclosed purchase after user has uploaded/waited. Existing granted legitimate credits are not expired when a campaign budget closes.

## Operational cases that must be tested together

Lost submit response + refresh; worker killed before/after upstream send; duplicated completion callback; late output after failure/cancel/deletion; SQLite write failure; concurrent task/merge/refund; provider403/429/5xx/timeout; exact unchanged output; report spam; compensation race across policy versions; refund-before-purchase; unknown supplier cost; config/profile changed after quote; storage quota reached. Every case has separate expected user balance, supplier exposure, version count and UI state.
