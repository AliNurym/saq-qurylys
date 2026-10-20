import { closeDatabase, openDatabase } from "../src/db.mjs";
import { loadEnvFile } from "../src/config.mjs";
import { seedDemoData } from "../src/seed-data.mjs";

loadEnvFile();
const db = openDatabase();
try {
  const result = seedDemoData(db);
  console.log(result.seeded
    ? "Seeded " + result.complexes + " demo complexes for " + (result.city || "demo") + " and " + result.advertisements + " advertisements."
    : "Seed unchanged; " + result.complexes + " complexes already exist.");
} finally {
  closeDatabase(db);
}
