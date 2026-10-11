# Recommended storefront sequence

Decision date: 2026-10-11. This is a concentration-of-effort recommendation, not a revenue forecast, legal opinion or approval to publish. Publisher residence, entity, tax status, hosting, actual supplier coverage and budget remain unknown.

## Concrete recommendation

1. Invite-only TestFlight with recruited English-speaking car owners first. Use selected groups for US-oriented vehicle samples; a public App Store listing is not a 100-user closed beta.
2. First public availability: United States only. Learn with one principal storefront, language/copy set, catalog and support process. Do not start broad paid acquisition just because review succeeds.
3. Australia is the next candidate; the United Kingdom follows, but either may remain closed while its own checks are incomplete. Being English-speaking does not make them legally or visually identical to the US.
4. New Zealand may be added after a separate small local check. Canada and EU markets remain later-phase candidates; not rejected as unattractive markets. Germany/France, Japan/Korea, Brazil/Mexico, Gulf markets and other regions need their own language, distribution, support and economics case rather than automatic worldwide release.

US first is NOT a claim that US CPI is low, iOS revenue highest, competition weak, law easiest, or this app will profit there. None of those has been established for FORM. An owner's established audience elsewhere could change this sequence after an explicit planning revision.

## Country-specific work before enabling

US: representative sedans, hatchbacks, SUVs and pickups; different model years, plates and wheel visibility; USD StoreKit display price; US consumer/privacy applicability assessment; publisher/export eligibility, supplier coverage and support. A server in the US is not itself compliance. Do not use copyrighted manufacturer badges as standalone marketing assets.

AU: local vehicle/plate/right-hand-drive samples only where the feature is actually visible; no automatic mirroring; en-AU wording where useful; AUD prices from StoreKit; measured generation/upload/export latency from an Australian connection. Review Australian consumer rights and privacy coverage. Do not publish a blanket no-refund clause or presume all small companies are exempt.

GB: local vehicle/plate samples and en-GB copy; GBP pricing; UK privacy scope, international transfers, any representative/registration and consumer duties reviewed for the actual entity. UK not being in the EU does not remove its own data-protection rules.

CA: review federal/provincial privacy, language/support and Quebec requirements for actual operations. App Store country availability does not offer a simple product decision of 'Canada except Quebec'. Do not claim English-only distribution is automatically illegal; obtain a scoped assessment rather than guessing.

EU: assess trader status/verified public contact, GDPR/consumer obligations and localized support. Apple requires a trader-status declaration even from developers not distributing in the EU; that declaration is not permission for Codex to invent a status or home address. The decision to postpone EU distribution is not a statement that GDPR can never apply to other activity.

## Activation gate (each country separately)

Record responsible owner, exact build and provider configuration, checked date, storefront code, sample coverage, latency measurements, product availability and localized prices, support routing, refund/deletion flow, jurisdiction review, supplier/hosting countries and approval. Internal research target: at least20 relevant authorized images for an expansion check, with overlap disclosed; not a statistical guarantee. Zero unresolved P0/P1 issues; no unauthorized budget exposure; existing user entitlements remain honored during an emergency sales freeze. The owner can revise sample targets in a versioned plan, not quietly mark missing evidence passed.

Use App Store Connect country/region availability plus the corresponding IAP availability. Do not select automatic addition of future storefronts. StoreKit countryCode may be ISO alpha-3 (USA/AUS/GBR); internal market codes are ISO alpha-2 (US/AU/GB). Normalize explicitly. Device language, SIM, IP and GPS are not substitutes for storefront or legal residence. A travelling customer must not lose purchased history because IP changed. Unknown storefront => explain purchase unavailability and retry; retain lawful access to existing material. Sales suspension is not mass credit deletion.

## Sources checked 2026-10-11

[M1] Apple availability: https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store/
[M2] Apple TestFlight: https://developer.apple.com/testflight/
[M3] ICO territorial scope (page notes current guidance is under review): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/who-does-the-uk-gdpr-apply-to/
[M4] ACCC consumer guarantees: https://www.accc.gov.au/consumers/buying-products-and-services/consumer-rights-and-guarantees
[M5] Canada privacy overview: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/02_05_d_15
[M6] Apple DSA trader declaration: https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
[M7] Apple store localizations: https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/

These sources support platform/legal checkpoints, not the commercial ranking. Release-date revalidation is mandatory.
