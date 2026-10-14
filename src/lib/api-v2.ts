import { canonicalJson, FIELDS, parseEditRequest, STYLES, type EditRequest, type Field, type ResolvedEdit } from '../../shared/v2/edit-plan.js';
import type { SubmissionStore } from './submission-store';
import type { ActorLease, SubmissionLease, SubmissionOperation } from './submission-store';

const ROOT = '/api/v2';
const BODY_LIMIT = 128 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const POLICY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CODE = /^[A-Z0-9_]{1,80}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const TASK_STATUSES = new Set(['queued', 'processing', 'uncertain', 'succeeded', 'failed', 'cancelled']);
const SUBMISSION_OPERATIONS = new Set<SubmissionOperation>(['task', 'trial_claim']);
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SafeTaskDTO {
  id: string; projectId: string; planId: string | null; status: 'queued' | 'processing' | 'uncertain' | 'succeeded' | 'failed' | 'cancelled';
  userCostUnits: number; createdAt: string; updatedAt: string | null; resultVersionId: string | null;
  creditReturned: boolean; safeErrorCode: string | null;
}
export interface ConsentIssueRequest { policyId: string; acknowledgePhotoRights: true; acknowledgeUploadStorage: true; acknowledgeSharing: boolean }
export interface ConsentRecordDTO { consentRecordId: string }
export type ProjectCreateInput = { name: string; file: Blob } | { name: string; demoId: string };
export interface CreatedProjectDTO { projectId: string; originalAssetId: string; displayAssetId: string; sourceKind: 'user_upload' | 'licensed_demo' }
export interface PlanQuoteDTO {
  schemaVersion: 1; planId: string; createdAt: string; expiresAt: string; planDigest: string;
  semantic: PlanQuoteSemanticDTO;
}
export interface PlanSourceDTO {
  kind: 'original' | 'version'; versionId?: string; assetId: string; assetKind: 'original' | 'master';
  persistedSha256: string; rawSha256: string; canonicalSha256: string; pixelSha256: string; bytes: number; width: number; height: number;
  rawGeometry: { width: number; height: number }; canonicalGeometry: { width: number; height: number };
  normalizerVersion: string; sourceFormat: string; sourceOrientation: number | null;
}
export interface PlanRecipeDTO {
  changes: ResolvedEdit[]; preserve: Field[];
  inherited: { styleId: string | null; verification: 'unverified' | 'unknown' | 'none'; requested: ResolvedEdit[]; preserve: Field[] };
}
export interface PlanQuoteSemanticDTO {
  ownerId: string; projectId: string; walletScope: 'live' | 'demo'; executionMode: 'live' | 'licensed_demo';
  source: PlanSourceDTO; requestEdits: EditRequest; desiredRecipe: PlanRecipeDTO;
  observedRecipe: { status: 'unknown'; fields: Record<string, never> };
  userCostUnits: 1; outputCount: 1; supplierExposureMicrosUSD: number;
  [key: string]: unknown;
}
export interface V2HttpErrorFields { status: number; code: string; message: string; retryable: boolean; requestId: string | null }
export class V2HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean, readonly requestId: string | null) {
    super(message); this.name = 'V2HttpError';
  }
}
export class V2NetworkError extends Error {
  readonly uncertain = true;
  constructor() { super('The request outcome is unknown. Retry the same submission.'); this.name = 'V2NetworkError'; }
}
export class V2UncertainResponseError extends Error {
  readonly uncertain = true;
  constructor() { super('The server response could not be verified. Retry the same submission.'); this.name = 'V2UncertainResponseError'; }
}
export class V2ActorChangedError extends Error {
  constructor() { super('The signed-in account changed while this request was running.'); this.name = 'V2ActorChangedError'; }
}

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const validText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const validNullableId = (value: unknown): value is string | null => value === null || (typeof value === 'string' && ID.test(value));
const validHash = (value: unknown): value is string => typeof value === 'string' && DIGEST.test(value);
const validGeometry = (value: unknown): value is { width: number; height: number } => plain(value) && exact(value, ['width', 'height']) && Number.isSafeInteger(value.width) && (value.width as number) > 0 && Number.isSafeInteger(value.height) && (value.height as number) > 0;
function validSource(value: unknown): value is PlanSourceDTO {
  if (!plain(value) || (value.kind !== 'original' && value.kind !== 'version')) return false;
  const keys = ['kind', ...(value.kind === 'version' ? ['versionId'] : []), 'assetId', 'assetKind', 'persistedSha256', 'rawSha256', 'canonicalSha256', 'pixelSha256', 'bytes', 'width', 'height', 'rawGeometry', 'canonicalGeometry', 'normalizerVersion', 'sourceFormat', 'sourceOrientation'];
  return exact(value, keys) && (value.kind !== 'version' || (typeof value.versionId === 'string' && ID.test(value.versionId))) &&
    typeof value.assetId === 'string' && ID.test(value.assetId) && (value.assetKind === 'original' || value.assetKind === 'master') &&
    validHash(value.persistedSha256) && validHash(value.rawSha256) && validHash(value.canonicalSha256) && validHash(value.pixelSha256) &&
    Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0 && Number.isSafeInteger(value.width) && (value.width as number) > 0 &&
    Number.isSafeInteger(value.height) && (value.height as number) > 0 && validGeometry(value.rawGeometry) && validGeometry(value.canonicalGeometry) &&
    validText(value.normalizerVersion) && typeof value.sourceFormat === 'string' && value.sourceFormat.length > 0 && value.sourceFormat.length <= 16 &&
    (value.sourceOrientation === null || Number.isSafeInteger(value.sourceOrientation));
}
function validResolvedEdits(value: unknown): value is ResolvedEdit[] {
  return Array.isArray(value) && value.every(item => {
    if (!plain(item) || (typeof item.field !== 'string') || !(FIELDS as readonly string[]).includes(item.field)) return false;
    if (item.action === 'restore_original') return exact(item, ['field', 'action']);
    return item.action === 'set' && exact(item, ['field', 'action', 'value']) && typeof item.value === 'string' && item.value.length <= 64;
  });
}
function validRecipe(value: unknown): value is PlanRecipeDTO {
  if (!plain(value) || !exact(value, ['changes', 'preserve', 'inherited']) || !validResolvedEdits(value.changes) || !Array.isArray(value.preserve) || !value.preserve.every(field => typeof field === 'string' && (FIELDS as readonly string[]).includes(field)) || !plain(value.inherited)) return false;
  const inherited = value.inherited;
  return exact(inherited, ['styleId', 'verification', 'requested', 'preserve']) && (inherited.styleId === null || (typeof inherited.styleId === 'string' && (STYLES as readonly string[]).includes(inherited.styleId))) &&
    ['unverified', 'unknown', 'none'].includes(String(inherited.verification)) && validResolvedEdits(inherited.requested) && Array.isArray(inherited.preserve) && inherited.preserve.every(field => typeof field === 'string' && (FIELDS as readonly string[]).includes(field));
}
function validTask(value: unknown): value is SafeTaskDTO {
  if (!plain(value) || !exact(value, ['id', 'projectId', 'planId', 'status', 'userCostUnits', 'createdAt', 'updatedAt', 'resultVersionId', 'creditReturned', 'safeErrorCode'])) return false;
  if (value.status === 'succeeded' && (value.resultVersionId === null || value.creditReturned !== false)) return false;
  if (['queued','processing','uncertain','failed','cancelled'].includes(String(value.status)) && value.resultVersionId !== null) return false;
  if (['queued','processing','uncertain'].includes(String(value.status)) && value.creditReturned !== false) return false;
  return typeof value.id === 'string' && ID.test(value.id) && typeof value.projectId === 'string' && ID.test(value.projectId) && validNullableId(value.planId) &&
    typeof value.status === 'string' && TASK_STATUSES.has(value.status) && Number.isSafeInteger(value.userCostUnits) && (value.userCostUnits as number) >= 1 &&
    validDate(value.createdAt) && (value.updatedAt === null || validDate(value.updatedAt)) && validNullableId(value.resultVersionId) && typeof value.creditReturned === 'boolean' &&
    (value.safeErrorCode === null || (typeof value.safeErrorCode === 'string' && CODE.test(value.safeErrorCode)));
}
function validConsent(value: unknown): value is ConsentRecordDTO {
  return plain(value) && exact(value, ['consentRecordId']) && typeof value.consentRecordId === 'string' && ID.test(value.consentRecordId);
}
function validCreatedProject(value: unknown): value is CreatedProjectDTO {
  return plain(value) && exact(value, ['projectId', 'originalAssetId', 'displayAssetId', 'sourceKind']) &&
    typeof value.projectId === 'string' && ID.test(value.projectId) && typeof value.originalAssetId === 'string' && ID.test(value.originalAssetId) &&
    typeof value.displayAssetId === 'string' && ID.test(value.displayAssetId) && (value.sourceKind === 'user_upload' || value.sourceKind === 'licensed_demo');
}
function validQuote(value: unknown): value is PlanQuoteDTO {
  if (!plain(value) || !exact(value, ['schemaVersion', 'planId', 'createdAt', 'expiresAt', 'semantic', 'planDigest']) || value.schemaVersion !== 1 || !plain(value.semantic)) return false;
  const semantic = value.semantic;
  let requestEdits: EditRequest;
  try { requestEdits = parseEditRequest(semantic.requestEdits); }
  catch { return false; }
  const observed = semantic.observedRecipe;
  const sourceMatchesRequest = plain(semantic.source) && semantic.source.kind === requestEdits.source.kind &&
    (semantic.source.kind !== 'version' || (requestEdits.source.kind === 'version' && semantic.source.versionId === requestEdits.source.versionId));
  return typeof value.planId === 'string' && ID.test(value.planId) && validDate(value.createdAt) && validDate(value.expiresAt) && typeof value.planDigest === 'string' && DIGEST.test(value.planDigest) &&
    typeof semantic.ownerId === 'string' && ID.test(semantic.ownerId) && typeof semantic.projectId === 'string' && ID.test(semantic.projectId) &&
    (semantic.walletScope === 'live' || semantic.walletScope === 'demo') && (semantic.executionMode === 'live' || semantic.executionMode === 'licensed_demo') &&
    (semantic.walletScope === 'demo' ? semantic.executionMode === 'licensed_demo' : semantic.executionMode === 'live') &&
    validSource(semantic.source) && sourceMatchesRequest && canonicalJson(requestEdits) === canonicalJson(semantic.requestEdits) && validRecipe(semantic.desiredRecipe) &&
    plain(observed) && exact(observed, ['status', 'fields']) && observed.status === 'unknown' && plain(observed.fields) && Object.keys(observed.fields).length === 0 &&
    semantic.userCostUnits === 1 && semantic.outputCount === 1 && Number.isSafeInteger(semantic.supplierExposureMicrosUSD) && (semantic.supplierExposureMicrosUSD as number) >= 0;
}
function safeErrorMessage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || /https?:\/\/|\b(?:token|api[_ -]?key|bearer)\b/i.test(value)) return 'The request could not be completed.';
  return value || 'The request could not be completed.';
}
function httpError(status: number, payload: unknown): V2HttpError {
  const envelope = plain(payload) ? payload : {};
  const code = typeof envelope.code === 'string' && CODE.test(envelope.code) ? envelope.code : 'HTTP_ERROR';
  const message = safeErrorMessage(envelope.message);
  const retryable = typeof envelope.retryable === 'boolean' ? envelope.retryable : status >= 500;
  const requestId = typeof envelope.requestId === 'string' && ID.test(envelope.requestId) ? envelope.requestId : null;
  return new V2HttpError(status, code, message, retryable, requestId);
}
async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    try { void response.body?.cancel().catch(() => undefined); } catch { /* the response is still rejected */ }
    throw new Error();
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > BODY_LIMIT) { void reader.cancel().catch(() => undefined); throw new Error(); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createV2Api(options: { store: SubmissionStore; fetcher?: Fetcher }) {
  const { store } = options;
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  async function request<T>(path: string, init: RequestInit, validate: (value: unknown) => value is T): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
    let response: Response;
    try { response = await fetcher(path, { ...init, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store' }); }
    catch { throw new V2NetworkError(); }
    let raw = '';
    try { raw = await readBounded(response); }
    catch {
      if (!response.ok) throw httpError(response.status, null);
      throw new V2UncertainResponseError();
    }
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch {
      if (!response.ok) throw httpError(response.status, null);
      throw new V2UncertainResponseError();
    }
    if (!response.ok) throw httpError(response.status, payload);
    if (!validate(payload)) throw new V2UncertainResponseError();
    return payload;
  }
  function assertCurrent(lease: ActorLease) {
    if (!store.isCurrent(lease)) throw new V2ActorChangedError();
  }
  async function withActor<T>(actorId: string, operation: () => Promise<T>): Promise<T> {
    const lease = store.captureActor(actorId);
    try {
      const result = await operation();
      assertCurrent(lease);
      return result;
    } catch (error) {
      if (!store.isCurrent(lease)) throw new V2ActorChangedError();
      throw error;
    }
  }
  function submitLease(lease: SubmissionLease): Promise<SafeTaskDTO> {
    assertCurrent(lease);
    const { planId, submissionId, consentRecordId } = lease.submission;
    const endpoint = lease.submission.operation === 'task' ? `${ROOT}/tasks`
      : lease.submission.operation === 'trial_claim' ? `${ROOT}/trial/claim`
      : null;
    if (endpoint === null) throw new TypeError('Invalid persisted submission operation.');
    return request(endpoint, { method: 'POST', body: JSON.stringify({ planId, submissionId, consentRecordId }) }, validTask).then(task => {
      assertCurrent(lease);
      if (task.planId !== lease.submission.planId || task.projectId !== lease.submission.projectId) throw new V2UncertainResponseError();
      return task;
    }, error => {
      if (!store.isCurrent(lease)) throw new V2ActorChangedError();
      throw error;
    });
  }
  return Object.freeze({
    issueConsent(actorId: string, input: ConsentIssueRequest): Promise<ConsentRecordDTO> {
      if (!input || !POLICY_ID.test(input.policyId) || input.acknowledgePhotoRights !== true || input.acknowledgeUploadStorage !== true || typeof input.acknowledgeSharing !== 'boolean') throw new TypeError('Invalid consent acknowledgments.');
      const body = { policyId: input.policyId, acknowledgePhotoRights: true, acknowledgeUploadStorage: true, acknowledgeSharing: input.acknowledgeSharing };
      return withActor(actorId, () => request(`${ROOT}/consents`, { method: 'POST', body: JSON.stringify(body) }, validConsent));
    },
    createProject(actorId: string, consentRecordId: string, input: ProjectCreateInput): Promise<CreatedProjectDTO> {
      if (!ID.test(consentRecordId) || !plain(input) || typeof input.name !== 'string' || input.name.length > 240) throw new TypeError('Invalid project request.');
      return withActor(actorId, () => {
        const form = new FormData(); form.append('name', input.name);
        if ('file' in input && input.file instanceof Blob && !('demoId' in input)) form.append('file', input.file);
        else if ('demoId' in input && typeof input.demoId === 'string' && input.demoId.length > 0 && input.demoId.length <= 128 && !('file' in input)) form.append('demoId', input.demoId);
        else throw new TypeError('Invalid project source.');
        return request(`${ROOT}/projects`, { method: 'POST', headers: { 'X-Form-Consent-Id': consentRecordId }, body: form }, validCreatedProject);
      });
    },
    quotePlan(actorId: string, projectId: string, consentRecordId: string, requestBody: EditRequest): Promise<PlanQuoteDTO> {
      if (!ID.test(projectId) || !ID.test(consentRecordId)) throw new TypeError('Invalid plan request identity.');
      let canonicalRequest: string;
      try { canonicalRequest = canonicalJson(parseEditRequest(requestBody)); }
      catch { throw new TypeError('Invalid plan request.'); }
      return withActor(actorId, () => request(`${ROOT}/projects/${encodeURIComponent(projectId)}/plans`, {
        method: 'POST', headers: { 'X-Form-Consent-Id': consentRecordId }, body: JSON.stringify(requestBody),
      }, (value): value is PlanQuoteDTO => validQuote(value) && value.semantic.ownerId === actorId && value.semantic.projectId === projectId && canonicalJson(value.semantic.requestEdits) === canonicalRequest));
    },
    async submitConfirmedPlan(actorId: string, quote: PlanQuoteDTO, consentRecordId: string, options: { operation?: SubmissionOperation } = {}): Promise<SafeTaskDTO> {
      if (!plain(options) || Reflect.ownKeys(options).some(key => key !== 'operation')) throw new TypeError('Invalid submission options.');
      const operation = options.operation === undefined ? 'task' : options.operation;
      if (!SUBMISSION_OPERATIONS.has(operation)) throw new TypeError('Invalid submission operation.');
      if (!validQuote(quote) || quote.semantic.ownerId !== actorId) throw new TypeError('Quote is not valid for the active owner.');
      const lease = store.begin(actorId, { planId: quote.planId, projectId: quote.semantic.projectId, expiresAt: quote.expiresAt }, consentRecordId, operation);
      return submitLease(lease);
    },
    async resumeSubmission(actorId: string, submissionId: string): Promise<SafeTaskDTO> {
      const lease = store.find(actorId, submissionId);
      try {
        const task = await request(`${ROOT}/submissions/${encodeURIComponent(submissionId)}`, { method: 'GET' }, validTask);
        assertCurrent(lease);
        if (task.planId !== lease.submission.planId || task.projectId !== lease.submission.projectId) throw new V2UncertainResponseError();
        return task;
      } catch (error) {
        if (!store.isCurrent(lease)) throw new V2ActorChangedError();
        if (!(error instanceof V2HttpError && error.status === 404 && error.code === 'TASK_NOT_FOUND')) throw error;
        return submitLease(lease);
      }
    },
    async acknowledgeTerminalSubmission(actorId: string, submissionId: string): Promise<{ task: SafeTaskDTO; removed: boolean }> {
      const lease = store.find(actorId, submissionId);
      try {
        const task = await request(`${ROOT}/submissions/${encodeURIComponent(submissionId)}`, { method: 'GET' }, validTask);
        assertCurrent(lease);
        if (task.planId !== lease.submission.planId || task.projectId !== lease.submission.projectId) throw new V2UncertainResponseError();
        return { task, removed: store.acknowledgeTerminal(lease, task) };
      } catch (error) {
        if (!store.isCurrent(lease)) throw new V2ActorChangedError();
        throw error;
      }
    },
    getTask(actorId: string, taskId: string): Promise<SafeTaskDTO> {
      if (!ID.test(taskId)) throw new TypeError('Invalid task identity.');
      return withActor(actorId, () => request(`${ROOT}/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' }, validTask));
    },
    cancelTask(actorId: string, taskId: string): Promise<SafeTaskDTO> {
      if (!ID.test(taskId)) throw new TypeError('Invalid task identity.');
      return withActor(actorId, () => request(`${ROOT}/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }, validTask));
    },
  });
}
