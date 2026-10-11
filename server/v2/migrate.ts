import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openV2Database } from "./db";

export type MigrationResult = {
  dryRun: boolean;
  applied: boolean;
  sourcePath: string;
  backupPath: string;
  outputPath: string | null;
  users: number;
  projects: number;
  assets: number;
  versions: number;
  tasks: number;
  reports: number;
  creditUnits: number;
  imageHashes: Record<string, string>;
  integrity: { before: string; after: string; foreignKeys: number };
};

type Options = {
  inputPath: string;
  backupPath?: string;
  outputPath?: string;
  apply?: boolean;
  failAfter?: string;
};
type LegacyState = {
  credits?: number;
  reservedCredits?: number;
  projects?: Array<Record<string, any>>;
  tasks?: Array<Record<string, any>>;
  ledger?: Array<Record<string, any>>;
  savedStyles?: string[];
};
const now = () => new Date().toISOString();
const safeId = (prefix: string, owner: string, value: string) => `${prefix}-${createHash("sha256").update(`${owner}:${value}`).digest("hex").slice(0, 24)}`;
const sqlPath = (value: string) => `'${resolve(value).replaceAll("'", "''")}'`;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function integrity(db: DatabaseSync) {
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  const fk = db.prepare("PRAGMA foreign_key_check").all();
  return { result: result.integrity_check, foreignKeys: fk.length };
}

/** Make a consistent SQLite copy without copying a live WAL file by hand. */
export function backupDatabase(inputPath: string, destinationPath: string): void {
  if (resolve(inputPath) === resolve(destinationPath)) throw new Error("backup destination must differ from input");
  mkdirSync(dirname(destinationPath), { recursive: true });
  rmSync(destinationPath, { force: true });
  const source = new DatabaseSync(inputPath);
  try {
    source.exec("PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(TRUNCATE);");
    source.exec(`VACUUM INTO ${sqlPath(destinationPath)}`);
  } finally {
    source.close();
  }
}

function hasTable(db: DatabaseSync, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function imageIdFromUrl(url: unknown) {
  if (typeof url !== "string") return null;
  const value = url.split("/").at(-1);
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
function maybeFail(options: Options, stage: string) {
  if (options.failAfter === stage) throw new Error(`simulated migration failure after ${stage}`);
}

function assertCurrentSchemaShape(path: string) {
  const raw = new DatabaseSync(path);
  try {
    const marker = raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_version'").get();
    if (!marker) return;
    const versionRow = raw.prepare("SELECT version FROM migration_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined;
    if (versionRow?.version !== 2) return;
    const state = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_state'").get();
    const columns = (table: string) => new Set((raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
    if (!state || !columns("reservation_allocations").has("owner_id") || !columns("tasks").has("project_id") || !columns("projects").has("cover_version_id")) {
      throw new Error("early V2 schema version 2 is missing current owner/project constraints; refuse silent migration");
    }
  } finally {
    raw.close();
  }
}

function migrateCopy(path: string, options: Options): Omit<MigrationResult, "dryRun" | "applied" | "sourcePath" | "backupPath" | "outputPath"> {
  assertCurrentSchemaShape(path);
  const db = openV2Database(path);
  const before = integrity(db);
  if (before.result !== "ok" || before.foreignKeys !== 0) throw new Error("source copy failed integrity checks");
  const state = db.prepare("SELECT legacy_data_status FROM migration_state WHERE id=1").get() as { legacy_data_status: string };
  if (state.legacy_data_status === "complete") {
    db.close();
    return { users: 0, projects: 0, assets: 0, versions: 0, tasks: 0, reports: 0, creditUnits: 0, imageHashes: {}, integrity: { before: before.result, after: before.result, foreignKeys: 0 } };
  }
  if (!hasTable(db, "sessions") || !hasTable(db, "images") || !hasTable(db, "reports")) throw new Error("legacy tables sessions, images and reports are required");
  const sessions = db.prepare("SELECT id,state FROM sessions ORDER BY id").all() as { id: string; state: string }[];
  const images = db.prepare("SELECT id,owner,project_id,data FROM images ORDER BY id").all() as { id: string; owner: string; project_id: string; data: Uint8Array }[];
  const reports = db.prepare("SELECT id,owner,task_id,reason,created_at FROM reports ORDER BY id").all() as { id: string; owner: string; task_id: string; reason: string; created_at: string }[];
  const imageHashes: Record<string, string> = {};
  for (const image of images) {
    if (image.data.byteLength === 0) throw new Error(`corrupt image ${image.id}`);
    imageHashes[`${image.owner}:${image.id}`] = sha256(image.data);
  }
  let users = 0, projects = 0, assets = 0, versions = 0, tasks = 0, reportCount = 0, creditUnits = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE migration_state SET legacy_data_status='in_progress', updated_at=? WHERE id=1").run(now());
    const userIds = new Set<string>();
    for (const row of sessions) {
      const owner = row.id;
      const legacy: LegacyState = JSON.parse(row.state);
      userIds.add(owner);
      db.prepare("INSERT OR IGNORE INTO users (id,created_at) VALUES (?,?)").run(owner, now());
      users++;
      const projectsById = new Map<string, string>();
      for (const project of legacy.projects ?? []) {
        const projectId = safeId("legacy-project", owner, String(project.id));
        projectsById.set(String(project.id), projectId);
        db.prepare("INSERT OR IGNORE INTO projects (id,owner_id,name,created_at) VALUES (?,?,?,?)").run(projectId, owner, String(project.name ?? "Imported car"), String(project.createdAt ?? now()));
        projects++;
      }
      const assetByImage = new Map<string, string>();
      for (const image of images.filter((item) => item.owner === owner)) {
        const assetId = safeId("legacy-asset", owner, image.id);
        assetByImage.set(image.id, assetId);
        const projectId = projectsById.get(image.project_id) ?? safeId("legacy-project", owner, image.project_id);
        db.prepare("INSERT OR IGNORE INTO projects (id,owner_id,name,created_at) VALUES (?,?,?,?)").run(projectId, owner, "Imported car", now());
        db.prepare("INSERT OR IGNORE INTO assets (id,owner_id,project_id,kind,mime,bytes,digest,storage_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(assetId, owner, projectId, "original", "image/png", image.data.byteLength, imageHashes[`${owner}:${image.id}`], `legacy://${owner}/${image.id}`, now());
        assets++;
      }
      for (const project of legacy.projects ?? []) {
        const projectId = projectsById.get(String(project.id))!;
        const versionsForProject = Array.isArray(project.versions) ? project.versions : [];
        for (const version of versionsForProject) {
          const versionId = safeId("legacy-version", owner, String(version.id));
          const imageId = imageIdFromUrl(version.imageUrl);
          const assetId = imageId ? assetByImage.get(imageId) ?? null : null;
          db.prepare("INSERT OR IGNORE INTO versions (id,owner_id,project_id,master_asset_id,display_asset_id,task_id,name,favorite,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(versionId, owner, projectId, assetId, assetId, null, String(version.name ?? "Imported version"), version.favorite ? 1 : 0, String(version.createdAt ?? now()));
          versions++;
        }
        if (project.draft) db.prepare("INSERT OR IGNORE INTO drafts (id,owner_id,project_id,revision,source_ref,edits_json,updated_at) VALUES (?,?,?,?,?,?,?)").run(safeId("legacy-draft", owner, String(project.id)), owner, projectId, 0, String(project.draft.baseVersionId ?? "original"), JSON.stringify(project.draft), String(project.draft.updatedAt ?? now()));
      }
      for (const task of legacy.tasks ?? []) {
        const projectId = projectsById.get(String(task.projectId)) ?? safeId("legacy-project", owner, String(task.projectId));
        const taskId = safeId("legacy-task", owner, String(task.id));
        const status = ["queued", "processing", "uncertain"].includes(String(task.status)) ? "uncertain" : String(task.status);
        db.prepare("INSERT OR IGNORE INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,result_version_id,root_task_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(taskId, owner, projectId, `legacy:${task.id}`, status, Number(task.cost ?? 1), null, null, String(task.createdAt ?? now()), String(task.updatedAt ?? task.createdAt ?? now()));
        tasks++;
        if (task.versionId) db.prepare("UPDATE tasks SET result_version_id=? WHERE id=? AND owner_id=?").run(safeId("legacy-version", owner, String(task.versionId)), taskId, owner);
        if (task.retryOfTaskId) db.prepare("UPDATE tasks SET root_task_id=? WHERE id=? AND owner_id=?").run(safeId("legacy-task", owner, String(task.retryOfTaskId)), taskId, owner);
        if (["queued", "processing", "uncertain"].includes(String(task.status))) {
          const reservationId = safeId("legacy-reservation", owner, String(task.id));
          db.prepare("INSERT OR IGNORE INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)").run(reservationId, owner, taskId, Number(task.cost ?? 1), "reserved", String(task.createdAt ?? now()));
        }
      }
      for (const project of legacy.projects ?? []) {
        const projectId = projectsById.get(String(project.id))!;
        for (const version of Array.isArray(project.versions) ? project.versions : []) {
          const versionId = safeId("legacy-version", owner, String(version.id));
          if (version.taskId) db.prepare("UPDATE versions SET task_id=? WHERE id=? AND owner_id=?").run(safeId("legacy-task", owner, String(version.taskId)), versionId, owner);
          if (version.parentVersionId) db.prepare("UPDATE versions SET parent_version_id=? WHERE id=? AND owner_id=?").run(safeId("legacy-version", owner, String(version.parentVersionId)), versionId, owner);
        }
        const cover = project.coverVersionId ?? (Array.isArray(project.versions) ? project.versions.find((version) => version.favorite)?.id : undefined);
        if (cover) db.prepare("UPDATE projects SET cover_version_id=? WHERE id=? AND owner_id=?").run(safeId("legacy-version", owner, String(cover)), projectId, owner);
      }
      const available = Math.max(0, Number(legacy.credits ?? 0));
      const reserved = Math.max(0, Number(legacy.reservedCredits ?? 0));
      const lotId = safeId("legacy-lot", owner, "starting-balance");
      db.prepare("INSERT OR IGNORE INTO credit_lots (id,owner_id,kind,units,available_units,created_at) VALUES (?,?,?,?,?,?)").run(lotId, owner, "promo", available + reserved, available, now());
      creditUnits += available + reserved;
      for (const task of legacy.tasks ?? []) {
        if (!["queued", "processing", "uncertain"].includes(String(task.status))) continue;
        const taskId = safeId("legacy-task", owner, String(task.id));
        db.prepare("INSERT OR IGNORE INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)").run(owner, safeId("legacy-reservation", owner, String(task.id)), lotId, Number(task.cost ?? 1));
      }
      for (const entry of legacy.ledger ?? []) {
        const taskId = entry.taskId ? safeId("legacy-task", owner, String(entry.taskId)) : null;
        db.prepare("INSERT OR IGNORE INTO ledger_events (id,owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,created_at) VALUES (?,?,?,?,?,?,?,?)").run(safeId("legacy-ledger", owner, String(entry.id)), owner, `legacy:${entry.id}`, taskId, lotId, String(entry.type ?? "grant"), Math.max(1, Number(entry.amount ?? 0)), String(entry.createdAt ?? now()));
      }
      for (const report of reports.filter((item) => item.owner === owner)) {
        const taskId = safeId("legacy-task", owner, report.task_id);
        db.prepare("INSERT OR IGNORE INTO feedback (id,owner_id,task_id,category,body,created_at) VALUES (?,?,?,?,?,?)").run(safeId("legacy-report", owner, report.id), owner, taskId, "legacy_report", report.reason, report.created_at);
        reportCount++;
      }
      db.prepare("UPDATE migration_state SET legacy_data_status='complete', updated_at=? WHERE id=1").run(now());
      maybeFail(options, "before-commit");
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.close();
    throw error;
  }
  const after = integrity(db);
  if (after.result !== "ok" || after.foreignKeys !== 0) { db.close(); throw new Error("migrated copy failed integrity checks"); }
  db.close();
  return { users, projects, assets, versions, tasks, reports: reportCount, creditUnits, imageHashes, integrity: { before: before.result, after: after.result, foreignKeys: after.foreignKeys } };
}

export function migrateLegacyDatabase(options: Options): MigrationResult {
  const inputPath = resolve(options.inputPath);
  if (!existsSync(inputPath)) throw new Error(`input database does not exist: ${inputPath}`);
  const dryRun = options.apply !== true;
  const backupPath = resolve(options.backupPath ?? join(tmpdir(), `form-f03-backup-${Date.now()}.sqlite`));
  backupDatabase(inputPath, backupPath);
  const workPath = join(tmpdir(), `form-f03-work-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  try {
    backupDatabase(inputPath, workPath);
    const report = migrateCopy(workPath, options);
    const outputPath = options.outputPath ? resolve(options.outputPath) : null;
    if (!dryRun) {
      if (!outputPath || outputPath === inputPath) throw new Error("--apply requires a distinct --output disposable database");
      backupDatabase(workPath, outputPath);
    }
    return { dryRun, applied: !dryRun, sourcePath: inputPath, backupPath, outputPath: dryRun ? null : outputPath, ...report };
  } finally {
    rmSync(workPath, { force: true });
  }
}

export function formatMigrationResult(result: MigrationResult) {
  return JSON.stringify(result, null, 2);
}
