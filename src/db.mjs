import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "./config.mjs";
import { migratePilot } from "./pilot-schema.mjs";
import { initializeAccess,validateTransactionActor } from "./access-service.mjs";
import { initializeSettings } from "./settings-service.mjs";
import { initializeDataset } from "./dataset-service.mjs";
import { initializeCollection } from "./collection-schema.mjs";
import { initializeBusinessCalendar } from "./business-calendar.mjs";
import { initializeConstruction } from "./construction-schema.mjs";

export function openDatabase(filePath = getDatabasePath()) {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  // Install the lock wait before journal/schema setup so simultaneous workers
  // do not race the WAL transition during first open.
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  createSchema(db);
  return db;
}

export function createSchema(db) {
  db.exec([
    "CREATE TABLE IF NOT EXISTS complexes (",
    " id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL,",
    " latitude REAL NOT NULL, longitude REAL NOT NULL, developer_name TEXT NOT NULL, developer_bin TEXT NOT NULL,",
    " construction_stage TEXT NOT NULL, commissioning_status TEXT NOT NULL,",
    " declared_completion_pct REAL, declared_completion_source TEXT, declared_completion_at TEXT,",
    " verified_completion_pct REAL, verified_completion_source TEXT, verified_completion_at TEXT,",
    " legal_basis_type TEXT, legal_basis_status TEXT NOT NULL DEFAULT 'UNKNOWN', legal_basis_source TEXT, legal_basis_checked_at TEXT,",
    " created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 1 CHECK (is_demo IN (0,1))",
    ");",
    "CREATE INDEX IF NOT EXISTS complexes_city_idx ON complexes(city);",
    "CREATE INDEX IF NOT EXISTS complexes_legal_idx ON complexes(legal_basis_status);",
    "CREATE TABLE IF NOT EXISTS complex_contacts (",
    " id TEXT PRIMARY KEY, complex_id TEXT NOT NULL REFERENCES complexes(id) ON DELETE CASCADE,",
    " type TEXT NOT NULL CHECK (type IN ('PHONE','ACCOUNT')), value TEXT NOT NULL, source_label TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 1",
    ");",
    "CREATE INDEX IF NOT EXISTS contacts_value_idx ON complex_contacts(type, value);",
    "CREATE TABLE IF NOT EXISTS advertisements (",
    " id TEXT PRIMARY KEY, platform TEXT NOT NULL, account TEXT, phone TEXT, publication_date TEXT NOT NULL, url TEXT,",
    " text TEXT NOT NULL, screenshot_path TEXT, notes TEXT, captured_at TEXT NOT NULL, complex_id TEXT REFERENCES complexes(id),",
    " suggested_complex_id TEXT REFERENCES complexes(id),",
    " link_status TEXT NOT NULL DEFAULT 'NEW', is_demo INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL",
    ");",
    "CREATE INDEX IF NOT EXISTS advertisements_complex_idx ON advertisements(complex_id);",
    "CREATE INDEX IF NOT EXISTS advertisements_date_idx ON advertisements(publication_date);",
    "CREATE TABLE IF NOT EXISTS ai_analyses (",
    " id TEXT PRIMARY KEY, advertisement_id TEXT NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,",
    " model TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,",
    " detected_complex_name TEXT, detected_address TEXT, detected_developer TEXT, detected_phone TEXT,",
    " payment_detected INTEGER NOT NULL, payment_type TEXT, amount INTEGER, currency TEXT, confidence REAL NOT NULL,",
    " evidence_text TEXT, analysis_source TEXT NOT NULL, analysis_json TEXT NOT NULL",
    ");",
    "CREATE INDEX IF NOT EXISTS analyses_ad_idx ON ai_analyses(advertisement_id, created_at);",
    "CREATE TABLE IF NOT EXISTS risk_factors (",
    " id TEXT PRIMARY KEY, complex_id TEXT NOT NULL REFERENCES complexes(id) ON DELETE CASCADE, code TEXT NOT NULL, weight INTEGER NOT NULL,",
    " status TEXT NOT NULL CHECK (status IN ('UNKNOWN','AI_HYPOTHESIS','CONFIRMED','REJECTED')),",
    " source_type TEXT NOT NULL, source_id TEXT, source_label TEXT, evidence_text TEXT, confidence REAL,",
    " confirmed_by TEXT, confirmed_at TEXT, rejected_by TEXT, rejected_at TEXT, notes TEXT, is_demo INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,",
    " UNIQUE(complex_id, code, source_type, source_id)",
    ");",
    "CREATE INDEX IF NOT EXISTS factors_complex_status_idx ON risk_factors(complex_id, status);",
    "CREATE TABLE IF NOT EXISTS complaints (",
    " id TEXT PRIMARY KEY, complex_id TEXT NOT NULL REFERENCES complexes(id) ON DELETE CASCADE, type TEXT NOT NULL,",
    " verified INTEGER NOT NULL, summary TEXT NOT NULL, source TEXT NOT NULL, captured_at TEXT NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS construction_events (",
    " id TEXT PRIMARY KEY, complex_id TEXT NOT NULL REFERENCES complexes(id) ON DELETE CASCADE, type TEXT NOT NULL,",
    " event_date TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL, confirmed INTEGER NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS signals (",
    " id TEXT PRIMARY KEY, complex_id TEXT NOT NULL REFERENCES complexes(id), score_snapshot INTEGER NOT NULL,",
    " zone_snapshot TEXT NOT NULL, legal_basis_snapshot TEXT NOT NULL, factor_snapshot_json TEXT NOT NULL,",
    " status TEXT NOT NULL CHECK (status IN ('DRAFT','NEEDS_REVIEW','CONFIRMED','RETURNED','ARCHIVED')),",
    " created_by TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, comment TEXT",
    ");",
    "CREATE INDEX IF NOT EXISTS signals_complex_idx ON signals(complex_id, created_at);",
    "CREATE INDEX IF NOT EXISTS signals_status_idx ON signals(status);",
    "CREATE TRIGGER IF NOT EXISTS signals_snapshot_immutable",
    " BEFORE UPDATE OF score_snapshot, zone_snapshot, legal_basis_snapshot, factor_snapshot_json ON signals",
    " BEGIN SELECT RAISE(ABORT, 'Signal snapshots are immutable'); END;",
    "CREATE TABLE IF NOT EXISTS audit_logs (",
    " id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,",
    " actor TEXT NOT NULL, timestamp TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}'",
    ");",
    "CREATE INDEX IF NOT EXISTS audit_time_idx ON audit_logs(timestamp DESC);",
    "CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs(entity_type, entity_id);",
    "CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs",
    " BEGIN SELECT RAISE(ABORT, 'Audit log entries are immutable'); END;",
    "CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs",
    " BEGIN SELECT RAISE(ABORT, 'Audit log entries are immutable'); END;",
    "CREATE TABLE IF NOT EXISTS risk_history (",
    " id INTEGER PRIMARY KEY AUTOINCREMENT, complex_id TEXT NOT NULL REFERENCES complexes(id), score INTEGER NOT NULL,",
    " zone TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL",
    ");",
    "CREATE INDEX IF NOT EXISTS risk_history_complex_idx ON risk_history(complex_id, created_at);",
  ].join("\n"));
  // Additive migration: preserve existing signals and mark missing context explicitly.
  const signalColumns = db.prepare("PRAGMA table_info(signals)").all();
  if (!signalColumns.some((column) => column.name === "context_snapshot_json")) {
    db.exec("ALTER TABLE signals ADD COLUMN context_snapshot_json TEXT;");
  }
  db.exec("DROP TRIGGER IF EXISTS signals_snapshot_immutable;");
  db.exec("CREATE TRIGGER signals_snapshot_immutable BEFORE UPDATE OF complex_id, created_at, created_by, score_snapshot, zone_snapshot, legal_basis_snapshot, factor_snapshot_json, context_snapshot_json ON signals BEGIN SELECT RAISE(ABORT, 'Signal snapshots are immutable'); END;");
  migratePilot(db);
  initializeAccess(db);
  initializeSettings(db);
  initializeDataset(db);
  initializeCollection(db);
  initializeBusinessCalendar(db);
  initializeConstruction(db);
  db.exec(`CREATE TABLE IF NOT EXISTS red_monitoring_state (
    complex_id TEXT PRIMARY KEY REFERENCES complexes(id),
    is_red INTEGER NOT NULL CHECK(is_red IN (0,1)),
    episode INTEGER NOT NULL CHECK(episode>=0), fingerprint TEXT,
    signal_id TEXT REFERENCES signals(id), last_signal_rowid INTEGER NOT NULL DEFAULT 0, observed_at TEXT NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(red_monitoring_state)').all().some(column=>column.name==='last_signal_rowid'))db.exec('ALTER TABLE red_monitoring_state ADD COLUMN last_signal_rowid INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS object_condition_reviews (
    id TEXT PRIMARY KEY,complex_id TEXT NOT NULL REFERENCES complexes(id),checked_date TEXT NOT NULL,
    created_at TEXT NOT NULL,created_by TEXT NOT NULL,source TEXT NOT NULL,evidence_text TEXT NOT NULL,
    checks_json TEXT NOT NULL,context_sha256 TEXT NOT NULL,context_json TEXT NOT NULL,is_demo INTEGER NOT NULL CHECK(is_demo IN (0,1)),
    review_window_days INTEGER NOT NULL DEFAULT 30,policy_version TEXT NOT NULL DEFAULT 'object-conditions-v1');
    CREATE INDEX IF NOT EXISTS condition_reviews_object ON object_condition_reviews(complex_id);
    CREATE TRIGGER IF NOT EXISTS condition_reviews_no_update BEFORE UPDATE ON object_condition_reviews BEGIN SELECT RAISE(ABORT,'Object condition reviews are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS condition_reviews_no_delete BEFORE DELETE ON object_condition_reviews BEGIN SELECT RAISE(ABORT,'Object condition reviews are immutable'); END;`);
  const conditionColumns=db.prepare('PRAGMA table_info(object_condition_reviews)').all();
  if(!conditionColumns.some(column=>column.name==='review_window_days'))db.exec('ALTER TABLE object_condition_reviews ADD COLUMN review_window_days INTEGER NOT NULL DEFAULT 30');
  if(!conditionColumns.some(column=>column.name==='policy_version'))db.exec("ALTER TABLE object_condition_reviews ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'object-conditions-v1'");
  db.exec(`CREATE TABLE IF NOT EXISTS complaint_intakes (
    complaint_id TEXT PRIMARY KEY REFERENCES complaints(id),received_date TEXT NOT NULL,
    registration_number TEXT NOT NULL,created_by TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,
    is_demo INTEGER NOT NULL CHECK(is_demo IN (0,1)));
    CREATE TABLE IF NOT EXISTS complaint_reviews (
    id TEXT PRIMARY KEY,complaint_id TEXT NOT NULL REFERENCES complaint_intakes(complaint_id),
    status TEXT NOT NULL CHECK(status IN ('CONFIRMED','REJECTED','RESOLVED')),
    checked_date TEXT NOT NULL,source TEXT NOT NULL,evidence_text TEXT NOT NULL,reason TEXT NOT NULL,
    created_at TEXT NOT NULL,created_by TEXT NOT NULL,previous_review_id TEXT REFERENCES complaint_reviews(id));
    CREATE INDEX IF NOT EXISTS complaint_reviews_case ON complaint_reviews(complaint_id);
    CREATE UNIQUE INDEX IF NOT EXISTS complaint_review_chain ON complaint_reviews(complaint_id,IFNULL(previous_review_id,''));
    CREATE INDEX IF NOT EXISTS complaints_object ON complaints(complex_id);
    CREATE TRIGGER IF NOT EXISTS complaint_intakes_no_update BEFORE UPDATE ON complaint_intakes BEGIN SELECT RAISE(ABORT,'Complaint intake is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS complaint_intakes_no_delete BEFORE DELETE ON complaint_intakes BEGIN SELECT RAISE(ABORT,'Complaint intake is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS complaint_reviews_no_update BEFORE UPDATE ON complaint_reviews BEGIN SELECT RAISE(ABORT,'Complaint review is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS complaint_reviews_no_delete BEFORE DELETE ON complaint_reviews BEGIN SELECT RAISE(ABORT,'Complaint review is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS complaint_body_immutable BEFORE UPDATE OF complex_id,type,summary,source,captured_at ON complaints
      WHEN EXISTS(SELECT 1 FROM complaint_intakes WHERE complaint_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Complaint body is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS complaint_verification_projection BEFORE UPDATE OF verified ON complaints
      WHEN EXISTS(SELECT 1 FROM complaint_intakes WHERE complaint_id=OLD.id)
      AND NEW.verified IS NOT COALESCE((SELECT status IN ('CONFIRMED','RESOLVED') FROM complaint_reviews WHERE complaint_id=OLD.id ORDER BY rowid DESC LIMIT 1),0)
      BEGIN SELECT RAISE(ABORT,'Complaint verification follows review history'); END;`);
}

export function inTransaction(db, action) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    // The actor may have been revoked by another process while BEGIN waited for the writer.
    validateTransactionActor(db);
    const value = action();
    db.exec("COMMIT;");
    return value;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function closeDatabase(db) {
  try { db.close(); } catch {}
}
