import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../shared/v2/edit-plan.js';
import { planCompensation } from '../../shared/v2/form-quality-policy.js';
import { readQualityReviewsInTransaction, type QualityReviewAuthorizer, type QualityReviewRecord } from './audit.js';
import { hasDirectCompletedOwnerUpgrade } from './merge.js';
import { appleRevocationTombstoneId, type ApplePurchaseEnvironment } from './purchases.js';
import { WalletRepository, type WalletTransaction, type WalletScope } from './wallet-repo.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const FEEDBACK_ID = /^feedback:[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Plain = Record<string, unknown>;
type TaskRow = {
  id: string; owner_id: string; project_id: string; plan_id: string | null; confirmed_plan_id: string | null;
  status: string; user_cost_units: number; result_version_id: string | null; root_task_id: string | null;
  request_snapshot_json: string | null;
};
type AllocationRow = {
  credit_lot_id: string; units: number; revoked_units: number; lot_units: number; lot_revoked_units: number; owner_id: string; kind: string; scope: string;
  source_kind: string; source_event_key: string; purchase_id: string | null;
};
type SettleRow = { owner_id: string; ledger_event_key: string; task_id: string | null; credit_lot_id: string | null; event_type: string; units: number; origin_owner_id: string | null };

export class QualityCompensationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'QualityCompensationError'; }
}

export interface QualityCompensationRequest { taskId: string; versionId: string; feedbackId: string }
export interface QualityCompensationOptions {
  db: DatabaseSync; authorizeOperator?: QualityReviewAuthorizer; clock?: () => Date; id?: () => string;
}
export type QualityCompensationResult = { status: 'granted' | 'already_compensated' | 'not_approved' | 'not_eligible' | 'blocked_refund'; units?: number; rootTaskId?: string };

function plain(value: unknown): value is Plain {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: Plain, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key));
}
function safeId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function invalid(): never { throw new QualityCompensationError('COMPENSATION_INVALID'); }
function facts(): never { throw new QualityCompensationError('COMPENSATION_FACTS_INVALID'); }
function validUnits(value: unknown, allowZero = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
}
function parseRequest(value: unknown): QualityCompensationRequest {
  if (!plain(value) || !exact(value, ['taskId', 'versionId', 'feedbackId']) || !safeId(value.taskId) || !safeId(value.versionId) ||
      typeof value.feedbackId !== 'string' || !FEEDBACK_ID.test(value.feedbackId)) invalid();
  return { taskId: value.taskId, versionId: value.versionId, feedbackId: value.feedbackId };
}
function timestamp(clock: () => Date): string {
  let date: Date;
  try { date = clock(); } catch { throw new QualityCompensationError('COMPENSATION_UNAVAILABLE'); }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new QualityCompensationError('COMPENSATION_UNAVAILABLE');
  return date.toISOString();
}
function latestMatchingReview(reviews: QualityReviewRecord[], request: QualityCompensationRequest): QualityReviewRecord | undefined {
  return reviews.find(review => review.taskId === request.taskId && review.versionId === request.versionId && review.feedbackId === request.feedbackId);
}
function eligibleReview(review: QualityReviewRecord | undefined): review is QualityReviewRecord {
  return !!review && review.decision === 'accepted' && ['identity_changed', 'target_not_applied', 'unwanted_structure', 'image_artifacts'].includes(review.category);
}

function activeTask(tx: WalletTransaction, ownerId: string, request: QualityCompensationRequest): TaskRow | undefined {
  return tx.get<TaskRow>(`SELECT t.id,t.owner_id,t.project_id,t.plan_id,t.confirmed_plan_id,t.status,t.user_cost_units,t.result_version_id,t.root_task_id,t.request_snapshot_json
    FROM users u JOIN projects p ON p.owner_id=u.id JOIN tasks t ON t.owner_id=p.owner_id AND t.project_id=p.id
    JOIN versions v ON v.owner_id=t.owner_id AND v.project_id=t.project_id AND v.task_id=t.id
    WHERE u.id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND t.id=? AND t.status='succeeded'
      AND t.result_version_id=? AND v.id=?`, ownerId, request.taskId, request.versionId, request.versionId);
}

function rootLineage(tx: WalletTransaction, task: TaskRow): TaskRow[] | undefined {
  const path: TaskRow[] = [task], seen = new Set([task.id]);
  let current = task;
  while (current.root_task_id !== null) {
    const parentId = current.root_task_id;
    if (!safeId(parentId) || seen.has(parentId)) facts();
    const parent = tx.get<TaskRow>(`SELECT id,owner_id,project_id,plan_id,confirmed_plan_id,status,user_cost_units,result_version_id,root_task_id,request_snapshot_json
      FROM tasks WHERE owner_id=? AND project_id=? AND id=?`, task.owner_id, task.project_id, parentId);
    if (!parent || parent.status !== 'succeeded') return undefined;
    seen.add(parentId); path.push(parent); current = parent;
  }
  return path;
}

function snapshotScope(snapshot: string | null): WalletScope | undefined {
  if (snapshot === null) return undefined;
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!plain(value) || value.scope !== 'demo' && value.scope !== 'live') facts();
    return value.scope;
  } catch (error) {
    if (error instanceof QualityCompensationError) throw error;
    facts();
  }
}

function validateConfirmedQuote(tx: WalletTransaction, task: TaskRow, units: number): void {
  if (task.confirmed_plan_id === null) {
    if (task.plan_id !== null) facts();
    return;
  }
  if (task.plan_id !== task.confirmed_plan_id) facts();
  const quote = tx.get<{ owner_id: string; project_id: string; user_cost_units: number; confirmed_at: string | null }>(
    'SELECT owner_id,project_id,user_cost_units,confirmed_at FROM plans WHERE owner_id=? AND project_id=? AND id=?', task.owner_id, task.project_id, task.confirmed_plan_id);
  if (!quote || quote.confirmed_at === null || !validUnits(quote.user_cost_units) || quote.user_cost_units !== units) facts();
}

function validSettlement(tx: WalletTransaction, db: DatabaseSync, task: TaskRow): { units: number; scope: WalletScope; allocations: AllocationRow[] } {
  if (task.status !== 'succeeded' || task.result_version_id === null || !validUnits(task.user_cost_units)) facts();
  if (!tx.get('SELECT 1 FROM versions WHERE owner_id=? AND project_id=? AND id=? AND task_id=?',
    task.owner_id, task.project_id, task.result_version_id, task.id)) facts();
  const reservation = tx.get<{ id: string; owner_id: string; task_id: string; units: number; status: string }>(
    'SELECT id,owner_id,task_id,units,status FROM reservations WHERE owner_id=? AND task_id=?', task.owner_id, task.id);
  if (!reservation || reservation.status !== 'settled' || reservation.owner_id !== task.owner_id || reservation.task_id !== task.id ||
      !validUnits(reservation.units) || reservation.units !== task.user_cost_units) facts();
  const allocations = tx.all<AllocationRow>(`SELECT allocation.credit_lot_id,allocation.units,allocation.revoked_units,lot.units AS lot_units,lot.revoked_units AS lot_revoked_units,lot.owner_id,lot.kind,lot.scope,lot.source_kind,lot.source_event_key,lot.purchase_id
    FROM reservation_allocations allocation JOIN credit_lots lot ON lot.owner_id=allocation.owner_id AND lot.id=allocation.credit_lot_id
    WHERE allocation.owner_id=? AND allocation.reservation_id=? ORDER BY allocation.credit_lot_id`, task.owner_id, reservation.id);
  if (allocations.length === 0) facts();
  let allocationUnits = 0;
  const scopes = new Set<WalletScope>();
  for (const allocation of allocations) {
    if (!safeId(allocation.credit_lot_id) || allocation.owner_id !== task.owner_id || !validUnits(allocation.units) || !validUnits(allocation.revoked_units, true) ||
        allocation.revoked_units > allocation.units || !validUnits(allocation.lot_units) || !validUnits(allocation.lot_revoked_units, true) || !['purchased', 'promo'].includes(allocation.kind) || !['demo', 'live'].includes(allocation.scope) ||
        !['legacy_import', 'purchase', 'promo', 'trial', 'quality_compensation'].includes(allocation.source_kind) || typeof allocation.source_event_key !== 'string' || allocation.source_event_key.length < 1) facts();
    const grants = tx.all<{ owner_id: string; ledger_event_key: string; event_type: string; units: number; task_id: string | null; credit_lot_id: string | null; origin_owner_id: string | null }>(
      "SELECT owner_id,ledger_event_key,event_type,units,task_id,credit_lot_id,origin_owner_id FROM ledger_events WHERE owner_id=? AND credit_lot_id=? AND event_type='grant'",
      task.owner_id, allocation.credit_lot_id);
    if (grants.length !== 1 || grants[0]!.owner_id !== task.owner_id || grants[0]!.ledger_event_key !== `grant:${allocation.source_event_key}` ||
        grants[0]!.units !== allocation.lot_units || grants[0]!.task_id !== null || grants[0]!.credit_lot_id !== allocation.credit_lot_id ||
        typeof grants[0]!.origin_owner_id !== 'string' || !(grants[0]!.origin_owner_id === task.owner_id || hasDirectCompletedOwnerUpgrade(db, grants[0]!.origin_owner_id, task.owner_id))) facts();
    allocationUnits += allocation.units;
    if (!Number.isSafeInteger(allocationUnits)) facts();
    scopes.add(allocation.scope as WalletScope);
  }
  if (allocationUnits !== reservation.units || scopes.size !== 1) facts();
  const scope = [...scopes][0]!;
  const recordedScope = snapshotScope(task.request_snapshot_json);
  if (recordedScope && recordedScope !== scope) facts();
  validateConfirmedQuote(tx, task, reservation.units);

  const settlements = tx.all<SettleRow>(`SELECT owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id
    FROM ledger_events WHERE owner_id=? AND task_id=? AND event_type='settle' ORDER BY ledger_event_key`, task.owner_id, task.id);
  if (settlements.length !== allocations.length) facts();
  const byKey = new Map(settlements.map(row => [row.ledger_event_key, row]));
  let settledUnits = 0;
  for (const allocation of allocations) {
    const event = byKey.get(`settle:${task.id}:${allocation.credit_lot_id}`);
    if (!event || event.owner_id !== task.owner_id || event.task_id !== task.id || event.credit_lot_id !== allocation.credit_lot_id ||
        event.event_type !== 'settle' || event.units !== allocation.units || typeof event.origin_owner_id !== 'string' ||
        !(event.origin_owner_id === task.owner_id || hasDirectCompletedOwnerUpgrade(db, event.origin_owner_id, task.owner_id))) facts();
    settledUnits += event.units;
    if (!Number.isSafeInteger(settledUnits)) facts();
  }
  if (settledUnits !== reservation.units) facts();
  return { units: settledUnits, scope, allocations };
}

function refundState(tx: WalletTransaction, allocation: AllocationRow, ownerId: string): 'clear' | 'refunded' {
  if (allocation.source_kind !== 'purchase') {
    if (allocation.purchase_id !== null || allocation.kind === 'purchased') facts();
    if (allocation.revoked_units !== 0 || allocation.lot_revoked_units !== 0) facts();
    return 'clear';
  }
  if (allocation.kind !== 'purchased' || !allocation.purchase_id || allocation.scope !== 'live') facts();
  const purchase = tx.get<{ id: string; owner_id: string; environment: string; transaction_id: string; product_id: string }>(
    'SELECT id,owner_id,environment,transaction_id,product_id FROM purchases WHERE owner_id=? AND id=?', ownerId, allocation.purchase_id);
  if (!purchase || purchase.owner_id !== ownerId || !['Sandbox', 'Production'].includes(purchase.environment) ||
      !/^[A-Za-z0-9._-]{1,256}$/.test(purchase.transaction_id) || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(purchase.product_id)) facts();
  let tombstoneId: string;
  try { tombstoneId = appleRevocationTombstoneId(purchase.environment as ApplePurchaseEnvironment, purchase.transaction_id); }
  catch { facts(); }
  const transactionDigest = digest(purchase.transaction_id);
  const tombstone = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', tombstoneId!);
  const appliedId = `apple-refund-applied:v1:${digest(`${purchase.environment}:${purchase.transaction_id}`)}`;
  const applied = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', appliedId);
  const refundLedgerKey = `apple-refund:v1:${purchase.environment}:${transactionDigest}:${allocation.credit_lot_id}`;
  const refundLedgerRows = tx.all<{ owner_id: string; ledger_event_key: string; task_id: string | null; credit_lot_id: string | null; event_type: string; units: number; origin_owner_id: string | null }>(
    "SELECT owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id FROM ledger_events WHERE owner_id=? AND credit_lot_id=? AND event_type='refund'",
    ownerId, allocation.credit_lot_id);
  const refundLedger = refundLedgerRows[0];
  if (!tombstone && !applied && refundLedgerRows.length === 0 && allocation.revoked_units === 0 && allocation.lot_revoked_units === 0) return 'clear';
  if (!tombstone || tombstone.owner_id !== null || tombstone.event_type !== 'apple_revocation_tombstone' ||
      !applied || applied.owner_id !== ownerId || applied.event_type !== 'apple_refund_applied') facts();
  let tombstoneDetails: unknown, appliedDetails: unknown;
  try { tombstoneDetails = JSON.parse(tombstone.details_json); appliedDetails = JSON.parse(applied.details_json); }
  catch { facts(); }
  if (!plain(tombstoneDetails) || !exact(tombstoneDetails, ['version', 'environment', 'transactionDigest']) || tombstoneDetails.version !== 1 ||
      tombstoneDetails.environment !== purchase.environment || tombstoneDetails.transactionDigest !== transactionDigest ||
      !plain(appliedDetails) || !exact(appliedDetails, ['version', 'environment', 'transactionDigest', 'productId', 'purchaseId', 'lotId', 'revokedUnits', 'consumedLossUnits', 'exposedUnits', 'cancelledTaskCount']) ||
      appliedDetails.version !== 1 || appliedDetails.environment !== purchase.environment ||
      appliedDetails.transactionDigest !== transactionDigest || appliedDetails.productId !== purchase.product_id ||
      appliedDetails.purchaseId !== purchase.id || appliedDetails.lotId !== allocation.credit_lot_id ||
      !validUnits(appliedDetails.revokedUnits, true) || !validUnits(appliedDetails.consumedLossUnits, true) ||
      !validUnits(appliedDetails.exposedUnits, true) || !validUnits(appliedDetails.cancelledTaskCount, true)) facts();
  if (refundLedgerRows.length > 1 || refundLedger && (refundLedger.owner_id !== ownerId || refundLedger.ledger_event_key !== refundLedgerKey ||
      refundLedger.task_id !== null || refundLedger.credit_lot_id !== allocation.credit_lot_id || refundLedger.event_type !== 'refund' ||
      !validUnits(refundLedger.units) || refundLedger.origin_owner_id !== ownerId)) facts();
  if ((refundLedger?.units ?? 0) !== appliedDetails.revokedUnits || allocation.lot_revoked_units !== appliedDetails.revokedUnits) facts();
  return 'refunded';
}

function stableAuditId(rootTaskId: string): string { return `quality-compensation:v1:${digest(rootTaskId)}`; }
function assertPriorBenefit(tx: WalletTransaction, db: DatabaseSync, ownerId: string, root: TaskRow, units: number, scope: WalletScope): boolean {
  const row = tx.get<{ id: string; owner_id: string; root_task_id: string; units: number; created_at: string }>(
    'SELECT id,owner_id,root_task_id,units,created_at FROM quality_compensations WHERE root_task_id=?', root.id);
  if (!row) return false;
  const sourceKey = `quality_compensation:${root.id}`;
  const actualLot = tx.get<{ id: string; owner_id: string; kind: string; units: number; source_kind: string; source_event_key: string; scope: string }>(
    'SELECT id,owner_id,kind,units,source_kind,source_event_key,scope FROM credit_lots WHERE owner_id=? AND source_event_key=?', ownerId, sourceKey);
  const grant = tx.get<{ owner_id: string; ledger_event_key: string; event_type: string; units: number; task_id: string | null; credit_lot_id: string | null; origin_owner_id: string | null }>(
    'SELECT owner_id,ledger_event_key,event_type,units,task_id,credit_lot_id,origin_owner_id FROM ledger_events WHERE owner_id=? AND ledger_event_key=?', ownerId, `grant:${sourceKey}`);
  const auditId = stableAuditId(root.id);
  const audit = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', auditId);
  if (row.owner_id !== ownerId || row.root_task_id !== root.id || row.units !== units || !row.id || !Number.isFinite(Date.parse(row.created_at)) ||
      !actualLot || actualLot.owner_id !== ownerId || actualLot.kind !== 'promo' || actualLot.units !== units || actualLot.source_kind !== 'quality_compensation' || actualLot.source_event_key !== sourceKey || actualLot.scope !== scope ||
      !grant || grant.owner_id !== ownerId || grant.ledger_event_key !== `grant:${sourceKey}` || grant.event_type !== 'grant' || grant.units !== units || grant.task_id !== null || grant.credit_lot_id !== actualLot.id ||
      typeof grant.origin_owner_id !== 'string' || !(grant.origin_owner_id === ownerId || hasDirectCompletedOwnerUpgrade(db, grant.origin_owner_id, ownerId)) ||
      !audit || audit.event_type !== 'quality.compensation_applied' || typeof audit.owner_id !== 'string' ||
      !(audit.owner_id === ownerId || hasDirectCompletedOwnerUpgrade(db, audit.owner_id, ownerId))) facts();
  let details: unknown;
  try { details = JSON.parse(audit.details_json); } catch { facts(); }
  if (!plain(details) || !exact(details, ['version', 'rootTaskId', 'units', 'scope', 'sourceEventKey', 'review']) || details.version !== 1 ||
      details.rootTaskId !== root.id || details.units !== units || details.scope !== scope || details.sourceEventKey !== sourceKey || !plain(details.review) ||
      !exact(details.review, ['reviewKey', 'taskId', 'versionId', 'feedbackId', 'policyVersion', 'actorId', 'category', 'decision', 'policyEventKey'])) facts();
  const review = details.review;
  if (!safeId(review.reviewKey) || !safeId(review.taskId) || !safeId(review.versionId) || typeof review.feedbackId !== 'string' || !FEEDBACK_ID.test(review.feedbackId) ||
      !TOKEN.test(String(review.actorId)) || !TOKEN.test(String(review.category)) || review.decision !== 'accepted' || !TOKEN.test(String(review.policyVersion)) ||
      !['identity_changed', 'target_not_applied', 'unwanted_structure', 'image_artifacts'].includes(review.category as string) ||
      !tx.get('SELECT 1 FROM feedback WHERE id=? AND owner_id=? AND task_id=? AND category=?', review.feedbackId as string, ownerId, review.taskId as string, review.category as string)) facts();
  const reviewAuditId = `quality-review:${digest(`${audit.owner_id}\0${review.reviewKey}`)}`;
  const reviewAudit = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', reviewAuditId);
  if (!reviewAudit || reviewAudit.owner_id !== audit.owner_id || reviewAudit.event_type !== 'quality.review') facts();
  let recordedReview: unknown;
  try { recordedReview = JSON.parse(reviewAudit.details_json); } catch { facts(); }
  if (!plain(recordedReview) || !exact(recordedReview, ['v', 'reviewKey', 'actorId', 'taskId', 'versionId', 'feedbackId', 'category', 'decision', 'evidenceReference', 'policyVersion']) ||
      recordedReview.v !== 1 || recordedReview.reviewKey !== review.reviewKey || recordedReview.actorId !== review.actorId || recordedReview.taskId !== review.taskId ||
      recordedReview.versionId !== review.versionId || recordedReview.feedbackId !== review.feedbackId || recordedReview.category !== review.category ||
      recordedReview.decision !== 'accepted' || !TOKEN.test(String(recordedReview.evidenceReference)) || recordedReview.policyVersion !== review.policyVersion) facts();
  const originalTask = activeTask(tx, ownerId, { taskId: review.taskId, versionId: review.versionId, feedbackId: review.feedbackId });
  const originalLineage = originalTask && rootLineage(tx, originalTask);
  if (!originalLineage || originalLineage.at(-1)?.id !== root.id) facts();
  let recordedPlan: ReturnType<typeof planCompensation>;
  try { recordedPlan = planCompensation({ rootTaskId: root.id, taskStatus: 'succeeded', creditCost: units, rootAlreadyCompensated: true, review: 'approved', policyVersion: review.policyVersion as string }); }
  catch { facts(); }
  if (review.policyEventKey !== recordedPlan!.eventKey || recordedPlan!.benefitKey !== sourceKey || recordedPlan!.grantUnits !== 0 || grant.origin_owner_id !== audit.owner_id) facts();
  return true;
}

export function createQualityCompensationService(options: QualityCompensationOptions) {
  const wallet = new WalletRepository(options.db), clock = options.clock ?? (() => new Date()), makeId = options.id ?? randomUUID;
  return Object.freeze({
    compensate(ownerId: string, raw: unknown): QualityCompensationResult {
      if (!safeId(ownerId)) invalid();
      const request = parseRequest(raw), now = timestamp(clock);
      return wallet.transaction(tx => {
        const task = activeTask(tx, ownerId, request);
        if (!task) return { status: 'not_eligible' };
        const reviews = readQualityReviewsInTransaction(tx, ownerId, { taskId: task.id, versionId: request.versionId, limit: 100 }, options.authorizeOperator);
        const review = latestMatchingReview(reviews, request);
        if (!eligibleReview(review)) return { status: 'not_approved' };
        const lineage = rootLineage(tx, task);
        if (!lineage) return { status: 'not_eligible' };
        const root = lineage[lineage.length - 1]!;
        let lineageSettlements: ReturnType<typeof validSettlement>[];
        try { lineageSettlements = lineage.map(item => validSettlement(tx, options.db, item)); }
        catch (error) { if (error instanceof QualityCompensationError && error.code === 'COMPENSATION_FACTS_INVALID') throw error; throw new QualityCompensationError('COMPENSATION_FACTS_INVALID'); }
        if (lineageSettlements.some(item => item.allocations.some(allocation => allocation.source_kind === 'quality_compensation'))) {
          return { status: 'not_eligible', rootTaskId: root.id };
        }
        let refunded = false;
        for (const settlement of lineageSettlements) for (const allocation of settlement.allocations) {
          if (refundState(tx, allocation, ownerId) === 'refunded') refunded = true;
        }
        const rootSettlement = lineageSettlements[lineageSettlements.length - 1]!;
        if (refunded) return { status: 'blocked_refund', units: rootSettlement.units, rootTaskId: root.id };
        const alreadyCompensated = assertPriorBenefit(tx, options.db, ownerId, root, rootSettlement.units, rootSettlement.scope);
        let recommendation: ReturnType<typeof planCompensation>;
        try {
          recommendation = planCompensation({ rootTaskId: root.id, taskStatus: 'succeeded', creditCost: rootSettlement.units,
            rootAlreadyCompensated: alreadyCompensated, review: 'approved', policyVersion: review.policyVersion });
        } catch { facts(); }
        if (recommendation!.benefitKey !== `quality_compensation:${root.id}`) facts();
        if (alreadyCompensated) {
          if (recommendation!.grantUnits !== 0) facts();
          return { status: 'already_compensated', units: rootSettlement.units, rootTaskId: root.id };
        }
        if (recommendation!.grantUnits !== rootSettlement.units) facts();
        const sourceEventKey = recommendation!.benefitKey;
        const priorAudit = tx.get('SELECT 1 FROM audit_events WHERE id=?', stableAuditId(root.id));
        if (priorAudit) facts();
        tx.run('INSERT INTO quality_compensations(id,owner_id,root_task_id,units,created_at) VALUES(?,?,?,?,?)', makeId(), ownerId, root.id, recommendation!.grantUnits, now);
        const grant = wallet.grantInTransaction(tx, { ownerId, kind: 'promo', sourceKind: 'quality_compensation', sourceEventKey, units: recommendation!.grantUnits, scope: rootSettlement.scope, projectId: root.project_id, createdAt: now });
        if (grant.replayed) facts();
        const detailsJson = canonicalJson({ version: 1, rootTaskId: root.id, units: recommendation!.grantUnits, scope: rootSettlement.scope, sourceEventKey,
          review: { reviewKey: review.reviewKey, taskId: review.taskId, versionId: review.versionId, feedbackId: review.feedbackId, policyVersion: review.policyVersion,
            actorId: review.actorId, category: review.category, decision: review.decision, policyEventKey: recommendation!.eventKey } });
        tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,'quality.compensation_applied',?,?)",
          stableAuditId(root.id), ownerId, detailsJson, now);
        return { status: 'granted', units: recommendation!.grantUnits, rootTaskId: root.id };
      });
    },
  });
}
