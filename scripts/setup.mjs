import { closeDatabase, openDatabase } from "../src/db.mjs";
import { loadEnvFile } from "../src/config.mjs";
import { seedDemoData } from "../src/seed-data.mjs";

loadEnvFile();
const db = openDatabase();
try {
  const result = seedDemoData(db);
  console.log(result.seeded
    ? "Setup complete: " + result.complexes + " demo complexes for " + (result.city || "demo") + " and " + result.advertisements + " advertisements are ready."
    : "Database already contains " + result.complexes + " complexes; no data was changed.");
} finally {
  closeDatabase(db);
}
