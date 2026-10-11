import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openV2Database } from "../../server/v2/db";

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
  assert.equal((db.prepare("SELECT version FROM migration_version").get() as { version: number }).version, 2);
  assert.equal((db.prepare("SELECT legacy_data_status FROM migration_state WHERE id=1").get() as { legacy_data_status: string }).legacy_data_status, "pending");
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
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-a", "owner-a", "purchased", 1, 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run("lot-b", "owner-b", "purchased", 1, 1, "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run("reservation-a", "owner-a", "task-a", 1, "reserved", "2026-01-01T00:00:00Z");
  db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-a", 1);
  assert.throws(() => db.prepare("INSERT INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run("owner-a", "reservation-a", "lot-b", 1), /FOREIGN KEY/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
