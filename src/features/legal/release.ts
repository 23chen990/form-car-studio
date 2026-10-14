import register from '../../../docs/form-v2/asset-register.json';
export interface LegalFacts {
  publisherEntity: string | null; ownerApproved: boolean;
  legalReviewReference: string | null; dataMapReference: string | null; retentionReference: string | null; processorReference: string | null;
  publicPrivacyUrl: string | null; publicTermsUrl: string | null; publicSupportUrl: string | null;
}
export interface AssetRecord { id: string; role: 'before' | 'after' | 'icon'; productionApproved: boolean; commercialUse: boolean; sha256: string; licenseEvidenceReference: string }
export interface AssetRegister { schemaVersion: 1; productionApproved: boolean; assets: readonly AssetRecord[] }
export const defaultAssetRegister: AssetRegister = Object.freeze({ schemaVersion: 1, productionApproved: register.productionApproved, assets: Object.freeze([...register.assets]) });
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
function publicURL(value: unknown): value is string {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !/^(?:localhost|example\.(?:com|org|net))$|\.(?:invalid|example|localhost)$/.test(url.hostname);
  } catch { return false; }
}
/** Structural presentation gate, never proof of copyright, legal review or Owner authorization. */
export function legalReleasePacket(facts: LegalFacts | null, assets: AssetRegister = defaultAssetRegister) {
  const blockers: string[] = [];
  if (!facts || !text(facts.publisherEntity) || facts.ownerApproved !== true) blockers.push('OPERATOR_APPROVAL_MISSING');
  if (!facts || [facts.legalReviewReference,facts.dataMapReference,facts.retentionReference,facts.processorReference].some(value => !text(value))) blockers.push('POLICY_DATA_FACTS_MISSING');
  if (!facts || ![facts.publicPrivacyUrl,facts.publicTermsUrl,facts.publicSupportUrl].every(publicURL)) blockers.push('PUBLIC_POLICY_URLS_MISSING');
  const validAssets = assets && assets.schemaVersion === 1 && assets.productionApproved === true && Array.isArray(assets.assets) &&
    new Set(assets.assets.map(asset => asset.id)).size === assets.assets.length && ['before','after','icon'].every(role => assets.assets.some(asset => asset.role === role)) &&
    assets.assets.every(asset => text(asset.id) && ['before','after','icon'].includes(asset.role) && asset.productionApproved === true && asset.commercialUse === true && /^[a-f0-9]{64}$/.test(asset.sha256) && text(asset.licenseEvidenceReference));
  if (!validAssets) blockers.push('LICENSED_PRODUCTION_ASSETS_MISSING');
  return Object.freeze({ ready: blockers.length === 0, blockers: Object.freeze(blockers), links: blockers.length ? null : Object.freeze({
    privacy: facts!.publicPrivacyUrl!, terms: facts!.publicTermsUrl!, support: facts!.publicSupportUrl!,
  }) });
}
export function assertSupportedCopy(copy: string) {
  if (!text(copy) || /®|\b4k\b|\ball cars\b|no data (?:collected|collection)|on.device ai|exact fitment|unlimited free/i.test(copy)) throw Error('UNSUPPORTED_RELEASE_CLAIM');
}
