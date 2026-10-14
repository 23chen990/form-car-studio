/** FORM research-only deterministic Style+Extra+Color prompt composer.
 * DOES NOT authorize capabilities, charge credits, read assets, or invoke models.
 * Current V2 production EditRequest cannot represent these creative extras.
 */
import { createHash } from 'node:crypto';

export const TEMPLATE_VERSION = 'form-sec-v0-research-20261014';

// Original FORM candidate vocabulary. Not copied from competitors' private prompts.
const styles = Object.freeze({
  street: { title: 'Street Tuning', intent: 'A restrained, realistic street-tuning aesthetic with crisp, coherent exterior details.', allowedExtras: ['none', 'widebody', 'spoiler', 'front_lip'] },
  track: { title: 'Track Inspired', intent: 'A restrained, track-inspired aesthetic with functional-looking but non-certified exterior details.', allowedExtras: ['none', 'widebody', 'spoiler', 'front_lip'] },
  touring: { title: 'OEM+ Touring', intent: 'A refined OEM-plus touring aesthetic with premium, subtle exterior refinement.', allowedExtras: ['none', 'spoiler', 'front_lip'] },
});
const extras = Object.freeze({
  none: { title: 'No added part', instruction: '', allowed: [], preserve: ['Keep the existing visible body panels and fitted components unchanged.'] },
  widebody: {
    title: 'Subtle widebody', instruction: 'Add subtle, coherent widened fender contours and wheel-arch extensions that follow the existing body lines; keep all changes confined to the visible fender and arch areas.',
    allowed: ['fender contours', 'wheel arch extensions'],
    preserve: ['Keep the original wheel centers, wheelbase, wheel count, tires and door/window openings.', 'Do not add a spoiler, front lip, light bar or unrelated part.'],
  },
  spoiler: {
    title: 'Subtle rear spoiler', instruction: 'Add one subtle, visually plausible rear spoiler where the source camera angle and visible rear body make it possible. Do not fabricate hidden mounting details.',
    allowed: ['visible rear spoiler'],
    preserve: ['Preserve original fender widths, wheels, door/window openings and body proportions.', 'Do not add a widebody kit, front lip, light bar or unrelated part.'],
  },
  front_lip: {
    title: 'Subtle front lip', instruction: 'Add one subtle, visually coherent lower front-lip extension only on visible front bumper geometry. Respect the perspective of the source photo.',
    allowed: ['visible lower front lip'],
    preserve: ['Preserve the original fender widths, wheels, doors, windows and roofline.', 'Do not add a widebody kit, rear spoiler, light bar or unrelated part.'],
  },
});
const colors = Object.freeze({
  keep: { title: 'Keep existing paint', instruction: 'Keep the existing body paint color and finish unchanged.' },
  matte_black: { title: 'Matte Black', instruction: 'Repaint the visible painted exterior body surfaces matte black, with low-gloss surface response and physically plausible reflections.' },
  metallic_silver: { title: 'Metallic Silver', instruction: 'Repaint the visible painted exterior body surfaces metallic silver, with realistic fine metallic highlights matched to the source illumination.' },
  gloss_red: { title: 'Gloss Red', instruction: 'Repaint the visible painted exterior body surfaces gloss deep red, with coherent glossy reflections that follow the source lighting.' },
});
const tokens = Object.freeze({ styles, extras, colors });

export function getCatalog() {
  return {
    styles: Object.entries(styles).map(([id, item]) => ({ id, title: item.title })),
    extras: Object.entries(extras).map(([id, item]) => ({ id, title: item.title })),
    colors: Object.entries(colors).map(([id, item]) => ({ id, title: item.title })),
  };
}

function insist(ok, code) {
  if (!ok) { const e = new Error(code); e.code = code; throw e; }
}
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const exact = (obj, allowed) => Reflect.ownKeys(obj).every(k => typeof k === 'string' && allowed.includes(k));
const versionId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);

/** trustedPolicy must be set by the server, never taken from an HTTP request. */
export function compose(request, trustedPolicy = {}) {
  insist(plain(trustedPolicy) && exact(trustedPolicy, ['researchCreativeBuildEnabled']), 'POLICY_INVALID');
  insist(trustedPolicy.researchCreativeBuildEnabled === true, 'CREATIVE_BUILD_NOT_APPROVED');
  insist(plain(request) && exact(request, ['source', 'styleId', 'extraId', 'colorId']), 'UNKNOWN_REQUEST_FIELD');
  insist(plain(request.source) && (request.source.kind === 'original' || request.source.kind === 'version'), 'SOURCE_INVALID');
  if (request.source.kind === 'version') {
    insist(exact(request.source, ['kind', 'versionId']) && versionId(request.source.versionId), 'VERSION_INVALID');
  } else insist(exact(request.source, ['kind']), 'SOURCE_INVALID');
  insist(typeof request.styleId === 'string' && Object.hasOwn(styles, request.styleId), 'STYLE_UNKNOWN');
  insist(typeof request.extraId === 'string' && Object.hasOwn(extras, request.extraId), 'EXTRA_UNKNOWN');
  insist(typeof request.colorId === 'string' && Object.hasOwn(colors, request.colorId), 'COLOR_UNKNOWN');
  const style = tokens.styles[request.styleId];
  const extra = tokens.extras[request.extraId];
  const color = tokens.colors[request.colorId];
  insist(style.allowedExtras.includes(request.extraId), 'INCOMPATIBLE_STYLE_EXTRA');
  // No chargeable concept is emitted when the user requests neither an allowed
  // part change nor a paint change. Style names alone are not measured changes.
  insist(request.extraId !== 'none' || request.colorId !== 'keep', 'NO_EFFECTIVE_CHANGE');
  const changes = [style.intent, extra.instruction, color.instruction].filter(Boolean);
  const protections = [
    'Keep the same recognizable vehicle identity, door count, roofline, windows, lights, wheelbase impression, visible badges and license plate layout.',
    'Keep the same camera angle, framing, background, scene illumination direction and ground contact shadows.',
    'Preserve original wheel centers, apparent outside wheel diameter, tire geometry and the visible steering side.',
    ...extra.preserve,
    ...(request.colorId !== 'keep'
      ? ['Do not recolor windows, tires, lights, exposed metal trim, interior or background.']
      : []),
  ];
  const prompt = [
    'SOURCE IMAGE ROLE: The attached primary image is the actual car to edit. Use this exact image as the identity and camera reference.',
    'STYLE DIRECTION: ' + style.intent,
    'ADDITIONAL MODIFICATION: ' + (extra.instruction || 'Do not add any new vehicle parts.'),
    'BODY PAINT: ' + color.instruction,
    'ALLOW ONLY: ' + (extra.allowed.length ? extra.allowed.join('; ') + '; and the explicitly requested body paint treatment.' : 'the explicitly requested paint treatment; no new part geometries.'),
    'PRESERVE: ' + protections.join(' '),
    'OUTPUT: One photorealistic automotive concept of the same car. Keep the complete visible vehicle in frame. Edges, reflections and shadows must match the original photograph. No added people, new scenery, aftermarket brand badges, new text, watermarks or unrequested parts.',
    'DISCLAIMER: Visual concept only; do not imply certified real-world fitment, materials or safety.',
  ].join('\n\n');
  const snapshot = {
    schemaVersion: 'sec-research-v0',
    templateVersion: TEMPLATE_VERSION,
    source: request.source.kind === 'original' ? {kind:'original'} : {kind:'version', versionId:request.source.versionId},
    styleId:request.styleId, extraId:request.extraId, colorId:request.colorId,
    outputCount:1,
  };
  const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return Object.freeze({researchOnly:true, frozenIntent:Object.freeze(snapshot), intentDigest:hash, prompt, estimatedImageCallsIfAuthorized:1, additionalLLMCalls:0, changes});
}
