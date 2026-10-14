import rawConfig from '../../config/form-markets.json';
const countries = Object.freeze({ USA: 'US', AUS: 'AU', GBR: 'GB', NZL: 'NZ', CAN: 'CA', DEU: 'DE', FRA: 'FR', JPN: 'JP', KOR: 'KR', BRA: 'BR', MEX: 'MX', ARE: 'AE', SAU: 'SA' } as const);
const gateNames = ['nativeVerified','iapVerified','modelQualityVerified','privacyReviewed','entityAgreementsVerified'] as const;
export interface MarketConfig {
  schemaVersion: 1; proposedInitialMarkets: readonly ['US']; approvedMarkets: readonly string[]; releaseApproved: boolean;
  gates: Record<typeof gateNames[number], boolean>;
}
function validate(config: MarketConfig) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.proposedInitialMarkets) || config.proposedInitialMarkets.length !== 1 || config.proposedInitialMarkets[0] !== 'US' || !Array.isArray(config.approvedMarkets) || new Set(config.approvedMarkets).size !== config.approvedMarkets.length || config.approvedMarkets.some(value => !Object.values(countries).includes(value as never)) || typeof config.releaseApproved !== 'boolean' || !config.gates || Object.keys(config.gates).length !== gateNames.length || gateNames.some(name => typeof config.gates[name] !== 'boolean')) throw Error('INVALID_MARKET_CONFIG');
}
export const defaultMarketConfig: MarketConfig = Object.freeze({
  ...rawConfig, schemaVersion: 1, proposedInitialMarkets: Object.freeze(['US'] as const),
  approvedMarkets: Object.freeze([...rawConfig.approvedMarkets]), gates: Object.freeze({ ...rawConfig.gates }),
});
validate(defaultMarketConfig);
/** Input is StoreKit countryCode, never device language, travel IP or residence. */
export function normalizeStorefront(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? countries[value as keyof typeof countries] ?? null : null;
}
export function decideStorefront(input: { storefrontCountryCode: unknown; authenticated: boolean; config?: MarketConfig }) {
  const config = input.config ?? defaultMarketConfig; validate(config);
  const country = normalizeStorefront(input.storefrontCountryCode);
  const reason = !country ? 'unknown_storefront' : !config.approvedMarkets.includes(country) ? 'market_not_approved'
    : !config.releaseApproved || gateNames.some(name => !config.gates[name]) ? 'release_not_verified' : input.authenticated !== true ? 'account_required' : null;
  return Object.freeze({ country, mayOfferPurchase: reason === null, mayStartPaidGeneration: reason === null,
    preserveExistingAccess: true, reason,
  });
}
