export const V2_SCHEMA_VERSION = 2;

export const V2_SCHEMA = `
CREATE TABLE IF NOT EXISTS migration_version (
  version INTEGER PRIMARY KEY CHECK (version >= 0),
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
  legacy_data_status TEXT NOT NULL CHECK (legacy_data_status IN ('pending','in_progress','complete','blocked')),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS v2_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT,
  cover_version_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(owner_id, id),
  FOREIGN KEY (owner_id, id, cover_version_id) REFERENCES versions(owner_id, project_id, id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('original','master','display','temporary')),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  digest TEXT,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE,
  UNIQUE(owner_id, id),
  UNIQUE(owner_id, id, project_id)
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_version_id TEXT,
  master_asset_id TEXT,
  display_asset_id TEXT,
  task_id TEXT,
  name TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, id),
  UNIQUE(owner_id, id, project_id),
  UNIQUE(owner_id, project_id, id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, parent_version_id, project_id) REFERENCES versions(owner_id, id, project_id),
  FOREIGN KEY (owner_id, master_asset_id, project_id) REFERENCES assets(owner_id, id, project_id),
  FOREIGN KEY (owner_id, display_asset_id, project_id) REFERENCES assets(owner_id, id, project_id),
  FOREIGN KEY (owner_id, task_id, project_id) REFERENCES tasks(owner_id, id, project_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  source_ref TEXT NOT NULL,
  edits_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, project_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_asset_id TEXT,
  plan_digest TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  user_cost_units INTEGER NOT NULL CHECK (user_cost_units > 0),
  confirmed_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, id),
  UNIQUE(owner_id, id, project_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, source_asset_id, project_id) REFERENCES assets(owner_id, id, project_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  plan_id TEXT,
  confirmed_plan_id TEXT,
  submission_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','uncertain','succeeded','failed','cancelled')),
  user_cost_units INTEGER NOT NULL CHECK (user_cost_units > 0),
  result_version_id TEXT,
  root_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(owner_id, id),
  UNIQUE(owner_id, id, project_id),
  UNIQUE(owner_id, submission_id),
  UNIQUE(owner_id, confirmed_plan_id),
  FOREIGN KEY (owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, plan_id, project_id) REFERENCES plans(owner_id, id, project_id),
  FOREIGN KEY (owner_id, confirmed_plan_id, project_id) REFERENCES plans(owner_id, id, project_id),
  FOREIGN KEY (owner_id, result_version_id, project_id) REFERENCES versions(owner_id, id, project_id),
  FOREIGN KEY (owner_id, root_task_id, project_id) REFERENCES tasks(owner_id, id, project_id)
);
CREATE TABLE IF NOT EXISTS supplier_attempts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('started','succeeded','failed','uncertain')),
  usage_json TEXT,
  estimated_cost_usd_micros INTEGER CHECK (estimated_cost_usd_micros IS NULL OR estimated_cost_usd_micros >= 0),
  reconciled_cost_usd_micros INTEGER CHECK (reconciled_cost_usd_micros IS NULL OR reconciled_cost_usd_micros >= 0),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (owner_id, task_id) REFERENCES tasks(owner_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS credit_lots (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchased','promo')),
  units INTEGER NOT NULL CHECK (units >= 0),
  available_units INTEGER NOT NULL CHECK (available_units >= 0 AND available_units <= units),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  units INTEGER NOT NULL CHECK (units > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','released')),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, task_id) REFERENCES tasks(owner_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reservation_allocations (
  owner_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  credit_lot_id TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  PRIMARY KEY (owner_id, reservation_id, credit_lot_id),
  FOREIGN KEY (owner_id, reservation_id) REFERENCES reservations(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, credit_lot_id) REFERENCES credit_lots(owner_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ledger_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  ledger_event_key TEXT NOT NULL,
  task_id TEXT,
  credit_lot_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('grant','reserve','settle','release','refund')),
  units INTEGER NOT NULL CHECK (units > 0),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, ledger_event_key),
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (owner_id, task_id) REFERENCES tasks(owner_id, id),
  FOREIGN KEY (owner_id, credit_lot_id) REFERENCES credit_lots(owner_id, id)
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(environment, transaction_id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS purchase_events (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id)
);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  purposes_json TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (owner_id, task_id) REFERENCES tasks(owner_id, id)
);
CREATE TABLE IF NOT EXISTS quality_compensations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  root_task_id TEXT NOT NULL UNIQUE,
  units INTEGER NOT NULL CHECK (units > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (owner_id, root_task_id) REFERENCES tasks(owner_id, id)
);
CREATE TABLE IF NOT EXISTS trial_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trial_program_id TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  created_at TEXT NOT NULL,
  UNIQUE(user_id, trial_program_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS deletion_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_one_active_per_owner
  ON tasks(owner_id) WHERE status IN ('queued','processing','uncertain');
CREATE UNIQUE INDEX IF NOT EXISTS versions_one_official_per_task
  ON versions(owner_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS projects_owner_created ON projects(owner_id, created_at);
CREATE INDEX IF NOT EXISTS assets_owner_created ON assets(owner_id, created_at);
CREATE INDEX IF NOT EXISTS versions_owner_created ON versions(owner_id, created_at);
CREATE INDEX IF NOT EXISTS tasks_owner_status ON tasks(owner_id, status, created_at);
CREATE INDEX IF NOT EXISTS ledger_owner_created ON ledger_events(owner_id, created_at);
`;
