/**
 * FORM V2.2 UI intent reference oracle.
 * RESEARCH-ONLY: no React, network, model, wallet, storage, ownership resolution,
 * or production imports. This is NOT an implementation of server validation.
 * Pin: shared/v2/edit-plan.ts @ PR#3 2cef4a2, S01, S05.
 */
export const STYLE_IDS = Object.freeze(['clean', 'sport', 'dark', 'heritage', 'track', 'rally', 'touring', 'color']);
export const BODY_COLORS = Object.freeze(['white', 'black', 'silver', 'graphite', 'blue', 'green', 'red', 'yellow']);
export const WHEEL_COLORS = Object.freeze(['silver', 'graphite', 'bronze', 'black', 'white']);
export const FIRST_LAUNCH_FIELDS = Object.freeze(['bodyColor', 'wheelColor']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class IntentError extends Error {
  constructor(code) { super(code); this.name = 'IntentError'; this.code = code; }
}
const check = (condition, code) => { if (!condition) throw new IntentError(code); };
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const exact = (v, keys) => plain(v) && Reflect.ownKeys(v).every(k => typeof k === 'string' && keys.includes(k));
const canonicalId = (v) => typeof v === 'string' && SAFE_ID.test(v);

export function assertSource(source) {
  check(plain(source) && ['original', 'version'].includes(source.kind), 'SOURCE_REQUIRED');
  if (source.kind === 'original') check(exact(source, ['kind']), 'INVALID_SOURCE');
  else check(exact(source, ['kind', 'versionId']) && canonicalId(source.versionId), 'INVALID_VERSION_ID');
  return source.kind === 'original' ? { kind: 'original' } : { kind: 'version', versionId: source.versionId };
}

function checkPublishedStyle(styleId, approvedStyleIds) {
  check(STYLE_IDS.includes(styleId), 'STYLE_NOT_IN_FROZEN_CONTRACT');
  // Even a valid historical ID is not proof it is publish-approved today.
  check(Array.isArray(approvedStyleIds) && approvedStyleIds.includes(styleId), 'STYLE_NOT_PUBLISHED');
  return styleId;
}

export function tryCaseOnMyCar({styleId, approvedStyleIds = []}) {
  return {
    schemaVersion: 2,
    source: {kind: 'original'},
    operation: 'explore',
    styleId: checkPublishedStyle(styleId, approvedStyleIds),
    edits: {}
  };
}

export function directSingleDetail({source, field, value, enabledFields = []}) {
  const selected = assertSource(source);
  check(FIRST_LAUNCH_FIELDS.includes(field) && enabledFields.includes(field), 'CAPABILITY_NOT_READY');
  const allowed = field === 'bodyColor' ? BODY_COLORS : WHEEL_COLORS;
  check(allowed.includes(value), 'UNSUPPORTED_VALUE');
  return {schemaVersion: 2, source: selected, operation: 'detail', edits: {[field]: {action: 'set', value}}};
}

export function refineSpecificVersion({versionId, field, value, enabledFields = []}) {
  return directSingleDetail({source: {kind: 'version', versionId}, field, value, enabledFields});
}

export function exploreAnotherFromOriginal({styleId, approvedStyleIds = []}) {
  return tryCaseOnMyCar({styleId, approvedStyleIds});
}

/** No 'explore + arbitrary expert edits' in frozen first-launch quote flow. */
export function assertNoExploreOverrides(request) {
  check(plain(request) && request.operation === 'explore', 'NOT_EXPLORE');
  check(plain(request.edits) && Reflect.ownKeys(request.edits).length === 0, 'EXPLORE_OVERRIDES_UNSUPPORTED');
  return request;
}

/** Transient selection state. The returned reference never represents updated image pixels. */
export function openChoiceSheet(committed) {
  check(plain(committed), 'DRAFT_REQUIRED');
  return {committed: {...committed}, staged: {...committed}};
}
export function chooseInSheet(state, key, value) {
  check(plain(state) && plain(state.committed) && plain(state.staged), 'SHEET_REQUIRED');
  check(['styleId','bodyColor','wheelColor'].includes(key), 'CONTROL_NOT_READY');
  return {...state, staged: {...state.staged, [key]: value}};
}
export function closeChoiceSheet(state) {
  check(plain(state) && plain(state.committed), 'SHEET_REQUIRED');
  return {...state.committed};
}
export function applyChoiceSheet(state) {
  check(plain(state) && plain(state.staged), 'SHEET_REQUIRED');
  return {...state.staged};
}

/** Explicitly avoid converting a selected historic result into 'latest'. */
export function resultNextSource({action, selectedVersionId}) {
  if (action === 'try_another_from_original') return {kind:'original'};
  check(action === 'refine_selected_version', 'UNKNOWN_RESULT_ACTION');
  check(canonicalId(selectedVersionId), 'SELECTED_VERSION_REQUIRED');
  return {kind:'version',versionId:selectedVersionId};
}

/** Check UI data-only snapshot; not an authoritative quote or paid-submit path. */
export function isNoCallAction(action) {
  return ['browse', 'preview_example', 'stage_style', 'stage_color', 'cancel_sheet', 'apply_sheet', 'compare', 'favorite', 'export_static', 'open_history'].includes(action);
}
