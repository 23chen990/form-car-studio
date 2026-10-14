import { createHash } from "node:crypto";
import { constants, copyFileSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

type Options = { inputPath: string; backupPath?: string; outputPath?: string; apply?: boolean; failAfter?: string };
type LegacyRecord = Record<string, unknown>;
type LegacyState = { credits?: unknown; reservedCredits?: unknown; projects?: unknown; tasks?: unknown };
type LegacyImage = { id: unknown; owner: unknown; project_id: unknown; data: Uint8Array };
type LegacyReport = { id: unknown; owner: unknown; task_id: unknown; reason: unknown; created_at: unknown };
type PreparedProject = { legacyId: string; id: string; row: LegacyRecord; versions: LegacyRecord[]; versionIds: Map<string, string>; originalImageId: string | null };
type PreparedTask = { legacyId: string; id: string; project: PreparedProject; row: LegacyRecord; status: string; cost: number };
type PreparedOwner = { rawCookie: string; owner: string; tokenDigest: string; legacy: LegacyState; projects: PreparedProject[]; projectsById: Map<string, PreparedProject>; tasks: PreparedTask[]; tasksById: Map<string, PreparedTask>; credits: number; reserved: number };
type PreparedImage = { legacyId: string; owner: PreparedOwner; project: PreparedProject; data: Uint8Array; digest: string; safeImageId: string; originalAssetId: string; masterAssetId: string };

const activeStatuses = new Set(["queued", "processing", "uncertain"]);
const completedStatuses = new Set(["succeeded", "failed", "cancelled"]);
const now = () => new Date().toISOString();
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeId = (prefix: string, owner: string, value: string) => `${prefix}-${sha256(`${owner}:${value}`).slice(0, 24)}`;
const scoped = (projectId: string, id: string) => `${projectId}\0${id}`;
const ownerId = (rawCookie: string) => `legacy-owner-${sha256(`form:v2:legacy-owner\0${rawCookie}`).slice(0, 24)}`;
const sqlPath = (value: string) => `'${value.replaceAll("'", "''")}'`;

function integrity(db: DatabaseSync) {
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  return { result: result.integrity_check, foreignKeys: db.prepare("PRAGMA foreign_key_check").all().length };
}

function lstatOrNull(path: string) {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function canonicalPath(path: string) {
  let current = resolve(path);
  const missing: string[] = [];
  while (!lstatOrNull(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`path has no existing parent: ${path}`);
    missing.unshift(basename(current));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}

function requireInput(path: string) {
  const absolute = resolve(path);
  if (!lstatOrNull(absolute)) throw new Error(`input database does not exist: ${absolute}`);
  return { absolute, canonical: realpathSync(absolute) };
}

function realpathOrNull(path: string) {
  try { return realpathSync(path); } catch { return null; }
}

function destination(path: string, label: string, inputCanonical: string, prior: string[]) {
  const absolute = resolve(path);
  if (absolute === inputCanonical || realpathOrNull(absolute) === inputCanonical) throw new Error(`${label} destination already exists and aliases input`);
  if (lstatOrNull(absolute)) throw new Error(`${label} destination already exists: ${absolute}`);
  if (!lstatOrNull(dirname(absolute))) throw new Error(`${label} destination parent does not exist: ${dirname(absolute)}`);
  const canonical = canonicalPath(absolute);
  if (canonical === inputCanonical || prior.includes(canonical)) throw new Error(`${label} destination aliases input or another destination`);
  return { absolute, canonical };
}

/** A read-only WAL-aware snapshot; this never checkpoints or mutates the source. */
function snapshotDatabase(inputPath: string, destinationPath: string): void {
  const source = new DatabaseSync(inputPath, { readOnly: true });
  try { source.exec(`VACUUM INTO ${sqlPath(destinationPath)}`); } finally { source.close(); }
}

export function backupDatabase(inputPath: string, destinationPath: string): void {
  const input = requireInput(inputPath);
  const output = destination(destinationPath, "backup", input.canonical, []);
  snapshotDatabase(input.canonical, output.absolute);
}

function hasTable(db: DatabaseSync, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function imageIdFromUrl(url: unknown) {
  if (typeof url !== "string") return null;
  const value = url.split("/").at(-1);
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function stringId(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`legacy ${label} must be a non-empty string`);
  return value;
}

function records(value: unknown, label: string): LegacyRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error(`legacy ${label} must be an array of objects`);
  return value as LegacyRecord[];
}

function safeInteger(value: unknown, label: string, minimum: number, missing = 0) {
  const number = value === undefined ? missing : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < minimum) throw new Error(`legacy ${label} must be a safe integer${minimum > 0 ? " greater than zero" : ""}`);
  return number;
}

function text(value: unknown, fallback: string) { return typeof value === "string" ? value : fallback; }
function timestamp(value: unknown) { return typeof value === "string" ? value : now(); }
function maybeFail(options: Options, stage: string) { if (options.failAfter === stage) throw new Error(`simulated migration failure after ${stage}`); }

function target(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const selected: LegacyRecord = {};
  for (const key of ["bodyColor", "wheelColor", "finish", "wheelDesign"]) if (typeof (value as LegacyRecord)[key] === "string") selected[key] = (value as LegacyRecord)[key];
  return Object.keys(selected).length ? selected : undefined;
}

function metadata(row: LegacyRecord, fields: string[]) {
  const result: LegacyRecord = { source: "legacy", verification: "unverified" };
  for (const field of fields) if (typeof row[field] === "string" || typeof row[field] === "boolean") result[field] = row[field];
  const selectedTarget = target(row.target);
  if (selectedTarget) result.target = selectedTarget;
  return JSON.stringify(result);
}

function assertCurrentSchemaShape(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    if (!hasTable(raw, "migration_version")) return;
    const version = raw.prepare("SELECT version FROM migration_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined;
    if (version?.version !== 2) return;
    const columns = (table: string) => new Set((raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
    if (!hasTable(raw, "migration_state") || !columns("reservation_allocations").has("owner_id") || !columns("tasks").has("project_id") || !columns("projects").has("cover_version_id")) throw new Error("early V2 schema version 2 is missing current owner/project constraints; refuse silent migration");
  } finally { raw.close(); }
}

function prepareOwners(sessions: { id: unknown; state: unknown }[]) {
  const owners: PreparedOwner[] = [];
  const byCookie = new Map<string, PreparedOwner>();
  for (const session of sessions) {
    const rawCookie = stringId(session.id, "session id");
    if (typeof session.state !== "string") throw new Error("legacy session state must be JSON text");
    let parsed: unknown;
    try { parsed = JSON.parse(session.state); } catch { throw new Error("legacy session has invalid JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("legacy session state must be an object");
    const legacy = parsed as LegacyState;
    const owner = ownerId(rawCookie);
    const projectsById = new Map<string, PreparedProject>();
    const projects = records(legacy.projects, "projects").map((row) => {
      const legacyId = stringId(row.id, "project id");
      if (projectsById.has(legacyId)) throw new Error(`duplicate legacy project ${legacyId}`);
      const project: PreparedProject = { legacyId, id: safeId("legacy-project", owner, legacyId), row, versions: records(row.versions, "project versions"), versionIds: new Map(), originalImageId: row.originalUrl == null ? null : imageReference(row.originalUrl, `project ${legacyId}`) };
      for (const version of project.versions) {
        const versionId = stringId(version.id, "version id");
        if (project.versionIds.has(versionId)) throw new Error(`duplicate legacy version ${versionId}`);
        project.versionIds.set(versionId, safeId("legacy-version", owner, scoped(legacyId, versionId)));
      }
      projectsById.set(legacyId, project);
      return project;
    });
    const tasksById = new Map<string, PreparedTask>();
    const tasks = records(legacy.tasks, "tasks").map((row) => {
      const legacyId = stringId(row.id, "task id");
      const projectLegacyId = stringId(row.projectId, "task project id");
      const project = projectsById.get(projectLegacyId);
      if (!project) throw new Error(`missing legacy project ${projectLegacyId} for task ${legacyId}`);
      if (tasksById.has(legacyId)) throw new Error(`duplicate legacy task ${legacyId}`);
      const sourceStatus = stringId(row.status, "task status");
      const status = activeStatuses.has(sourceStatus) ? "uncertain" : completedStatuses.has(sourceStatus) ? sourceStatus : (() => { throw new Error(`unsupported legacy task status ${sourceStatus}`); })();
      const task: PreparedTask = { legacyId, id: safeId("legacy-task", owner, scoped(projectLegacyId, legacyId)), project, row, status, cost: safeInteger(row.cost, "task cost", 1, -1) };
      tasksById.set(legacyId, task);
      return task;
    });
    const active = tasks.filter((task) => task.status === "uncertain");
    const credits = safeInteger(legacy.credits, "credits", 0);
    const reserved = safeInteger(legacy.reservedCredits, "reserved credits", 0);
    if (active.length > 1) throw new Error("legacy owner has more than one active task");
    if (active.reduce((sum, task) => sum + task.cost, 0) !== reserved) throw new Error("legacy reserved credits must equal active task cost");
    if (credits > Number.MAX_SAFE_INTEGER - reserved) throw new Error("legacy opening balance exceeds safe integer range");
    const prepared: PreparedOwner = { rawCookie, owner, tokenDigest: sha256(rawCookie), legacy, projects, projectsById, tasks, tasksById, credits, reserved };
    byCookie.set(rawCookie, prepared);
    owners.push(prepared);
  }
  return { owners, byCookie };
}

function imageReference(value: unknown, label: string) {
  const imageId = imageIdFromUrl(value);
  if (!imageId) throw new Error(`missing legacy image reference for ${label}`);
  return imageId;
}

function prepareImages(rows: LegacyImage[], owners: Map<string, PreparedOwner>) {
  const images = new Map<string, PreparedImage>();
  for (const row of rows) {
    const legacyId = stringId(row.id, "image id"), rawCookie = stringId(row.owner, "image owner"), projectId = stringId(row.project_id, "image project id");
    const owner = owners.get(rawCookie), project = owner?.projectsById.get(projectId);
    if (!owner || !project) throw new Error(`missing legacy owner or project for image ${legacyId}`);
    if (images.has(legacyId)) throw new Error(`duplicate legacy image ${legacyId}`);
    if (!(row.data instanceof Uint8Array) || row.data.byteLength === 0) throw new Error(`corrupt image ${legacyId}`);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(legacyId) || legacyId.includes(rawCookie)) throw new Error("unsafe legacy storage identifier");
    const safeImageId = safeId("legacy-image", owner.owner, legacyId);
    images.set(legacyId, { legacyId, owner, project, data: row.data, digest: sha256(row.data), safeImageId, originalAssetId: safeId("legacy-original", owner.owner, legacyId), masterAssetId: safeId("legacy-master", owner.owner, legacyId) });
  }
  return images;
}

function validateReferences(owners: PreparedOwner[], images: Map<string, PreparedImage>, reports: LegacyReport[]) {
  const imageFor = (owner: PreparedOwner, project: PreparedProject, id: string) => {
    const image = images.get(id);
    if (!image) throw new Error(`missing legacy image ${id}`);
    if (image.owner !== owner || image.project !== project) throw new Error(`cross-owner legacy image reference ${id}`);
    return image;
  };
  for (const owner of owners) for (const project of owner.projects) {
    if (project.originalImageId) imageFor(owner, project, project.originalImageId);
    for (const version of project.versions) {
      imageFor(owner, project, imageReference(version.imageUrl, `version ${stringId(version.id, "version id")}`));
      if (version.parentVersionId != null && !project.versionIds.has(stringId(version.parentVersionId, "parent version id"))) throw new Error(`missing legacy parent version ${version.parentVersionId}`);
      if (version.taskId != null) {
        const task = owner.tasksById.get(stringId(version.taskId, "version task id"));
        if (!task || task.project !== project) throw new Error(`cross-owner legacy task reference ${version.taskId}`);
      }
    }
    if (project.row.coverVersionId != null && !project.versionIds.has(stringId(project.row.coverVersionId, "cover version id"))) throw new Error(`missing legacy cover version ${project.row.coverVersionId}`);
    if (project.row.draft != null) {
      if (!project.row.draft || typeof project.row.draft !== "object" || Array.isArray(project.row.draft)) throw new Error("legacy draft must be an object");
      const base = (project.row.draft as LegacyRecord).baseVersionId;
      if (base == null ? !project.originalImageId : !project.versionIds.has(stringId(base, "draft source version id"))) throw new Error("missing legacy draft source version");
    }
  }
  for (const owner of owners) for (const task of owner.tasks) {
    if (task.row.versionId != null) {
      const version = task.project.versionIds.get(stringId(task.row.versionId, "task version id"));
      if (!version) throw new Error(`missing legacy task version ${task.row.versionId}`);
    }
    if (task.row.retryOfTaskId != null) {
      const root = owner.tasksById.get(stringId(task.row.retryOfTaskId, "retry task id"));
      if (!root || root.project !== task.project) throw new Error(`cross-owner legacy retry reference ${task.row.retryOfTaskId}`);
    }
  }
  for (const report of reports) {
    const owner = owners.find((item) => item.rawCookie === stringId(report.owner, "report owner"));
    const task = owner?.tasksById.get(stringId(report.task_id, "report task id"));
    if (!owner || !task) throw new Error(`missing legacy report task ${String(report.task_id)}`);
  }
  return imageFor;
}

function migrateCopy(path: string, options: Options): Omit<MigrationResult, "dryRun" | "applied" | "sourcePath" | "backupPath" | "outputPath"> {
  assertCurrentSchemaShape(path);
  const db = openV2Database(path);
  try {
    const before = integrity(db);
    if (before.result !== "ok" || before.foreignKeys !== 0) throw new Error("source copy failed integrity checks");
    const migration = db.prepare("SELECT legacy_data_status FROM migration_state WHERE id=1").get() as { legacy_data_status: string };
    if (migration.legacy_data_status === "complete") return { users: 0, projects: 0, assets: 0, versions: 0, tasks: 0, reports: 0, creditUnits: 0, imageHashes: {}, integrity: { before: before.result, after: before.result, foreignKeys: 0 } };
    if (!hasTable(db, "sessions") || !hasTable(db, "images") || !hasTable(db, "reports")) throw new Error("legacy tables sessions, images and reports are required");
    const sessions = db.prepare("SELECT id,state FROM sessions ORDER BY id").all() as { id: unknown; state: unknown }[];
    const imageRows = db.prepare("SELECT id,owner,project_id,data FROM images ORDER BY id").all() as LegacyImage[];
    const reports = db.prepare("SELECT id,owner,task_id,reason,created_at FROM reports ORDER BY id").all() as LegacyReport[];
    const prepared = prepareOwners(sessions), images = prepareImages(imageRows, prepared.byCookie), imageFor = validateReferences(prepared.owners, images, reports);
    const imageHashes: Record<string, string> = {};
    for (const image of images.values()) imageHashes[`${image.owner.owner}:${image.safeImageId}`] = image.digest;
    let users = 0, projects = 0, assets = 0, versions = 0, tasks = 0, reportCount = 0, creditUnits = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE migration_state SET legacy_data_status='in_progress', updated_at=? WHERE id=1").run(now());
      const insertUser = db.prepare("INSERT OR IGNORE INTO users (id,created_at) VALUES (?,?)");
      const insertFamily = db.prepare("INSERT OR IGNORE INTO session_families (id,owner_id,created_at) VALUES (?,?,?)");
      const insertIdentity = db.prepare("INSERT OR IGNORE INTO identities (id,user_id,provider,subject,created_at) VALUES (?,?,?,?,?)");
      const insertSession = db.prepare("INSERT OR IGNORE INTO v2_sessions (id,owner_id,token_digest,created_at,family_id,token_kind) VALUES (?,?,?,?,?,?)");
      const insertProject = db.prepare("INSERT OR IGNORE INTO projects (id,owner_id,name,created_at) VALUES (?,?,?,?)");
      const insertAsset = db.prepare("INSERT OR IGNORE INTO assets (id,owner_id,project_id,kind,mime,bytes,width,height,digest,storage_key,private_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
      const insertVersion = db.prepare("INSERT OR IGNORE INTO versions (id,owner_id,project_id,master_asset_id,display_asset_id,task_id,name,favorite,recipe_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
      const insertTask = db.prepare("INSERT OR IGNORE INTO tasks (id,owner_id,project_id,submission_id,status,user_cost_units,result_version_id,root_task_id,request_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
      const insertDraft = db.prepare("INSERT OR IGNORE INTO drafts (id,owner_id,project_id,revision,source_ref,edits_json,updated_at) VALUES (?,?,?,?,?,?,?)");
      const insertLot = db.prepare("INSERT OR IGNORE INTO credit_lots (id,owner_id,kind,units,available_units,source_kind,source_event_key,scope,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
      const insertReservation = db.prepare("INSERT OR IGNORE INTO reservations (id,owner_id,task_id,units,status,created_at) VALUES (?,?,?,?,?,?)");
      const insertAllocation = db.prepare("INSERT OR IGNORE INTO reservation_allocations (owner_id,reservation_id,credit_lot_id,units) VALUES (?,?,?,?)");
      const insertLedger = db.prepare("INSERT OR IGNORE INTO ledger_events (id,owner_id,ledger_event_key,task_id,credit_lot_id,event_type,units,origin_owner_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
      const insertFeedback = db.prepare("INSERT OR IGNORE INTO feedback (id,owner_id,task_id,category,body,created_at) VALUES (?,?,?,?,?,?)");
      for (const owner of prepared.owners) {
        const created = now(), familyId = safeId("legacy-family", owner.owner, "cookie"), sessionId = safeId("legacy-session", owner.owner, "cookie");
        insertUser.run(owner.owner, created); users++;
        insertFamily.run(familyId, owner.owner, created);
        insertIdentity.run(safeId("legacy-identity", owner.owner, owner.tokenDigest), owner.owner, "legacy_cookie", owner.tokenDigest, created);
        insertSession.run(sessionId, owner.owner, owner.tokenDigest, created, familyId, "legacy");
        for (const project of owner.projects) { insertProject.run(project.id, owner.owner, text(project.row.name, "Imported car"), timestamp(project.row.createdAt)); projects++; }
        for (const image of images.values()) if (image.owner === owner) {
          const locator = `legacy://${owner.owner}/${image.legacyId}`;
          if (image.project.originalImageId === image.legacyId) insertAsset.run(image.originalAssetId, owner.owner, image.project.id, "original", "application/octet-stream", image.data.byteLength, null, null, image.digest, locator, null, created);
          insertAsset.run(image.masterAssetId, owner.owner, image.project.id, "master", "application/octet-stream", image.data.byteLength, null, null, image.digest, locator, null, created);
          assets += image.project.originalImageId === image.legacyId ? 2 : 1;
        }
        for (const project of owner.projects) if (project.originalImageId) db.prepare("UPDATE projects SET original_asset_id=? WHERE id=? AND owner_id=?").run(imageFor(owner, project, project.originalImageId).originalAssetId, project.id, owner.owner);
        for (const project of owner.projects) for (const version of project.versions) {
          const versionId = project.versionIds.get(stringId(version.id, "version id"))!;
          const image = imageFor(owner, project, imageReference(version.imageUrl, `version ${version.id}`));
          insertVersion.run(versionId, owner.owner, project.id, image.masterAssetId, null, null, text(version.name, "Imported version"), version.favorite ? 1 : 0, metadata(version, ["styleId", "demo"]), timestamp(version.createdAt));
          versions++;
        }
        for (const task of owner.tasks) {
          insertTask.run(task.id, owner.owner, task.project.id, safeId("legacy-submission", owner.owner, scoped(task.project.legacyId, task.legacyId)), task.status, task.cost, null, null, metadata(task.row, ["intent", "styleId", "mode"]), timestamp(task.row.createdAt), timestamp(task.row.updatedAt ?? task.row.createdAt));
          tasks++;
        }
        for (const project of owner.projects) {
          for (const version of project.versions) {
            const versionId = project.versionIds.get(stringId(version.id, "version id"))!;
            if (version.parentVersionId != null) db.prepare("UPDATE versions SET parent_version_id=? WHERE id=? AND owner_id=?").run(project.versionIds.get(stringId(version.parentVersionId, "parent version id"))!, versionId, owner.owner);
            if (version.taskId != null) db.prepare("UPDATE versions SET task_id=? WHERE id=? AND owner_id=?").run(owner.tasksById.get(stringId(version.taskId, "version task id"))!.id, versionId, owner.owner);
          }
          if (project.row.coverVersionId != null) db.prepare("UPDATE projects SET cover_version_id=? WHERE id=? AND owner_id=?").run(project.versionIds.get(stringId(project.row.coverVersionId, "cover version id"))!, project.id, owner.owner);
          if (project.row.draft != null) {
            const draft = project.row.draft as LegacyRecord, source = draft.baseVersionId == null ? "original" : project.versionIds.get(stringId(draft.baseVersionId, "draft source version id"))!;
            insertDraft.run(safeId("legacy-draft", owner.owner, project.legacyId), owner.owner, project.id, 0, source, metadata(draft, ["styleId", "intent"]), timestamp(draft.updatedAt));
          }
        }
        for (const task of owner.tasks) {
          if (task.row.versionId != null) db.prepare("UPDATE tasks SET result_version_id=? WHERE id=? AND owner_id=?").run(task.project.versionIds.get(stringId(task.row.versionId, "task version id"))!, task.id, owner.owner);
          if (task.row.retryOfTaskId != null) db.prepare("UPDATE tasks SET root_task_id=? WHERE id=? AND owner_id=?").run(owner.tasksById.get(stringId(task.row.retryOfTaskId, "retry task id"))!.id, task.id, owner.owner);
        }
        const lotId = safeId("legacy-lot", owner.owner, "opening-balance"), openingUnits = owner.credits + owner.reserved;
        insertLot.run(lotId, owner.owner, "promo", openingUnits, owner.credits, "legacy_import", safeId("legacy-opening-lot", owner.owner, "opening"), "demo", created);
        creditUnits += openingUnits;
        if (openingUnits > 0) insertLedger.run(safeId("legacy-opening-grant", owner.owner, "opening"), owner.owner, safeId("legacy-opening-grant-key", owner.owner, "opening"), null, lotId, "grant", openingUnits, owner.owner, created);
        for (const task of owner.tasks.filter((item) => item.status === "uncertain")) {
          const reservationId = safeId("legacy-reservation", owner.owner, scoped(task.project.legacyId, task.legacyId));
          insertReservation.run(reservationId, owner.owner, task.id, task.cost, "reserved", timestamp(task.row.createdAt));
          insertAllocation.run(owner.owner, reservationId, lotId, task.cost);
          insertLedger.run(safeId("legacy-reserve-event", owner.owner, task.id), owner.owner, safeId("legacy-reserve-key", owner.owner, task.id), task.id, lotId, "reserve", task.cost, owner.owner, timestamp(task.row.createdAt));
        }
        for (const report of reports) if (String(report.owner) === owner.rawCookie) {
          const task = owner.tasksById.get(stringId(report.task_id, "report task id"))!;
          insertFeedback.run(safeId("legacy-report", owner.owner, stringId(report.id, "report id")), owner.owner, task.id, "legacy_report", text(report.reason, ""), timestamp(report.created_at));
          reportCount++;
        }
      }
      db.prepare("UPDATE migration_state SET legacy_data_status='complete', updated_at=? WHERE id=1").run(now());
      maybeFail(options, "before-commit");
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    const after = integrity(db);
    if (after.result !== "ok" || after.foreignKeys !== 0) throw new Error("migrated copy failed integrity checks");
    return { users, projects, assets, versions, tasks, reports: reportCount, creditUnits, imageHashes, integrity: { before: before.result, after: after.result, foreignKeys: after.foreignKeys } };
  } finally { db.close(); }
}

export function migrateLegacyDatabase(options: Options): MigrationResult {
  const input = requireInput(options.inputPath), dryRun = options.apply !== true;
  const backup = options.backupPath ? destination(options.backupPath, "backup", input.canonical, []) : null;
  const output = options.outputPath ? destination(options.outputPath, "output", input.canonical, backup ? [backup.canonical] : []) : null;
  if (!dryRun && !output) throw new Error("--apply requires a distinct --output disposable database");
  const backupRoot = mkdtempSync(join(tmpdir(), "form-f03-backup-"));
  const snapshot = join(backupRoot, "snapshot.sqlite");
  const workRoot = mkdtempSync(join(tmpdir(), "form-f03-work-"));
  const work = join(workRoot, "work.sqlite");
  try {
    snapshotDatabase(input.canonical, snapshot);
    const backupPath = backup?.absolute ?? snapshot;
    if (backup) copyFileSync(snapshot, backupPath, constants.COPYFILE_EXCL);
    copyFileSync(backupPath, work, constants.COPYFILE_EXCL);
    const report = migrateCopy(work, options);
    if (!dryRun) snapshotDatabase(work, output!.absolute);
    return { dryRun, applied: !dryRun, sourcePath: input.canonical, backupPath, outputPath: dryRun ? null : output!.absolute, ...report };
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
    if (backup) rmSync(backupRoot, { recursive: true, force: true });
  }
}

export function formatMigrationResult(result: MigrationResult) { return JSON.stringify(result, null, 2); }
