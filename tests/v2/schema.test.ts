import assert from "node:assert/strict";
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
  for (const name of ["migration_version", "users", "sessions", "projects", "assets", "versions", "drafts", "plans", "tasks", "supplier_attempts", "credit_lots", "reservations", "reservation_allocations", "ledger_events", "purchases", "purchase_events", "consents", "feedback", "quality_compensations", "trial_claims", "deletion_jobs", "audit_events"]) assert.ok(names.has(name), name);
  assert.equal((db.prepare("SELECT version FROM migration_version").get() as { version: number }).version, 1);
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
