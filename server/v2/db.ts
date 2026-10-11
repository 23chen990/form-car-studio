import { DatabaseSync } from "node:sqlite";
import { V2_SCHEMA, V2_SCHEMA_VERSION } from "./schema";

export function openV2Database(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  db.exec(V2_SCHEMA);
  const row = db.prepare("SELECT version FROM migration_version ORDER BY version DESC LIMIT 1").get() as { version: number } | undefined;
  if (!row) db.prepare("INSERT INTO migration_version (version, applied_at) VALUES (?,?)").run(V2_SCHEMA_VERSION, new Date().toISOString());
  else if (row.version !== V2_SCHEMA_VERSION) throw new Error(`Unsupported V2 schema version ${row.version}`);
  return db;
}
