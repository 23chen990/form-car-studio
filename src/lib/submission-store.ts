export interface ConfirmedQuoteIdentity { planId: string; projectId: string; expiresAt: string }
export type SubmissionOperation = 'task' | 'trial_claim';
export interface PendingSubmission {
  operation: SubmissionOperation;
  planId: string;
  projectId: string;
  submissionId: string;
  consentRecordId: string;
  expiresAt: string;
  createdAt: string;
}
export interface ActorLease { actorId: string; generation: number }
export interface SubmissionLease extends ActorLease { submission: PendingSubmission }
export interface SubmissionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface SecureRandomSource {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}
export interface SubmissionStore {
  activateActor(actorId: string | null): void;
  captureActor(actorId: string): ActorLease;
  begin(actorId: string, quote: ConfirmedQuoteIdentity, consentRecordId: string, operation?: SubmissionOperation): SubmissionLease;
  find(actorId: string, submissionId: string): SubmissionLease;
  list(actorId: string): readonly PendingSubmission[];
  acknowledgeTerminal(lease: SubmissionLease, task: { planId: string | null; status: string }): boolean;
  isCurrent(lease: ActorLease): boolean;
  clearActor(actorId: string): void;
}
export class SubmissionStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SubmissionStoreError'; }
}

const PREFIX = 'form:v2:submissions:';
const LIMIT = 32;
const OPERATIONS = new Set<SubmissionOperation>(['task', 'trial_claim']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function actorKey(actorId: string): string {
  if (!validId(actorId)) throw new SubmissionStoreError('INVALID_ACTOR_NAMESPACE');
  return `${PREFIX}${encodeURIComponent(actorId)}`;
}
function validLegacyRecord(value: unknown): value is Omit<PendingSubmission, 'operation'> {
  if (!plain(value) || !exactKeys(value, ['planId', 'projectId', 'submissionId', 'consentRecordId', 'expiresAt', 'createdAt'])) return false;
  return validId(value.planId) && validId(value.projectId) && validId(value.submissionId) && validId(value.consentRecordId) && validDate(value.expiresAt) && validDate(value.createdAt);
}
function validRecord(value: unknown): value is PendingSubmission {
  if (!plain(value) || !exactKeys(value, ['operation', 'planId', 'projectId', 'submissionId', 'consentRecordId', 'expiresAt', 'createdAt']) || !OPERATIONS.has(value.operation as SubmissionOperation)) return false;
  return validId(value.planId) && validId(value.projectId) && validId(value.submissionId) && validId(value.consentRecordId) && validDate(value.expiresAt) && validDate(value.createdAt);
}

export function createSubmissionStore(options: {
  storage?: SubmissionStorage;
  crypto?: SecureRandomSource | null;
  createId?: () => string;
  now?: () => string;
} = {}): SubmissionStore {
  let storage = options.storage;
  if (!storage) {
    try { storage = globalThis.localStorage; }
    catch { throw new SubmissionStoreError('SUBMISSION_STORAGE_UNAVAILABLE'); }
    if (!storage) throw new SubmissionStoreError('SUBMISSION_STORAGE_UNAVAILABLE');
  }
  const random = options.crypto === undefined ? globalThis.crypto : options.crypto;
  const createId = options.createId ?? (() => {
    if (random && typeof random.randomUUID === 'function') return random.randomUUID();
    if (random && typeof random.getRandomValues === 'function') {
      const bytes = random.getRandomValues(new Uint8Array(16));
      if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new SubmissionStoreError('SUBMISSION_ID_UNAVAILABLE');
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      let hex = '';
      for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new SubmissionStoreError('SUBMISSION_ID_UNAVAILABLE');
  });
  const now = options.now ?? (() => new Date().toISOString());
  let activeActor: string | null = null;
  let generation = 0;

  function requireActor(actorId: string) {
    actorKey(actorId);
    if (activeActor !== actorId) throw new SubmissionStoreError('ACTOR_NOT_ACTIVE');
  }
  function read(actorId: string): PendingSubmission[] {
    let raw: string | null;
    try { raw = storage!.getItem(actorKey(actorId)); }
    catch { throw new SubmissionStoreError('SUBMISSION_STORAGE_UNAVAILABLE'); }
    if (raw === null) return [];
    if (raw.length > 32_768) throw new SubmissionStoreError('SUBMISSION_STORE_INVALID');
    try {
      const value: unknown = JSON.parse(raw);
      if (!plain(value) || !exactKeys(value, ['schemaVersion', 'submissions']) || !Array.isArray(value.submissions) || value.submissions.length > LIMIT) throw new Error();
      let records: PendingSubmission[];
      if (value.schemaVersion === 1 && value.submissions.every(validLegacyRecord)) {
        records = value.submissions.map(record => ({ ...record, operation: 'task' as const }));
      } else if (value.schemaVersion === 2 && value.submissions.every(validRecord)) {
        records = value.submissions;
      } else throw new Error();
      if (new Set(records.map(record => record.planId)).size !== records.length || new Set(records.map(record => record.submissionId)).size !== records.length) throw new Error();
      return records;
    } catch { throw new SubmissionStoreError('SUBMISSION_STORE_INVALID'); }
  }
  function write(actorId: string, records: readonly PendingSubmission[]) {
    try { storage!.setItem(actorKey(actorId), JSON.stringify({ schemaVersion: 2, submissions: records })); }
    catch { throw new SubmissionStoreError('SUBMISSION_STORAGE_UNAVAILABLE'); }
  }

  return Object.freeze({
    activateActor(actorId: string | null) {
      if (actorId !== null) actorKey(actorId);
      if (activeActor !== actorId) { activeActor = actorId; generation++; }
    },
    captureActor(actorId: string): ActorLease {
      requireActor(actorId);
      return { actorId, generation };
    },
    begin(actorId: string, quote: ConfirmedQuoteIdentity, consentRecordId: string, operation: SubmissionOperation = 'task'): SubmissionLease {
      if (!OPERATIONS.has(operation)) throw new SubmissionStoreError('INVALID_SUBMISSION_OPERATION');
      requireActor(actorId);
      if (!validId(quote?.planId) || !validId(quote?.projectId) || !validDate(quote?.expiresAt) || !validId(consentRecordId)) throw new SubmissionStoreError('INVALID_SUBMISSION_IDENTITY');
      const records = read(actorId), previous = records.find(record => record.planId === quote.planId);
      if (previous) {
        if (previous.operation !== operation || previous.projectId !== quote.projectId || previous.consentRecordId !== consentRecordId || previous.expiresAt !== quote.expiresAt) throw new SubmissionStoreError('SUBMISSION_IDENTITY_CONFLICT');
        return { actorId, generation, submission: { ...previous } };
      }
      if (records.length >= LIMIT) throw new SubmissionStoreError('SUBMISSION_STORE_FULL');
      let submissionId: string;
      try { submissionId = createId(); }
      catch { throw new SubmissionStoreError('SUBMISSION_ID_UNAVAILABLE'); }
      const createdAt = now();
      if (!validId(submissionId) || !validDate(createdAt) || records.some(record => record.submissionId === submissionId)) throw new SubmissionStoreError('INVALID_SUBMISSION_IDENTITY');
      const submission = { operation, planId: quote.planId, projectId: quote.projectId, submissionId, consentRecordId, expiresAt: quote.expiresAt, createdAt };
      write(actorId, [...records, submission]);
      return { actorId, generation, submission };
    },
    find(actorId: string, submissionId: string): SubmissionLease {
      requireActor(actorId);
      if (!validId(submissionId)) throw new SubmissionStoreError('INVALID_SUBMISSION_IDENTITY');
      const submission = read(actorId).find(record => record.submissionId === submissionId);
      if (!submission) throw new SubmissionStoreError('SUBMISSION_NOT_FOUND');
      return { actorId, generation, submission: { ...submission } };
    },
    list(actorId: string): readonly PendingSubmission[] {
      requireActor(actorId);
      return read(actorId).map(record => ({ ...record }));
    },
    acknowledgeTerminal(lease: SubmissionLease, task: { planId: string | null; status: string }): boolean {
      if (activeActor !== lease.actorId || generation !== lease.generation) return false;
      if (!['succeeded', 'failed', 'cancelled'].includes(task.status) || task.planId !== lease.submission.planId) return false;
      const records = read(lease.actorId), index = records.findIndex(record => record.submissionId === lease.submission.submissionId && record.planId === task.planId);
      if (index < 0) return false;
      write(lease.actorId, records.filter((_record, item) => item !== index));
      return true;
    },
    isCurrent(lease: ActorLease): boolean {
      return activeActor === lease.actorId && generation === lease.generation;
    },
    clearActor(actorId: string) {
      const key = actorKey(actorId);
      if (activeActor === actorId) { activeActor = null; generation++; }
      try { storage!.removeItem(key); }
      catch { throw new SubmissionStoreError('SUBMISSION_STORAGE_UNAVAILABLE'); }
    },
  });
}
