import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
async function load() {
  assert.ok(existsSync(new URL('../../src/features/legal/release.ts', import.meta.url)), 'legal release boundary must exist');
  return import('../../src/features/legal/release.js');
}
// Synthetic contract records only. These are never operator facts or release approval.
const facts = () => ({ publisherEntity: 'SYNTHETIC FIXTURE', ownerApproved: true, legalReviewReference: 'synthetic-review-only', dataMapReference: 'synthetic-map-only', retentionReference: 'synthetic-retention-only', processorReference: 'synthetic-processor-only', publicPrivacyUrl: 'https://fixture-docs.org/privacy', publicTermsUrl: 'https://fixture-docs.org/terms', publicSupportUrl: 'https://fixture-docs.org/support' });
const registry = () => ({ schemaVersion: 1, productionApproved: true, assets: ['before','after','icon'].map(role => ({ id: 'synthetic-' + role, role, productionApproved: true, commercialUse: true, sha256: 'a'.repeat(64), licenseEvidenceReference: 'synthetic-license-only' })) });
test('missing entity/policy/license facts close publication without fake links', async () => {
  const { legalReleasePacket, defaultAssetRegister } = await load();
  const packet = legalReleasePacket(null); assert.equal(packet.ready, false); assert.equal(packet.links, null);
  assert.equal(defaultAssetRegister.productionApproved, false); assert.deepEqual(defaultAssetRegister.assets, []);
});
test('all reviewed policy/data-map references and authorized roles are required', async () => {
  const { legalReleasePacket } = await load();
  for (const field of ['publisherEntity','legalReviewReference','dataMapReference','retentionReference','processorReference']) {
    assert.equal(legalReleasePacket({ ...facts(), [field]: null } as any, registry() as any).ready, false);
  }
  assert.equal(legalReleasePacket(facts(), { ...registry(), assets: registry().assets.slice(0,2) } as any).ready, false);
  assert.equal(legalReleasePacket({ ...facts(), ownerApproved: false }, registry() as any).ready, false);
});
test('actual HTTPS policy URLs are preserved and unsafe/placeholder links are refused', async () => {
  const { legalReleasePacket } = await load();
  const packet = legalReleasePacket(facts(), registry() as any); assert.equal(packet.ready, true); assert.equal(packet.links?.privacy, facts().publicPrivacyUrl);
  for (const publicPrivacyUrl of ['javascript:alert(1)','http://fixture-docs.org','https://name@fixture-docs.org','https://example.com/privacy','https://policy.invalid','']) assert.equal(legalReleasePacket({ ...facts(), publicPrivacyUrl }, registry() as any).ready, false);
});
test('unlicensed/malformed asset evidence never enables production imagery', async () => {
  const { legalReleasePacket } = await load();
  for (const patch of [{ commercialUse: false }, { sha256: null }, { licenseEvidenceReference: null }, { productionApproved: false }]) {
    const assets = registry().assets.map(asset => asset.role === 'before' ? { ...asset, ...patch } : asset);
    assert.equal(legalReleasePacket(facts(), { ...registry(), assets } as any).ready, false);
  }
});
test('unsupported marketing claims fail before publication', async () => {
  const { assertSupportedCopy } = await load();
  for (const copy of ['FORM®','4K outputs','Works on all cars','No data collected','On-device AI','Guaranteed exact fitment','Unlimited free generations']) assert.throws(() => assertSupportedCopy(copy), /UNSUPPORTED_RELEASE_CLAIM/);
  assert.doesNotThrow(() => assertSupportedCopy('Choose a style, an optional detail and a color. Create one look.'));
});
test('unconfigured legal surface renders honest unavailability and no placeholder anchors', async () => {
  await load(); const { LegalLinks } = await import('../../src/features/legal/LegalLinks.js');
  const html = renderToStaticMarkup(createElement(LegalLinks, {})); assert.match(html, /Legal information is not available yet/); assert.doesNotMatch(html, /href=/);
  const copy = readFileSync(new URL('../../docs/form-v2/store-copy.md', import.meta.url), 'utf8'); assert.match(copy, /UNPUBLISHABLE/); assert.doesNotMatch(copy, /®|4K|No data collected|On-device AI|all cars/);
});
