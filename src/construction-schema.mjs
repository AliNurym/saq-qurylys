export function initializeConstruction(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS construction_observations (
    id TEXT PRIMARY KEY,complex_id TEXT NOT NULL REFERENCES complexes(id),observed_date TEXT NOT NULL,
    completion_pct REAL NOT NULL CHECK(completion_pct BETWEEN 0 AND 100),source TEXT NOT NULL,method TEXT NOT NULL,
    description TEXT NOT NULL,supersedes_id TEXT REFERENCES construction_observations(id),
    mime TEXT NOT NULL,sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes BLOB NOT NULL,
    fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,UNIQUE(complex_id,fingerprint));
    CREATE INDEX IF NOT EXISTS construction_object_date ON construction_observations(complex_id,observed_date DESC,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS construction_supersedes ON construction_observations(supersedes_id);
    CREATE TABLE IF NOT EXISTS construction_reviews (
      observation_id TEXT PRIMARY KEY REFERENCES construction_observations(id),status TEXT NOT NULL CHECK(status IN ('CONFIRMED','REJECTED')),
      reason TEXT NOT NULL,applied INTEGER NOT NULL CHECK(applied IN (0,1)),reviewed_at TEXT NOT NULL,reviewed_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS readiness_history (
      id TEXT PRIMARY KEY,complex_id TEXT NOT NULL REFERENCES complexes(id),kind TEXT NOT NULL CHECK(kind IN ('DECLARED','VERIFIED')),
      percentage REAL CHECK(percentage BETWEEN 0 AND 100),source TEXT,captured_at TEXT,observation_id TEXT REFERENCES construction_observations(id),
      revision INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS readiness_object_history ON readiness_history(complex_id,created_at DESC,id DESC);`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS readiness_object_revision ON readiness_history(complex_id,revision)');
  for(const table of ['construction_observations','construction_reviews','readiness_history'])for(const action of ['UPDATE','DELETE'])db.exec(
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Construction evidence is immutable'); END;`);
  const add=(table,name,type)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(column=>column.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);};
  add('complexes','verified_observation_id','TEXT REFERENCES construction_observations(id)');
  add('complexes','readiness_revision','INTEGER NOT NULL DEFAULT 0');
  add('risk_factors','context_json','TEXT');
}
