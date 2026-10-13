import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../shared/v2/edit-plan.js';
import { assetInsertMetadata, AssetError } from './assets.js';
import type { ConsentCatalog } from './consents.js';
import { createDisplayAsset, exactPixelEquality, ImageError, validateOutputMaster, type ImageAsset } from './images.js';
import { createPlanService, PlanError, providerEditRequest, type PlanConfiguration, type PlanSnapshot } from './plans.js';
import type { ProviderInput, ProviderResult, Usage } from './provider.js';
import { checkTaskStorageHeadroom, readTaskSnapshot, SAFE_TASK_ERROR_CODES, supplierLiability, TaskError, type TaskSnapshot } from './tasks.js';
import { WalletError, WalletRepository, type WalletTransaction } from './wallet-repo.js';

const MAX_WORKER_CONCURRENCY = 8;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const profileToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const providerRequestId = (value: unknown): value is string | null => value === null || typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const thenable = (value: unknown) => !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';

export class WorkerError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'WorkerError'; }
}
export interface LicensedDemoResultFixture {
  registryId: string; licenseEvidence: string; sourcePixelSha256: string; editRequestSha256: string; bytes: Uint8Array;
}
export interface DispatchAuthorizationContext {
  tx: WalletTransaction; taskId: string; ownerId: string; projectId: string; maximumExposureMicrosUSD: number; currentLiabilityMicrosUSD: bigint;
}
export interface QualityReviewContext { taskId: string; ownerId: string; projectId: string; plan: PlanSnapshot; master: ImageAsset }
export interface WorkerOptions {
  db: DatabaseSync; consentCatalog?: ConsentCatalog | null; config?: PlanConfiguration; getConfig?: () => PlanConfiguration;
  storageQuotaBytes?: number | null; clock?: () => Date; id?: () => string; concurrency?: number;
  /** Deliberately false by default; F10 has no production provider wiring. */
  liveDispatchEnabled?: boolean;
  /** Server-supplied F05 adapter. No adapter is installed by default or from a task/route. */
  serverProvider?: (input: ProviderInput) => Promise<ProviderResult>;
  licensedDemoResults?: readonly LicensedDemoResultFixture[];
  /** F27 synchronous claim-time breaker hook. No network or asynchronous work is permitted. */
  dispatchGuard?: (context: DispatchAuthorizationContext) => boolean | undefined;
  /** Local policy/review-record rejection only; external processing requires its own approved consent adapter. */
  qualityReview?: (context: QualityReviewContext) => void | Promise<void>;
}
export type WorkerRunResult = { status: 'disabled' | 'not_claimed' | 'succeeded' | 'failed' | 'discarded'; taskId: string; resultVersionId?: string };
type WorkerTaskRow = {
  id: string; owner_id: string; project_id: string; plan_id: string | null; confirmed_plan_id: string | null; submission_id: string;
  status: string; user_cost_units: number; result_version_id: string | null; created_at: string; request_snapshot_json: string | null;
  quote_id: string | null; quote_owner_id: string | null; quote_project_id: string | null; source_asset_id: string | null;
  quote_plan_digest: string | null; quote_snapshot_json: string | null; quote_user_cost_units: number | null; quote_confirmed_at: string | null;
  owner_deleted_at: string | null; project_deleted_at: string | null;
};
type Attempt = { id: string; owner_id: string; task_id: string; status: string; provider_profile_id: string; provider_profile_version: string | null };
type Claimed = { taskId: string; ownerId: string; projectId: string; scope: 'live' | 'demo'; snapshot: TaskSnapshot; attemptId: string | null; demoResult: LicensedDemoResultFixture | null };
type FailureRecord = { code: string; sent: boolean; cost: number | null; status: 'succeeded' | 'failed' | 'uncertain'; requestId?: string | null; usage?: Usage | null; category?: string | null };
const TASK_QUERY = `SELECT t.id,t.owner_id,t.project_id,t.plan_id,t.confirmed_plan_id,t.submission_id,t.status,t.user_cost_units,
  t.result_version_id,t.created_at,t.request_snapshot_json,q.id AS quote_id,q.owner_id AS quote_owner_id,q.project_id AS quote_project_id,
  q.source_asset_id,q.plan_digest AS quote_plan_digest,q.snapshot_json AS quote_snapshot_json,q.user_cost_units AS quote_user_cost_units,
  q.confirmed_at AS quote_confirmed_at,u.deleted_at AS owner_deleted_at,p.deleted_at AS project_deleted_at
  FROM tasks t LEFT JOIN plans q ON q.id=t.confirmed_plan_id AND q.owner_id=t.owner_id AND q.project_id=t.project_id
  LEFT JOIN users u ON u.id=t.owner_id LEFT JOIN projects p ON p.owner_id=t.owner_id AND p.id=t.project_id WHERE t.id=?`;

function clockIso(clock: () => Date): string {
  const date = clock(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new WorkerError('CLOCK_UNAVAILABLE'); return date.toISOString();
}
function rowFor(db: DatabaseSync, taskId: string) { return db.prepare(TASK_QUERY).get(taskId) as WorkerTaskRow | undefined; }
function validateBinding(row: WorkerTaskRow, snapshot: TaskSnapshot): void {
  const plan = snapshot.plan, semantic = plan.semantic;
  if (!row.request_snapshot_json || row.request_snapshot_json !== canonicalJson(snapshot) || row.quote_id !== plan.planId || row.quote_owner_id !== row.owner_id || row.quote_project_id !== row.project_id ||
    row.plan_id !== plan.planId || row.confirmed_plan_id !== plan.planId || row.submission_id !== snapshot.submissionId || row.quote_confirmed_at === null ||
    row.source_asset_id !== semantic.source.assetId || row.quote_plan_digest !== plan.planDigest || row.quote_snapshot_json !== canonicalJson(plan) ||
    row.quote_user_cost_units !== row.user_cost_units || row.user_cost_units !== semantic.userCostUnits || semantic.ownerId !== row.owner_id ||
    semantic.projectId !== row.project_id || snapshot.scope !== semantic.walletScope) throw new WorkerError('TASK_SNAPSHOT_INVALID');
}
function minimumFor(size: string): { width: number; height: number } {
  if (size === '1024x1024') return { width: 1024, height: 1024 };
  if (size === '1536x1024') return { width: 1536, height: 1024 };
  if (size === '1024x1536') return { width: 1024, height: 1536 };
  throw new WorkerError('GENERATION_FAILED');
}
function safeCode(error: unknown): string {
  if (error instanceof WorkerError) return SAFE_TASK_ERROR_CODES.includes(error.code) ? error.code : 'GENERATION_FAILED';
  if (error instanceof TaskError || error instanceof PlanError) return SAFE_TASK_ERROR_CODES.includes(error.code) ? error.code : 'GENERATION_FAILED';
  if (error instanceof AssetError) return error.code === 'ASSET_NOT_FOUND' ? 'SOURCE_NOT_FOUND' : 'SOURCE_CHANGED';
  if (error instanceof ImageError) return error.stage === 'display' ? 'OUTPUT_INVALID' : 'OUTPUT_INVALID';
  if (error instanceof WalletError) {
    if (error.code === 'OWNER_TOMBSTONED') return 'ACCOUNT_DELETED';
    if (error.code === 'PROJECT_TOMBSTONED' || error.code === 'TASK_NOT_FOUND') return 'TASK_DELETED';
    return SAFE_TASK_ERROR_CODES.includes(error.code) ? error.code : 'GENERATION_FAILED';
  }
  return 'GENERATION_FAILED';
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function validUsage(value: unknown): value is Usage | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>, keys = ['inputTokens', 'outputTokens', 'totalTokens'];
  return exactKeys(item, keys) && keys.every(key => item[key] === null || Number.isSafeInteger(item[key]) && Number(item[key]) >= 0);
}
function validProviderResult(value: unknown): value is ProviderResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, any>;
  if (item.ok === true) return exactKeys(item, ['ok','image','mimeType','profileId','profileVersion','model','templateVersion','promptSha256','providerRequestId','usage','actualCostMicrosUSD','maxExposureMicrosUSD','attempted','quality']) &&
    Buffer.isBuffer(item.image) && item.mimeType === 'image/png' && profileToken(item.profileId) && profileToken(item.profileVersion) && profileToken(item.model) && profileToken(item.templateVersion) && digest(item.promptSha256) &&
    providerRequestId(item.providerRequestId) && validUsage(item.usage) && (item.actualCostMicrosUSD === null || Number.isSafeInteger(item.actualCostMicrosUSD) && item.actualCostMicrosUSD >= 0) &&
    (item.maxExposureMicrosUSD === null || Number.isSafeInteger(item.maxExposureMicrosUSD) && item.maxExposureMicrosUSD >= 0) && item.attempted === true && item.quality === 'UNASSESSED';
  if (item.ok !== false || !exactKeys(item, ['ok','error','attempted','providerRequestId','usage','actualCostMicrosUSD','maxExposureMicrosUSD']) || typeof item.attempted !== 'boolean' || !providerRequestId(item.providerRequestId) ||
    item.usage !== null || item.actualCostMicrosUSD !== null || item.maxExposureMicrosUSD !== null && (!Number.isSafeInteger(item.maxExposureMicrosUSD) || item.maxExposureMicrosUSD < 0)) return false;
  return !!item.error && typeof item.error === 'object' && exactKeys(item.error, ['code','category','retryable']) && typeof item.error.code === 'string' &&
    ['disabled','input','refusal','upstream','invalid_output','uncertain','aborted'].includes(item.error.category) && item.error.retryable === false;
}
function demoKey(snapshot: TaskSnapshot): { registryId: string; pixel: string; request: string } | null {
  const semantic = snapshot.plan.semantic, registryId = semantic.projectSource.licenseRegistryId;
  if (semantic.executionMode !== 'licensed_demo' || semantic.projectSource.kind !== 'licensed_demo' || !registryId || !digest(semantic.source.pixelSha256)) return null;
  return { registryId, pixel: semantic.source.pixelSha256, request: hash(canonicalJson(providerEditRequest(snapshot.plan))) };
}
function matchesDemo(entries: readonly LicensedDemoResultFixture[], snapshot: TaskSnapshot): LicensedDemoResultFixture | null {
  const key = demoKey(snapshot); if (!key) return null;
  const matches = entries.filter(item => item.registryId === key.registryId && item.sourcePixelSha256 === key.pixel && item.editRequestSha256 === key.request);
  return matches.length === 1 ? matches[0]! : null;
}
function insertAsset(tx: WalletTransaction, input: { ownerId: string; projectId: string; kind: 'master' | 'display'; image: ImageAsset; createdAt: string; makeId: () => string }): string {
  const id = input.makeId(), storageKey = input.makeId();
  const row = assetInsertMetadata({ id, ownerId: input.ownerId, projectId: input.projectId, kind: input.kind, storageKey, createdAt: input.createdAt }, input.image);
  tx.run(`INSERT INTO assets(id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,created_at,private_bytes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, row.id, row.owner_id, row.project_id, row.kind, row.mime, row.bytes, row.width, row.height, row.digest, row.storage_key, row.created_at, input.image.bytes);
  return id;
}

export function createWorkerService(options: WorkerOptions) {
  const { db } = options, clock = options.clock ?? (() => new Date()), makeId = options.id ?? randomUUID;
  const repo = new WalletRepository(db, { newId: makeId, clock: () => clockIso(clock) });
  const plans = createPlanService({ db, consentCatalog: options.consentCatalog, config: options.config, getConfig: options.getConfig, clock });
  const configuredConcurrency = options.concurrency ?? 0;
  const concurrency = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency > 0 && configuredConcurrency <= MAX_WORKER_CONCURRENCY ? configuredConcurrency : 0;
  const demoResults = (options.licensedDemoResults ?? []).filter(item => item && id(item.registryId) && typeof item.licenseEvidence === 'string' && item.licenseEvidence.trim().length > 0 && digest(item.sourcePixelSha256) && digest(item.editRequestSha256) && (Buffer.isBuffer(item.bytes) || item.bytes instanceof Uint8Array)).map(item => Object.freeze({ ...item, bytes: Buffer.from(item.bytes) }));
  const active = new Set<string>();

  function claim(tx: WalletTransaction, taskId: string): Claimed | null {
    const row = tx.get<WorkerTaskRow>(TASK_QUERY, taskId); if (!row || row.status !== 'queued') return null;
    const running = tx.get<{ count: number }>("SELECT count(*) AS count FROM tasks WHERE status IN ('processing','uncertain')");
    if (!running || running.count >= concurrency) return null;
    const snapshot = readTaskSnapshot(row.request_snapshot_json); validateBinding(row, snapshot);
    const semantic = snapshot.plan.semantic, scope = snapshot.scope;
    const demoResult = scope === 'demo' ? matchesDemo(demoResults, snapshot) : null;
    if (scope === 'demo' && (!demoResult || semantic.executionMode !== 'licensed_demo')) return null;
    if (scope === 'live') {
      const supplier = semantic.supplier;
      if (!options.liveDispatchEnabled || !options.serverProvider || semantic.executionMode !== 'live' || !supplier) return null;
      const exposure = tx.get<{ id: string; status: string; provider_profile_id: string; provider_profile_version: string; max_cost_usd_micros: number; cost_currency: string; estimate_basis: string }>(`SELECT id,status,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis FROM supplier_exposures WHERE owner_id=? AND task_id=?`, row.owner_id, taskId);
      if (!exposure || exposure.status !== 'reserved' || exposure.provider_profile_id !== supplier.supplierProfileId || exposure.provider_profile_version !== supplier.profileVersion || exposure.max_cost_usd_micros !== supplier.maxSupplierCostMicrosUSD || exposure.cost_currency !== 'USD' || exposure.estimate_basis !== 'profile_max_cost_usd_micros' || tx.get('SELECT 1 FROM supplier_attempts WHERE owner_id=? AND task_id=?', row.owner_id, taskId)) throw new WorkerError('SUPPLIER_LIABILITY_UNKNOWN');
      const liability = supplierLiability(tx);
      if (liability > BigInt(supplier.approvedBudgetMicrosUSD)) throw new WorkerError('SUPPLIER_BUDGET_EXCEEDED');
      if (options.dispatchGuard) {
        const approved: unknown = options.dispatchGuard({ tx, taskId, ownerId: row.owner_id, projectId: row.project_id, maximumExposureMicrosUSD: exposure.max_cost_usd_micros, currentLiabilityMicrosUSD: liability });
        if (thenable(approved)) { void Promise.resolve(approved).catch(() => {}); throw new WorkerError('SUPPLIER_BUDGET_EXCEEDED'); }
        if (approved === false) throw new WorkerError('SUPPLIER_BUDGET_EXCEEDED');
      }
    } else if (scope !== 'demo' || semantic.supplier !== null || semantic.supplierExposureMicrosUSD !== 0 || tx.get('SELECT 1 FROM supplier_attempts WHERE owner_id=? AND task_id=?', row.owner_id, taskId)) throw new WorkerError('TASK_SNAPSHOT_INVALID');

    const timestamp = clockIso(clock), updated = tx.run("UPDATE tasks SET status='processing',updated_at=? WHERE owner_id=? AND id=? AND status='queued'", timestamp, row.owner_id, taskId);
    if (updated.changes !== 1) return null;
    let attemptId: string | null = null;
    if (scope === 'live') {
      const supplier = semantic.supplier!; attemptId = makeId(); if (!id(attemptId)) throw new WorkerError('GENERATION_FAILED');
      tx.run(`INSERT INTO supplier_attempts(id,owner_id,task_id,provider_profile_id,provider_profile_version,status,estimated_cost_usd_micros,started_at)
        VALUES (?,?,?,?,?,'started',?,?)`, attemptId, row.owner_id, taskId, supplier.supplierProfileId, supplier.profileVersion, supplier.maxSupplierCostMicrosUSD, timestamp);
      const started = tx.run("UPDATE supplier_exposures SET status='started',updated_at=? WHERE owner_id=? AND task_id=? AND status='reserved'", timestamp, row.owner_id, taskId);
      if (started.changes !== 1) throw new WorkerError('SUPPLIER_LIABILITY_UNKNOWN');
    }
    return { taskId, ownerId: row.owner_id, projectId: row.project_id, scope, snapshot, attemptId, demoResult };
  }

  function preDispatch(claimed: Claimed): boolean {
    return repo.transaction(tx => {
      const row = tx.get<WorkerTaskRow>(TASK_QUERY, claimed.taskId);
      if (!row || !['processing','uncertain'].includes(row.status)) return false;
      if (row.owner_id !== claimed.ownerId || row.project_id !== claimed.projectId) throw new WorkerError('TASK_DELETED');
      if (row.owner_deleted_at) throw new WorkerError('ACCOUNT_DELETED');
      if (row.project_deleted_at) throw new WorkerError('TASK_DELETED');
      validateBinding(row, claimed.snapshot);
      if (claimed.attemptId) {
        const attempt = tx.get<Attempt>('SELECT id,owner_id,task_id,status,provider_profile_id,provider_profile_version FROM supplier_attempts WHERE id=? AND owner_id=? AND task_id=?', claimed.attemptId, claimed.ownerId, claimed.taskId);
        if (!attempt || attempt.status !== 'started' || row.status !== 'processing') return false;
      }
      plans.assertCurrent(claimed.snapshot.plan);
      return true;
    });
  }

  function recordAttempt(tx: WalletTransaction, claimed: Claimed, record: FailureRecord, extra: { requestId?: string | null; usage?: Usage | null; width?: number; height?: number } = {}): void {
    if (!claimed.attemptId) return;
    const endedAt = clockIso(clock), exposureStatus = record.cost === null ? 'uncertain' : 'settled';
    const attempt = tx.run(`UPDATE supplier_attempts SET status=?,provider_request_id=?,usage_json=?,error_category=?,reconciled_cost_usd_micros=?,actual_width=?,actual_height=?,ended_at=?
      WHERE id=? AND owner_id=? AND task_id=? AND status IN ('started','uncertain')`, record.status, extra.requestId ?? null, extra.usage ? canonicalJson(extra.usage) : null, record.category ?? null, record.cost, extra.width ?? null, extra.height ?? null, endedAt, claimed.attemptId, claimed.ownerId, claimed.taskId);
    if (attempt.changes !== 1) throw new WorkerError('SUPPLIER_LIABILITY_UNKNOWN');
    const exposure = tx.run('UPDATE supplier_exposures SET status=?,updated_at=? WHERE owner_id=? AND task_id=? AND status IN (\'started\',\'uncertain\')', exposureStatus, endedAt, claimed.ownerId, claimed.taskId);
    if (exposure.changes !== 1) throw new WorkerError('SUPPLIER_LIABILITY_UNKNOWN');
  }

  function finishFailure(claimed: Claimed, record: FailureRecord): WorkerRunResult {
    return repo.transaction(tx => {
      const row = tx.get<WorkerTaskRow>(TASK_QUERY, claimed.taskId);
      if (!row) return { status: 'discarded', taskId: claimed.taskId };
      if (row.status === 'succeeded' && row.result_version_id) return { status: 'succeeded', taskId: claimed.taskId, resultVersionId: row.result_version_id };
      if (!['processing','uncertain'].includes(row.status)) return { status: 'discarded', taskId: claimed.taskId };
      if (row.owner_id !== claimed.ownerId || row.project_id !== claimed.projectId) return { status: 'discarded', taskId: claimed.taskId };
      recordAttempt(tx, claimed, record, record);
      repo.finalizeTaskInTransaction(tx, { ownerId: claimed.ownerId, taskId: claimed.taskId, outcome: 'failed' });
      tx.run('UPDATE tasks SET safe_error_code=? WHERE owner_id=? AND id=? AND status=\'failed\'', SAFE_TASK_ERROR_CODES.includes(record.code) ? record.code : 'GENERATION_FAILED', claimed.ownerId, claimed.taskId);
      return { status: 'failed', taskId: claimed.taskId };
    });
  }

  function assertOutputAuthorization(tx: WalletTransaction, claimed: Claimed, row: WorkerTaskRow | undefined): void {
    if (!row || !['processing','uncertain'].includes(row.status) || row.owner_id !== claimed.ownerId || row.project_id !== claimed.projectId) throw new WorkerError('TASK_DELETED');
    if (row.owner_deleted_at) throw new WorkerError('ACCOUNT_DELETED');
    if (row.project_deleted_at) throw new WorkerError('TASK_DELETED');
    validateBinding(row, claimed.snapshot);
    plans.assertCurrent(claimed.snapshot.plan);
  }

  function finishSuccess(claimed: Claimed, master: ImageAsset, display: ImageAsset, result: Extract<ProviderResult, { ok: true }> | null): WorkerRunResult {
    return repo.transaction(tx => {
      const row = tx.get<WorkerTaskRow>(TASK_QUERY, claimed.taskId);
      if (!row) return { status: 'discarded', taskId: claimed.taskId };
      if (row.status === 'succeeded' && row.result_version_id) return { status: 'succeeded', taskId: claimed.taskId, resultVersionId: row.result_version_id };
      if (!['processing','uncertain'].includes(row.status) || row.owner_id !== claimed.ownerId || row.project_id !== claimed.projectId) return { status: 'discarded', taskId: claimed.taskId };
      assertOutputAuthorization(tx, claimed, row);
      const semantic = claimed.snapshot.plan.semantic, supplier = semantic.supplier;
      if (claimed.scope === 'live' && (!result || !supplier || result.profileId !== supplier.supplierProfileId || result.profileVersion !== supplier.profileVersion || result.model !== supplier.model || result.templateVersion !== supplier.templateVersion || result.maxExposureMicrosUSD !== supplier.maxSupplierCostMicrosUSD)) throw new WorkerError('GENERATION_FAILED');
      checkTaskStorageHeadroom(db, claimed.ownerId, options.storageQuotaBytes);
      const createdAt = clockIso(clock), masterId = insertAsset(tx, { ownerId: claimed.ownerId, projectId: claimed.projectId, kind: 'master', image: master, createdAt, makeId });
      const displayId = insertAsset(tx, { ownerId: claimed.ownerId, projectId: claimed.projectId, kind: 'display', image: display, createdAt, makeId });
      const versionId = makeId(); if (!id(versionId)) throw new WorkerError('GENERATION_FAILED');
      const parent = semantic.source.kind === 'version' ? semantic.source.versionId! : null;
      tx.run(`INSERT INTO versions(id,owner_id,project_id,parent_version_id,master_asset_id,display_asset_id,task_id,name,favorite,created_at,recipe_json)
        VALUES (?,?,?,?,?,?,?,NULL,0,?,?)`, versionId, claimed.ownerId, claimed.projectId, parent, masterId, displayId, claimed.taskId, createdAt, canonicalJson({ schemaVersion: 2, requestEdits: semantic.requestEdits, desiredRecipe: semantic.desiredRecipe, observedRecipe: semantic.observedRecipe, qualityAssessment: { status: 'unassessed' } }));
      const provenance = {schemaVersion:1,taskId:claimed.taskId,versionId,declaredOutput:supplier?.output??null,
        sourceSha256:master.sourceSha256,sourceGeometry:{width:master.sourceWidth,height:master.sourceHeight},
        canonicalSha256:master.sha256,canonicalGeometry:{width:master.width,height:master.height},pixelSha256:master.pixelSha256,
        normalizerVersion:master.normalizerVersion,sourceFormat:master.sourceFormat,sourceOrientation:master.sourceOrientation};
      tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES (?,?,'version.output.created',?,?)", makeId(), claimed.ownerId, canonicalJson(provenance), createdAt);
      if (result) {
        const actual = result.actualCostMicrosUSD;
        const cost = actual === null ? null : actual;
        const category = null;
        recordAttempt(tx, claimed, { code: 'GENERATION_FAILED', sent: true, cost, status: 'succeeded', requestId: result.providerRequestId, usage: result.usage, category }, { requestId: result.providerRequestId, usage: result.usage, width: master.width, height: master.height });
      }
      repo.finalizeTaskInTransaction(tx, { ownerId: claimed.ownerId, taskId: claimed.taskId, outcome: 'succeeded', resultVersionId: versionId });
      return { status: 'succeeded', taskId: claimed.taskId, resultVersionId: versionId };
    });
  }

  async function persistOutput(claimed: Claimed, input: Awaited<ReturnType<ReturnType<typeof createPlanService>['readCurrentInputs']>>, bytes: Buffer, result: Extract<ProviderResult, { ok: true }> | null): Promise<WorkerRunResult> {
    let master: ImageAsset, display: ImageAsset;
    try {
      master = await validateOutputMaster(bytes);
      if (exactPixelEquality(master, input.source.image)) return finishFailure(claimed, { code: 'OUTPUT_UNCHANGED', sent: !!claimed.attemptId, cost: result?.actualCostMicrosUSD ?? null, status: 'failed', requestId: result?.providerRequestId, usage: result?.usage, category: 'invalid_output' });
      if (claimed.scope === 'live') master = await validateOutputMaster(bytes, minimumFor(claimed.snapshot.plan.semantic.supplier!.output.size));
      display = await createDisplayAsset(master);
    } catch (error) {
      const code = error instanceof ImageError ? 'OUTPUT_INVALID' : safeCode(error);
      return finishFailure(claimed, { code, sent: !!claimed.attemptId, cost: result?.actualCostMicrosUSD ?? null, status: 'failed', requestId: result?.providerRequestId, usage: result?.usage, category: 'invalid_output' });
    }
    if (options.qualityReview) {
      try { repo.transaction(tx => assertOutputAuthorization(tx, claimed, tx.get<WorkerTaskRow>(TASK_QUERY, claimed.taskId))); }
      catch (error) { return finishFailure(claimed, {code:safeCode(error),sent:!!claimed.attemptId,cost:result?.actualCostMicrosUSD??null,status:'failed',category:'authorization',requestId:result?.providerRequestId,usage:result?.usage}); }
      try { await options.qualityReview({taskId:claimed.taskId,ownerId:claimed.ownerId,projectId:claimed.projectId,plan:claimed.snapshot.plan,master}); }
      catch { return finishFailure(claimed, {code:'OUTPUT_REJECTED',sent:!!claimed.attemptId,cost:result?.actualCostMicrosUSD??null,status:'failed',category:'quality',requestId:result?.providerRequestId,usage:result?.usage}); }
    }
    try { return finishSuccess(claimed, master, display, result); }
    catch (error) {
      const code = error instanceof WorkerError || error instanceof PlanError || error instanceof TaskError || error instanceof WalletError ? safeCode(error) : 'STORAGE_WRITE_FAILED';
      return finishFailure(claimed, { code, sent: !!claimed.attemptId, cost: result?.actualCostMicrosUSD ?? null, status: 'failed', requestId: result?.providerRequestId, usage: result?.usage, category: 'storage' });
    }
  }

  async function runTask(taskId: string): Promise<WorkerRunResult> {
    if (!id(taskId)) return { status: 'not_claimed', taskId: String(taskId).slice(0, 128) };
    const probe = rowFor(db, taskId); if (!probe || probe.status !== 'queued') return { status: 'not_claimed', taskId };
    if (!concurrency || active.size >= concurrency || active.has(taskId)) return { status: 'disabled', taskId };
    let probed: TaskSnapshot;
    try { probed = readTaskSnapshot(probe.request_snapshot_json); validateBinding(probe, probed); }
    catch { throw new WorkerError('TASK_SNAPSHOT_INVALID'); }
    if (probed.scope === 'live' && (!options.liveDispatchEnabled || !options.serverProvider)) return { status: 'disabled', taskId };
    if (probed.scope === 'demo' && !matchesDemo(demoResults, probed)) return { status: 'disabled', taskId };
    active.add(taskId);
    try {
      let claimed: Claimed | null;
      try { claimed = repo.transaction(tx => claim(tx, taskId)); }
      catch (error) { if (error instanceof WorkerError && error.code === 'SUPPLIER_BUDGET_EXCEEDED') return { status: 'disabled', taskId }; throw error; }
      if (!claimed) return { status: 'not_claimed', taskId };
      let inputs: Awaited<ReturnType<typeof plans.readCurrentInputs>>;
      try { inputs = await plans.readCurrentInputs(claimed.snapshot.plan); }
      catch (error) { return finishFailure(claimed, { code: safeCode(error), sent: false, cost: claimed.attemptId ? 0 : null, status: 'failed' }); }
      let authorized: boolean;
      try { authorized = preDispatch(claimed); }
      catch (error) { return finishFailure(claimed, { code: safeCode(error), sent: false, cost: claimed.attemptId ? 0 : null, status: 'failed' }); }
      if (!authorized) return { status: 'discarded', taskId };
      if (claimed.scope === 'demo') return persistOutput(claimed, inputs, Buffer.from(claimed.demoResult!.bytes), null);
      const semantic = claimed.snapshot.plan.semantic, sourceRef = semantic.source.kind === 'version' ? { kind: 'version' as const, versionId: semantic.source.versionId! } : { kind: 'original' as const };
      const asset = (value: typeof inputs.source, source: ProviderInput['primary']['source']) => ({ ownerId: claimed!.ownerId, projectId: claimed!.projectId, assetId: value.row.id, source, mimeType: 'image/png' as const, sha256: value.image.sha256, bytes: value.image.bytes });
      let providerInput: ProviderInput;
      try { providerInput = { ownerId: claimed.ownerId, projectId: claimed.projectId, editRequest: providerEditRequest(claimed.snapshot.plan), primary: asset(inputs.source, sourceRef), ...(claimed.snapshot.plan.semantic.originalReference && inputs.originalReference ? { originalReference: asset(inputs.originalReference, { kind: 'original' }) } : {}) }; }
      catch (error) { return finishFailure(claimed, { code: safeCode(error), sent: false, cost: 0, status: 'failed' }); }
      let response: ProviderResult;
      try { response = await options.serverProvider!(providerInput); }
      catch { return finishFailure(claimed, { code: 'PROVIDER_TRANSPORT_UNKNOWN', sent: true, cost: null, status: 'uncertain', category: 'uncertain' }); }
      if (!validProviderResult(response)) return finishFailure(claimed, { code: 'GENERATION_FAILED', sent: true, cost: null, status: 'uncertain', category: 'uncertain' });
      if (!response.attempted) return finishFailure(claimed, { code: SAFE_TASK_ERROR_CODES.includes(response.error.code) ? response.error.code : 'PROVIDER_DISABLED', sent: false, cost: 0, status: 'failed', category: response.error.category });
      if (!response.ok) {
        const code = SAFE_TASK_ERROR_CODES.includes(response.error.code) ? response.error.code : response.error.category === 'invalid_output' ? 'OUTPUT_INVALID' : 'GENERATION_FAILED';
        return finishFailure(claimed, { code, sent: true, cost: response.actualCostMicrosUSD, status: response.error.category === 'uncertain' || response.error.category === 'aborted' ? 'uncertain' : 'failed', requestId: response.providerRequestId, usage: response.usage, category: response.error.category });
      }
      if (!response.image.length || response.image.length > semantic.supplier!.maxOutputBytes) return finishFailure(claimed, {code:'OUTPUT_INVALID',sent:true,cost:response.actualCostMicrosUSD,status:'failed',requestId:response.providerRequestId,usage:response.usage,category:'invalid_output'});
      return persistOutput(claimed, inputs, Buffer.from(response.image), response);
    } finally { active.delete(taskId); }
  }

  return Object.freeze({ runTask });
}
