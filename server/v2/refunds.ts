import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Environment } from '@apple/app-store-server-library';
import { createProductCatalog, findCatalogProduct } from './catalog.js';
import {
  appleRevocationTombstoneId,
  createAppleSignedDataAdapter,
  hasAppleRevocationTombstoneInTransaction,
  recordAppleRevocationTombstoneInTransaction,
  PurchaseError,
  type ApplePurchaseConfig,
  type ApplePurchaseEnvironment,
  type VerifiedAppleNotification,
} from './purchases.js';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const MAX_RECONCILIATION_ITEMS = 25;
const isEnvironment = (value: unknown): value is ApplePurchaseEnvironment => value === Environment.SANDBOX || value === Environment.PRODUCTION;
const isTransactionId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._-]{1,256}$/.test(value);
const isProductId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(value);
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isThenable = (value: unknown): boolean => !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';
function canonicalTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new PurchaseError('REFUND_TIME_INVALID', 503);
  return value;
}
function eventId(prefix: string, material: string) { return `${prefix}:v1:${sha(material)}`; }
function appendAudit(tx: WalletTransaction, id: string, ownerId: string | null, eventType: string, detailsJson: string, createdAt: string): void {
  const existing = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', id);
  if (existing) {
    if (existing.owner_id !== ownerId || existing.event_type !== eventType || existing.details_json !== detailsJson) throw new PurchaseError('REFUND_AUDIT_CONFLICT', 503);
    return;
  }
  tx.run('INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,?,?,?,?)', id, ownerId, eventType, detailsJson, createdAt);
}

export interface AppleRevocationInput { environment: ApplePurchaseEnvironment; transactionId: string; productId: string }
export interface AppleRevocationResult {
  matchedPurchase: boolean;
  revokedUnits: number;
  consumedLossUnits: number;
  exposedUnits: number;
  cancelledTaskIds: string[];
}
type PurchaseRow = { id: string; owner_id: string; environment: string; transaction_id: string; product_id: string };
type LotRow = { id: string; owner_id: string; kind: string; scope: string; source_kind: string; source_event_key: string; purchase_id: string; units: number; available_units: number; revoked_units: number };
type AllocationRow = {
  reservation_id: string; task_id: string; units: number; revoked_units: number; reservation_status: string; task_status: string;
  exposure_id: string | null; exposure_status: string | null; has_attempt: number;
};
const validUnits = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Applies a verified Apple reversal inside the caller's existing wallet transaction. */
export function applyAppleRevocationInTransaction(wallet: WalletRepository, tx: WalletTransaction, input: AppleRevocationInput, now: string): AppleRevocationResult {
  canonicalTime(now);
  if (!isEnvironment(input.environment) || !isTransactionId(input.transactionId) || !isProductId(input.productId)) throw new PurchaseError('PURCHASE_METADATA_INVALID', 400);
  recordAppleRevocationTombstoneInTransaction(tx, input.environment, input.transactionId, now);
  const purchase = tx.get<PurchaseRow>('SELECT id,owner_id,environment,transaction_id,product_id FROM purchases WHERE environment=? AND transaction_id=?', input.environment, input.transactionId);
  if (!purchase) return { matchedPurchase: false, revokedUnits: 0, consumedLossUnits: 0, exposedUnits: 0, cancelledTaskIds: [] };
  if (purchase.environment !== input.environment || purchase.transaction_id !== input.transactionId || purchase.product_id !== input.productId) throw new PurchaseError('PURCHASE_OWNER_CONFLICT', 409);
  const sourceKey = `apple-purchase:v1:${input.environment}:${sha(input.transactionId)}`;
  const lots = tx.all<LotRow>('SELECT id,owner_id,kind,scope,source_kind,source_event_key,purchase_id,units,available_units,revoked_units FROM credit_lots WHERE owner_id=? AND purchase_id=? AND source_kind=?', purchase.owner_id, purchase.id, 'purchase');
  if (lots.length !== 1) throw new PurchaseError('PURCHASE_LOT_MISSING', 503);
  const lot = lots[0]!;
  if (lot.id.length < 1 || lot.kind !== 'purchased' || lot.scope !== 'live' || lot.source_kind !== 'purchase' || lot.source_event_key !== sourceKey || lot.purchase_id !== purchase.id ||
      !validUnits(lot.units) || !validUnits(lot.available_units) || !validUnits(lot.revoked_units) || lot.available_units + lot.revoked_units > lot.units) throw new PurchaseError('PURCHASE_LOT_INVALID', 503);
  const allocations = tx.all<AllocationRow>(`SELECT allocation.reservation_id,allocation.units,allocation.revoked_units,reservation.task_id,reservation.status AS reservation_status,
      task.status AS task_status,exposure.id AS exposure_id,exposure.status AS exposure_status,
      CASE WHEN EXISTS(SELECT 1 FROM supplier_attempts attempt WHERE attempt.owner_id=task.owner_id AND attempt.task_id=task.id) THEN 1 ELSE 0 END AS has_attempt
    FROM reservation_allocations allocation
    JOIN reservations reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id
    JOIN tasks task ON task.owner_id=reservation.owner_id AND task.id=reservation.task_id
    LEFT JOIN supplier_exposures exposure ON exposure.owner_id=task.owner_id AND exposure.task_id=task.id
    WHERE allocation.owner_id=? AND allocation.credit_lot_id=? ORDER BY reservation.id`, lot.owner_id, lot.id);
  let activeUnits = 0, consumedLossUnits = 0, exposedUnits = 0;
  const queuedTaskIds: string[] = [], activeAllocations: AllocationRow[] = [];
  for (const allocation of allocations) {
    if (!validUnits(allocation.units) || !validUnits(allocation.revoked_units) || allocation.revoked_units > allocation.units) throw new PurchaseError('PURCHASE_ALLOCATION_INVALID', 503);
    const remaining = allocation.units - allocation.revoked_units;
    if (allocation.reservation_status === 'reserved') {
      activeUnits += remaining;
      activeAllocations.push(allocation);
      if (allocation.task_status === 'queued') {
        if (allocation.has_attempt || !allocation.exposure_id || allocation.exposure_status !== 'reserved') throw new PurchaseError('REFUND_QUEUED_EXPOSURE_CONFLICT', 503);
        queuedTaskIds.push(allocation.task_id);
      } else if (allocation.task_status === 'processing' || allocation.task_status === 'uncertain') {
        if (!allocation.has_attempt || !allocation.exposure_id || !['started', 'uncertain'].includes(allocation.exposure_status ?? '')) throw new PurchaseError('REFUND_ACTIVE_EXPOSURE_MISSING', 503);
        exposedUnits += remaining;
      } else throw new PurchaseError('REFUND_TASK_STATE_CONFLICT', 503);
    } else if (allocation.reservation_status === 'settled') {
      if (allocation.task_status !== 'succeeded') throw new PurchaseError('REFUND_SETTLED_TASK_CONFLICT', 503);
      consumedLossUnits += remaining;
    } else if (allocation.reservation_status !== 'released') throw new PurchaseError('REFUND_RESERVATION_STATE_CONFLICT', 503);
  }
  if (![activeUnits, consumedLossUnits, exposedUnits].every(Number.isSafeInteger) || lot.available_units + activeUnits + consumedLossUnits + lot.revoked_units !== lot.units) throw new PurchaseError('PURCHASE_LOT_ACCOUNTING_CONFLICT', 503);

  if (!hasAppleRevocationTombstoneInTransaction(tx, input.environment, input.transactionId)) throw new PurchaseError('REVOCATION_TOMBSTONE_CONFLICT', 503);
  const newlyRevoked = lot.available_units + activeUnits;
  for (const allocation of activeAllocations) {
    if (allocation.revoked_units === allocation.units) continue;
    const updated = tx.run('UPDATE reservation_allocations SET revoked_units=? WHERE owner_id=? AND reservation_id=? AND credit_lot_id=? AND revoked_units=?', allocation.units, lot.owner_id, allocation.reservation_id, lot.id, allocation.revoked_units);
    if (updated.changes !== 1) throw new PurchaseError('REFUND_ALLOCATION_RACE', 503);
  }
  if (newlyRevoked) {
    const revokedLot = tx.run('UPDATE credit_lots SET available_units=0,revoked_units=revoked_units+? WHERE owner_id=? AND id=? AND available_units=? AND revoked_units=?', newlyRevoked, lot.owner_id, lot.id, lot.available_units, lot.revoked_units);
    if (revokedLot.changes !== 1) throw new PurchaseError('REFUND_LOT_RACE', 503);
  }
  const ledgerKey = `apple-refund:v1:${input.environment}:${sha(input.transactionId)}:${lot.id}`;
  const priorRefund = tx.get<{ event_type: string; units: number; task_id: string | null; credit_lot_id: string | null; origin_owner_id: string | null }>('SELECT event_type,units,task_id,credit_lot_id,origin_owner_id FROM ledger_events WHERE owner_id=? AND ledger_event_key=?', lot.owner_id, ledgerKey);
  if (priorRefund && (priorRefund.event_type !== 'refund' || priorRefund.task_id !== null || priorRefund.credit_lot_id !== lot.id || priorRefund.origin_owner_id !== lot.owner_id || !validUnits(priorRefund.units) || priorRefund.units !== lot.revoked_units)) throw new PurchaseError('REFUND_LEDGER_CONFLICT', 503);
  if (!priorRefund && lot.revoked_units !== 0) throw new PurchaseError('REFUND_LEDGER_CONFLICT', 503);
  if (newlyRevoked) {
    if (priorRefund) throw new PurchaseError('REFUND_LEDGER_CONFLICT', 503);
    tx.run("INSERT INTO ledger_events(id,owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id,created_at) VALUES(?,?,?,NULL,?,'refund',?,?,?)", randomUUID(), lot.owner_id, ledgerKey, lot.id, newlyRevoked, lot.owner_id, now);
  }
  const cancelledTaskIds: string[] = [];
  for (const taskId of [...new Set(queuedTaskIds)]) {
    const completed = wallet.finalizeTaskInTransaction(tx, { ownerId: lot.owner_id, taskId, outcome: 'cancelled' });
    if (completed.status !== 'cancelled') throw new PurchaseError('REFUND_TASK_CANCEL_CONFLICT', 503);
    const released = tx.run("UPDATE supplier_exposures SET status='released',updated_at=? WHERE owner_id=? AND task_id=? AND status='reserved'", now, lot.owner_id, taskId);
    if (released.changes !== 1) throw new PurchaseError('REFUND_QUEUED_EXPOSURE_CONFLICT', 503);
    cancelledTaskIds.push(taskId);
  }
  const auditId = eventId('apple-refund-applied', `${input.environment}:${input.transactionId}`);
  const audit = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', auditId);
  if (audit) {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse(audit.details_json) as Record<string, unknown>; } catch { throw new PurchaseError('REFUND_AUDIT_CONFLICT', 503); }
    if (audit.owner_id !== purchase.owner_id || audit.event_type !== 'apple_refund_applied' || details.environment !== input.environment || details.transactionDigest !== sha(input.transactionId) || details.productId !== input.productId || details.purchaseId !== purchase.id || details.lotId !== lot.id ||
        details.revokedUnits !== lot.revoked_units + newlyRevoked || details.consumedLossUnits !== consumedLossUnits || !validUnits(details.exposedUnits as number) || (details.exposedUnits as number) > lot.units ||
        !validUnits(details.cancelledTaskCount as number) || (details.cancelledTaskCount as number) > lot.units) throw new PurchaseError('REFUND_AUDIT_CONFLICT', 503);
  } else {
    if (priorRefund) throw new PurchaseError('REFUND_AUDIT_CONFLICT', 503);
    const details = JSON.stringify({ version: 1, environment: input.environment, transactionDigest: sha(input.transactionId), productId: input.productId,
      purchaseId: purchase.id, lotId: lot.id, revokedUnits: lot.revoked_units + newlyRevoked, consumedLossUnits, exposedUnits, cancelledTaskCount: cancelledTaskIds.length });
    appendAudit(tx, auditId, purchase.owner_id, 'apple_refund_applied', details, now);
  }
  return { matchedPurchase: true, revokedUnits: newlyRevoked, consumedLossUnits, exposedUnits, cancelledTaskIds };
}

interface NotificationVerifier {
  enabled: boolean;
  productionEnabled: boolean;
  verifyNotification(signedPayload: string, environment: ApplePurchaseEnvironment): Promise<VerifiedAppleNotification>;
}
export interface AppleRefundServiceOptions {
  db: DatabaseSync; config?: ApplePurchaseConfig; environment?: ApplePurchaseEnvironment; verifier?: NotificationVerifier;
  enableOnlineChecks?: boolean; clock?: () => Date; id?: () => string;
}
export type AppleRefundService = ReturnType<typeof createAppleRefundService>;

export function createAppleRefundService(options: AppleRefundServiceOptions) {
  const config = options.config ?? {}, environment = options.environment;
  const verifier = options.verifier ?? createAppleSignedDataAdapter(config, { enableOnlineChecks: options.enableOnlineChecks });
  const catalog = createProductCatalog(config), wallet = new WalletRepository(options.db), clock = options.clock ?? (() => new Date()), makeId = options.id ?? randomUUID;
  const enabled = isEnvironment(environment) && verifier.enabled && catalog.enabled && (environment === Environment.SANDBOX || verifier.productionEnabled);
  async function processSignedNotification(signedPayload: string): Promise<{ status: 'accepted' | 'duplicate'; revokedUnits: number }> {
    if (!enabled || !environment) throw new PurchaseError('PURCHASES_DISABLED', 503);
    if (typeof signedPayload !== 'string' || signedPayload.length < 1 || Buffer.byteLength(signedPayload, 'utf8') > 64 * 1024) throw new PurchaseError('APPLE_NOTIFICATION_INVALID', 400);
    const notification = await verifier.verifyNotification(signedPayload, environment);
    if (!isUuid(notification.notificationUUID) || !/^[A-Z0-9_]{1,64}$/.test(notification.notificationType) || notification.environment !== environment ||
        notification.transaction && notification.transaction.environment !== environment) throw new PurchaseError('APPLE_NOTIFICATION_SCOPE_INVALID', 400);
    const isRefund = notification.notificationType === 'REFUND' || notification.notificationType === 'REVOKE';
    const transactionId = notification.transaction?.transactionId;
    const productId = notification.transaction?.productId;
    if (isRefund && (!isTransactionId(transactionId) || !isProductId(productId) || !Number.isSafeInteger(notification.transaction?.revocationDate) || (notification.transaction?.revocationDate ?? 0) <= 0 || !findCatalogProduct(catalog, productId))) {
      throw new PurchaseError('APPLE_NOTIFICATION_METADATA_INVALID', 400);
    }
    const time = clock();
    if (!(time instanceof Date) || !Number.isFinite(time.getTime())) throw new PurchaseError('REFUND_TIME_INVALID', 503);
    const now = time.toISOString();
    const uuidDigest = sha(notification.notificationUUID), transactionDigest = transactionId ? sha(transactionId) : null;
    const details = JSON.stringify({ version: 1, uuidDigest, notificationType: notification.notificationType, subtype: notification.subtype ?? null,
      environment, transactionDigest, productId: productId ?? null, revocationDate: notification.transaction?.revocationDate ?? null });
    const notificationId = `apple-notification:v1:${uuidDigest}`;
    return wallet.transaction(tx => {
      const existing = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', notificationId);
      const duplicate = !!existing;
      if (existing && (existing.owner_id !== null || existing.event_type !== 'apple_notification_received' || existing.details_json !== details)) throw new PurchaseError('APPLE_NOTIFICATION_CONFLICT', 409);
      if (!existing) tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,NULL,'apple_notification_received',?,?)", notificationId, details, now);
      let revokedUnits = 0;
      if (isRefund) {
        const result = applyAppleRevocationInTransaction(wallet, tx, { environment, transactionId: transactionId!, productId: productId! }, now);
        revokedUnits = result.revokedUnits;
      }
      return { status: duplicate ? 'duplicate' as const : 'accepted' as const, revokedUnits };
    });
  }
  return Object.freeze({ enabled, processSignedNotification });
}

export interface RefundReconciliationItem {
  environment: ApplePurchaseEnvironment | null; transactionDigest: string; status: 'awaiting_purchase' | 'needs_reconciliation' | 'complete' | 'invalid';
  purchaseId?: string; productId?: string; units?: number; availableUnits?: number; revokedUnits?: number;
}
export interface RefundReconciliationPreview { mode: 'dry-run'; items: RefundReconciliationItem[]; truncated: boolean; nextCursor?: string }
type TombstoneRow = { id: string; details_json: string; created_at: string };
type ReconciliationCursor = { createdAt: string; id: string };
function encodeCursor(row: TombstoneRow): string { return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64url'); }
function decodeCursor(cursor: string | undefined): ReconciliationCursor | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new PurchaseError('RECONCILIATION_CURSOR_INVALID', 400);
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) throw new Error('non-canonical');
    const value = JSON.parse(decoded.toString('utf8')) as Record<string, unknown>;
    const createdAt = typeof value.createdAt === 'string' ? new Date(value.createdAt) : undefined;
    if (!createdAt || !Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt ||
        typeof value.id !== 'string' || !/^apple-revocation:v1:(?:Sandbox|Production):[0-9a-f]{64}$/.test(value.id)) throw new Error('invalid fields');
    return { createdAt: value.createdAt as string, id: value.id };
  } catch { throw new PurchaseError('RECONCILIATION_CURSOR_INVALID', 400); }
}
function readTombstone(row: TombstoneRow): { environment: ApplePurchaseEnvironment; transactionDigest: string } | undefined {
  try {
    const value = JSON.parse(row.details_json) as Record<string, unknown>;
    if (value.version === 1 && isEnvironment(value.environment) && typeof value.transactionDigest === 'string' && /^[0-9a-f]{64}$/.test(value.transactionDigest)) {
      if (row.id === `apple-revocation:v1:${value.environment}:${value.transactionDigest}`) return { environment: value.environment, transactionDigest: value.transactionDigest };
    }
  } catch { /* malformed persisted data stays non-actionable */ }
  return undefined;
}
function reconciliationRows(db: DatabaseSync, limit: number, cursor?: string): { items: RefundReconciliationItem[]; truncated: boolean; nextCursor?: string } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECONCILIATION_ITEMS) throw new PurchaseError('RECONCILIATION_LIMIT_INVALID', 400);
  const after = decodeCursor(cursor);
  const rows = (after
    ? db.prepare("SELECT id,details_json,created_at FROM audit_events WHERE event_type='apple_revocation_tombstone' AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT ?").all(after.createdAt, after.createdAt, after.id, limit + 1)
    : db.prepare("SELECT id,details_json,created_at FROM audit_events WHERE event_type='apple_revocation_tombstone' ORDER BY created_at,id LIMIT ?").all(limit + 1)) as TombstoneRow[];
  const truncated = rows.length > limit;
  const page = rows.slice(0, limit);
  const items: RefundReconciliationItem[] = [];
  for (const row of page) {
    const tombstone = readTombstone(row);
    if (!tombstone) { items.push({ environment: null, transactionDigest: '', status: 'invalid' }); continue; }
    const sourceKey = `apple-purchase:v1:${tombstone.environment}:${tombstone.transactionDigest}`;
    const lot = db.prepare("SELECT id,owner_id,purchase_id,source_event_key,units,available_units,revoked_units FROM credit_lots WHERE source_kind='purchase' AND source_event_key=?").get(sourceKey) as {
      id: string; owner_id: string; purchase_id: string; source_event_key: string; units: number; available_units: number; revoked_units: number;
    } | undefined;
    if (!lot) { items.push({ ...tombstone, status: 'awaiting_purchase' }); continue; }
    const purchase = db.prepare('SELECT id,owner_id,environment,transaction_id,product_id FROM purchases WHERE id=? AND owner_id=?').get(lot.purchase_id, lot.owner_id) as {
      id: string; owner_id: string; environment: string; transaction_id: string; product_id: string;
    } | undefined;
    if (!purchase || purchase.environment !== tombstone.environment || sha(purchase.transaction_id) !== tombstone.transactionDigest || !validUnits(lot.units) || !validUnits(lot.available_units) || !validUnits(lot.revoked_units) || lot.available_units + lot.revoked_units > lot.units) {
      items.push({ ...tombstone, status: 'invalid' }); continue;
    }
    const active = db.prepare("SELECT COALESCE(SUM(allocation.units-allocation.revoked_units),0) AS units FROM reservation_allocations allocation JOIN reservations reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE allocation.owner_id=? AND allocation.credit_lot_id=? AND reservation.status='reserved'").get(lot.owner_id, lot.id) as { units: number };
    const settled = db.prepare("SELECT COALESCE(SUM(allocation.units-allocation.revoked_units),0) AS units FROM reservation_allocations allocation JOIN reservations reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE allocation.owner_id=? AND allocation.credit_lot_id=? AND reservation.status='settled'").get(lot.owner_id, lot.id) as { units: number };
    const ledgerKey = `apple-refund:v1:${tombstone.environment}:${tombstone.transactionDigest}:${lot.id}`;
    const refund = db.prepare('SELECT event_type,units,task_id,credit_lot_id,origin_owner_id FROM ledger_events WHERE owner_id=? AND ledger_event_key=?').get(lot.owner_id, ledgerKey) as {
      event_type: string; units: number; task_id: string | null; credit_lot_id: string | null; origin_owner_id: string | null;
    } | undefined;
    const applied = db.prepare('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?').get(eventId('apple-refund-applied', `${tombstone.environment}:${purchase.transaction_id}`)) as {
      owner_id: string | null; event_type: string; details_json: string;
    } | undefined;
    const accountedUnits = lot.available_units + lot.revoked_units + active.units + settled.units;
    const refundInvalid = lot.revoked_units === 0 ? !!refund : !refund || refund.event_type !== 'refund' || refund.units !== lot.revoked_units || refund.task_id !== null || refund.credit_lot_id !== lot.id || refund.origin_owner_id !== lot.owner_id;
    let auditInvalid = false;
    if (applied) {
      try {
        const details = JSON.parse(applied.details_json) as Record<string, unknown>;
        auditInvalid = applied.owner_id !== purchase.owner_id || applied.event_type !== 'apple_refund_applied' || details.environment !== tombstone.environment || details.transactionDigest !== tombstone.transactionDigest ||
          details.productId !== purchase.product_id || details.purchaseId !== purchase.id || details.lotId !== lot.id || details.revokedUnits !== lot.revoked_units || details.consumedLossUnits !== settled.units ||
          !validUnits(details.exposedUnits as number) || (details.exposedUnits as number) > lot.units || !validUnits(details.cancelledTaskCount as number) || (details.cancelledTaskCount as number) > lot.units;
      } catch { auditInvalid = true; }
    }
    if (!validUnits(active.units) || !validUnits(settled.units) || !Number.isSafeInteger(accountedUnits) || accountedUnits !== lot.units || refundInvalid || applied && auditInvalid || lot.revoked_units > 0 && !applied) { items.push({ ...tombstone, status: 'invalid' }); continue; }
    const isComplete = lot.available_units + active.units === 0 && !!applied;
    items.push({ ...tombstone, status: isComplete ? 'complete' : 'needs_reconciliation', purchaseId: purchase.id, productId: purchase.product_id, units: lot.units, availableUnits: lot.available_units, revokedUnits: lot.revoked_units });
  }
  return { items, truncated, ...(truncated && page.length ? { nextCursor: encodeCursor(page[page.length - 1]!) } : {}) };
}
export function previewRefundReconciliation(db: DatabaseSync, options: { limit?: number; cursor?: string } = {}): RefundReconciliationPreview {
  const result = reconciliationRows(db, options.limit ?? 10, options.cursor);
  return { mode: 'dry-run', ...result };
}
export interface TrustedRefundOperatorAuthorization { actorId: string }
export interface RefundReconciliationApplyOptions {
  limit: number; cursor?: string; authorize: (request: { action: 'apply-apple-refund-reconciliation'; environment: ApplePurchaseEnvironment; transactionDigest: string; purchaseId: string }) => TrustedRefundOperatorAuthorization | undefined;
  clock?: () => Date; id?: () => string;
}
export function applyRefundReconciliation(db: DatabaseSync, wallet: WalletRepository, options: RefundReconciliationApplyOptions): { applied: Array<{ transactionDigest: string; revokedUnits: number }>; nextCursor?: string } {
  if (typeof options.authorize !== 'function') throw new PurchaseError('OPERATOR_AUTHORIZATION_REQUIRED', 403);
  const preview = reconciliationRows(db, options.limit, options.cursor);
  if (preview.items.some(item => item.status === 'invalid')) throw new PurchaseError('RECONCILIATION_FACTS_INVALID', 503);
  const candidates = preview.items.filter((item): item is RefundReconciliationItem & { environment: ApplePurchaseEnvironment; status: 'needs_reconciliation'; purchaseId: string; productId: string } => item.status === 'needs_reconciliation' && !!item.environment && !!item.purchaseId && !!item.productId);
  const authorizations = new Map<string, TrustedRefundOperatorAuthorization>();
  for (const item of candidates) {
    const authorization = options.authorize({ action: 'apply-apple-refund-reconciliation', environment: item.environment, transactionDigest: item.transactionDigest, purchaseId: item.purchaseId });
    if (isThenable(authorization) || !authorization || typeof authorization.actorId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(authorization.actorId)) throw new PurchaseError('OPERATOR_AUTHORIZATION_REQUIRED', 403);
    authorizations.set(`${item.environment}:${item.transactionDigest}`, authorization);
  }
  const clock = options.clock ?? (() => new Date());
  const timestamp = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new PurchaseError('REFUND_TIME_INVALID', 503); return value.toISOString(); };
  return wallet.transaction(tx => {
    const applied: Array<{ transactionDigest: string; revokedUnits: number }> = [];
    for (const item of candidates) {
      const sourceKey = `apple-purchase:v1:${item.environment}:${item.transactionDigest}`;
      const lot = tx.get<{ id: string; owner_id: string; purchase_id: string; units: number; revoked_units: number }>("SELECT id,owner_id,purchase_id,units,revoked_units FROM credit_lots WHERE source_kind='purchase' AND source_event_key=?", sourceKey);
      if (!lot || lot.purchase_id !== item.purchaseId) throw new PurchaseError('RECONCILIATION_FACTS_CHANGED', 409);
      const purchase = tx.get<PurchaseRow>('SELECT id,owner_id,environment,transaction_id,product_id FROM purchases WHERE id=? AND owner_id=?', lot.purchase_id, lot.owner_id);
      if (!purchase || purchase.environment !== item.environment || sha(purchase.transaction_id) !== item.transactionDigest || purchase.product_id !== item.productId) throw new PurchaseError('RECONCILIATION_FACTS_CHANGED', 409);
      const now = canonicalTime(timestamp());
      const result = applyAppleRevocationInTransaction(wallet, tx, { environment: item.environment, transactionId: purchase.transaction_id, productId: purchase.product_id }, now);
      if (!result.revokedUnits && !result.consumedLossUnits && !result.cancelledTaskIds.length) continue;
      const authorization = authorizations.get(`${item.environment}:${item.transactionDigest}`)!;
      const auditDetails = JSON.stringify({ version: 1, action: 'apply-apple-refund-reconciliation', environment: item.environment, transactionDigest: item.transactionDigest,
        purchaseId: purchase.id, actorId: authorization.actorId, revokedUnits: result.revokedUnits, consumedLossUnits: result.consumedLossUnits, cancelledTaskCount: result.cancelledTaskIds.length });
      appendAudit(tx, `apple-refund-reconcile:v1:${item.environment}:${item.transactionDigest}`, purchase.owner_id, 'apple_refund_reconciliation_applied', auditDetails, now);
      applied.push({ transactionDigest: item.transactionDigest, revokedUnits: result.revokedUnits });
    }
    return { applied, ...(preview.nextCursor ? { nextCursor: preview.nextCursor } : {}) };
  });
}
