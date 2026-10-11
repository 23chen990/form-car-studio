import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateLegacyDatabase } from "../../server/v2/migrate";

const state = {
  credits: 4,
  reservedCredits: 1,
  projects: [{ id: "project-1", coverVersionId: "version-1", name: "Synthetic car", source: "upload", originalUrl: "/api/images/img-1", createdAt: "2026-01-01T00:00:00.000Z", draft: { styleId: "sport", baseVersionId: "version-1", target: { bodyColor: "blue", wheelColor: "keep" }, intent: "refine", updatedAt: "2026-01-01T00:00:00.000Z" }, versions: [{ id: "version-0", parentVersionId: null, name: "Original look", imageUrl: "/api/images/img-1", styleId: "sport", target: { bodyColor: "keep", wheelColor: "keep" }, favorite: false, createdAt: "2026-01-01T00:00:00.000Z", demo: false }, { id: "version-1", parentVersionId: "version-0", taskId: "task-live", name: "First look", imageUrl: "/api/images/img-1", styleId: "sport", target: { bodyColor: "blue", wheelColor: "keep" }, favorite: true, createdAt: "2026-01-01T00:00:00.000Z", demo: false }] }],
  tasks: [{ id: "task-live", projectId: "project-1", status: "processing", intent: "refine", styleId: "sport", baseVersionId: "version-1", target: { bodyColor: "blue", wheelColor: "keep" }, versionId: "version-1", error: null, cost: 1, createdAt: "2026-01-01T00:00:00.000Z", retryOfTaskId: null, key: "legacy-key", fingerprint: "legacy-fingerprint", mode: "live" }],
  ledger: [{ id: "grant-1", taskId: null, type: "grant", amount: 5, createdAt: "2026-01-01T00:00:00.000Z" }, { id: "reserve-1", taskId: "task-live", type: "reserve", amount: 1, createdAt: "2026-01-01T00:00:00.000Z" }],
  savedStyles: ["sport"],
};

function makeLegacy(dir: string, image = Buffer.from("synthetic-image-bytes")) {
  const path = join(dir, "legacy.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE images (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL, data BLOB NOT NULL); CREATE TABLE reports (id TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);");
  db.prepare("INSERT INTO sessions VALUES (?,?)").run("guest-a", JSON.stringify(state));
  db.prepare("INSERT INTO images VALUES (?,?,?,?)").run("img-1", "guest-a", "project-1", image);
  db.prepare("INSERT INTO reports VALUES (?,?,?,?,?)").run("report-1", "guest-a", "task-live", "synthetic report", "2026-01-01T00:00:00.000Z");
  db.close();
  return path;
}

function digest(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

test("dry-run backs up a real legacy schema without writing the source or output", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-dry-"));
  const input = makeLegacy(dir), before = digest(input), output = join(dir, "v2.sqlite");
  const result = migrateLegacyDatabase({ inputPath: input, outputPath: output });
  assert.equal(result.dryRun, true);
  assert.equal(result.applied, false);
  assert.equal(result.users, 1);
  assert.equal(result.projects, 1);
  assert.equal(result.tasks, 1);
  assert.equal(result.creditUnits, 5);
  assert.equal(existsSync(output), false);
  assert.equal(digest(input), before);
  const backup = new DatabaseSync(result.backupPath);
  assert.equal((backup.prepare("SELECT id FROM sessions").get() as any).id, "guest-a");
  assert.equal((backup.prepare("SELECT state FROM sessions").get() as any).state, JSON.stringify(state));
  backup.close();
  rmSync(dir, { recursive: true, force: true });
});

test("apply migrates only an isolated copy, preserves bytes and makes active live work uncertain", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-apply-"));
  const input = makeLegacy(dir), before = digest(input), output = join(dir, "v2.sqlite");
  const result = migrateLegacyDatabase({ inputPath: input, outputPath: output, apply: true });
  assert.equal(result.applied, true);
  assert.equal(digest(input), before);
  const db = new DatabaseSync(output);
  db.exec("PRAGMA foreign_keys=ON");
  assert.equal((db.prepare("SELECT legacy_data_status FROM migration_state WHERE id=1").get() as any).legacy_data_status, "complete");
  assert.equal((db.prepare("SELECT status FROM tasks").get() as any).status, "uncertain");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM versions WHERE parent_version_id IS NOT NULL").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM projects WHERE cover_version_id IS NOT NULL").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM versions WHERE task_id IS NOT NULL").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM assets WHERE digest=?").get(result.imageHashes["guest-a:img-1"]) as any).n, 1);
  assert.equal((db.prepare("SELECT available_units,units FROM credit_lots").get() as any).available_units, 4);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM feedback").get() as any).n, 1);
  assert.equal((db.prepare("PRAGMA foreign_key_check").all() as any[]).length, 0);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("rerun is idempotent and does not duplicate users, assets, grants or reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-repeat-"));
  const input = makeLegacy(dir), output = join(dir, "v2.sqlite"), repeat = join(dir, "repeat.sqlite");
  migrateLegacyDatabase({ inputPath: input, outputPath: output, apply: true });
  const result = migrateLegacyDatabase({ inputPath: output, outputPath: repeat, apply: true });
  assert.equal(result.users, 0);
  assert.equal(result.assets, 0);
  const db = new DatabaseSync(repeat);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM credit_lots").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledger_events WHERE event_type='grant'").get() as any).n, 1);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("failure before commit leaves original database intact and no migrated output", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-fail-"));
  const input = makeLegacy(dir), before = digest(input), output = join(dir, "v2.sqlite");
  assert.throws(() => migrateLegacyDatabase({ inputPath: input, outputPath: output, apply: true, failAfter: "before-commit" }), /simulated migration failure/);
  assert.equal(existsSync(output), false);
  assert.equal(digest(input), before);
  const db = new DatabaseSync(input);
  assert.deepEqual((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_state'").get()), undefined);
  assert.equal((db.prepare("SELECT id FROM sessions").get() as any).id, "guest-a");
  assert.equal((db.prepare("SELECT state FROM sessions").get() as any).state, JSON.stringify(state));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("corrupt image fixture is rejected without touching the original", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-corrupt-"));
  const input = makeLegacy(dir, Buffer.alloc(0)), before = digest(input);
  assert.throws(() => migrateLegacyDatabase({ inputPath: input }), /corrupt image/);
  assert.equal(digest(input), before);
  rmSync(dir, { recursive: true, force: true });
});

test("refuses an early temporary V2 schema that lacks current owner/project constraints", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-early-v2-"));
  const input = join(dir, "early.sqlite");
  const db = new DatabaseSync(input);
  db.exec("CREATE TABLE migration_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migration_version VALUES (2,'2026-01-01'); CREATE TABLE migration_state (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, legacy_data_status TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE reservation_allocations (reservation_id TEXT, credit_lot_id TEXT, units INTEGER); CREATE TABLE tasks (id TEXT PRIMARY KEY); CREATE TABLE projects (id TEXT PRIMARY KEY);");
  db.close();
  assert.throws(() => migrateLegacyDatabase({ inputPath: input }), /early V2 schema version 2/);
  rmSync(dir, { recursive: true, force: true });
});
