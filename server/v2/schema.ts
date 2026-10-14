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

export const V3_SCHEMA_VERSION = 3;

export const V3_COLUMN_ADDITIONS = [
  { table: "projects", column: "original_asset_id", sql: "ALTER TABLE projects ADD COLUMN original_asset_id TEXT" },
  { table: "assets", column: "private_bytes", sql: "ALTER TABLE assets ADD COLUMN private_bytes BLOB" },
  { table: "v2_sessions", column: "family_id", sql: "ALTER TABLE v2_sessions ADD COLUMN family_id TEXT" },
  { table: "v2_sessions", column: "parent_session_id", sql: "ALTER TABLE v2_sessions ADD COLUMN parent_session_id TEXT" },
  { table: "v2_sessions", column: "token_kind", sql: "ALTER TABLE v2_sessions ADD COLUMN token_kind TEXT NOT NULL DEFAULT 'legacy'" },
  { table: "supplier_attempts", column: "provider_profile_version", sql: "ALTER TABLE supplier_attempts ADD COLUMN provider_profile_version TEXT" },
  { table: "supplier_attempts", column: "error_category", sql: "ALTER TABLE supplier_attempts ADD COLUMN error_category TEXT" },
  { table: "supplier_attempts", column: "actual_width", sql: "ALTER TABLE supplier_attempts ADD COLUMN actual_width INTEGER" },
  { table: "supplier_attempts", column: "actual_height", sql: "ALTER TABLE supplier_attempts ADD COLUMN actual_height INTEGER" },
  { table: "credit_lots", column: "purchase_id", sql: "ALTER TABLE credit_lots ADD COLUMN purchase_id TEXT" },
  { table: "credit_lots", column: "source_kind", sql: "ALTER TABLE credit_lots ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'legacy_import'" },
  { table: "credit_lots", column: "source_event_key", sql: "ALTER TABLE credit_lots ADD COLUMN source_event_key TEXT NOT NULL DEFAULT ''" },
  { table: "credit_lots", column: "revoked_units", sql: "ALTER TABLE credit_lots ADD COLUMN revoked_units INTEGER NOT NULL DEFAULT 0" },
  { table: "credit_lots", column: "scope", sql: "ALTER TABLE credit_lots ADD COLUMN scope TEXT NOT NULL DEFAULT 'demo' CHECK (scope IN ('demo','live'))" },
  { table: "reservation_allocations", column: "revoked_units", sql: "ALTER TABLE reservation_allocations ADD COLUMN revoked_units INTEGER NOT NULL DEFAULT 0" },
  { table: "purchases", column: "price_minor_units", sql: "ALTER TABLE purchases ADD COLUMN price_minor_units INTEGER" },
  { table: "purchases", column: "currency", sql: "ALTER TABLE purchases ADD COLUMN currency TEXT" },
  { table: "purchase_events", column: "event_key", sql: "ALTER TABLE purchase_events ADD COLUMN event_key TEXT NOT NULL DEFAULT ''" },
  { table: "consents", column: "revoked_at", sql: "ALTER TABLE consents ADD COLUMN revoked_at TEXT" },
  { table: "tasks", column: "safe_error_code", sql: "ALTER TABLE tasks ADD COLUMN safe_error_code TEXT" },
  { table: "tasks", column: "credit_returned", sql: "ALTER TABLE tasks ADD COLUMN credit_returned INTEGER NOT NULL DEFAULT 0" },
  { table: "tasks", column: "request_snapshot_json", sql: "ALTER TABLE tasks ADD COLUMN request_snapshot_json TEXT" },
  { table: "versions", column: "recipe_json", sql: "ALTER TABLE versions ADD COLUMN recipe_json TEXT" },
  { table: "ledger_events", column: "origin_owner_id", sql: "ALTER TABLE ledger_events ADD COLUMN origin_owner_id TEXT" },
] as const;

export const V3_SCHEMA = `
CREATE TABLE IF NOT EXISTS session_families (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(owner_id, id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  nonce_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS owner_upgrades (
  source_owner_id TEXT PRIMARY KEY,
  target_owner_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','deferred','completed','failed')),
  UNIQUE(target_owner_id, request_digest),
  CHECK (source_owner_id <> target_owner_id),
  FOREIGN KEY (source_owner_id) REFERENCES users(id),
  FOREIGN KEY (target_owner_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS supplier_exposures (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  provider_profile_version TEXT NOT NULL,
  max_cost_usd_micros INTEGER NOT NULL CHECK (max_cost_usd_micros >= 0),
  cost_currency TEXT NOT NULL CHECK (cost_currency = 'USD'),
  estimate_basis TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','started','uncertain','settled','released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, task_id),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, task_id) REFERENCES tasks(owner_id, id) ON DELETE CASCADE
);
`;

export const V3_CONSTRAINTS = `
CREATE UNIQUE INDEX IF NOT EXISTS supplier_attempts_one_per_owner_task ON supplier_attempts(owner_id, task_id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_one_purchase_provenance ON credit_lots(owner_id, purchase_id) WHERE purchase_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_source_event ON credit_lots(owner_id, source_event_key) WHERE source_event_key <> '';
CREATE UNIQUE INDEX IF NOT EXISTS purchase_events_event_key ON purchase_events(event_key) WHERE event_key <> '';

CREATE TRIGGER IF NOT EXISTS v3_projects_original_insert BEFORE INSERT ON projects FOR EACH ROW WHEN NEW.original_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.original_asset_id AND owner_id=NEW.owner_id AND project_id=NEW.id AND kind='original')
BEGIN SELECT RAISE(ABORT, 'invalid project original asset'); END;
CREATE TRIGGER IF NOT EXISTS v3_projects_original_update BEFORE UPDATE OF owner_id,id,original_asset_id ON projects FOR EACH ROW WHEN NEW.original_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assets WHERE id=NEW.original_asset_id AND owner_id=NEW.owner_id AND project_id=NEW.id AND kind='original')
BEGIN SELECT RAISE(ABORT, 'invalid project original asset'); END;
CREATE TRIGGER IF NOT EXISTS v3_assets_preserve_project_original BEFORE UPDATE OF owner_id,project_id,kind ON assets FOR EACH ROW WHEN EXISTS (SELECT 1 FROM projects WHERE original_asset_id=OLD.id AND (owner_id<>NEW.owner_id OR id<>NEW.project_id OR NEW.kind<>'original'))
BEGIN SELECT RAISE(ABORT, 'invalid project original asset'); END;

CREATE TRIGGER IF NOT EXISTS v3_sessions_validate_insert BEFORE INSERT ON v2_sessions FOR EACH ROW WHEN
  NEW.token_kind NOT IN ('legacy','access','refresh') OR
  (NEW.token_kind IN ('access','refresh') AND (NEW.expires_at IS NULL OR NEW.family_id IS NULL)) OR
  (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM session_families WHERE id=NEW.family_id AND owner_id=NEW.owner_id)) OR
  (NEW.parent_session_id IS NOT NULL AND (NEW.parent_session_id=NEW.id OR NOT EXISTS (SELECT 1 FROM v2_sessions AS parent WHERE parent.id=NEW.parent_session_id AND parent.owner_id=NEW.owner_id AND parent.family_id=NEW.family_id)))
BEGIN SELECT RAISE(ABORT, 'invalid v2 session family'); END;
CREATE TRIGGER IF NOT EXISTS v3_sessions_validate_update BEFORE UPDATE OF owner_id,family_id,parent_session_id,token_kind,expires_at ON v2_sessions FOR EACH ROW WHEN
  NEW.token_kind NOT IN ('legacy','access','refresh') OR
  (NEW.token_kind IN ('access','refresh') AND (NEW.expires_at IS NULL OR NEW.family_id IS NULL)) OR
  (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM session_families WHERE id=NEW.family_id AND owner_id=NEW.owner_id)) OR
  (NEW.parent_session_id IS NOT NULL AND (NEW.parent_session_id=NEW.id OR NOT EXISTS (SELECT 1 FROM v2_sessions AS parent WHERE parent.id=NEW.parent_session_id AND parent.owner_id=NEW.owner_id AND parent.family_id=NEW.family_id)))
BEGIN SELECT RAISE(ABORT, 'invalid v2 session family'); END;

CREATE TRIGGER IF NOT EXISTS v3_credit_lots_validate_insert BEFORE INSERT ON credit_lots FOR EACH ROW WHEN
  typeof(NEW.units) <> 'integer' OR typeof(NEW.available_units) <> 'integer' OR typeof(NEW.revoked_units) <> 'integer' OR NEW.units < 0 OR NEW.units > 9007199254740991 OR NEW.available_units < 0 OR NEW.revoked_units < 0 OR NEW.available_units + NEW.revoked_units > NEW.units OR NEW.scope NOT IN ('demo','live')
BEGIN SELECT RAISE(ABORT, 'credit lot units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_credit_lots_validate_update BEFORE UPDATE OF units,available_units,revoked_units,scope ON credit_lots FOR EACH ROW WHEN
  typeof(NEW.units) <> 'integer' OR typeof(NEW.available_units) <> 'integer' OR typeof(NEW.revoked_units) <> 'integer' OR NEW.units < 0 OR NEW.units > 9007199254740991 OR NEW.available_units < 0 OR NEW.revoked_units < 0 OR NEW.available_units + NEW.revoked_units > NEW.units OR NEW.scope NOT IN ('demo','live')
BEGIN SELECT RAISE(ABORT, 'credit lot units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_credit_lots_no_revoked_revival BEFORE UPDATE OF revoked_units ON credit_lots FOR EACH ROW WHEN NEW.revoked_units < OLD.revoked_units
BEGIN SELECT RAISE(ABORT, 'revoked units cannot be restored'); END;
CREATE TRIGGER IF NOT EXISTS v3_credit_lots_provenance_insert BEFORE INSERT ON credit_lots FOR EACH ROW WHEN
  NEW.source_kind NOT IN ('legacy_import','purchase','promo','trial','quality_compensation') OR
  (NEW.source_kind='purchase' AND (NEW.kind <> 'purchased' OR NEW.scope <> 'live' OR NEW.purchase_id IS NULL OR NEW.source_event_key='' OR NOT EXISTS (SELECT 1 FROM purchases WHERE id=NEW.purchase_id AND owner_id=NEW.owner_id))) OR
  (NEW.source_kind IN ('promo','trial','quality_compensation') AND NEW.kind <> 'promo') OR
  (NEW.source_kind <> 'purchase' AND NEW.purchase_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid purchase lot provenance'); END;
CREATE TRIGGER IF NOT EXISTS v3_credit_lots_provenance_update BEFORE UPDATE OF owner_id,kind,purchase_id,source_kind,source_event_key,scope ON credit_lots FOR EACH ROW WHEN
  NEW.source_kind NOT IN ('legacy_import','purchase','promo','trial','quality_compensation') OR
  (NEW.source_kind='purchase' AND (NEW.kind <> 'purchased' OR NEW.scope <> 'live' OR NEW.purchase_id IS NULL OR NEW.source_event_key='' OR NOT EXISTS (SELECT 1 FROM purchases WHERE id=NEW.purchase_id AND owner_id=NEW.owner_id))) OR
  (NEW.source_kind IN ('promo','trial','quality_compensation') AND NEW.kind <> 'promo') OR
  (NEW.source_kind <> 'purchase' AND NEW.purchase_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid purchase lot provenance'); END;
CREATE TRIGGER IF NOT EXISTS v3_purchases_preserve_lot_provenance BEFORE UPDATE OF id,owner_id ON purchases FOR EACH ROW WHEN (NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id) AND EXISTS (SELECT 1 FROM credit_lots WHERE purchase_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'purchase provenance is immutable'); END;

CREATE TRIGGER IF NOT EXISTS v3_reservations_validate_insert BEFORE INSERT ON reservations FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'reservation units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_reservations_validate_update BEFORE UPDATE OF units ON reservations FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'reservation units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_validate_insert BEFORE INSERT ON reservation_allocations FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR typeof(NEW.revoked_units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991 OR NEW.revoked_units < 0 OR NEW.revoked_units > NEW.units
BEGIN SELECT RAISE(ABORT, 'allocation units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_validate_update BEFORE UPDATE OF units,revoked_units ON reservation_allocations FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR typeof(NEW.revoked_units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991 OR NEW.revoked_units < 0 OR NEW.revoked_units > NEW.units
BEGIN SELECT RAISE(ABORT, 'allocation units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_no_revoked_revival BEFORE UPDATE OF revoked_units ON reservation_allocations FOR EACH ROW WHEN NEW.revoked_units < OLD.revoked_units
BEGIN SELECT RAISE(ABORT, 'revoked units cannot be restored'); END;
CREATE TRIGGER IF NOT EXISTS v3_reservations_allocation_total_update BEFORE UPDATE OF units ON reservations FOR EACH ROW WHEN NEW.units < COALESCE((SELECT SUM(units) FROM reservation_allocations WHERE owner_id=NEW.owner_id AND reservation_id=NEW.id),0)
BEGIN SELECT RAISE(ABORT, 'allocation total exceeds reservation'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_reservation_total_insert BEFORE INSERT ON reservation_allocations FOR EACH ROW WHEN EXISTS (SELECT 1 FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id) AND EXISTS (SELECT 1 FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id) AND (NEW.units + COALESCE((SELECT SUM(units) FROM reservation_allocations WHERE owner_id=NEW.owner_id AND reservation_id=NEW.reservation_id),0) > (SELECT units FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id))
BEGIN SELECT RAISE(ABORT, 'allocation total exceeds reservation'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_reservation_total_update BEFORE UPDATE OF owner_id,reservation_id,credit_lot_id,units ON reservation_allocations FOR EACH ROW WHEN EXISTS (SELECT 1 FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id) AND EXISTS (SELECT 1 FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id) AND (NEW.units + COALESCE((SELECT SUM(units) FROM reservation_allocations WHERE owner_id=NEW.owner_id AND reservation_id=NEW.reservation_id AND NOT (owner_id=OLD.owner_id AND reservation_id=OLD.reservation_id AND credit_lot_id=OLD.credit_lot_id)),0) > (SELECT units FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id))
BEGIN SELECT RAISE(ABORT, 'allocation total exceeds reservation'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_lot_total_insert BEFORE INSERT ON reservation_allocations FOR EACH ROW WHEN EXISTS (SELECT 1 FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id) AND EXISTS (SELECT 1 FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id) AND (COALESCE((SELECT available_units + revoked_units FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id),0) + COALESCE((SELECT SUM(allocation.units-allocation.revoked_units) FROM reservation_allocations AS allocation JOIN reservations AS reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE allocation.owner_id=NEW.owner_id AND allocation.credit_lot_id=NEW.credit_lot_id AND reservation.status='reserved'),0) + CASE WHEN (SELECT status FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id)='reserved' THEN NEW.units-NEW.revoked_units ELSE 0 END > COALESCE((SELECT units FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id),0))
BEGIN SELECT RAISE(ABORT, 'credit lot active allocations exceed lot units'); END;
CREATE TRIGGER IF NOT EXISTS v3_allocations_lot_total_update BEFORE UPDATE OF owner_id,reservation_id,credit_lot_id,units,revoked_units ON reservation_allocations FOR EACH ROW WHEN EXISTS (SELECT 1 FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id) AND EXISTS (SELECT 1 FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id) AND (COALESCE((SELECT available_units + revoked_units FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id),0) + COALESCE((SELECT SUM(allocation.units-allocation.revoked_units) FROM reservation_allocations AS allocation JOIN reservations AS reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE allocation.owner_id=NEW.owner_id AND allocation.credit_lot_id=NEW.credit_lot_id AND reservation.status='reserved' AND NOT (allocation.owner_id=OLD.owner_id AND allocation.reservation_id=OLD.reservation_id AND allocation.credit_lot_id=OLD.credit_lot_id)),0) + CASE WHEN (SELECT status FROM reservations WHERE owner_id=NEW.owner_id AND id=NEW.reservation_id)='reserved' THEN NEW.units-NEW.revoked_units ELSE 0 END > COALESCE((SELECT units FROM credit_lots WHERE owner_id=NEW.owner_id AND id=NEW.credit_lot_id),0))
BEGIN SELECT RAISE(ABORT, 'credit lot active allocations exceed lot units'); END;
CREATE TRIGGER IF NOT EXISTS v3_credit_lots_active_allocation_total_update BEFORE UPDATE OF units,available_units,revoked_units ON credit_lots FOR EACH ROW WHEN NEW.available_units + NEW.revoked_units + COALESCE((SELECT SUM(allocation.units-allocation.revoked_units) FROM reservation_allocations AS allocation JOIN reservations AS reservation ON reservation.owner_id=allocation.owner_id AND reservation.id=allocation.reservation_id WHERE allocation.owner_id=NEW.owner_id AND allocation.credit_lot_id=NEW.id AND reservation.status='reserved'),0) > NEW.units
BEGIN SELECT RAISE(ABORT, 'credit lot active allocations exceed lot units'); END;
CREATE TRIGGER IF NOT EXISTS v3_ledger_validate_insert BEFORE INSERT ON ledger_events FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'ledger units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_ledger_validate_update BEFORE UPDATE OF units ON ledger_events FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'ledger units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_ledger_origin_insert BEFORE INSERT ON ledger_events FOR EACH ROW WHEN NEW.origin_owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.origin_owner_id)
BEGIN SELECT RAISE(ABORT, 'invalid ledger origin owner'); END;
CREATE TRIGGER IF NOT EXISTS v3_ledger_origin_update BEFORE UPDATE OF origin_owner_id ON ledger_events FOR EACH ROW WHEN NEW.origin_owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.origin_owner_id)
BEGIN SELECT RAISE(ABORT, 'invalid ledger origin owner'); END;
CREATE TRIGGER IF NOT EXISTS v3_ledger_origin_immutable BEFORE UPDATE OF origin_owner_id ON ledger_events FOR EACH ROW WHEN NEW.origin_owner_id IS NOT OLD.origin_owner_id
BEGIN SELECT RAISE(ABORT, 'ledger origin owner is immutable'); END;
CREATE TRIGGER IF NOT EXISTS v3_ledger_economic_facts_immutable BEFORE UPDATE OF units,event_type,ledger_event_key,task_id,credit_lot_id,created_at ON ledger_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'ledger economic facts are immutable'); END;

CREATE TRIGGER IF NOT EXISTS v3_attempts_validate_insert BEFORE INSERT ON supplier_attempts FOR EACH ROW WHEN
  (NEW.estimated_cost_usd_micros IS NOT NULL AND (typeof(NEW.estimated_cost_usd_micros) <> 'integer' OR NEW.estimated_cost_usd_micros < 0 OR NEW.estimated_cost_usd_micros > 9007199254740991)) OR
  (NEW.reconciled_cost_usd_micros IS NOT NULL AND (typeof(NEW.reconciled_cost_usd_micros) <> 'integer' OR NEW.reconciled_cost_usd_micros < 0 OR NEW.reconciled_cost_usd_micros > 9007199254740991)) OR
  (NEW.actual_width IS NOT NULL AND (typeof(NEW.actual_width) <> 'integer' OR NEW.actual_width < 1 OR NEW.actual_width > 9007199254740991)) OR
  (NEW.actual_height IS NOT NULL AND (typeof(NEW.actual_height) <> 'integer' OR NEW.actual_height < 1 OR NEW.actual_height > 9007199254740991))
BEGIN SELECT RAISE(ABORT, 'supplier attempt values must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_attempts_validate_update BEFORE UPDATE OF estimated_cost_usd_micros,reconciled_cost_usd_micros,actual_width,actual_height ON supplier_attempts FOR EACH ROW WHEN
  (NEW.estimated_cost_usd_micros IS NOT NULL AND (typeof(NEW.estimated_cost_usd_micros) <> 'integer' OR NEW.estimated_cost_usd_micros < 0 OR NEW.estimated_cost_usd_micros > 9007199254740991)) OR
  (NEW.reconciled_cost_usd_micros IS NOT NULL AND (typeof(NEW.reconciled_cost_usd_micros) <> 'integer' OR NEW.reconciled_cost_usd_micros < 0 OR NEW.reconciled_cost_usd_micros > 9007199254740991)) OR
  (NEW.actual_width IS NOT NULL AND (typeof(NEW.actual_width) <> 'integer' OR NEW.actual_width < 1 OR NEW.actual_width > 9007199254740991)) OR
  (NEW.actual_height IS NOT NULL AND (typeof(NEW.actual_height) <> 'integer' OR NEW.actual_height < 1 OR NEW.actual_height > 9007199254740991))
BEGIN SELECT RAISE(ABORT, 'supplier attempt values must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_exposures_validate_insert BEFORE INSERT ON supplier_exposures FOR EACH ROW WHEN typeof(NEW.max_cost_usd_micros) <> 'integer' OR NEW.max_cost_usd_micros < 0 OR NEW.max_cost_usd_micros > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'supplier exposure must be a safe integer'); END;
CREATE TRIGGER IF NOT EXISTS v3_exposures_validate_update BEFORE UPDATE OF max_cost_usd_micros ON supplier_exposures FOR EACH ROW WHEN typeof(NEW.max_cost_usd_micros) <> 'integer' OR NEW.max_cost_usd_micros < 0 OR NEW.max_cost_usd_micros > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'supplier exposure must be a safe integer'); END;
CREATE TRIGGER IF NOT EXISTS v3_purchases_validate_insert BEFORE INSERT ON purchases FOR EACH ROW WHEN
  (NEW.price_minor_units IS NOT NULL AND (typeof(NEW.price_minor_units) <> 'integer' OR NEW.price_minor_units < 0 OR NEW.price_minor_units > 9007199254740991 OR NEW.currency IS NULL OR length(NEW.currency) <> 3)) OR
  (NEW.price_minor_units IS NULL AND NEW.currency IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'purchase price must be a safe integer with currency'); END;
CREATE TRIGGER IF NOT EXISTS v3_purchases_validate_update BEFORE UPDATE OF price_minor_units,currency ON purchases FOR EACH ROW WHEN
  (NEW.price_minor_units IS NOT NULL AND (typeof(NEW.price_minor_units) <> 'integer' OR NEW.price_minor_units < 0 OR NEW.price_minor_units > 9007199254740991 OR NEW.currency IS NULL OR length(NEW.currency) <> 3)) OR
  (NEW.price_minor_units IS NULL AND NEW.currency IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'purchase price must be a safe integer with currency'); END;
CREATE TRIGGER IF NOT EXISTS v3_tasks_validate_update BEFORE UPDATE OF user_cost_units,credit_returned ON tasks FOR EACH ROW WHEN typeof(NEW.user_cost_units) <> 'integer' OR NEW.user_cost_units < 1 OR NEW.user_cost_units > 9007199254740991 OR NEW.credit_returned NOT IN (0,1)
BEGIN SELECT RAISE(ABORT, 'task units and credit_returned must be valid'); END;
CREATE TRIGGER IF NOT EXISTS v3_tasks_validate_insert BEFORE INSERT ON tasks FOR EACH ROW WHEN typeof(NEW.user_cost_units) <> 'integer' OR NEW.user_cost_units < 1 OR NEW.user_cost_units > 9007199254740991 OR NEW.credit_returned NOT IN (0,1)
BEGIN SELECT RAISE(ABORT, 'task units and credit_returned must be valid'); END;
CREATE TRIGGER IF NOT EXISTS v3_plans_validate_insert BEFORE INSERT ON plans FOR EACH ROW WHEN typeof(NEW.user_cost_units) <> 'integer' OR NEW.user_cost_units < 1 OR NEW.user_cost_units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'plan units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_plans_validate_update BEFORE UPDATE OF user_cost_units ON plans FOR EACH ROW WHEN typeof(NEW.user_cost_units) <> 'integer' OR NEW.user_cost_units < 1 OR NEW.user_cost_units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'plan units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_quality_compensations_validate_insert BEFORE INSERT ON quality_compensations FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'quality compensation units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_quality_compensations_validate_update BEFORE UPDATE OF units ON quality_compensations FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'quality compensation units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_trial_claims_validate_insert BEFORE INSERT ON trial_claims FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'trial claim units must be safe integers'); END;
CREATE TRIGGER IF NOT EXISTS v3_trial_claims_validate_update BEFORE UPDATE OF units ON trial_claims FOR EACH ROW WHEN typeof(NEW.units) <> 'integer' OR NEW.units < 1 OR NEW.units > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'trial claim units must be safe integers'); END;
`;
