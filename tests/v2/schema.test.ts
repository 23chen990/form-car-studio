import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openV2Database } from "../../server/v2/db";
import { V2_SCHEMA } from "../../server/v2/schema";

test("creates additive V2 tables while preserving legacy tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-schema-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  db.exec("CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY)");
  assert.equal(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_marker'").get() as { name: string }).name,
    "legacy_marker",
  );
  const names = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name),
  );
  for (const name of ["migration_version", "migration_state", "users", "v2_sessions", "projects", "assets", "versions", "drafts", "plans", "tasks", "supplier_attempts", "credit_lots", "reservations", "reservation_allocations", "ledger_events", "purchases", "purchase_events", "consents", "feedback", "quality_compensations", "trial_claims", "deletion_jobs", "audit_events"]) assert.ok(names.has(name), name);
  assert.equal((db.prepare("SELECT version FROM migration_version").get() as { version: number }).version, 3);
  assert.equal((db.prepare("SELECT legacy_data_status FROM migration_state WHERE id=1").get() as { legacy_data_status: string }).legacy_data_status, "pending");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("upgrades an existing V2 database to V3 atomically without touching legacy data", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-upgrade-"));
  const path = join(dir, "v2.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec(V2_SCHEMA);
  raw.exec("CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY, note TEXT NOT NULL)");
  raw.prepare("INSERT INTO migration_version (version,applied_at) VALUES (?,?)").run(2, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO migration_state (id,schema_version,legacy_data_status,updated_at) VALUES (1,?,?,?)").run(2, "complete", "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO v2_sessions (id,owner_id,token_digest,created_at) VALUES (?,?,?,?)").run("legacy-session", "owner-a", "digest-a", "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("legacy-lot", "owner-a", "promo", 2, 2, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO legacy_marker (id,note) VALUES (?,?)").run(1, "keep-me");
  raw.close();

  const db = openV2Database(path);
  assert.equal((db.prepare("SELECT MAX(version) AS version FROM migration_version").get() as { version: number }).version, 3);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM migration_version").get() as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT schema_version FROM migration_state WHERE id=1").get() as { schema_version: number }).schema_version, 3);
  assert.equal((db.prepare("SELECT note FROM legacy_marker WHERE id=1").get() as { note: string }).note, "keep-me");
  const migratedSession = db.prepare("SELECT family_id,token_kind FROM v2_sessions WHERE id=?").get("legacy-session") as { family_id: string; token_kind: string };
  assert.equal(migratedSession.family_id, "legacy-family:legacy-session");
  assert.equal(migratedSession.token_kind, "legacy");
  assert.equal((db.prepare("SELECT scope FROM credit_lots WHERE id=?").get("legacy-lot") as { scope: string }).scope, "demo");
  const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
  for (const name of ["auth_challenges", "session_families", "supplier_exposures"]) assert.ok(names.has(name), name);
  const lotColumns = new Set((db.prepare("PRAGMA table_info(credit_lots)").all() as { name: string }[]).map((row) => row.name));
  for (const name of ["purchase_id", "source_kind", "source_event_key", "revoked_units"]) assert.ok(lotColumns.has(name), name);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("backfills V2 ledger origins and keeps them immutable", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-ledger-origin-"));
  const path = join(dir, "v2.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec(V2_SCHEMA);
  raw.prepare("INSERT INTO migration_version (version,applied_at) VALUES (?,?)").run(2, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO migration_state (id,schema_version,legacy_data_status,updated_at) VALUES (1,?,?,?)").run(2, "complete", "2026-01-01T00:00:00Z");
  for (const owner of ["owner-a", "owner-b"]) raw.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run(owner, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "promo", 1, 1, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO ledger_events (id,owner_id,ledger_event_key,event_type,units,created_at) VALUES (?,?,?,?,?,?)").run("ledger-a", "owner-a", "legacy-event-a", "grant", 1, "2026-01-01T00:00:00Z");
  raw.prepare("INSERT INTO ledger_events (id,owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("ledger-b", "owner-a", "legacy-event-b", "task-a", "lot-a", "reserve", 1, "2026-01-01T00:00:00Z");
  raw.close();

  const db = openV2Database(path);
  assert.equal((db.prepare("SELECT origin_owner_id FROM ledger_events WHERE id=?").get("ledger-a") as { origin_owner_id: string }).origin_owner_id, "owner-a");
  assert.throws(() => db.prepare("UPDATE ledger_events SET origin_owner_id=? WHERE id=?").run("owner-b", "ledger-a"), /ledger origin owner is immutable/);
  assert.equal((db.prepare("SELECT origin_owner_id FROM ledger_events WHERE id=?").get("ledger-a") as { origin_owner_id: string }).origin_owner_id, "owner-a");
  for (const statement of [
    "UPDATE ledger_events SET units=2 WHERE id='ledger-b'",
    "UPDATE ledger_events SET event_type='refund' WHERE id='ledger-b'",
    "UPDATE ledger_events SET ledger_event_key='rewritten-event' WHERE id='ledger-b'",
    "UPDATE ledger_events SET task_id=NULL WHERE id='ledger-b'",
    "UPDATE ledger_events SET credit_lot_id=NULL WHERE id='ledger-b'",
    "UPDATE ledger_events SET created_at='2026-01-02T00:00:00Z' WHERE id='ledger-b'",
  ]) assert.throws(() => db.exec(statement), /ledger economic facts are immutable/);
  db.prepare("UPDATE ledger_events SET owner_id=? WHERE id=?").run("owner-b", "ledger-a");
  const moved = db.prepare("SELECT owner_id,origin_owner_id FROM ledger_events WHERE id=?").get("ledger-a") as { owner_id: string; origin_owner_id: string };
  assert.equal(moved.owner_id, "owner-b");
  assert.equal(moved.origin_owner_id, "owner-a");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("refuses unsafe V2 integer data without recording a partial V3 upgrade", () => {
  for (const [label, seed] of [
    ["credit_lot", (db: DatabaseSync) => {
      db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "promo", 1.5, 1.5, "2026-01-01T00:00:00Z");
    }],
    ["allocation", (db: DatabaseSync) => {
      db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "promo", 2, 2, "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", 1, "reserved", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", 1.5);
    }],
    ["quality_compensation", (db: DatabaseSync) => {
      db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO quality_compensations (id,owner_id,root_task_id,units,created_at) VALUES (?,?,?,?,?)").run("comp-a", "owner-a", "task-a", 1.5, "2026-01-01T00:00:00Z");
    }],
    ["trial_claim", (db: DatabaseSync) => {
      db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
      db.prepare("INSERT INTO trial_claims (id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)").run("trial-a", "owner-a", "first-trial", 1.5, "2026-01-01T00:00:00Z");
    }],
  ] as const) {
    const dir = mkdtempSync(join(tmpdir(), `form-v3-${label}-`));
    const path = join(dir, "v2.sqlite");
    const raw = new DatabaseSync(path);
    raw.exec(V2_SCHEMA);
    raw.prepare("INSERT INTO migration_version (version,applied_at) VALUES (?,?)").run(2, "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO migration_state (id,schema_version,legacy_data_status,updated_at) VALUES (1,?,?,?)").run(2, "complete", "2026-01-01T00:00:00Z");
    seed(raw);
    raw.close();
    assert.throws(() => openV2Database(path), /V3 migration refused unsafe integer/);
    const verify = new DatabaseSync(path);
    assert.equal((verify.prepare("SELECT MAX(version) AS version FROM migration_version").get() as { version: number }).version, 2);
    assert.equal((verify.prepare("PRAGMA table_info(credit_lots)").all() as { name: string }[]).some((column) => column.name === "revoked_units"), false);
    verify.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses inconsistent V2 allocation totals without a partial V3 upgrade", () => {
  for (const [label, reservationUnits, availableUnits, allocationUnits] of [
    ["reservation-total", 2, 1, 1],
    ["lot-availability", 2, 1, 2],
  ] as const) {
    const dir = mkdtempSync(join(tmpdir(), `form-v3-${label}-`));
    const path = join(dir, "v2.sqlite");
    const raw = new DatabaseSync(path);
    raw.exec(V2_SCHEMA);
    raw.prepare("INSERT INTO migration_version (version,applied_at) VALUES (?,?)").run(2, "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO migration_state (id,schema_version,legacy_data_status,updated_at) VALUES (1,?,?,?)").run(2, "complete", "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "promo", 2, availableUnits, "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", reservationUnits, "reserved", "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", allocationUnits);
    raw.close();

    assert.throws(() => openV2Database(path), /V3 migration refused allocation accounting invariants/);
    const verify = new DatabaseSync(path);
    assert.equal((verify.prepare("SELECT MAX(version) AS version FROM migration_version").get() as { version: number }).version, 2);
    assert.equal((verify.prepare("PRAGMA table_info(ledger_events)").all() as { name: string }[]).some((column) => column.name === "origin_owner_id"), false);
    verify.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enforces V3 family, provenance, supplier and revoked-credit contracts", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-contracts-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  for (const owner of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run(owner, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO session_families (id,owner_id,created_at) VALUES (?,?,?)").run("family-a", "owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO session_families (id,owner_id,created_at) VALUES (?,?,?)").run("family-b", "owner-b", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO v2_sessions (id,owner_id,token_digest,created_at,family_id,token_kind) VALUES (?,?,?,?,?,?)").run("access-no-expiry", "owner-a", "digest-1", "2026-01-01T00:00:00Z", "family-a", "access"), /invalid v2 session family/);
  assert.throws(() => db.prepare("INSERT INTO v2_sessions (id,owner_id,token_digest,created_at,expires_at,family_id,token_kind) VALUES (?,?,?,?,?,?,?)").run("access-cross-family", "owner-b", "digest-2", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "family-a", "access"), /invalid v2 session family/);
  db.prepare("INSERT INTO v2_sessions (id,owner_id,token_digest,created_at,expires_at,family_id,token_kind) VALUES (?,?,?,?,?,?,?)").run("access-a", "owner-a", "digest-3", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "family-a", "access");
  assert.throws(() => db.prepare("INSERT INTO v2_sessions (id,owner_id,token_digest,created_at,expires_at,family_id,parent_session_id,token_kind) VALUES (?,?,?,?,?,?,?,?)").run("refresh-cross-parent", "owner-b", "digest-4", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "family-b", "access-a", "refresh"), /invalid v2 session family/);
  db.prepare("INSERT INTO auth_challenges (id,nonce_digest,created_at,expires_at) VALUES (?,?,?,?)").run("challenge-a", "nonce-a", "2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z");
  assert.throws(() => db.prepare("INSERT INTO auth_challenges (id,nonce_digest,created_at,expires_at) VALUES (?,?,?,?)").run("challenge-b", "nonce-a", "2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z"), /UNIQUE/);
  db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-a", "owner-a", "sandbox", "tx-a", "pack-5", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,source_kind,created_at) VALUES (?,?,?,?,?,?,?)").run("lot-invalid", "owner-a", "purchased", 2, 2, "purchase", "2026-01-01T00:00:00Z"), /purchase lot provenance/);
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,purchase_id,source_kind,source_event_key,scope,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("lot-a", "owner-a", "purchased", 2, 2, "purchase-a", "purchase", "grant-a", "live", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-fractional", "owner-a", "promo", 1.5, 1.5, "2026-01-01T00:00:00Z"), /safe integer/);
  db.prepare("UPDATE credit_lots SET available_units=?,revoked_units=? WHERE id=?").run(1, 1, "lot-a");
  assert.throws(() => db.prepare("UPDATE credit_lots SET revoked_units=? WHERE id=?").run(0, "lot-a"), /revoked units cannot be restored/);
  db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", 1, "reserved", "2026-01-01T00:00:00Z");
  db.prepare("UPDATE credit_lots SET available_units=0 WHERE id='lot-a'").run();
  db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", 1);
  db.prepare("UPDATE reservation_allocations SET revoked_units=1 WHERE owner_id=? AND reservation_id=? AND credit_lot_id=?").run("owner-a", "reservation-a", "lot-a");
  assert.throws(() => db.prepare("UPDATE reservation_allocations SET revoked_units=0 WHERE owner_id=? AND reservation_id=? AND credit_lot_id=?").run("owner-a", "reservation-a", "lot-a"), /revoked units cannot be restored/);
  db.prepare("INSERT INTO supplier_attempts (id,owner_id,task_id,provider_profile_id,status,started_at) VALUES (?,?,?,?,?,?)").run("attempt-a", "owner-a", "task-a", "profile-a", "started", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO supplier_attempts (id,owner_id,task_id,provider_profile_id,status,started_at) VALUES (?,?,?,?,?,?)").run("attempt-b", "owner-a", "task-a", "profile-a", "started", "2026-01-01T00:00:00Z"), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO supplier_exposures (id,owner_id,task_id,provider_profile_id,provider_profile_version,max_cost_usd_micros,cost_currency,estimate_basis,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("exposure-a", "owner-a", "task-a", "profile-a", "v1", 1.5, "USD", "catalog", "reserved", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), /safe integer/);
  db.prepare("UPDATE purchases SET price_minor_units=?,currency=? WHERE id=?").run(500, "USD", "purchase-a");
  assert.throws(() => db.prepare("UPDATE purchases SET price_minor_units=? WHERE id=?").run(1.5, "purchase-a"), /safe integer/);
  db.prepare("UPDATE tasks SET safe_error_code=?,credit_returned=?,request_snapshot_json=? WHERE id=?").run("OUTPUT_UNCHANGED", 1, "{}", "task-a");
  assert.throws(() => db.prepare("UPDATE tasks SET credit_returned=? WHERE id=?").run(2, "task-a"), /credit_returned/);
  assert.throws(() => db.prepare("INSERT INTO quality_compensations (id,owner_id,root_task_id,units,created_at) VALUES (?,?,?,?,?)").run("comp-fractional", "owner-a", "task-a", 1.5, "2026-01-01T00:00:00Z"), /safe integer/);
  db.prepare("INSERT INTO quality_compensations (id,owner_id,root_task_id,units,created_at) VALUES (?,?,?,?,?)").run("comp-safe", "owner-a", "task-a", 1, "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("UPDATE quality_compensations SET units=? WHERE id=?").run(1.5, "comp-safe"), /safe integer/);
  assert.throws(() => db.prepare("INSERT INTO trial_claims (id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)").run("trial-fractional", "owner-a", "launch", 1.5, "2026-01-01T00:00:00Z"), /safe integer/);
  db.prepare("INSERT INTO trial_claims (id,user_id,trial_program_id,units,created_at) VALUES (?,?,?,?,?)").run("trial-safe", "owner-a", "launch", 1, "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("UPDATE trial_claims SET units=? WHERE id=?").run(1.5, "trial-safe"), /safe integer/);
  db.prepare("INSERT INTO versions (id,owner_id,project_id,task_id,recipe_json,created_at) VALUES (?,?,?,?,?,?)").run("version-a", "owner-a", "project-a", "task-a", "{}", "2026-01-01T00:00:00Z");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("prevents V3 reservation and lot allocation totals from exceeding their balances", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-allocation-totals-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
  for (const id of ["task-a", "task-b"]) db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run(id, "owner-a", "project-a", `submission-${id}`, "failed", 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "promo", 3, 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", 2, "reserved", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-b", "owner-a", "task-b", 1, "reserved", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", 2);
  assert.throws(() => db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-b", "lot-a", 1), /credit lot active allocations exceed lot units/);
  assert.throws(() => db.prepare("UPDATE reservations SET units=? WHERE id=?").run(1, "reservation-a"), /allocation total exceeds reservation/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("reopening V3 does not rewrite newly recorded provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-reopen-"));
  const path = join(dir, "fixture.sqlite");
  const first = openV2Database(path);
  first.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
  first.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,source_kind,created_at) VALUES (?,?,?,?,?,?,?)").run("promo-a", "owner-a", "promo", 1, 1, "promo", "2026-01-01T00:00:00Z");
  first.close();
  const second = openV2Database(path);
  const lot = second.prepare("SELECT source_kind,source_event_key FROM credit_lots WHERE id=?").get("promo-a") as { source_kind: string; source_event_key: string };
  assert.equal(lot.source_kind, "promo");
  assert.equal(lot.source_event_key, "");
  second.close();
  rmSync(dir, { recursive: true, force: true });
});

test("persists original assets, private bytes, owner upgrades and economic provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-persistence-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  for (const owner of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run(owner, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-b", "owner-b", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,private_bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("original-a", "owner-a", "project-a", "original", "image/png", 3, Buffer.from("abc"), "private-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)").run("original-b", "owner-b", "project-b", "original", "image/png", 3, "private-b", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)").run("display-a", "owner-a", "project-a", "display", "image/png", 3, "display-a", "2026-01-01T00:00:00Z");
  db.prepare("UPDATE projects SET original_asset_id=? WHERE id=?").run("original-a", "project-a");
  assert.throws(() => db.prepare("UPDATE projects SET original_asset_id=? WHERE id=?").run("original-b", "project-a"), /invalid project original asset/);
  assert.throws(() => db.prepare("UPDATE projects SET original_asset_id=? WHERE id=?").run("display-a", "project-a"), /invalid project original asset/);
  assert.throws(() => db.prepare("UPDATE assets SET kind=? WHERE id=?").run("display", "original-a"), /invalid project original asset/);
  assert.deepEqual(Array.from((db.prepare("SELECT private_bytes FROM assets WHERE id=?").get("original-a") as { private_bytes: Uint8Array }).private_bytes), [97, 98, 99]);
  db.exec("BEGIN");
  db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,private_bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("rolled-back", "owner-a", "project-a", "temporary", "image/png", 3, Buffer.from("tmp"), "private-tmp", "2026-01-01T00:00:00Z");
  db.exec("ROLLBACK");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM assets WHERE id=?").get("rolled-back") as { count: number }).count, 0);
  db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-a", "owner-a", "sandbox", "tx-a", "pack-5", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,scope,created_at) VALUES (?,?,?,?,?,?,?)").run("scope-invalid", "owner-a", "promo", 1, 1, "paid", "2026-01-01T00:00:00Z"), /safe integers|CHECK|scope/);
  assert.throws(() => db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,purchase_id,source_kind,source_event_key,scope,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("scope-demo-purchase", "owner-a", "purchased", 1, 1, "purchase-a", "purchase", "grant-a", "demo", "2026-01-01T00:00:00Z"), /purchase lot provenance/);
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,purchase_id,source_kind,source_event_key,scope,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("scope-live-purchase", "owner-a", "purchased", 1, 1, "purchase-a", "purchase", "grant-b", "live", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("UPDATE purchases SET owner_id=? WHERE id=?").run("owner-b", "purchase-a"), /purchase provenance is immutable/);
  assert.throws(() => db.prepare("UPDATE purchases SET id=? WHERE id=?").run("purchase-rewritten", "purchase-a"), /purchase provenance is immutable/);
  db.prepare("INSERT INTO owner_upgrades (source_owner_id,target_owner_id,request_digest,created_at,completed_at,status) VALUES (?,?,?,?,?,?)").run("owner-a", "owner-b", "digest-a", "2026-01-01T00:00:00Z", null, "deferred");
  assert.throws(() => db.prepare("INSERT INTO owner_upgrades (source_owner_id,target_owner_id,request_digest,created_at,status) VALUES (?,?,?,?,?)").run("owner-a", "owner-b", "digest-b", "2026-01-01T00:00:00Z", "pending"), /UNIQUE/);
  db.prepare("INSERT INTO ledger_events (id,owner_id,origin_owner_id,ledger_event_key,event_type,units,created_at) VALUES (?,?,?,?,?,?,?)").run("ledger-a", "owner-a", "owner-a", "event-a", "grant", 1, "2026-01-01T00:00:00Z");
  assert.equal((db.prepare("SELECT origin_owner_id FROM ledger_events WHERE id=?").get("ledger-a") as { origin_owner_id: string }).origin_owner_id, "owner-a");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("distinguishes schema creation from legacy data migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-version-"));
  const path = join(dir, "old-v2.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec("CREATE TABLE migration_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migration_version VALUES (1,'2026-01-01T00:00:00Z');");
  raw.close();
  assert.throws(() => openV2Database(path), /dedicated migration task/);
  rmSync(dir, { recursive: true, force: true });
});

test("preserves a legacy sessions table and opens a V2 session beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-legacy-"));
  const path = join(dir, "legacy.sqlite");
  const legacy = openV2Database(path);
  legacy.exec("DROP TABLE v2_sessions; DROP TABLE migration_version; DROP TABLE users;");
  legacy.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)");
  legacy.prepare("INSERT INTO sessions (id,state) VALUES (?,?)").run("legacy-owner", '{"credits":3}');
  legacy.close();
  const db = openV2Database(path);
  const columns = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((row) => row.name);
  assert.deepEqual(columns, ["id", "state"]);
  assert.equal((db.prepare("SELECT state FROM sessions WHERE id=?").get("legacy-owner") as { state: string }).state, '{"credits":3}');
  db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-v2", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO v2_sessions (id,owner_id,token_digest,created_at) VALUES (?,?,?,?)").run("session-v2", "owner-v2", "digest-v2", "2026-01-01T00:00:00Z");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("reopening applies the schema idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-schema-"));
  const path = join(dir, "fixture.sqlite");
  const first = openV2Database(path);
  first.close();
  const second = openV2Database(path);
  assert.equal((second.prepare("SELECT COUNT(*) AS count FROM migration_version").get() as { count: number }).count, 1);
  second.close();
  rmSync(dir, { recursive: true, force: true });
});

test("owner-scoped composite foreign keys reject cross-owner references", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-schema-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-b", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)").run("asset-b", "owner-b", "project-a", "original", "image/png", 1, "key-b", "2026-01-01T00:00:00Z"), /FOREIGN KEY/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("critical uniqueness and check constraints are enforced", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-schema-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO plans (id,owner_id,project_id,plan_digest,user_cost_units,created_at) VALUES (?,?,?,?,?,?)").run("plan-a", "owner-a", "project-a", "digest-a", 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO tasks (id,owner_id,project_id,plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "plan-a", "submission-a", "queued", 1, "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO tasks (id,owner_id,project_id,plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("task-b", "owner-a", "project-a", "plan-a", "submission-a", "queued", 1, "2026-01-01T00:00:00Z"), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO tasks (id,owner_id,project_id,plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("task-c", "owner-a", "project-a", "plan-a", "submission-c", "invalid", 1, "2026-01-01T00:00:00Z"), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO tasks (id,owner_id,project_id,plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("task-active", "owner-a", "project-a", "plan-a", "submission-active", "processing", 1, "2026-01-01T00:00:00Z"), /UNIQUE/);
  db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-a", "owner-a", "sandbox", "tx-1", "pack-5", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-b", "owner-a", "sandbox", "tx-1", "pack-5", "2026-01-01T00:00:00Z"), /UNIQUE/);
  db.prepare("INSERT INTO quality_compensations (id,owner_id,root_task_id,units,created_at) VALUES (?,?,?,?,?)").run("comp-a", "owner-a", "task-a", 1, "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO quality_compensations (id,owner_id,root_task_id,units,created_at) VALUES (?,?,?,?,?)").run("comp-b", "owner-a", "task-a", 1, "2026-01-01T00:00:00Z"), /UNIQUE/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("prevents same-owner cross-project assets, plans, versions and task money links", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-projects-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  for (const id of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run(id, "2026-01-01T00:00:00Z");
  for (const id of ["project-a", "project-b"]) db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run(id, "owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-c", "owner-b", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)").run("asset-a", "owner-a", "project-a", "original", "image/png", 1, "asset-a", "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO versions (id,owner_id,project_id,master_asset_id,created_at) VALUES (?,?,?,?,?)").run("version-b", "owner-a", "project-b", "asset-a", "2026-01-01T00:00:00Z"), /FOREIGN KEY/);
  db.prepare("INSERT INTO plans (id,owner_id,project_id,source_asset_id,plan_digest,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("plan-a", "owner-a", "project-a", "asset-a", "digest-a", 1, "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO tasks (id,owner_id,project_id,plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("task-b", "owner-a", "project-b", "plan-a", "submission-b", "queued", 1, "2026-01-01T00:00:00Z"), /FOREIGN KEY/);
  db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO quality_compensations (id,owner_id,root_task_id,units,created_at) VALUES (?,?,?,?,?)").run("comp-b", "owner-b", "task-a", 1, "2026-01-01T00:00:00Z"), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO ledger_events (id,owner_id,ledger_event_key,task_id,event_type,units,created_at) VALUES (?,?,?,?,?,?,?)").run("ledger-b", "owner-b", "event-b", "task-a", "refund", 1, "2026-01-01T00:00:00Z"), /FOREIGN KEY/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("retains purchase replay and refund events when account deletion is attempted", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-finance-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO purchases (id,owner_id,environment,transaction_id,product_id,created_at) VALUES (?,?,?,?,?,?)").run("purchase-a", "owner-a", "sandbox", "tx-1", "pack-5", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO purchase_events (id,purchase_id,event_type,payload_json,created_at) VALUES (?,?,?,?,?)").run("refund-a", "purchase-a", "refund", '{"status":"revoked"}', "2026-01-01T00:00:00Z");
  assert.throws(() => db.prepare("DELETE FROM users WHERE id=?").run("owner-a"), /FOREIGN KEY/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM purchase_events WHERE id=?").get("refund-a") as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM purchases WHERE environment=? AND transaction_id=?").get("sandbox", "tx-1") as { count: number }).count, 1);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("enforces cover, task lineage, confirmed plan and allocation owner consistency", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v2-lineage-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  for (const id of ["owner-a", "owner-b"]) db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run(id, "2026-01-01T00:00:00Z");
  for (const [id, owner] of [["project-a", "owner-a"], ["project-b", "owner-a"], ["project-c", "owner-b"]]) db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run(id, owner, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO assets (id,owner_id,project_id,kind,mime,bytes,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?)").run("asset-a", "owner-a", "project-a", "original", "image/png", 1, "asset-a", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO plans (id,owner_id,project_id,source_asset_id,plan_digest,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("plan-a", "owner-a", "project-a", "asset-a", "digest-a", 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO tasks (id,owner_id,project_id,plan_id,confirmed_plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "plan-a", "plan-a", "submission-a", "failed", 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO versions (id,owner_id,project_id,task_id,created_at) VALUES (?,?,?,?,?)").run("version-a", "owner-a", "project-a", "task-a", "2026-01-01T00:00:00Z");
  db.prepare("UPDATE projects SET cover_version_id=? WHERE id=? AND owner_id=?").run("version-a", "project-a", "owner-a");
  assert.throws(() => db.prepare("UPDATE projects SET cover_version_id=? WHERE id=? AND owner_id=?").run("version-a", "project-b", "owner-a"), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO versions (id,owner_id,project_id,task_id,created_at) VALUES (?,?,?,?,?)").run("version-b", "owner-a", "project-b", "task-a", "2026-01-01T00:00:00Z"), /(FOREIGN KEY|UNIQUE)/);
  assert.throws(() => db.prepare("INSERT INTO tasks (id,owner_id,project_id,confirmed_plan_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?,?)").run("task-b", "owner-a", "project-b", "plan-a", "submission-b", "queued", 1, "2026-01-01T00:00:00Z"), /(FOREIGN KEY|UNIQUE)/);
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "purchased", 1, 0, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-b", "owner-b", "purchased", 1, 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", 1, "reserved", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", 1);
  assert.throws(() => db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-b", 1), /FOREIGN KEY/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("revoked and actively reserved lot units cannot be counted twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-v3-revoked-total-"));
  const db = openV2Database(join(dir, "fixture.sqlite"));
  try {
    db.prepare("INSERT INTO users (id,created_at) VALUES (?,?)").run("owner-a", "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO projects (id,owner_id,created_at) VALUES (?,?,?)").run("project-a", "owner-a", "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,created_at) VALUES (?,?,?,?,?,?,?)").run("task-a", "owner-a", "project-a", "submission-a", "queued", 2, "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "promo", 3, 1, "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", 2, "reserved", "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", 2);
    assert.throws(() => db.prepare("UPDATE credit_lots SET revoked_units=1 WHERE id='lot-a'").run(), /active allocations exceed lot units/);
    assert.equal((db.prepare("SELECT revoked_units FROM credit_lots WHERE id='lot-a'").get() as {revoked_units:number}).revoked_units, 0);
    db.prepare("UPDATE reservation_allocations SET revoked_units=1 WHERE reservation_id='reservation-a'").run();
    db.prepare("UPDATE credit_lots SET revoked_units=1 WHERE id='lot-a'").run();
    assert.equal((db.prepare("SELECT revoked_units FROM credit_lots WHERE id='lot-a'").get() as {revoked_units:number}).revoked_units, 1);
  } finally { db.close(); rmSync(dir, {recursive:true,force:true}); }
});
