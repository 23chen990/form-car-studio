import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

type LegacyImage = { id: string; owner: string; projectId: string; data: Buffer };
type LegacySession = { id: string; state: unknown };
type LegacyReport = { id: string; owner: string; taskId: string; reason: string; createdAt: string };
type LegacyOptions = { state?: unknown; images?: LegacyImage[]; sessions?: LegacySession[]; reports?: LegacyReport[]; keepOpen?: boolean };

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function hash(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function opaqueOwner(cookie: string) { return `legacy-owner-${hash(`form:v2:legacy-owner\0${cookie}`).slice(0, 24)}`; }
function safeId(prefix: string, owner: string, value: string) { return `${prefix}-${hash(`${owner}:${value}`).slice(0, 24)}`; }
function digest(path: string) { return hash(readFileSync(path)); }

function makeLegacy(dir: string, options: LegacyOptions = {}) {
  const path = join(dir, "legacy.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE images (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL, data BLOB NOT NULL); CREATE TABLE reports (id TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);");
  const sessions = options.sessions ?? [{ id: "guest-a", state: options.state ?? state }];
  const images = options.images ?? [{ id: "img-1", owner: "guest-a", projectId: "project-1", data: Buffer.from("synthetic-image-bytes") }];
  const reports = options.reports ?? [{ id: "report-1", owner: "guest-a", taskId: "task-live", reason: "synthetic report", createdAt: "2026-01-01T00:00:00.000Z" }];
  for (const session of sessions) db.prepare("INSERT INTO sessions VALUES (?,?)").run(session.id, JSON.stringify(session.state));
  for (const image of images) db.prepare("INSERT INTO images VALUES (?,?,?,?)").run(image.id, image.owner, image.projectId, image.data);
  for (const report of reports) db.prepare("INSERT INTO reports VALUES (?,?,?,?,?)").run(report.id, report.owner, report.taskId, report.reason, report.createdAt);
  if (options.keepOpen) return { path, writer: db };
  db.close();
  return { path, writer: undefined };
}

function legacyRows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = {
    sessions: db.prepare("SELECT id,state FROM sessions ORDER BY id").all(),
    images: (db.prepare("SELECT id,owner,project_id,data FROM images ORDER BY id").all() as Array<{ id: string; owner: string; project_id: string; data: Uint8Array }>).map((image) => ({ ...image, data: Array.from(image.data) })),
    reports: db.prepare("SELECT id,owner,task_id,reason,created_at FROM reports ORDER BY id").all(),
  };
  db.close();
  return rows;
}

function removeBackup(path: string) {
  rmSync(path, { force: true });
  const parent = dirname(path);
  if (parent.startsWith(tmpdir()) && /form-f03-backup-/.test(parent)) rmSync(parent, { recursive: true, force: true });
}

test("dry-run snapshots a live WAL source without changing source bytes or writing output", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-wal-"));
  const { path: input, writer } = makeLegacy(dir, { keepOpen: true });
  const before = digest(input), beforeWal = digest(input+"-wal"), output = join(dir, "v2.sqlite");
  try {
    const result = migrateLegacyDatabase({ inputPath: input, outputPath: output });
    assert.equal(result.dryRun, true);
    assert.equal(result.applied, false);
    assert.equal(result.users, 1);
    assert.equal(result.projects, 1);
    assert.equal(result.tasks, 1);
    assert.equal(result.creditUnits, 5);
    assert.equal(existsSync(output), false);
    assert.equal(digest(input), before);
    assert.equal(digest(input+"-wal"), beforeWal);
    assert.deepEqual(legacyRows(result.backupPath), legacyRows(input));
    removeBackup(result.backupPath);
  } finally {
    writer?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply restores legacy rows and maps opaque owners, assets, metadata, relationships and balances", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-apply-"));
  const { path: input } = makeLegacy(dir);
  const before = digest(input), oldRows = legacyRows(input), output = join(dir, "v2.sqlite");
  const result = migrateLegacyDatabase({ inputPath: input, outputPath: output, apply: true });
  const owner = opaqueOwner("guest-a"), originalId = safeId("legacy-original", owner, "img-1"), masterId = safeId("legacy-master", owner, "img-1");
  const selectedVersion = safeId("legacy-version", owner, "project-1\0version-1"), previousVersion = safeId("legacy-version", owner, "project-1\0version-0");
  assert.equal(result.applied, true);
  assert.equal(digest(input), before);
  assert.deepEqual(legacyRows(output), oldRows);
  assert.deepEqual(Object.keys(result.imageHashes), [`${owner}:${safeId("legacy-image", owner, "img-1")}`]);
  assert.equal(result.imageHashes[Object.keys(result.imageHashes)[0]], hash(Buffer.from("synthetic-image-bytes")));
  const db = new DatabaseSync(output);
  db.exec("PRAGMA foreign_keys=ON");
  assert.equal((db.prepare("SELECT legacy_data_status FROM migration_state WHERE id=1").get() as any).legacy_data_status, "complete");
  assert.equal((db.prepare("SELECT id FROM users").get() as any).id, owner);
  assert.equal((db.prepare("SELECT provider,subject FROM identities").get() as any).provider, "legacy_cookie");
  assert.equal((db.prepare("SELECT provider,subject FROM identities").get() as any).subject, hash("guest-a"));
  assert.deepEqual({ ...db.prepare("SELECT token_digest,token_kind,family_id FROM v2_sessions").get() }, { token_digest: hash("guest-a"), token_kind: "legacy", family_id: safeId("legacy-family", owner, "cookie") });
  assert.equal((db.prepare("SELECT status FROM tasks").get() as any).status, "uncertain");
  assert.deepEqual(db.prepare("SELECT id,kind,mime,width,height,private_bytes,storage_key FROM assets ORDER BY kind").all().map((row) => ({ ...row })), [
    { id: masterId, kind: "master", mime: "application/octet-stream", width: null, height: null, private_bytes: null, storage_key: `legacy://${owner}/img-1` },
    { id: originalId, kind: "original", mime: "application/octet-stream", width: null, height: null, private_bytes: null, storage_key: `legacy://${owner}/img-1` },
  ]);
  assert.deepEqual({ ...db.prepare("SELECT original_asset_id,name FROM projects").get() }, { original_asset_id: originalId, name: "Synthetic car" });
  assert.deepEqual(db.prepare("SELECT id,parent_version_id,master_asset_id,display_asset_id,task_id,name,favorite FROM versions ORDER BY favorite").all().map((row) => ({ ...row })), [
    { id: previousVersion, parent_version_id: null, master_asset_id: masterId, display_asset_id: null, task_id: null, name: "Original look", favorite: 0 },
    { id: selectedVersion, parent_version_id: previousVersion, master_asset_id: masterId, display_asset_id: null, task_id: safeId("legacy-task", owner, "project-1\0task-live"), name: "First look", favorite: 1 },
  ]);
  const draft = db.prepare("SELECT source_ref,edits_json FROM drafts").get() as { source_ref: string; edits_json: string };
  assert.equal(draft.source_ref, selectedVersion);
  assert.equal(JSON.parse(draft.edits_json).verification, "unverified");
  assert.equal(JSON.parse((db.prepare("SELECT recipe_json FROM versions WHERE id=?").get(selectedVersion) as any).recipe_json).verification, "unverified");
  assert.equal(JSON.parse((db.prepare("SELECT request_snapshot_json FROM tasks").get() as any).request_snapshot_json).verification, "unverified");
  assert.deepEqual({ ...db.prepare("SELECT available_units,units,source_kind,scope FROM credit_lots").get() }, { available_units: 4, units: 5, source_kind: "legacy_import", scope: "demo" });
  assert.deepEqual(db.prepare("SELECT event_type,units,origin_owner_id FROM ledger_events ORDER BY event_type").all().map((row) => ({ ...row })), [{ event_type: "grant", units: 5, origin_owner_id: owner }, { event_type: "reserve", units: 1, origin_owner_id: owner }]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM feedback").get() as any).n, 1);
  const v2Text = JSON.stringify(["users", "identities", "v2_sessions", "session_families", "projects", "assets", "versions", "drafts", "tasks", "credit_lots", "reservations", "reservation_allocations", "ledger_events"].flatMap((table) => db.prepare(`SELECT * FROM ${table}`).all()));
  assert.equal(v2Text.includes("guest-a"), false);
  assert.equal((db.prepare("PRAGMA foreign_key_check").all() as any[]).length, 0);
  db.close();
  removeBackup(result.backupPath);
  rmSync(dir, { recursive: true, force: true });
});

test("rerun is idempotent and does not duplicate users, assets, grants or reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-repeat-"));
  const { path: input } = makeLegacy(dir), output = join(dir, "v2.sqlite"), repeat = join(dir, "repeat.sqlite");
  const first = migrateLegacyDatabase({ inputPath: input, outputPath: output, apply: true });
  const result = migrateLegacyDatabase({ inputPath: output, outputPath: repeat, apply: true });
  assert.equal(result.users, 0);
  assert.equal(result.assets, 0);
  const db = new DatabaseSync(repeat);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM credit_lots").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledger_events WHERE event_type='grant'").get() as any).n, 1);
  db.close();
  removeBackup(first.backupPath);
  removeBackup(result.backupPath);
  rmSync(dir, { recursive: true, force: true });
});

test("rejects aliases and every existing backup or output destination before any write", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-paths-"));
  const { path: input } = makeLegacy(dir), before = digest(input);
  const hardlink = join(dir, "hardlink.sqlite"), symlink = join(dir, "symlink.sqlite");
  linkSync(input, hardlink);
  symlinkSync(input, symlink);
  assert.throws(() => migrateLegacyDatabase({ inputPath: input, backupPath: input }), /destination.*input|must differ/i);
  assert.throws(() => migrateLegacyDatabase({ inputPath: input, outputPath: hardlink, apply: true }), /destination already exists/i);
  assert.throws(() => migrateLegacyDatabase({ inputPath: input, outputPath: symlink, apply: true }), /destination already exists/i);
  assert.equal(digest(input), before);
  rmSync(dir, { recursive: true, force: true });
});

test("same-clock backup requests get distinct snapshots and invalid values or references fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-invalid-"));
  const { path: input } = makeLegacy(dir);
  const originalNow = Date.now;
  try {
    Date.now = () => 1;
    const first = migrateLegacyDatabase({ inputPath: input });
    const second = migrateLegacyDatabase({ inputPath: input });
    assert.notEqual(first.backupPath, second.backupPath);
    assert.ok(existsSync(first.backupPath));
    assert.ok(existsSync(second.backupPath));
    removeBackup(first.backupPath);
    removeBackup(second.backupPath);
  } finally { Date.now = originalNow; }
  for (const [field, value] of [["credits", -1], ["credits", 1.5], ["credits", "1"], ["reservedCredits", -1], ["reservedCredits", Number.MAX_SAFE_INTEGER + 1], ["cost", 1.5]] as const) {
    const invalid = clone(state) as any;
    if (field === "cost") invalid.tasks[0].cost = value;
    else invalid[field] = value;
    assert.throws(() => migrateLegacyDatabase({ inputPath: makeLegacy(mkdtempSync(join(tmpdir(), "form-f03-number-")), { state: invalid }).path }), /safe integer|positive/i);
  }
  const mismatch = clone(state) as any;
  mismatch.reservedCredits = 0;
  assert.throws(() => migrateLegacyDatabase({ inputPath: makeLegacy(mkdtempSync(join(tmpdir(), "form-f03-mismatch-")), { state: mismatch }).path }), /reserved.*active/i);
  const missing = clone(state) as any;
  missing.projects[0].versions[0].imageUrl = "/api/images/missing";
  assert.throws(() => migrateLegacyDatabase({ inputPath: makeLegacy(mkdtempSync(join(tmpdir(), "form-f03-missing-")), { state: missing }).path }), /missing.*image/i);
  rmSync(dir, { recursive: true, force: true });
});

test("zero balance creates no grant and failure leaves original database and output intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-zero-"));
  const zero = clone(state) as any;
  zero.credits = 0;
  zero.reservedCredits = 0;
  zero.tasks = [];
  delete zero.projects[0].versions[1].taskId;
  zero.ledger = [];
  const { path: input } = makeLegacy(dir, { state: zero, reports: [] }), output = join(dir, "zero.sqlite"), before = digest(input);
  const result = migrateLegacyDatabase({ inputPath: input, outputPath: output, apply: true });
  const db = new DatabaseSync(output);
  assert.deepEqual({ ...db.prepare("SELECT units,available_units FROM credit_lots").get() }, { units: 0, available_units: 0 });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledger_events").get() as any).n, 0);
  db.close();
  assert.throws(() => migrateLegacyDatabase({ inputPath: input, outputPath: join(dir, "failure.sqlite"), apply: true, failAfter: "before-commit" }), /simulated migration failure/);
  assert.equal(digest(input), before);
  assert.equal(existsSync(join(dir, "failure.sqlite")), false);
  removeBackup(result.backupPath);
  rmSync(dir, { recursive: true, force: true });
});

test("corrupt images and early temporary V2 schemas are rejected without source changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "form-f03-reject-"));
  const { path: corrupt } = makeLegacy(dir, { images: [{ id: "img-1", owner: "guest-a", projectId: "project-1", data: Buffer.alloc(0) }] }), before = digest(corrupt);
  assert.throws(() => migrateLegacyDatabase({ inputPath: corrupt }), /corrupt image/);
  assert.equal(digest(corrupt), before);
  const early = join(dir, "early.sqlite");
  const db = new DatabaseSync(early);
  db.exec("CREATE TABLE migration_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migration_version VALUES (2,'2026-01-01'); CREATE TABLE migration_state (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, legacy_data_status TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE reservation_allocations (reservation_id TEXT, credit_lot_id TEXT, units INTEGER); CREATE TABLE tasks (id TEXT PRIMARY KEY); CREATE TABLE projects (id TEXT PRIMARY KEY);");
  db.close();
  assert.throws(() => migrateLegacyDatabase({ inputPath: early }), /early V2 schema version 2/);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI help succeeds and invalid flags or inputs exit with usage status", () => {
  const cli = resolve("tools/migrate-form.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { cwd: resolve("."), encoding: "utf8" });
  assert.equal(run("--help").status, 0);
  assert.equal(run("--unknown").status, 2);
  assert.equal(run("--input", join(tmpdir(), "missing-form-f03.sqlite")).status, 2);
  assert.equal(run("--apply").status, 2);
});
