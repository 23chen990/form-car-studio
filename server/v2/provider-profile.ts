/** F05 draft. Server configuration, never a body supplied by the browser. */
import { FIELDS, canonicalJson, type Capabilities, type Field } from '../../shared/v2/edit-plan.js';

export interface ProviderProfile {
  id: string;
  version: string;
  protocol: 'openai-images-edits';
  endpoint: string;
  model: string;
  templateVersion: string;
  fields: readonly Field[];
  originalReference: boolean;
  approvedForLive: boolean;
  officialEvidence: string;
  qualityEvidence: string | null;
  maxCostMicrosUSD: number | null;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxResponseBytes: number;
  /** Explicitly reviewed request shape; no arbitrary passthrough fields. */
  output: { format: 'png'; size: '1024x1024' | '1536x1024' | '1024x1536'; quality: 'low' | 'medium' | 'high' };
}

export class ProfileError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ProfileError'; }
}
function need(ok: unknown, code = 'INVALID_PROVIDER_PROFILE'): asserts ok {
  if (!ok) throw new ProfileError(code);
}
const keys = ['id', 'version', 'protocol', 'endpoint', 'model', 'templateVersion', 'fields',
  'originalReference', 'approvedForLive', 'officialEvidence', 'qualityEvidence',
  'maxCostMicrosUSD', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'maxResponseBytes', 'output'];
const token = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(v);
const bounded = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

export function snapshotProfile(raw: unknown): Readonly<ProviderProfile> {
  // canonicalJson rejects non-data values, cycles, extra array properties and non-finite numbers.
  canonicalJson(raw);
  need(object(raw));
  need(Object.keys(raw).length === keys.length && Object.keys(raw).every(k => keys.includes(k)));
  for (const k of ['id', 'version', 'model', 'templateVersion']) need(token(raw[k]));
  need(raw.protocol === 'openai-images-edits');
  // Fixed reviewed provider origin; no caller URL, credentials, query, fragment or redirect.
  need(raw.endpoint === 'https://api.openai.com/v1/images/edits', 'UNREVIEWED_ENDPOINT');
  need(typeof raw.originalReference === 'boolean' && typeof raw.approvedForLive === 'boolean');
  need(Array.isArray(raw.fields) && raw.fields.length > 0 && raw.fields.every(f => FIELDS.includes(f)));
  need(new Set(raw.fields).size === raw.fields.length);
  need(typeof raw.officialEvidence === 'string' && /^https:\/\/(developers\.openai\.com|platform\.openai\.com)\//.test(raw.officialEvidence));
  need(raw.qualityEvidence === null || token(raw.qualityEvidence));
  need(raw.maxCostMicrosUSD === null || bounded(raw.maxCostMicrosUSD, 1, 1_000_000_000));
  need(bounded(raw.timeoutMs, 1, 300_000));
  need(bounded(raw.maxInputBytes, 1, 10 * 1024 * 1024));
  need(bounded(raw.maxOutputBytes, 1, 32 * 1024 * 1024));
  need(bounded(raw.maxResponseBytes, 1, 48 * 1024 * 1024));
  need(object(raw.output) && Object.keys(raw.output).sort().join(',') === 'format,quality,size');
  need(raw.output.format === 'png');
  need(['1024x1024', '1536x1024', '1024x1536'].includes(String(raw.output.size)));
  need(['low', 'medium', 'high'].includes(String(raw.output.quality)));
  if (raw.approvedForLive) need(raw.maxCostMicrosUSD !== null && raw.qualityEvidence !== null, 'LIVE_EVIDENCE_REQUIRED');
  const copy = structuredClone(raw) as unknown as ProviderProfile;
  Object.freeze(copy.fields); Object.freeze(copy.output);
  return Object.freeze(copy);
}
export function profileCapabilities(profile: ProviderProfile): Capabilities {
  return { enabled: true, fields: profile.fields, originalReference: profile.originalReference };
}
