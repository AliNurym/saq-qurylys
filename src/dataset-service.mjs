const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 409 }); };

export function initializeDataset(db) {
  db.exec("CREATE TABLE IF NOT EXISTS dataset_config (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('demo','working'))); INSERT OR IGNORE INTO dataset_config VALUES (1,'demo')");
}

export function getDataset(db) {
  const mode = db.prepare("SELECT mode FROM dataset_config WHERE id=1").get().mode;
  return { mode, isDemo: mode === "demo" };
}

export function configureDataset(db, mode = getDataset(db).mode) {
  if (!["demo", "working"].includes(mode)) fail("SAQ_DATA_MODE: допустимы demo или working.");
  const current = getDataset(db).mode;
  if (current !== mode && ["complexes", "advertisements", "signals", "collection_sources", "background_jobs"].some(table => db.prepare("SELECT 1 FROM " + table + " LIMIT 1").get())) {
    fail("Для смены режима нужна отдельная пустая база SAQ_DB_PATH. Существующие записи сохранены.");
  }
  db.prepare("UPDATE dataset_config SET mode=? WHERE id=1").run(mode);
  return getDataset(db);
}

export function assertDatasetReady(db) {
  const dataset = getDataset(db);
  if (["complexes", "advertisements"].some(table => db.prepare("SELECT 1 FROM " + table + " WHERE is_demo<>? LIMIT 1").get(Number(dataset.isDemo)))) fail("Режим базы не соответствует записям. Учебные и рабочие данные должны храниться отдельно.");
  if (!dataset.isDemo) {
    if (!db.prepare("SELECT 1 FROM users WHERE role='ADMIN' AND disabled_at IS NULL LIMIT 1").get()) fail("Рабочая база требует администратора. Создайте его через scripts/create-user.mjs перед запуском.");
  }
}
