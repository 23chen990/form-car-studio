/**
 * RESEARCH-ONLY additive request validator for a hypothetical S01 build operation.
 * Does not check owner/consent/assets, quote, charge, send an API request, or call an AI.
 * It MUST NOT be mounted as a production parser before S01/S02/S05 approval.
 */
export const LAB_INTENT_VERSION = 'sec-request-research-20261014';
const safeId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (obj, allowed) => Reflect.ownKeys(obj).every(k => typeof k === 'string' && allowed.includes(k));
const need = (ok, code) => { if (!ok) { const e = new Error(code); e.code = code; throw e; } };

function sourceRef(source) {
  need(plain(source) && (source.kind === 'original' || source.kind === 'version'), 'INVALID_SOURCE');
  if (source.kind === 'original') {
    need(exact(source, ['kind']), 'INVALID_SOURCE');
    return Object.freeze({kind: 'original'});
  }
  need(exact(source, ['kind', 'versionId']) && safeId(source.versionId), 'INVALID_VERSION_SOURCE');
  return Object.freeze({kind:'version', versionId:source.versionId});
}

/**
 * The `trustedCatalog` argument stands in for server-fetched, already-reviewed,
 * owner-independent catalog and capability publication. It is NEVER a user field.
 * This function validates intent syntax and catalog compatibility only.
 */
export function parseSecResearchRequest(request, trustedCatalog) {
  need(plain(request) && exact(request, ['schemaVersion','operation','source','styleId','extraId','colorId']), 'REQUEST_SHAPE_INVALID');
  need(request.schemaVersion === 3 && request.operation === 'build', 'NOT_SEC_BUILD_V3');
  const source = sourceRef(request.source);
  need(plain(trustedCatalog) && trustedCatalog.researchEnabled === true, 'CATALOG_UNAVAILABLE');
  need(safeId(trustedCatalog.catalogVersion) && safeId(trustedCatalog.templateVersion) && safeId(trustedCatalog.capabilityVersion), 'CATALOG_VERSION_INVALID');
  need(plain(trustedCatalog.styles) && plain(trustedCatalog.extras) && plain(trustedCatalog.colors), 'CATALOG_INVALID');
  need(safeId(request.styleId) && Object.hasOwn(trustedCatalog.styles, request.styleId), 'STYLE_NOT_PUBLISHED');
  need(request.extraId === null || (safeId(request.extraId) && Object.hasOwn(trustedCatalog.extras, request.extraId)), 'EXTRA_NOT_PUBLISHED');
  need(safeId(request.colorId) && Object.hasOwn(trustedCatalog.colors, request.colorId), 'COLOR_NOT_PUBLISHED');
  const style = trustedCatalog.styles[request.styleId];
  const extra = request.extraId === null ? null : trustedCatalog.extras[request.extraId];
  const color = trustedCatalog.colors[request.colorId];
  need(plain(style) && Array.isArray(style.allowedExtras) && typeof style.hasStandaloneChange === 'boolean' && style.enabled === true, 'STYLE_DISABLED');
  need(request.extraId === null || (plain(extra) && extra.enabled === true), 'EXTRA_DISABLED');
  need(plain(color) && color.enabled === true && typeof color.isKeep === 'boolean', 'COLOR_DISABLED');
  need(style.allowedExtras.includes(request.extraId), 'COMBINATION_INCOMPATIBLE');
  if (source.kind === 'version') need(trustedCatalog.versionSourceEnabled === true, 'VERSION_SOURCE_NOT_SUPPORTED');
  // A style can be meaningful alone if a future validated style actually changes
  // the photo; existing color-only labels do not prove it. This is catalog policy.
  need(style.hasStandaloneChange || request.extraId !== null || !color.isKeep, 'NO_EFFECTIVE_CHANGE');
  const snapshot = Object.freeze({
    schemaVersion:3,
    operation:'build',
    source,
    styleId:request.styleId,
    extraId:request.extraId,
    colorId:request.colorId,
    catalogVersion:trustedCatalog.catalogVersion,
    templateVersion:trustedCatalog.templateVersion,
    capabilityVersion:trustedCatalog.capabilityVersion,
    outputCount:1,
  });
  return Object.freeze({researchOnly:true, requestedIntent:snapshot});
}
