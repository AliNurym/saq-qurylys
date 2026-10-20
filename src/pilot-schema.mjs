import { FACTORS } from "./constants.mjs";

export function migratePilot(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_versions (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const add = (table, name, type) => {
    if (!db.prepare("PRAGMA table_info(" + table + ")").all().some((column) => column.name === name)) {
      db.exec("ALTER TABLE " + table + " ADD COLUMN " + name + " " + type);
    }
  };
  add("complexes", "object_number", "TEXT");
  add("complexes", "passport_json", "TEXT NOT NULL DEFAULT '{}'");
  add("signals", "routing_json", "TEXT NOT NULL DEFAULT '{}'");
  add("advertisements", "source_status", "TEXT NOT NULL DEFAULT 'CAPTURED'");
  add("advertisements", "source_removed_at", "TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS evidence_files (
    id TEXT PRIMARY KEY, advertisement_id TEXT NOT NULL REFERENCES advertisements(id),
    mime TEXT NOT NULL, sha256 TEXT NOT NULL, captured_at TEXT NOT NULL, bytes BLOB NOT NULL);
    CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence_files
      BEGIN SELECT RAISE(ABORT, 'Evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence_files
      BEGIN SELECT RAISE(ABORT, 'Evidence is immutable'); END;
    CREATE UNIQUE INDEX IF NOT EXISTS complexes_number_unique ON complexes(object_number);`);
  db.exec("CREATE TABLE IF NOT EXISTS monitoring_runs (complex_id TEXT PRIMARY KEY REFERENCES complexes(id),last_run_at TEXT NOT NULL,next_run_at TEXT,score INTEGER NOT NULL,zone TEXT NOT NULL,scoring_version TEXT NOT NULL)");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM schema_versions WHERE version='pilot-v1'").get()) {
      // Old R6 meant delay. Never reinterpret that evidence as on-schedule construction.
      db.prepare("UPDATE risk_factors SET code='DELAY',weight=0 WHERE code='R6' AND weight<>-15").run();
      db.prepare("UPDATE risk_factors SET code='R6_SCHEDULE_LEGACY',weight=0 WHERE code='R6' AND weight=-15").run();
      for (const [code, factor] of Object.entries(FACTORS)) db.prepare("UPDATE risk_factors SET weight=? WHERE code=?").run(factor.weight, code);
      db.prepare("INSERT INTO schema_versions VALUES ('pilot-v1',?)").run(new Date().toISOString());
    }
    if (!db.prepare("SELECT 1 FROM schema_versions WHERE version='codemasters-8.0-saq-v1'").get()) {
      // Preserve the old pilot's on-schedule R6 evidence under a non-scoring legacy code.
      // The former DELAY entries become the case's confirmed stoppage/delay factor R6.
      db.prepare("UPDATE risk_factors SET code='R6_SCHEDULE_LEGACY',weight=0 WHERE code='R6'").run();
      db.prepare("UPDATE risk_factors SET code='R6',weight=? WHERE code='DELAY'").run(FACTORS.R6.weight);
      for (const [code, factor] of Object.entries(FACTORS)) db.prepare("UPDATE risk_factors SET weight=? WHERE code=?").run(factor.weight, code);
      db.prepare("INSERT INTO schema_versions VALUES ('codemasters-8.0-saq-v1',?)").run(new Date().toISOString());
    }
    const rows = db.prepare("SELECT id FROM complexes WHERE object_number IS NULL ORDER BY created_at,id").all();
    let sequence = Number(db.prepare("SELECT MAX(CAST(substr(object_number,8) AS INTEGER)) AS n FROM complexes").get().n ?? 0);
    for (const row of rows) db.prepare("UPDATE complexes SET object_number=? WHERE id=?").run("SQ-OBJ-" + String(++sequence).padStart(4, "0"), row.id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
