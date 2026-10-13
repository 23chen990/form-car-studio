import { DatabaseSync } from "node:sqlite";
import { V2_SCHEMA, V2_SCHEMA_VERSION, V3_COLUMN_ADDITIONS, V3_CONSTRAINTS, V3_SCHEMA, V3_SCHEMA_VERSION } from "./schema";

type Marker = { version: number };
const now = () => new Date().toISOString();

export function openV2Database(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  try {
    const marker = schemaMarker(db);
    if (marker && marker.version !== V2_SCHEMA_VERSION && marker.version !== V3_SCHEMA_VERSION) throw new Error(`V2 schema version ${marker.version} requires the dedicated migration task`);
    atomic(db, () => {
      const needsV3Upgrade = !marker || marker.version === V2_SCHEMA_VERSION;
      if (!marker) migratePreviousV2SessionName(db);
      db.exec(V2_SCHEMA);
      if (marker?.version === V2_SCHEMA_VERSION) assertV2ValuesCanUpgrade(db);
      applyV3Schema(db);
      if (needsV3Upgrade) {
        backfillV3Values(db);
        db.exec(V3_CONSTRAINTS);
        recordV3(db);
      }
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function schemaMarker(db: DatabaseSync): Marker | undefined {
  if (!hasTable(db, "migration_version")) return undefined;
  return db.prepare("SELECT version FROM migration_version ORDER BY version DESC LIMIT 1").get() as Marker | undefined;
}

function hasTable(db: DatabaseSync, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((item) => item.name === column);
}

function atomic(db: DatabaseSync, work: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function assertV2ValuesCanUpgrade(db: DatabaseSync): void {
  const unsafe = [
    ["credit_lots", "typeof(units) <> 'integer' OR typeof(available_units) <> 'integer' OR units < 0 OR units > 9007199254740991 OR available_units < 0 OR available_units > units"],
    ["reservations", "typeof(units) <> 'integer' OR units < 1 OR units > 9007199254740991"],
    ["reservation_allocations", "typeof(units) <> 'integer' OR units < 1 OR units > 9007199254740991"],
    ["ledger_events", "typeof(units) <> 'integer' OR units < 1 OR units > 9007199254740991"],
    ["plans", "typeof(user_cost_units) <> 'integer' OR user_cost_units < 1 OR user_cost_units > 9007199254740991"],
    ["tasks", "typeof(user_cost_units) <> 'integer' OR user_cost_units < 1 OR user_cost_units > 9007199254740991"],
    ["supplier_attempts", "(estimated_cost_usd_micros IS NOT NULL AND (typeof(estimated_cost_usd_micros) <> 'integer' OR estimated_cost_usd_micros < 0 OR estimated_cost_usd_micros > 9007199254740991)) OR (reconciled_cost_usd_micros IS NOT NULL AND (typeof(reconciled_cost_usd_micros) <> 'integer' OR reconciled_cost_usd_micros < 0 OR reconciled_cost_usd_micros > 9007199254740991))"],
    ["quality_compensations", "typeof(units) <> 'integer' OR units < 1 OR units > 9007199254740991"],
    ["trial_claims", "typeof(units) <> 'integer' OR units < 1 OR units > 9007199254740991"],
  ] as const;
  for (const [table, condition] of unsafe) {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${condition} LIMIT 1`).get()) throw new Error(`V3 migration refused unsafe integer in ${table}`);
  }
  const invalidAllocationTotals = [
    "SELECT 1 FROM reservations AS reservation WHERE reservation.units <> COALESCE((SELECT SUM(allocation.units) FROM reservation_allocations AS allocation WHERE allocation.owner_id=reservation.owner_id AND allocation.reservation_id=reservation.id),0) LIMIT 1",
    "SELECT 1 FROM credit_lots AS lot WHERE lot.available_units + COALESCE((SELECT SUM(allocation.units) FROM reservation_allocations AS allocation JOIN reservations AS reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE allocation.owner_id=lot.owner_id AND allocation.credit_lot_id=lot.id AND reservation.status='reserved'),0) > lot.units LIMIT 1",
  ];
  for (const query of invalidAllocationTotals) {
    if (db.prepare(query).get()) throw new Error("V3 migration refused allocation accounting invariants");
  }
}

function applyV3Schema(db: DatabaseSync): void {
  db.exec(V3_SCHEMA);
  for (const addition of V3_COLUMN_ADDITIONS) if (!hasColumn(db, addition.table, addition.column)) db.exec(addition.sql);
}

function backfillV3Values(db: DatabaseSync): void {
  db.prepare("INSERT OR IGNORE INTO session_families (id,owner_id,created_at,revoked_at) SELECT 'legacy-family:' || id,owner_id,created_at,revoked_at FROM v2_sessions WHERE family_id IS NULL").run();
  db.exec("UPDATE v2_sessions SET family_id='legacy-family:' || id, token_kind='legacy' WHERE family_id IS NULL");
  db.exec("UPDATE credit_lots SET source_kind='legacy_import', source_event_key='v2-legacy-lot:' || id WHERE source_event_key='' ");
  db.exec("UPDATE purchase_events SET event_key='v2-legacy-purchase-event:' || id WHERE event_key='' ");
  db.exec("UPDATE ledger_events SET origin_owner_id=owner_id WHERE origin_owner_id IS NULL");
}

function recordV3(db: DatabaseSync): void {
  db.prepare("INSERT INTO migration_version (version,applied_at) VALUES (?,?)").run(V3_SCHEMA_VERSION, now());
  ensureMigrationState(db);
}

function ensureMigrationState(db: DatabaseSync): void {
  const state = db.prepare("SELECT id FROM migration_state WHERE id=1").get();
  if (state) db.prepare("UPDATE migration_state SET schema_version=?,updated_at=? WHERE id=1").run(V3_SCHEMA_VERSION, now());
  else db.prepare("INSERT INTO migration_state (id,schema_version,legacy_data_status,updated_at) VALUES (1,?,?,?)").run(V3_SCHEMA_VERSION, "pending", now());
}

function migratePreviousV2SessionName(db: DatabaseSync): void {
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (!legacy) return;
  const columns = new Set(
    (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((column) => column.name),
  );
  const wasV2 = columns.has("owner_id") && columns.has("token_digest") && !columns.has("state");
  const alreadyRenamed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_sessions'").get();
  if (wasV2 && !alreadyRenamed) db.exec("ALTER TABLE sessions RENAME TO v2_sessions");
}
