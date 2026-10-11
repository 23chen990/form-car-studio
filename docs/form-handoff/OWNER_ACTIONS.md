# External decisions that cannot honestly be prefilled

These do not prevent preparing safe code and synthetic tests. They do block the respective live integration or release. Do not repeatedly ask the owner to choose routine UI/architecture; use DECISIONS.md. Do not request secrets in chat or public GitHub.

| Owner input / authorization | Why needed | Safe default until supplied |
|---|---|---|
| Legal publisher/entity and country; tax/banking/agreement completion | App Store and jurisdiction duties depend on actual facts | Unknown, no release |
| Actual Apple team/bundle/application IDs and signing configuration | Device login, purchase verification and archive | Adapters disabled; mock tests only |
| Product IDs, actual price tiers, approved storefronts | StoreKit catalog and financial promises | Proposed5/15 units; no product/price invented |
| Actual provider/model, features, terms, data use and hosting | Correct API/profile/consent, quality and privacy | No real calls |
| Written test budget with call/cost/time limits | Prevent uncontrolled supplier charges | USD0 authorized |
| Authorized photos/cases and permitted use | Real evaluation and marketing rights | Empty registry plus synthetic test pixels |
| Public support/privacy/terms URLs and approved retention | Accurate disclosure and deletion | Unpublishable template; no fake contact |
| Native device/Mac signing environment and QA participant access | Real iPhone/StoreKit/permission/background validation | NOT_RUN |
| Independent review for auth/money/migration/privacy | Lower-capability coding is not proof of safety | NOT_INDEPENDENT |
| Exact release go/no-go and initial countries | Publishing is a business action | All approvedMarkets empty |

The owner may provide non-secret facts by a private appropriate channel and configure secrets in approved server/CI secret storage. Tooling must use secret references, not ask for plaintext in reports. Ordinary GitHub editing permission does not authorize production data changes or purchases.
