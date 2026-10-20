import { resolve, sep } from "node:path";
import { closeDatabase, openDatabase } from "../src/db.mjs";
import { getDatabasePath, loadEnvFile } from "../src/config.mjs";
import { seedDemoData } from "../src/seed-data.mjs";

loadEnvFile();
const dbPath = getDatabasePath();
const allowedRoot = resolve(process.cwd(), "data") + sep;
if (dbPath === ":memory:" || !dbPath.startsWith(allowedRoot)) {
  console.error("Refusing reset: SAQ_DB_PATH must point inside the project data directory.");
  process.exitCode = 1;
} else {
  const db = openDatabase(dbPath);
  try {
    const result = seedDemoData(db, { reset: true });
    console.log("Demo database reset: " + result.complexes + " demo complexes and " + result.advertisements + " advertisements (" + (result.city || "demo") + ").");
  } finally {
    closeDatabase(db);
  }
}
