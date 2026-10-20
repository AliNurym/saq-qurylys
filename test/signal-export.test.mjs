import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { createSignal, getSignalDetails } from "../src/signal-service.mjs";
import { renderSignalExport } from "../src/signal-export.mjs";

test("downloadable report contains full captured evidence and survives later source edits", (t) => {
  const db = openDatabase(":memory:"); seedDemoData(db); t.after(() => db.close());
  const text = "Начало публикации. " + "Сохранённый фрагмент. ".repeat(30) + "Последняя строка доказательства.";
  db.prepare("UPDATE advertisements SET text = ? WHERE id = 'ad-001'").run(text);
  const signal = createSignal(db, "cx-aspan");
  db.prepare("UPDATE advertisements SET text = 'Позднее изменение' WHERE id = 'ad-001'").run();
  const html = renderSignalExport(getSignalDetails(db, signal.id));
  assert.ok(html.includes(text)); assert.ok(html.includes("Последняя строка доказательства."));
  assert.equal(html.includes("Позднее изменение"), false);
  assert.ok(html.includes("Content-Security-Policy"));
});

test("report escapes user-controlled markup and rejects executable source links", (t) => {
  const db = openDatabase(":memory:"); seedDemoData(db); t.after(() => db.close());
  db.prepare("UPDATE advertisements SET text = '<script>alert(1)</script>', url = 'javascript:alert(1)' WHERE id = 'ad-001'").run();
  const html = renderSignalExport(createSignal(db, "cx-aspan"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.ok(html.includes("&lt;script&gt;"));
});
