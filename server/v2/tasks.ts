import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../shared/v2/edit-plan.js';
import { IMAGE_LIMITS } from './images.js';
import { createPlanService, isPlanExpired, PlanError, validatePlanSnapshot, validateStoredPlanRow, type PlanConfiguration, type PlanSnapshot } from './plans.js';
import { WalletError, WalletRepository, type WalletScope, type WalletTransaction } from './wallet-repo.js';
import type { ConsentCatalog } from './consents.js';

const STORAGE_RESERVE_BYTES = 2 * IMAGE_LIMITS.outputBytes;
export const SAFE_TASK_ERROR_CODES:readonly string[]=Object.freeze([
  'OUTPUT_UNCHANGED','OUTPUT_INVALID','OUTPUT_REJECTED','STORAGE_WRITE_FAILED','STORAGE_QUOTA_EXCEEDED',
  'PROVIDER_DISABLED','PROVIDER_REFUSAL','PROVIDER_HTTP_ERROR','PROVIDER_RATE_LIMIT',
  'PROVIDER_TIMEOUT_UNKNOWN','PROVIDER_ABORT_UNKNOWN','PROVIDER_TRANSPORT_UNKNOWN',
  'CONSENT_INVALID','SOURCE_CHANGED','SOURCE_NOT_FOUND','PLAN_CONFIGURATION_CHANGED',
  'INPUT_TOO_LARGE_FOR_PROVIDER','RECOVERY_TIMEOUT','TASK_DELETED','ACCOUNT_DELETED','GENERATION_FAILED',
]);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const fingerprint = (planId: string, submissionId: string, consentRecordId: string) => sha(canonicalJson({ planId, submissionId, consentRecordId }));

export class TaskError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'TaskError'; }
}
export interface TaskRequest { planId: string; submissionId: string; consentRecordId: string }
export interface TaskSnapshot {
  schemaVersion: 1;
  scope: WalletScope;
  plan: PlanSnapshot;
  submissionId: string;
  consentRecordId: string;
  submissionFingerprint: string;
  storageReserveBytes: number;
}
export interface SafeTaskDTO {
  id: string; projectId: string; planId: string | null; status: string; userCostUnits: number;
  createdAt: string; updatedAt: string | null; resultVersionId: string | null; creditReturned: boolean; safeErrorCode: string | null;
}
export interface StorageHeadroom { usedBytes: number; reserveBytes: number; remainingBytes: number }
export interface TrustedFundingContext { tx: WalletTransaction; ownerId: string; taskId: string; plan: PlanSnapshot }
export interface TrustedFundingDecision { sourceEventKey: string }
export type TrustedFundingHook = (context: TrustedFundingContext) => TrustedFundingDecision | undefined;
export interface BeforeAcceptContext {
  tx: WalletTransaction; ownerId: string; projectId: string; taskId: string; plan: PlanSnapshot;
  maximumExposureMicrosUSD: number; currentLiabilityMicrosUSD: bigint;
}
export type BeforeAcceptHook = (context: BeforeAcceptContext) => boolean | undefined;
export interface TaskServiceOptions {
  db: DatabaseSync; consentCatalog?: ConsentCatalog | null; config?: PlanConfiguration; getConfig?: () => PlanConfiguration;
  storageQuotaBytes?: number | null; clock?: () => Date; id?: () => string; trustedFunding?: TrustedFundingHook; beforeAccept?: BeforeAcceptHook;
}
type TaskRow = {
  id: string; owner_id: string; project_id: string; plan_id: string | null; confirmed_plan_id: string | null;
  submission_id: string; status: string; user_cost_units: number; result_version_id: string | null;
  created_at: string; updated_at: string | null; credit_returned: number; safe_error_code: string | null;
  request_snapshot_json: string | null;
};
type PlanRow = {
  id: string; owner_id: string; project_id: string; source_asset_id: string; plan_digest: string;
  snapshot_json: string; user_cost_units: number; confirmed_at: string | null; created_at: string; expires_at: string;
};
const TASK_SELECT = `SELECT id,owner_id,project_id,plan_id,confirmed_plan_id,submission_id,status,user_cost_units,result_version_id,created_at,updated_at,credit_returned,safe_error_code,request_snapshot_json FROM tasks`;
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }
function thenable(value: unknown): boolean { return !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'; }

export function validateTaskRequest(value: unknown): TaskRequest {
  if (!plain(value) || !exact(value, ['planId', 'submissionId', 'consentRecordId']) || !safeId(value.planId) || !safeId(value.submissionId) || !safeId(value.consentRecordId)) throw new TaskError('INVALID_REQUEST', 400);
  return { planId: value.planId, submissionId: value.submissionId, consentRecordId: value.consentRecordId };
}

export function validateTaskSnapshot(value: unknown): TaskSnapshot {
  if (!plain(value) || !exact(value, ['schemaVersion', 'scope', 'plan', 'submissionId', 'consentRecordId', 'submissionFingerprint', 'storageReserveBytes'])) throw new TaskError('TASK_SNAPSHOT_INVALID', 500);
  let plan: PlanSnapshot;
  try { plan = validatePlanSnapshot(value.plan); } catch { throw new TaskError('TASK_SNAPSHOT_INVALID', 500); }
  const { semantic } = plan;
  if (value.schemaVersion !== 1 || (value.scope !== 'demo' && value.scope !== 'live') || value.scope !== semantic.walletScope || !safeId(value.submissionId) || !safeId(value.consentRecordId) || value.consentRecordId !== semantic.consent.recordId || value.submissionFingerprint !== fingerprint(plan.planId, value.submissionId, value.consentRecordId) || value.storageReserveBytes !== STORAGE_RESERVE_BYTES || sha(canonicalJson(semantic)) !== plan.planDigest) throw new TaskError('TASK_SNAPSHOT_INVALID', 500);
  return Object.freeze({ schemaVersion: 1, scope: value.scope, plan, submissionId: value.submissionId, consentRecordId: value.consentRecordId, submissionFingerprint: value.submissionFingerprint, storageReserveBytes: STORAGE_RESERVE_BYTES });
}

/** Read the F09 frozen task payload. Legacy F03 snapshots are intentionally not resubmittable. */
export function readTaskSnapshot(serialized: string | null | undefined): TaskSnapshot {
  if (typeof serialized !== 'string') throw new TaskError('TASK_SNAPSHOT_INVALID', 500);
  try { return validateTaskSnapshot(JSON.parse(serialized)); } catch (error) { if (error instanceof TaskError) throw error; throw new TaskError('TASK_SNAPSHOT_INVALID', 500); }
}

/** Synchronous owner storage preflight. Callers performing acceptance must call it inside their write transaction. */
export function checkTaskStorageHeadroom(db: DatabaseSync, ownerId: string, quotaBytes: number | null | undefined): StorageHeadroom {
  if (!safeId(ownerId)) throw new TaskError('INVALID_REQUEST', 400);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes === null || quotaBytes === undefined || quotaBytes < 1) throw new TaskError('STORAGE_QUOTA_UNAVAILABLE', 503);
  let used = 0n;
  try {
    const rows = db.prepare('SELECT bytes FROM assets WHERE owner_id=?').all(ownerId) as { bytes: number }[];
    for (const row of rows) {
      if (!Number.isSafeInteger(row.bytes) || row.bytes < 0) throw new TaskError('QUOTA_STATE_INVALID', 503);
      used += BigInt(row.bytes);
      if (used > MAX_SAFE) throw new TaskError('QUOTA_STATE_INVALID', 503);
    }
  } catch (error) { if (error instanceof TaskError) throw error; throw new TaskError('QUOTA_STATE_INVALID', 503); }
  const reserve = BigInt(STORAGE_RESERVE_BYTES), quota = BigInt(quotaBytes);
  if (used + reserve > quota) throw new TaskError('STORAGE_QUOTA_EXCEEDED', 409);
  return { usedBytes: Number(used), reserveBytes: STORAGE_RESERVE_BYTES, remainingBytes: Number(quota - used - reserve) };
}

function dto(row: TaskRow): SafeTaskDTO {
  return { id: row.id, projectId: row.project_id, planId: row.confirmed_plan_id, status: row.status, userCostUnits: row.user_cost_units, createdAt: row.created_at, updatedAt: row.updated_at, resultVersionId: row.result_version_id, creditReturned: row.credit_returned === 1, safeErrorCode: typeof row.safe_error_code==='string'&&SAFE_TASK_ERROR_CODES.includes(row.safe_error_code)?row.safe_error_code:null };
}
function validClock(clock: () => Date): string {
  const date = clock(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TaskError('CLOCK_UNAVAILABLE', 503); return date.toISOString();
}
function maybeTask(row: TaskRow | undefined, request: TaskRequest): { task: SafeTaskDTO; replayed: true } | undefined {
  if (!row) return undefined;
  try {
    const snapshot = readTaskSnapshot(row.request_snapshot_json);
    if (row.plan_id !== request.planId || row.confirmed_plan_id !== request.planId || snapshot.submissionId !== request.submissionId || snapshot.consentRecordId !== request.consentRecordId || snapshot.submissionFingerprint !== fingerprint(request.planId, request.submissionId, request.consentRecordId)) throw new Error('conflict');
    return { task: dto(row), replayed: true };
  } catch { throw new TaskError('SUBMISSION_CONFLICT', 409); }
}
function assertSafeCost(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TaskError('SUPPLIER_COST_UNAVAILABLE', 503);
}
function sumCost(total: bigint, value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN', 503);
  const next = total + BigInt(value); if (next > MAX_SAFE) throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN', 503); return next;
}
export function supplierLiability(tx: WalletTransaction, ownerId?: string): bigint {
  if (ownerId !== undefined) {
    if (!safeId(ownerId)) throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN', 503);
    const broken = tx.get(`SELECT 1 AS broken FROM supplier_attempts AS a LEFT JOIN tasks AS t ON t.id=a.task_id
      WHERE (a.owner_id=? OR t.owner_id=?) AND (t.id IS NULL OR t.owner_id<>a.owner_id)
      UNION ALL
      SELECT 1 AS broken FROM supplier_exposures AS e LEFT JOIN tasks AS t ON t.id=e.task_id
      WHERE (e.owner_id=? OR t.owner_id=?) AND (t.id IS NULL OR t.owner_id<>e.owner_id) LIMIT 1`, ownerId, ownerId, ownerId, ownerId);
    if (broken) throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN', 503);
  }
  let actual = 0n, open = 0n;
  const parameters = ownerId === undefined ? [] : [ownerId];
  const attemptSql = `SELECT a.reconciled_cost_usd_micros,a.status,a.ended_at,e.max_cost_usd_micros,e.status AS exposure_status FROM supplier_attempts a LEFT JOIN supplier_exposures e ON e.owner_id=a.owner_id AND e.task_id=a.task_id`;
  const attempts = tx.all<{ reconciled_cost_usd_micros: number | null; max_cost_usd_micros: number | null; exposure_status: string | null; status:string; ended_at:string|null }>(`${attemptSql}${ownerId === undefined ? '' : ' WHERE a.owner_id=?'}`, ...parameters);
  for (const row of attempts) {
    const cost=row.reconciled_cost_usd_micros, maximum=row.max_cost_usd_micros;
    if(cost!==null)sumCost(0n,cost);
    if(maximum!==null){sumCost(0n,maximum);if(cost!==null&&cost>maximum)throw new TaskError('SUPPLIER_COST_CAP_BREACHED',503);}
    if(['reserved','started','uncertain'].includes(row.exposure_status??'')){
      if(maximum===null||maximum===0)throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN',503);
      // Partial/final-looking usage never reduces an exposure that is still unresolved.
      open=sumCost(open,maximum);continue;
    }
    if(row.exposure_status==='settled'&&cost!==null){actual=sumCost(actual,cost);continue;}
    // Missing exposure also loses the original cap; an apparent final cost cannot prove it was respected.
    // A claimed attempt cannot be released as unattempted; known zero dispatch is settled at zero.
    throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN',503);
  }
  const exposureSql = `SELECT e.max_cost_usd_micros,e.status FROM supplier_exposures e LEFT JOIN supplier_attempts a ON a.owner_id=e.owner_id AND a.task_id=e.task_id WHERE a.id IS NULL`;
  const exposures = tx.all<{ max_cost_usd_micros: number; status: string }>(`${exposureSql}${ownerId === undefined ? '' : ' AND e.owner_id=?'}`, ...parameters);
  for (const row of exposures) {
    if (row.status === 'settled') throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN', 503);
    if (['reserved', 'started', 'uncertain'].includes(row.status)) {
      if(row.max_cost_usd_micros===0)throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN',503);
      open = sumCost(open, row.max_cost_usd_micros);
    }
  }
  if(actual+open>MAX_SAFE)throw new TaskError('SUPPLIER_LIABILITY_UNKNOWN',503);
  return actual + open;
}

export function createTaskService(options: TaskServiceOptions) {
  const { db } = options, repo = new WalletRepository(db), clock = options.clock ?? (() => new Date()), makeId = options.id ?? randomUUID;
  const plans = createPlanService({ db, consentCatalog: options.consentCatalog, config: options.config, getConfig: options.getConfig, clock });
  const storageQuota = options.storageQuotaBytes;
  const findSubmission = (owner: string, id: string) => db.prepare(`${TASK_SELECT} WHERE owner_id=? AND submission_id=?`).get(owner, id) as TaskRow | undefined;
  const findTask = (owner: string, id: string) => db.prepare(`${TASK_SELECT} WHERE owner_id=? AND id=?`).get(owner, id) as TaskRow | undefined;
  const readBySubmission = (owner: string, id: string): SafeTaskDTO => { const row = safeId(owner) && safeId(id) ? findSubmission(owner, id) : undefined; if (!row) throw new TaskError('TASK_NOT_FOUND', 404); return dto(row); };
  const readTask = (owner: string, id: string): SafeTaskDTO => { const row = safeId(owner) && safeId(id) ? findTask(owner, id) : undefined; if (!row) throw new TaskError('TASK_NOT_FOUND', 404); return dto(row); };

  async function submit(ownerId: string, raw: unknown): Promise<{ task: SafeTaskDTO; replayed: boolean }> {
    if (!safeId(ownerId)) throw new TaskError('AUTH_REQUIRED', 401);
    const request = validateTaskRequest(raw);
    const early = maybeTask(findSubmission(ownerId, request.submissionId), request); if (early) return early;
    const already = db.prepare(`${TASK_SELECT} WHERE owner_id=? AND confirmed_plan_id=?`).get(ownerId, request.planId) as TaskRow | undefined;
    if (already) throw new TaskError('PLAN_ALREADY_CONFIRMED', 409);
    const row = db.prepare('SELECT id,owner_id,project_id,source_asset_id,plan_digest,snapshot_json,user_cost_units,confirmed_at,created_at,expires_at FROM plans WHERE id=? AND owner_id=?').get(request.planId, ownerId) as PlanRow | undefined;
    if (!row) throw new TaskError('PLAN_NOT_FOUND', 404);
    if (row.confirmed_at !== null) throw new TaskError('PLAN_ALREADY_CONFIRMED', 409);
    const plan = await validateStoredPlanRow(row);
    if (plan.planId !== request.planId || plan.semantic.ownerId !== ownerId || plan.semantic.consent.recordId !== request.consentRecordId) throw new TaskError('CONSENT_INVALID', 403);
    if (isPlanExpired(plan, clock())) throw new TaskError('PLAN_EXPIRED', 409);
    await plans.readCurrentInputs(plan);
    const createdAt = validClock(clock);
    return repo.transaction(tx => {
      const replay = maybeTask(tx.get<TaskRow>(`${TASK_SELECT} WHERE owner_id=? AND submission_id=?`, ownerId, request.submissionId), request);
      if (replay) return replay;
      if (tx.get(`${TASK_SELECT} WHERE owner_id=? AND confirmed_plan_id=?`, ownerId, request.planId)) throw new TaskError('PLAN_ALREADY_CONFIRMED', 409);
      if (tx.get('SELECT 1 FROM tasks WHERE owner_id=? AND status IN (\'queued\',\'processing\',\'uncertain\')', ownerId)) throw new TaskError('ACTIVE_TASK_EXISTS', 409);
      const current = tx.get<PlanRow>('SELECT id,owner_id,project_id,source_asset_id,plan_digest,snapshot_json,user_cost_units,confirmed_at,created_at,expires_at FROM plans WHERE id=? AND owner_id=?', request.planId, ownerId);
      if (!current) throw new TaskError('PLAN_NOT_FOUND', 404);
      if (current.confirmed_at !== null) throw new TaskError('PLAN_ALREADY_CONFIRMED', 409);
      if (isPlanExpired(plan, clock())) throw new TaskError('PLAN_EXPIRED', 409);
      plans.assertCurrent(plan);
      const semantic = plan.semantic, scope = semantic.walletScope;
      if (scope === 'live') {
        const supplier = semantic.supplier; if (!supplier || semantic.executionMode !== 'live' || semantic.projectSource.kind === 'licensed_demo') throw new TaskError('SUPPLIER_COST_UNAVAILABLE', 503);
        assertSafeCost(supplier.maxSupplierCostMicrosUSD); assertSafeCost(semantic.supplierExposureMicrosUSD); assertSafeCost(supplier.approvedBudgetMicrosUSD);
        if (supplier.maxSupplierCostMicrosUSD !== semantic.supplierExposureMicrosUSD || supplier.maxSupplierCostMicrosUSD > supplier.approvedBudgetMicrosUSD) throw new TaskError('SUPPLIER_COST_UNAVAILABLE', 503);
        if (!tx.get('SELECT 1 FROM identities WHERE user_id=? AND provider=\'apple\' LIMIT 1', ownerId)) throw new TaskError('LIVE_IDENTITY_REQUIRED', 403);
      } else if (scope !== 'demo' || semantic.executionMode !== 'licensed_demo' || semantic.projectSource.kind !== 'licensed_demo' || semantic.supplier !== null || semantic.supplierExposureMicrosUSD !== 0) throw new TaskError('DEMO_SOURCE_REQUIRED', 403);
      checkTaskStorageHeadroom(db, ownerId, storageQuota);
      let currentLiabilityMicrosUSD = 0n, maximumExposureMicrosUSD = 0;
      if (scope === 'live') {
        const supplier = semantic.supplier!;
        maximumExposureMicrosUSD = supplier.maxSupplierCostMicrosUSD;
        currentLiabilityMicrosUSD = supplierLiability(tx);
        if (currentLiabilityMicrosUSD + BigInt(maximumExposureMicrosUSD) > BigInt(supplier.approvedBudgetMicrosUSD)) throw new TaskError('SUPPLIER_BUDGET_EXCEEDED', 503);
      }
      const taskId = makeId(); if (!safeId(taskId)) throw new TaskError('TASK_ID_INVALID', 500);
      const snapshot = validateTaskSnapshot({ schemaVersion: 1, scope, plan, submissionId: request.submissionId, consentRecordId: request.consentRecordId, submissionFingerprint: fingerprint(request.planId, request.submissionId, request.consentRecordId), storageReserveBytes: STORAGE_RESERVE_BYTES });
      if (options.beforeAccept) {
        const decision: unknown = options.beforeAccept(Object.freeze({ tx, ownerId, projectId: semantic.projectId, taskId, plan, maximumExposureMicrosUSD, currentLiabilityMicrosUSD }));
        if (thenable(decision)) { void Promise.resolve(decision).catch(() => {}); throw new TaskError('TASK_ADMISSION_ASYNC_FORBIDDEN', 500); }
        if (decision === false) throw new TaskError('TASK_ADMISSION_REJECTED', 409);
        if (decision !== undefined && decision !== true) throw new TaskError('TASK_ADMISSION_INVALID', 500);
      }
      tx.run(`INSERT INTO tasks(id,owner_id,project_id,plan_id,confirmed_plan_id,submission_id,status,user_cost_units,created_at,updated_at,request_snapshot_json)
        VALUES (?,?,?,?,?,?,'queued',?,?,?,?)`, taskId, ownerId, semantic.projectId, plan.planId, plan.planId, request.submissionId, semantic.userCostUnits, createdAt, createdAt, canonicalJson(snapshot));
      let fundedLotId: string | undefined;
      if (scope === 'live' && options.trustedFunding) {
        const funding: unknown = options.trustedFunding(Object.freeze({ tx, ownerId: semantic.ownerId, taskId, plan }));
        if (thenable(funding)) { void Promise.resolve(funding).catch(() => {}); throw new TaskError('TRUSTED_FUNDING_ASYNC_FORBIDDEN', 500); }
        if (funding !== undefined) {
          if (!plain(funding) || !exact(funding, ['sourceEventKey']) || typeof funding.sourceEventKey !== 'string' || !funding.sourceEventKey.trim() || funding.sourceEventKey.length > 512) throw new TaskError('TRUSTED_FUNDING_INVALID', 500);
          const grant = repo.grantInTransaction(tx, { ownerId: semantic.ownerId, kind: 'promo', sourceKind: 'trial', sourceEventKey: funding.sourceEventKey, units: semantic.userCostUnits, scope: semantic.walletScope, projectId: semantic.projectId, createdAt });
          if (grant.replayed) throw new TaskError('TRUSTED_FUNDING_REPLAY', 409);
          fundedLotId = grant.lotId;
        }
      }
      const reservation = repo.reserveTaskInTransaction(tx, { ownerId, taskId });
      if (fundedLotId) {
        const allocations = tx.all<{credit_lot_id:string;units:number}>('SELECT credit_lot_id,units FROM reservation_allocations WHERE owner_id=? AND reservation_id=?', ownerId, reservation.reservationId);
        if (allocations.length !== 1 || allocations[0]!.credit_lot_id !== fundedLotId || allocations[0]!.units !== semantic.userCostUnits) throw new TaskError('TRUSTED_FUNDING_ALLOCATION_CONFLICT', 409);
      }
      if (scope === 'live') {
        const supplier = semantic.supplier!;
        tx.run(`INSERT INTO supplier_exposures(id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'USD','profile_max_cost_usd_micros','reserved',?,?)`, makeId(), ownerId, taskId, supplier.supplierProfileId, supplier.profileVersion, supplier.maxSupplierCostMicrosUSD, createdAt, createdAt);
      }
      const confirmed = tx.run('UPDATE plans SET confirmed_at=? WHERE id=? AND owner_id=? AND confirmed_at IS NULL', createdAt, plan.planId, ownerId);
      if (confirmed.changes !== 1) throw new TaskError('PLAN_ALREADY_CONFIRMED', 409);
      const accepted = tx.get<TaskRow>(`${TASK_SELECT} WHERE owner_id=? AND id=?`, ownerId, taskId);
      if (!accepted) throw new TaskError('TASK_ACCEPTANCE_FAILED', 500);
      return { task: dto(accepted), replayed: false };
    });
  }

  function cancel(ownerId: string, taskId: string): { task: SafeTaskDTO; replayed: boolean } {
    if (!safeId(ownerId) || !safeId(taskId)) throw new TaskError('TASK_NOT_FOUND', 404);
    return repo.transaction(tx => {
      const task = tx.get<TaskRow>(`${TASK_SELECT} WHERE owner_id=? AND id=?`, ownerId, taskId);
      if (!task) throw new TaskError('TASK_NOT_FOUND', 404);
      if (task.status === 'cancelled') return { task: dto(task), replayed: true };
      if (task.status !== 'queued') throw new TaskError('TASK_NOT_CANCELLABLE', 409);
      if (tx.get('SELECT 1 FROM supplier_attempts WHERE owner_id=? AND task_id=?', ownerId, taskId)) throw new TaskError('TASK_NOT_CANCELLABLE', 409);
      repo.finalizeTaskInTransaction(tx, { ownerId, taskId, outcome: 'cancelled' });
      const exposure = tx.get<{ status: string }>('SELECT status FROM supplier_exposures WHERE owner_id=? AND task_id=?', ownerId, taskId);
      if (exposure) {
        if (exposure.status !== 'reserved') throw new TaskError('SUPPLIER_EXPOSURE_STATE_CONFLICT', 409);
        const update = tx.run("UPDATE supplier_exposures SET status='released',updated_at=? WHERE owner_id=? AND task_id=? AND status='reserved'", validClock(clock), ownerId, taskId);
        if (update.changes !== 1) throw new TaskError('SUPPLIER_EXPOSURE_STATE_CONFLICT', 409);
      }
      const updated = tx.get<TaskRow>(`${TASK_SELECT} WHERE owner_id=? AND id=?`, ownerId, taskId);
      if (!updated) throw new TaskError('TASK_NOT_FOUND', 404);
      return { task: dto(updated), replayed: false };
    });
  }
  return Object.freeze({ submit, readBySubmission, readTask, cancel });
}
