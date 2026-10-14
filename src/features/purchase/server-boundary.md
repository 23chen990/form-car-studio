# F24 minimum service binding and real acceptance

This is an interface request, not a second backend implementation. F20 native
session and F23 catalog/verification routes are reused, with stable server owner
UUID as the existing appAccountToken. No client owner/product price/units grant.

Bind the already specified authenticated `GET /api/v2/wallet` from frozen S02;
reuse `WalletRepository.summary(ownerId, "live")`, returning `{ownerId, ...summary}`
with `scope`, `spendable`, `totalReserved`, purchased/promo available and reserved.
Derive owner from the validated Bearer session and read one atomic snapshot;
reject deleted/revoked/upgraded actors and caller-supplied owner/scope selection.
Send no-store and never regrant historical purchases. Native maps server
`spendable` to the existing JS `availableUnits` view; no second balance API.
F24 calls this preflight before opening Apple purchase UI and after confirmed
purchase/unfinished replay/Sync balance. A missing or mismatched response closes
purchase preflight; it never fabricates a balance. Assign binding in reviewed
S02/F32 service scope; no server file is changed in F24.

F23 currently returns SANDBOX_CREDITING_DISABLED and its catalog only exposes
production-enabled packs. A real Sandbox acceptance path requires the service
owner to define a segregated development catalog/ledger acknowledgment that
cannot credit production; do not relax Production verification or infer approval
from these synthetic tests. Native requires durable credited/already-credited ack
before finish. Local Xcode transaction signatures cannot be called Apple-server
verification and remain unfinishable through this production adapter.

Bundled FORMPurchase config defaults disabled: enable only with approved actual
environment, product catalog and explicit alpha3 approvedStorefronts after review.
FORMAuth needs approved API/bundle/team configuration. No subscriptions or new
paid capabilities. Native signed JWS stays between StoreKit and HTTPS server;
neither JS bridge nor public logs contain it. Pending markers are protected
Keychain, owner scoped. Unresolved app-death/Ask-to-Buy state blocks repayment;
do not automatically clear it just because unfinished is empty.

All real acceptance rows are NOT_RUN:

- Xcode SDK build and local StoreKit configuration/signature evidence.
- Actual provisioned Apple login, storefront, real localized products/agreements.
- Sandbox buy/cancel/Ask-to-Buy/unfinished replay after app death/lost ack.
- Duplicate updates, refund-before-grant, account switch and ledger synchronization.
- Pending marker after declined/ambiguous Apple sheet; external resolution without repayment.
- Real iPhone VoiceOver/large type and Apple refund-help navigation.

F32 independent identity/payment/refund/deletion review and real signing/service
facts remain gates. No Sandbox or monetary purchase was run or approved here.
