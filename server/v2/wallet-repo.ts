import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue, type StatementResultingChanges } from "node:sqlite";

const MAX_UNITS = Number.MAX_SAFE_INTEGER;
const now = () => new Date().toISOString();

export type WalletScope = "demo" | "live";
export type CreditKind = "purchased" | "promo";
export type GrantSource = "purchase" | "promo" | "trial" | "quality_compensation";
export type ReservationStatus = "reserved" | "settled" | "released";

export class WalletError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "WalletError";
    this.code = code;
  }
}

export interface WalletTransaction {
  get<T extends object>(sql: string, ...values: SQLInputValue[]): T | undefined;
  all<T extends object>(sql: string, ...values: SQLInputValue[]): T[];
  run(sql: string, ...values: SQLInputValue[]): StatementResultingChanges;
}

export interface GrantInput {
  ownerId: string;
  kind: CreditKind;
  sourceKind: GrantSource;
  sourceEventKey: string;
  units: number;
  scope: WalletScope;
  purchaseId?: string;
  projectId?: string;
  createdAt?: string;
}

export interface GrantResult { lotId: string; replayed: boolean }
export interface ReserveInput { ownerId: string; taskId: string }
export interface ReserveResult { reservationId: string; units: number; status: ReservationStatus; replayed: boolean }
export interface FinalizeInput {
  ownerId: string;
  taskId: string;
  outcome: "succeeded" | "failed" | "cancelled";
  resultVersionId?: string;
}
export interface FinalizeResult { status: FinalizeInput["outcome"]; replayed: boolean; returnedUnits: number }
export interface WalletSummary {
  scope: WalletScope;
  available: { purchased: number; promo: number };
  reserved: { purchased: number; promo: number };
  spendable: number;
  totalReserved: number;
}

type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T;

interface TxState { repo: WalletRepository; db: DatabaseSync; active: boolean }
const txStates = new WeakMap<object, TxState>();

type LotRow = { id: string; kind: CreditKind; units: number; available_units: number; revoked_units: number; scope: WalletScope; source_kind: GrantSource; source_event_key: string; purchase_id: string | null; created_at: string };
type TaskRow = { id: string; owner_id: string; project_id: string; status: string; user_cost_units: number; credit_returned: number; request_snapshot_json: string | null; result_version_id: string | null; owner_deleted_at: string | null; project_deleted_at: string | null };
type ReservationRow = { id: string; owner_id: string; task_id: string; units: number; status: ReservationStatus };
type AllocationRow = { credit_lot_id: string; units: number; revoked_units: number; kind: CreditKind };

function fail(code: string, detail?: string): never { throw new WalletError(code, detail); }
function id(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) fail("INVALID_WALLET_INPUT", field);
}
function units(value: unknown, field: string, allowZero = false): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_UNITS) fail("INVALID_WALLET_UNITS", field);
}
function safeAdd(a: bigint, b: bigint, field: string): bigint {
  const sum = a + b;
  if (sum < 0n || sum > BigInt(MAX_UNITS)) fail("UNSAFE_WALLET_TOTAL", field);
  return sum;
}
function safeNumber(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(MAX_UNITS)) fail("UNSAFE_WALLET_TOTAL", field);
  return Number(value);
}
function isThenable(value: unknown): boolean {
  return (typeof value === "object" && value !== null || typeof value === "function") && typeof (value as { then?: unknown }).then === "function";
}
function assertNoTransactionControl(sql: string): void {
  const first = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/g, "").toUpperCase();
  if (/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/.test(first)) fail("WALLET_TRANSACTION_CONTROL_FORBIDDEN");
}

export class WalletRepository {
  readonly #db: DatabaseSync;
  readonly #newId: () => string;
  readonly #clock: () => string;

  constructor(db: DatabaseSync, options: { newId?: () => string; clock?: () => string } = {}) {
    this.#db = db;
    this.#newId = options.newId ?? randomUUID;
    this.#clock = options.clock ?? now;
  }

  transaction<T>(work: (tx: WalletTransaction) => SynchronousResult<T>): T {
    if (this.#db.isTransaction) fail("NESTED_WALLET_TRANSACTION");
    this.#db.exec("BEGIN IMMEDIATE");
    const state: TxState = { repo: this, db: this.#db, active: true };
    const tx: WalletTransaction = Object.freeze({
      get: <R extends object>(sql: string, ...values: SQLInputValue[]) => {
        this.#assertActive(state); assertNoTransactionControl(sql);
        return this.#db.prepare(sql).get(...values) as R | undefined;
      },
      all: <R extends object>(sql: string, ...values: SQLInputValue[]) => {
        this.#assertActive(state); assertNoTransactionControl(sql);
        return this.#db.prepare(sql).all(...values) as R[];
      },
      run: (sql: string, ...values: SQLInputValue[]) => {
        this.#assertActive(state); assertNoTransactionControl(sql);
        return this.#db.prepare(sql).run(...values);
      },
    });
    txStates.set(tx, state);
    try {
      const result = work(tx);
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => {});
        fail("ASYNC_WALLET_TRANSACTION_FORBIDDEN");
      }
      this.#assertActive(state);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#db.isTransaction) {
        try { this.#db.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
      }
      throw error;
    } finally {
      state.active = false;
    }
  }

  grantInTransaction(tx: WalletTransaction, input: GrantInput): GrantResult {
    this.#context(tx);
    id(input.ownerId, "ownerId"); id(input.sourceEventKey, "sourceEventKey");
    units(input.units, "grant units");
    if (input.scope !== "demo" && input.scope !== "live") fail("INVALID_WALLET_SCOPE");
    const isPurchase = input.sourceKind === "purchase";
    if ((isPurchase && (input.kind !== "purchased" || input.scope !== "live" || !input.purchaseId)) ||
      (!isPurchase && (input.kind !== "promo" || input.purchaseId)) ||
      !["purchase", "promo", "trial", "quality_compensation"].includes(input.sourceKind)) fail("INVALID_GRANT_PROVENANCE");
    if (input.sourceKind === "quality_compensation" && !input.projectId) fail("INVALID_GRANT_PROVENANCE", "quality compensation requires projectId");
    if (input.purchaseId) id(input.purchaseId, "purchaseId");
    if (input.projectId) id(input.projectId, "projectId");

    const owner = this.#db.prepare("SELECT deleted_at FROM users WHERE id=?").get(input.ownerId) as { deleted_at: string | null } | undefined;
    if (!owner) fail("OWNER_NOT_FOUND");
    if (owner.deleted_at) fail("OWNER_TOMBSTONED");
    if (input.projectId) {
      const project = this.#db.prepare("SELECT deleted_at FROM projects WHERE id=? AND owner_id=?").get(input.projectId, input.ownerId) as { deleted_at: string | null } | undefined;
      if (!project) fail("PROJECT_NOT_FOUND");
      if (project.deleted_at) fail("PROJECT_TOMBSTONED");
    }
    if (isPurchase) {
      const purchase = this.#db.prepare("SELECT owner_id FROM purchases WHERE id=?").get(input.purchaseId!) as { owner_id: string } | undefined;
      if (!purchase || purchase.owner_id !== input.ownerId) fail("PURCHASE_PROVENANCE_MISMATCH");
    }

    const existing = this.#db.prepare("SELECT id,kind,units,source_kind,source_event_key,purchase_id,scope,created_at FROM credit_lots WHERE owner_id=? AND source_event_key=?")
      .get(input.ownerId, input.sourceEventKey) as (Pick<LotRow, "id" | "kind" | "units" | "source_kind" | "source_event_key" | "purchase_id" | "scope" | "created_at">) | undefined;
    if (existing) {
      const same = existing.kind === input.kind && existing.units === input.units && existing.source_kind === input.sourceKind &&
        existing.source_event_key === input.sourceEventKey && existing.purchase_id === (input.purchaseId ?? null) && existing.scope === input.scope &&
        (input.createdAt === undefined || existing.created_at === input.createdAt);
      if (!same) fail("GRANT_SOURCE_CONFLICT");
      const event = this.#db.prepare("SELECT event_type,units,task_id,credit_lot_id,origin_owner_id FROM ledger_events WHERE owner_id=? AND ledger_event_key=?")
        .get(input.ownerId, `grant:${input.sourceEventKey}`) as { event_type: string; units: number; task_id: string | null; credit_lot_id: string | null; origin_owner_id: string | null } | undefined;
      if (!event || event.event_type !== "grant" || event.units !== existing.units || event.task_id !== null || event.credit_lot_id !== existing.id || event.origin_owner_id !== input.ownerId) fail("GRANT_LEDGER_CONFLICT");
      return { lotId: existing.id, replayed: true };
    }
    const usedLedgerKey = this.#db.prepare("SELECT event_type,units,credit_lot_id FROM ledger_events WHERE owner_id=? AND ledger_event_key=?")
      .get(input.ownerId, `grant:${input.sourceEventKey}`);
    if (usedLedgerKey) fail("GRANT_SOURCE_CONFLICT", "ledger key already used");
    this.#assertOwnerLotTotal(input.ownerId, BigInt(input.units));

    const lotId = this.#newId();
    const createdAt = input.createdAt ?? this.#clock();
    this.#db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,source_kind,source_event_key,purchase_id,revoked_units,scope,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(lotId, input.ownerId, input.kind, input.units, input.units, input.sourceKind, input.sourceEventKey, input.purchaseId ?? null, 0, input.scope, createdAt);
    this.#appendEvent(input.ownerId, `grant:${input.sourceEventKey}`, "grant", input.units, null, lotId, createdAt);
    return { lotId, replayed: false };
  }

  /** A reservation replay is read-only reconciliation, never dispatch permission; processing or uncertain tasks must not be resent. */
  reserveTaskInTransaction(tx: WalletTransaction, input: ReserveInput): ReserveResult {
    this.#context(tx);
    id(input.ownerId, "ownerId"); id(input.taskId, "taskId");
    const task = this.#task(input.ownerId, input.taskId);
    if (!task) fail("TASK_NOT_FOUND");
    units(task.user_cost_units, "task user_cost_units");
    if (task.owner_deleted_at) fail("OWNER_TOMBSTONED");
    if (task.project_deleted_at) fail("PROJECT_TOMBSTONED");
    const existing = this.#db.prepare("SELECT id,owner_id,task_id,units,status FROM reservations WHERE owner_id=? AND task_id=?").get(input.ownerId, input.taskId) as ReservationRow | undefined;
    if (existing) {
      if (existing.units !== task.user_cost_units) fail("RESERVATION_TASK_COST_CONFLICT");
      const rows = this.#db.prepare("SELECT allocation.units,allocation.revoked_units,lot.kind,lot.scope FROM reservation_allocations allocation JOIN credit_lots lot ON lot.owner_id=allocation.owner_id AND lot.id=allocation.credit_lot_id WHERE allocation.owner_id=? AND allocation.reservation_id=?")
        .all(input.ownerId, existing.id) as { units: number; revoked_units: number; kind: CreditKind; scope: WalletScope }[];
      const allocationTotal = rows.reduce((sum, row) => safeAdd(sum, BigInt(row.units), "reservation allocation"), 0n);
      if (allocationTotal !== BigInt(existing.units)) fail("RESERVATION_ALLOCATION_MISMATCH");
      const recordedScope = this.#snapshotScope(task.request_snapshot_json, false);
      if (recordedScope && rows.some((row) => row.scope !== recordedScope)) fail("RESERVATION_SCOPE_CONFLICT");
      return { reservationId: existing.id, units: existing.units, status: existing.status, replayed: true };
    }
    if (task.status !== "queued") fail("TASK_STATE_CONFLICT");
    const scope = this.#snapshotScope(task.request_snapshot_json, true)!;

    const lots = this.#db.prepare("SELECT id,kind,units,available_units,revoked_units,scope,source_kind,source_event_key,purchase_id,created_at FROM credit_lots WHERE owner_id=? AND scope=? AND available_units>0 ORDER BY CASE kind WHEN 'promo' THEN 0 ELSE 1 END,created_at,id")
      .all(input.ownerId, scope) as LotRow[];
    let needed = BigInt(task.user_cost_units);
    const plan: { lot: LotRow; amount: number }[] = [];
    for (const lot of lots) {
      units(lot.available_units, "lot available_units", true);
      const take = needed < BigInt(lot.available_units) ? needed : BigInt(lot.available_units);
      if (take) plan.push({ lot, amount: Number(take) });
      needed -= take;
      if (!needed) break;
    }
    if (needed) fail("INSUFFICIENT_CREDITS");

    const reservationId = this.#newId();
    const createdAt = this.#clock();
    this.#db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)")
      .run(reservationId, input.ownerId, input.taskId, task.user_cost_units, "reserved", createdAt);
    let allocated = 0n;
    for (const { lot, amount } of plan) {
      const decrement = this.#db.prepare("UPDATE credit_lots SET available_units=available_units-? WHERE owner_id=? AND id=? AND scope=? AND available_units>=?")
        .run(amount, input.ownerId, lot.id, scope, amount);
      if (decrement.changes !== 1) fail("CREDIT_LOT_RACE");
      this.#db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)")
        .run(input.ownerId, reservationId, lot.id, amount);
      this.#appendEvent(input.ownerId, `reserve:${input.taskId}:${lot.id}`, "reserve", amount, input.taskId, lot.id, createdAt);
      allocated = safeAdd(allocated, BigInt(amount), "reservation allocation");
    }
    if (allocated !== BigInt(task.user_cost_units)) fail("RESERVATION_ALLOCATION_MISMATCH");
    return { reservationId, units: task.user_cost_units, status: "reserved", replayed: false };
  }

  finalizeTaskInTransaction(tx: WalletTransaction, input: FinalizeInput): FinalizeResult {
    this.#context(tx);
    id(input.ownerId, "ownerId"); id(input.taskId, "taskId");
    if (!["succeeded", "failed", "cancelled"].includes(input.outcome)) fail("INVALID_TASK_OUTCOME");
    const task = this.#task(input.ownerId, input.taskId);
    if (!task) fail("TASK_NOT_FOUND");
    const reservation = this.#db.prepare("SELECT id,owner_id,task_id,units,status FROM reservations WHERE owner_id=? AND task_id=?").get(input.ownerId, input.taskId) as ReservationRow | undefined;
    if (!reservation) fail("RESERVATION_NOT_FOUND");
    if (reservation.units !== task.user_cost_units) fail("RESERVATION_TASK_COST_CONFLICT");
    if (reservation.status !== "reserved") {
      const expected = input.outcome === "succeeded" ? "settled" : "released";
      if (task.status === input.outcome && reservation.status === expected &&
        (input.outcome !== "succeeded" || task.result_version_id === input.resultVersionId)) {
        const returnedUnits = input.outcome === "succeeded" ? 0 : this.#returnedUnits(input.ownerId, input.taskId);
        if (task.credit_returned !== (returnedUnits > 0 ? 1 : 0)) fail("TASK_RETURN_LEDGER_CONFLICT");
        return { status: input.outcome, replayed: true, returnedUnits };
      }
      fail("TASK_RESERVATION_TERMINAL_CONFLICT");
    }
    if (["succeeded", "failed", "cancelled"].includes(task.status)) fail("TASK_RESERVATION_TERMINAL_CONFLICT");

    let allowed: string[];
    let targetReservation: ReservationStatus;
    if (input.outcome === "succeeded") {
      allowed = ["processing", "uncertain"];
      targetReservation = "settled";
      if (task.credit_returned !== 0) fail("TASK_RETURN_FLAG_CONFLICT");
      if (!input.resultVersionId) fail("RESULT_VERSION_REQUIRED");
      if (task.owner_deleted_at) fail("OWNER_TOMBSTONED");
      if (task.project_deleted_at) fail("PROJECT_TOMBSTONED");
      const version = this.#db.prepare("SELECT id FROM versions WHERE id=? AND owner_id=? AND project_id=? AND task_id=?")
        .get(input.resultVersionId, input.ownerId, task.project_id, input.taskId);
      if (!version) fail("RESULT_VERSION_NOT_OWNED");
    } else if (input.outcome === "failed") {
      allowed = ["processing", "uncertain"];
      targetReservation = "released";
    } else {
      allowed = ["queued"];
      targetReservation = "released";
    }
    if (!allowed.includes(task.status)) fail("TASK_STATE_CONFLICT");

    const allocations = this.#db.prepare("SELECT allocation.credit_lot_id,allocation.units,allocation.revoked_units,lot.kind FROM reservation_allocations allocation JOIN credit_lots lot ON lot.owner_id=allocation.owner_id AND lot.id=allocation.credit_lot_id WHERE allocation.owner_id=? AND allocation.reservation_id=? ORDER BY lot.id")
      .all(input.ownerId, reservation.id) as AllocationRow[];
    const total = allocations.reduce((sum, row) => safeAdd(sum, BigInt(row.units), "reservation allocation"), 0n);
    if (total !== BigInt(reservation.units)) fail("RESERVATION_ALLOCATION_MISMATCH");
    const restore = targetReservation === "released"
      ? allocations.reduce((sum, row) => safeAdd(sum, BigInt(row.units - row.revoked_units), "release allocation"), 0n)
      : 0n;

    const timestamp = this.#clock();
    if (targetReservation === "released" && task.credit_returned !== 0) fail("TASK_RETURN_FLAG_CONFLICT");
    if (targetReservation === "released") this.#assertOwnerAvailable(input.ownerId, restore);
    const returnedUnits = safeNumber(restore, "release allocation");
    const creditReturned = targetReservation === "released" && returnedUnits > 0 ? 1 : task.credit_returned;
    const taskUpdate = this.#db.prepare("UPDATE tasks SET status=?,result_version_id=?,credit_returned=?,updated_at=? WHERE owner_id=? AND id=? AND status=? AND result_version_id IS ? AND credit_returned=?")
      .run(input.outcome, input.outcome === "succeeded" ? input.resultVersionId! : task.result_version_id, creditReturned, timestamp, input.ownerId, input.taskId, task.status, task.result_version_id, task.credit_returned);
    if (taskUpdate.changes !== 1) fail("TASK_STATE_RACE");
    const reservationUpdate = this.#db.prepare("UPDATE reservations SET status=? WHERE owner_id=? AND id=? AND status='reserved'")
      .run(targetReservation, input.ownerId, reservation.id);
    if (reservationUpdate.changes !== 1) fail("RESERVATION_STATE_RACE");

    if (targetReservation === "released") {
      for (const allocation of allocations) {
        const amount = allocation.units - allocation.revoked_units;
        if (!amount) continue;
        const restored = this.#db.prepare("UPDATE credit_lots SET available_units=available_units+? WHERE owner_id=? AND id=? AND available_units<=?")
          .run(amount, input.ownerId, allocation.credit_lot_id, MAX_UNITS - amount);
        if (restored.changes !== 1) fail("CREDIT_LOT_RESTORE_FAILED");
        this.#appendEvent(input.ownerId, `release:${input.taskId}:${allocation.credit_lot_id}`, "release", amount, input.taskId, allocation.credit_lot_id, timestamp);
      }
    } else {
      for (const allocation of allocations) {
        const consumed = allocation.units - allocation.revoked_units;
        if (!consumed) continue;
        this.#appendEvent(input.ownerId, `settle:${input.taskId}:${allocation.credit_lot_id}`, "settle", consumed, input.taskId, allocation.credit_lot_id, timestamp);
      }
    }
    return { status: input.outcome, replayed: false, returnedUnits };
  }

  summary(ownerId: string, scope: WalletScope): WalletSummary {
    id(ownerId, "ownerId");
    if (scope !== "demo" && scope !== "live") fail("INVALID_WALLET_SCOPE");
    const rows = this.#db.prepare("SELECT lot.id,lot.kind,lot.units,lot.available_units,allocation.units AS reserved_units,allocation.revoked_units FROM credit_lots lot LEFT JOIN (SELECT allocation.owner_id,allocation.credit_lot_id,allocation.units,allocation.revoked_units FROM reservation_allocations allocation JOIN reservations reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE reservation.status='reserved') allocation ON allocation.owner_id=lot.owner_id AND allocation.credit_lot_id=lot.id WHERE lot.owner_id=? AND lot.scope=? ORDER BY lot.id")
      .all(ownerId, scope) as { id: string; kind: CreditKind; units: number; available_units: number; reserved_units: number | null; revoked_units: number | null }[];
    const sums = { available: { purchased: 0n, promo: 0n }, reserved: { purchased: 0n, promo: 0n } };
    const seen = new Set<string>();
    for (const row of rows) {
      if (!seen.has(row.id)) {
        units(row.available_units, "lot available_units", true);
        sums.available[row.kind] = safeAdd(sums.available[row.kind], BigInt(row.available_units), "available balance");
        seen.add(row.id);
      }
      if (row.reserved_units !== null) {
        units(row.reserved_units, "allocation units");
        units(row.revoked_units ?? 0, "revoked allocation units", true);
        sums.reserved[row.kind] = safeAdd(sums.reserved[row.kind], BigInt(row.reserved_units - (row.revoked_units ?? 0)), "reserved balance");
      }
    }
    const availableTotal = safeAdd(sums.available.purchased, sums.available.promo, "available balance");
    const reservedTotal = safeAdd(sums.reserved.purchased, sums.reserved.promo, "reserved balance");
    safeAdd(availableTotal, reservedTotal, "wallet total");
    return {
      scope,
      available: { purchased: Number(sums.available.purchased), promo: Number(sums.available.promo) },
      reserved: { purchased: Number(sums.reserved.purchased), promo: Number(sums.reserved.promo) },
      spendable: Number(availableTotal),
      totalReserved: Number(reservedTotal),
    };
  }

  #context(tx: WalletTransaction): TxState {
    const state = tx && typeof tx === "object" ? txStates.get(tx as object) : undefined;
    this.#assertActive(state);
    if (state!.repo !== this || state!.db !== this.#db) fail("INVALID_WALLET_TRANSACTION_CONTEXT");
    return state!;
  }

  #assertActive(state: TxState | undefined): void {
    if (!state?.active || state.db !== this.#db || !this.#db.isTransaction) fail("WALLET_TRANSACTION_REQUIRED");
  }

  #task(ownerId: string, taskId: string): TaskRow | undefined {
    return this.#db.prepare("SELECT task.id,task.owner_id,task.project_id,task.status,task.user_cost_units,task.credit_returned,task.request_snapshot_json,task.result_version_id,owner.deleted_at AS owner_deleted_at,project.deleted_at AS project_deleted_at FROM tasks task JOIN users owner ON owner.id=task.owner_id JOIN projects project ON project.owner_id=task.owner_id AND project.id=task.project_id WHERE task.owner_id=? AND task.id=?")
      .get(ownerId, taskId) as TaskRow | undefined;
  }

  #snapshotScope(snapshotJson: string | null, required: boolean): WalletScope | undefined {
    if (snapshotJson === null) {
      if (required) fail("TASK_SCOPE_MISSING");
      return undefined;
    }
    let snapshot: unknown;
    try { snapshot = JSON.parse(snapshotJson); } catch { fail("TASK_SCOPE_MISSING"); }
    const scope = snapshot && typeof snapshot === "object" ? (snapshot as { scope?: unknown }).scope : undefined;
    if (scope === undefined && !required) return undefined;
    if (scope !== "demo" && scope !== "live") fail("TASK_SCOPE_MISSING");
    return scope;
  }

  #returnedUnits(ownerId: string, taskId: string): number {
    const rows = this.#db.prepare("SELECT units FROM ledger_events WHERE owner_id=? AND task_id=? AND event_type='release'").all(ownerId, taskId) as { units: number }[];
    let total = 0n;
    for (const row of rows) { units(row.units, "release event units"); total = safeAdd(total, BigInt(row.units), "returned units"); }
    return Number(total);
  }

  #appendEvent(ownerId: string, key: string, type: "grant" | "reserve" | "settle" | "release", amount: number, taskId: string | null, lotId: string | null, createdAt: string): void {
    units(amount, "ledger event units");
    const existing = this.#db.prepare("SELECT event_type,units,task_id,credit_lot_id FROM ledger_events WHERE owner_id=? AND ledger_event_key=?")
      .get(ownerId, key) as { event_type: string; units: number; task_id: string | null; credit_lot_id: string | null } | undefined;
    if (existing) {
      if (existing.event_type !== type || existing.units !== amount || existing.task_id !== taskId || existing.credit_lot_id !== lotId) fail("LEDGER_EVENT_CONFLICT");
      return;
    }
    this.#db.prepare("INSERT INTO ledger_events (id,owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(this.#newId(), ownerId, key, taskId, lotId, type, amount, ownerId, createdAt);
  }

  #assertOwnerLotTotal(ownerId: string, addition: bigint): void {
    const rows = this.#db.prepare("SELECT units FROM credit_lots WHERE owner_id=?").all(ownerId) as { units: number }[];
    let total = addition;
    for (const row of rows) {
      units(row.units, "lot units", true);
      total = safeAdd(total, BigInt(row.units), "owner granted units");
    }
  }

  #assertOwnerAvailable(ownerId: string, addition: bigint): void {
    const rows = this.#db.prepare("SELECT available_units FROM credit_lots WHERE owner_id=?").all(ownerId) as { available_units: number }[];
    let total = addition;
    for (const row of rows) {
      units(row.available_units, "available_units", true);
      total = safeAdd(total, BigInt(row.available_units), "owner available units");
    }
  }
}
