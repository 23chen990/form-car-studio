import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
async function load() {
  assert.ok(existsSync(new URL('../../src/lib/storefront.ts', import.meta.url)), 'storefront policy must exist');
  return import('../../src/lib/storefront.js');
}
function approved(base: any) { return { ...base, approvedMarkets: ['US'], releaseApproved: true, gates: Object.fromEntries(Object.keys(base.gates).map(key => [key,true])) }; }
test('US is only proposed and every sales/release approval starts closed', async () => {
  const { defaultMarketConfig } = await load();
  assert.deepEqual(defaultMarketConfig.proposedInitialMarkets, ['US']); assert.deepEqual(defaultMarketConfig.approvedMarkets, []);
  assert.equal(defaultMarketConfig.releaseApproved, false); assert.ok(Object.values(defaultMarketConfig.gates).every(value => value === false));
});
test('actual StoreKit alpha3 normalizes explicitly without locale/IP guesses', async () => {
  const { normalizeStorefront } = await load();
  for (const [raw, expected] of [['USA','US'],['AUS','AU'],['GBR','GB'],['NZL','NZ'],['CAN','CA'],['DEU','DE'],['FRA','FR']]) assert.equal(normalizeStorefront(raw), expected);
  for (const raw of [null,undefined,'en-US','US','198.51.100.1','WORLD','???']) assert.equal(normalizeStorefront(raw), null);
});
test('proposed US and later English storefronts are never automatically enabled', async () => {
  const { decideStorefront } = await load();
  for (const storefrontCountryCode of ['USA','AUS','GBR','NZL']) {
    const result = decideStorefront({ storefrontCountryCode, authenticated: true });
    assert.equal(result.mayOfferPurchase, false); assert.equal(result.mayStartPaidGeneration, false); assert.equal(result.preserveExistingAccess, true);
  }
});
test('all actual approvals and authentication are required to offer sales', async () => {
  const { defaultMarketConfig, decideStorefront } = await load(); const config = approved(defaultMarketConfig);
  assert.equal(decideStorefront({ storefrontCountryCode: 'USA', authenticated: true, config }).mayOfferPurchase, true);
  assert.equal(decideStorefront({ storefrontCountryCode: 'USA', authenticated: false, config }).mayOfferPurchase, false);
  for (const gate of Object.keys(config.gates)) assert.equal(decideStorefront({ storefrontCountryCode: 'USA', authenticated: true, config: { ...config, gates: { ...config.gates, [gate]: false } } }).mayOfferPurchase, false);
});
test('travelling or unknown storefront cannot delete history or revoke existing credits', async () => {
  const { defaultMarketConfig, decideStorefront } = await load();
  for (const storefrontCountryCode of ['AUS','CAN',null]) {
    const result = decideStorefront({ storefrontCountryCode, authenticated: true, config: approved(defaultMarketConfig) });
    assert.equal(result.mayOfferPurchase, false); assert.equal(result.preserveExistingAccess, true);
  }
});
test('invalid market approvals and missing gate facts fail closed', async () => {
  const { defaultMarketConfig, decideStorefront } = await load();
  for (const config of [{ ...approved(defaultMarketConfig), approvedMarkets: ['WORLD'] }, { ...approved(defaultMarketConfig), gates: {} }]) {
    assert.throws(() => decideStorefront({ storefrontCountryCode: 'USA', authenticated: true, config: config as any }), /INVALID_MARKET_CONFIG/);
  }
  const source = readFileSync(new URL('../../src/lib/storefront.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /navigator\.language|geolocation|Intl\.NumberFormat|\bUSD\b/);
});
