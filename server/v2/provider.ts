/** F05 offline-reviewed draft. No routes, DB, retries, environment loading or default real model. */
import { createHash } from 'node:crypto';
import { canonicalJson, resolveEdits, type Observations } from '../../shared/v2/edit-plan.js';
import { buildEditPrompt } from '../../shared/v2/provider-prompt.js';
import { profileCapabilities, snapshotProfile, type ProviderProfile } from './provider-profile.js';

export interface ProviderAsset {
  ownerId: string; projectId: string; assetId: string;
  source: { kind: 'original' } | { kind: 'version'; versionId: string };
  mimeType: 'image/png'; sha256: string; bytes: Buffer;
}
export interface ProviderInput {
  ownerId: string; projectId: string; editRequest: unknown;
  primary: ProviderAsset; originalReference?: ProviderAsset;
  /** Trusted server-resolved observations, not requested history or browser assertions. */
  observations?: Observations; signal?: AbortSignal;
}
export interface Usage { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
export type ProviderResult = {
  ok: true; image: Buffer; mimeType: 'image/png'; profileId: string; profileVersion: string;
  model: string; templateVersion: string; promptSha256: string; providerRequestId: string | null;
  usage: Usage | null; actualCostMicrosUSD: null; maxExposureMicrosUSD: number | null;
  attempted: true; quality: 'UNASSESSED';
} | {
  ok: false; error: { code: string; category: 'disabled' | 'input' | 'refusal' | 'upstream' | 'invalid_output' | 'uncertain' | 'aborted'; retryable: false };
  attempted: boolean; providerRequestId: string | null; usage: null;
  actualCostMicrosUSD: null; maxExposureMicrosUSD: number | null;
};
export interface ProviderOptions {
  profile?: unknown; apiKey?: string;
  executionMode?: 'disabled' | 'mock' | 'live';
  /** F09/F10 must check actual owner/consent/quote/budget before authorizing live dispatch. */
  liveDispatchApproved?: boolean;
  transport?: typeof fetch;
}
const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const requestId = (v: string | null) => v && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null;
const png = (v: Buffer) => v.length >= 8 && v.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
const mockEndpoint = 'https://form-v2.mock.invalid/images/edits';
function need(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function exact(v: Record<string, unknown>, allowed: string[]) {
  need(Reflect.ownKeys(v).every(k => typeof k === 'string' && allowed.includes(k)), 'UNSUPPORTED_INPUT');
}
function asset(value: ProviderAsset, input: ProviderInput, p: ProviderProfile) {
  need(plain(value), 'INVALID_ASSET');
  exact(value, ['ownerId','projectId','assetId','source','mimeType','sha256','bytes']);
  need(value.ownerId === input.ownerId && value.projectId === input.projectId && id(value.assetId), 'ASSET_NOT_FOUND');
  need(Buffer.isBuffer(value.bytes) && value.bytes.length > 0 && value.bytes.length <= p.maxInputBytes, 'INVALID_INPUT_BYTES');
  need(value.mimeType === 'image/png' && png(value.bytes), 'INVALID_INPUT_FORMAT');
  need(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && hash(value.bytes) === value.sha256, 'INPUT_DIGEST_MISMATCH');
  need(plain(value.source), 'INVALID_ASSET_SOURCE');
  exact(value.source, value.source.kind === 'original' ? ['kind'] : ['kind','versionId']);
  need(value.source.kind === 'original' || (value.source.kind === 'version' && id(value.source.versionId)), 'INVALID_ASSET_SOURCE');
}
function parseUsage(value: unknown): Usage | null {
  if (!plain(value)) return null;
  const n = (k: string) => Number.isSafeInteger(value[k]) && Number(value[k]) >= 0 ? Number(value[k]) : null;
  const result = { inputTokens: n('input_tokens'), outputTokens: n('output_tokens'), totalTokens: n('total_tokens') };
  return Object.values(result).every(v => v === null) ? null : result;
}
async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new Error('RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  if (signal.aborted) cancel();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > limit) { void reader.cancel().catch(() => {}); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}
function decodeOutput(body: unknown, p: ProviderProfile): Buffer {
  need(plain(body) && Array.isArray(body.data) && body.data.length === 1, 'INVALID_OUTPUT_COUNT');
  const item = body.data[0]; need(plain(item) && typeof item.b64_json === 'string', 'BASE64_OUTPUT_REQUIRED');
  const text = item.b64_json;
  need(text.length > 0 && text.length <= 4 * Math.ceil(p.maxOutputBytes / 3), 'INVALID_OUTPUT_BYTES');
  need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text), 'INVALID_BASE64');
  const bytes = Buffer.from(text, 'base64');
  need(bytes.toString('base64') === text && bytes.length <= p.maxOutputBytes && png(bytes), 'INVALID_OUTPUT_FORMAT');
  // This is only transport validation. F06 must decode pixels/limits before any delivery or settlement.
  return bytes;
}

export function createV2Provider(options: ProviderOptions = {}) {
  let profile: Readonly<ProviderProfile> | null = null;
  try { if (options.profile) profile = snapshotProfile(options.profile); } catch { /* Fail closed, never echo config. */ }
  const mode = options.executionMode ?? 'disabled';
  const key = options.apiKey;
  const live = mode === 'live' && options.liveDispatchApproved === true && profile?.approvedForLive === true;
  const transport = mode === 'mock' ? options.transport : live ? (options.transport ?? globalThis.fetch) : undefined;
  const enabled = !!profile && typeof key === 'string' && key.length > 0 && !/[\r\n]/.test(key) && !!transport && (mode === 'mock' || live);
  // Snapshot everything at construction so later mutable configuration cannot alter a quoted dispatch.
  return async (input: ProviderInput): Promise<ProviderResult> => {
    let attempted = false; let upstreamId: string | null = null;
    const failure = (code: string, category: Extract<ProviderResult,{ok:false}>['error']['category']): ProviderResult => ({
      ok: false, error: { code, category, retryable: false }, attempted, providerRequestId: upstreamId,
      usage: null, actualCostMicrosUSD: null, maxExposureMicrosUSD: attempted ? profile?.maxCostMicrosUSD ?? null : null,
    });
    if (!enabled || !profile || !transport) return failure('PROVIDER_DISABLED', 'disabled');
    let prompt: string; let form: FormData;
    try {
      need(plain(input), 'INVALID_INPUT'); exact(input, ['ownerId','projectId','editRequest','primary','originalReference','observations','signal']);
      need(id(input.ownerId) && id(input.projectId), 'INVALID_OWNER_OR_PROJECT');
      need(input.signal === undefined || input.signal instanceof AbortSignal, 'INVALID_SIGNAL');
      if (input.signal?.aborted) return failure('ABORTED_BEFORE_DISPATCH', 'aborted');
      asset(input.primary, input, profile);
      const cap = profileCapabilities(profile);
      const plan = resolveEdits(input.editRequest, cap, input.observations ?? {});
      need(canonicalJson(plan.request.source) === canonicalJson(input.primary.source), 'SOURCE_MISMATCH');
      const restore = plan.changes.some(change => change.action === 'restore_original');
      if (restore) {
        need(profile.originalReference && input.originalReference, 'ORIGINAL_REFERENCE_REQUIRED');
        asset(input.originalReference, input, profile);
        need(input.originalReference.source.kind === 'original', 'WRONG_REFERENCE_ROLE');
      } else need(input.originalReference === undefined, 'UNREQUESTED_REFERENCE');
      prompt = buildEditPrompt(plan.request, cap, input.observations ?? {});
      form = new FormData();
      form.set('model', profile.model); form.set('prompt', prompt); form.set('n', '1');
      form.set('size', profile.output.size); form.set('quality', profile.output.quality); form.set('output_format', profile.output.format);
      // Positional roles are fixed: first primary, optional second original restoration reference.
      const imageKey = restore ? 'image[]' : 'image';
      form.append(imageKey, new Blob([new Uint8Array(input.primary.bytes)], {type:'image/png'}), 'primary.png');
      if (restore && input.originalReference) form.append(imageKey, new Blob([new Uint8Array(input.originalReference.bytes)], {type:'image/png'}), 'original-reference.png');
    } catch (error) {
      const safeCodes = new Set(['INVALID_INPUT','UNSUPPORTED_INPUT','INVALID_OWNER_OR_PROJECT','INVALID_SIGNAL','INVALID_ASSET','ASSET_NOT_FOUND','INVALID_INPUT_BYTES','INVALID_INPUT_FORMAT','INPUT_DIGEST_MISMATCH','INVALID_ASSET_SOURCE','SOURCE_MISMATCH','ORIGINAL_REFERENCE_REQUIRED','WRONG_REFERENCE_ROLE','UNREQUESTED_REFERENCE','REQUEST_OBJECT_REQUIRED','UNKNOWN_FIELD','UNSUPPORTED_SCHEMA','SOURCE_REQUIRED','INVALID_SOURCE','INVALID_VERSION_ID','INVALID_OPERATION','EXPLORE_REQUIRES_ORIGINAL','INVALID_STYLE','DETAIL_MUST_NOT_APPLY_STYLE','EDITS_REQUIRED','INVALID_EDIT','INVALID_ACTION','UNSUPPORTED_VALUE','CAPABILITY_DISABLED','INVALID_CAPABILITY','INVALID_OBSERVATIONS','INVALID_OBSERVATION','FIELD_NOT_ENABLED','ORIGINAL_REFERENCE_UNSUPPORTED','NO_EFFECTIVE_CHANGE']);
      const code = error instanceof Error && safeCodes.has(error.message) ? error.message : 'INVALID_INPUT';
      return failure(code, 'input');
    }
    const abort = new AbortController();
    let timedOut = false; let clientAborted = false;
    let rejectAbort: (e: Error) => void = () => {};
    const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => { clientAborted = true; abort.abort(); rejectAbort(new Error('CLIENT_ABORT')); };
    input.signal?.addEventListener('abort', onAbort, {once:true});
    // Covers a signal changing between the first input check and listener registration.
    if (input.signal?.aborted) { input.signal.removeEventListener('abort', onAbort); return failure('ABORTED_BEFORE_DISPATCH', 'aborted'); }
    const timer = setTimeout(() => { timedOut = true; abort.abort(); rejectAbort(new Error('TIMEOUT')); }, profile.timeoutMs);
    try {
      attempted = true;
      const work = async (): Promise<ProviderResult> => {
        const response = await transport(mode === 'mock' ? mockEndpoint : profile.endpoint, {
          method:'POST', headers:live ? {Authorization:`Bearer ${key}`} : undefined, body:form,
          signal:abort.signal, redirect:'error',
        });
        upstreamId = requestId(response.headers.get('x-request-id'));
        let body: unknown;
        try { body = await readBounded(response, profile.maxResponseBytes, abort.signal); }
        catch (error) { if (!response.ok) return failure(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR', 'upstream'); throw error; }
        const refusal = plain(body) && plain(body.error) && ['content_policy_violation','moderation_blocked','safety_violations'].includes(String(body.error.code));
        if (refusal) return failure('PROVIDER_REFUSAL', 'refusal');
        if (!response.ok) return failure(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR', 'upstream');
        const image = decodeOutput(body, profile);
        return {ok:true, image, mimeType:'image/png', profileId:profile.id, profileVersion:profile.version,
          model:profile.model, templateVersion:profile.templateVersion, promptSha256:hash(prompt),
          providerRequestId:upstreamId, usage:parseUsage(plain(body) ? body.usage : undefined),
          actualCostMicrosUSD:null, maxExposureMicrosUSD:profile.maxCostMicrosUSD, attempted:true, quality:'UNASSESSED'};
      };
      return await Promise.race([work(), abortPromise]);
    } catch (error) {
      if (timedOut) return failure('PROVIDER_TIMEOUT_UNKNOWN', 'uncertain');
      if (clientAborted) return failure('PROVIDER_ABORT_UNKNOWN', 'uncertain');
      const code = error instanceof Error ? error.message : '';
      const outputCodes = ['RESPONSE_TOO_LARGE','EMPTY_RESPONSE','INVALID_JSON','INVALID_OUTPUT_COUNT','BASE64_OUTPUT_REQUIRED','INVALID_OUTPUT_BYTES','INVALID_BASE64','INVALID_OUTPUT_FORMAT'];
      return outputCodes.includes(code) ? failure(code,'invalid_output') : failure('PROVIDER_TRANSPORT_UNKNOWN','uncertain');
    } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort); }
  };
}
