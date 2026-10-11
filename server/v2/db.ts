import { DatabaseSync } from "node:sqlite";
import { V2_SCHEMA, V2_SCHEMA_VERSION } from "./schema";

export function openV2Database(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  const markerTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_version'").get();
  const marker = markerTable
    ? db.prepare("SELECT version FROM migration_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined
    : undefined;
  if (marker && marker.version !== V2_SCHEMA_VERSION) throw new Error(`V2 schema version ${marker.version} requires the dedicated migration task`);
  if (!marker) migratePreviousV2SessionName(db);
  db.exec(V2_SCHEMA);
  const row = db.prepare("SELECT version FROM migration_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined;
  if (!row) db.prepare("INSERT INTO migration_version (version, applied_at) VALUES (?,?)").run(V2_SCHEMA_VERSION, new Date().toISOString());
  return db;
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
