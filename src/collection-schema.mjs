export function initializeCollection(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('HTML_PAGE','JSON_FEED')),
      platform TEXT NOT NULL, url TEXT NOT NULL, token_env TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 60 AND 10080),
      next_run_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS collection_sources_due ON collection_sources(enabled,next_run_at);
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('COLLECT_SOURCE','ANALYZE_AD')),
      subject_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 4,
      run_after TEXT NOT NULL, lease_until TEXT, lease_token TEXT,
      last_error TEXT, result_json TEXT, created_at TEXT NOT NULL, finished_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_subject ON background_jobs(kind,subject_id)
      WHERE state IN ('PENDING','RUNNING');
    CREATE INDEX IF NOT EXISTS jobs_due ON background_jobs(state,run_after);
    CREATE TABLE IF NOT EXISTS source_archives (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES collection_sources(id),
      job_id TEXT NOT NULL REFERENCES background_jobs(id), final_url TEXT NOT NULL,
      mime TEXT NOT NULL, sha256 TEXT NOT NULL, captured_at TEXT NOT NULL, bytes BLOB NOT NULL,
      source_snapshot_json TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS archives_no_update BEFORE UPDATE ON source_archives
      BEGIN SELECT RAISE(ABORT,'Source archives are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS archives_no_delete BEFORE DELETE ON source_archives
      BEGIN SELECT RAISE(ABORT,'Source archives are immutable'); END;
    CREATE TABLE IF NOT EXISTS collected_publications (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES collection_sources(id), external_id TEXT NOT NULL,
      content_sha256 TEXT NOT NULL, advertisement_id TEXT NOT NULL REFERENCES advertisements(id),
      archive_id TEXT NOT NULL REFERENCES source_archives(id), published_at TEXT, observed_at TEXT NOT NULL,
      UNIQUE(source_id,external_id,content_sha256));
    CREATE UNIQUE INDEX IF NOT EXISTS publication_origin_ad ON collected_publications(advertisement_id);
    CREATE TRIGGER IF NOT EXISTS provenance_no_update BEFORE UPDATE ON collected_publications
      BEGIN SELECT RAISE(ABORT,'Collection provenance is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS provenance_no_delete BEFORE DELETE ON collected_publications
      BEGIN SELECT RAISE(ABORT,'Collection provenance is immutable'); END;
  `);
  if(!db.prepare('PRAGMA table_info(background_jobs)').all().some(column=>column.name==='last_error_code'))db.exec('ALTER TABLE background_jobs ADD COLUMN last_error_code TEXT');
}
