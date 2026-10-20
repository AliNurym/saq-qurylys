import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, createSchema } from "../src/db.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { createAdvertisement, confirmAdvertisementMatch, reviewFactor, addManualFactor } from "../src/advertisement-service.mjs";
import { createSignal, getSignalDetails, listSignals, transitionSignal } from "../src/signal-service.mjs";
import { calculateComplexRisk, getOverview } from "../src/complex-service.mjs";
import { todayInKazakhstan } from "../src/dates.mjs";
import { listAudit, writeAudit } from "../src/audit-service.mjs";

process.env.AI_PROVIDER = "rule-based";
function fixture(t) {
  const db = openDatabase(":memory:"); seedDemoData(db); t.after(() => db.close()); return db;
}
const manual = (code) => ({ code, sourceLabel: "Учебный источник № 1", evidenceText: "Проверенное свидетельство в учебном источнике.", notes: "Данные сверены аналитиком." });

test("overview and new signal IDs use Kazakhstan's calendar day at the UTC boundary", (t) => {
  const db = fixture(t);
  const instant = new Date("2026-10-14T20:00:00Z");
  assert.equal(todayInKazakhstan(instant), "2026-10-15");
  t.mock.timers.enable({ apis: ["Date"], now: instant.getTime() });
  assert.equal(getOverview(db).asOf, "2026-10-15");
  const signal = createSignal(db, "cx-altai");
  assert.match(signal.id, /^SQ-2026-\d{4}$/u);
  assert.equal(signal.createdAt, "2026-10-14T20:00:00.000Z");
  const event = writeAudit(db, "SYSTEM", "timezone-check", "TIMEZONE_CHECK");
  assert.ok(listAudit(db, { from: "2026-10-15", to: "2026-10-15" }).some((row) => row.id === event.id));
  assert.ok(!listAudit(db, { to: "2026-10-14" }).some((row) => row.id === event.id));
  assert.throws(() => listAudit(db, { from: "2026-02-30" }), /дату/u);
});

test("manual factors persist with notes and repeated codes do not inflate score", (t) => {
  const db = fixture(t);
  const first = addManualFactor(db, "cx-altai", manual("R2"));
  assert.equal(first.risk.score, 25);
  assert.equal(first.factor.notes, manual("R2").notes);
  assert.equal(addManualFactor(db, "cx-altai", manual("R2")).risk.score, 25);
  assert.throws(() => addManualFactor(db, "cx-altai", { code: "R4" }), /источник/u);
  assert.throws(() => addManualFactor(db, "cx-saryarka", manual("R3")), /строящемуся/u);
});

test("R5 requires both source dates", (t) => {
  const db = fixture(t);
  db.prepare("UPDATE complexes SET verified_completion_at = NULL WHERE id = 'cx-qazyna'").run();
  assert.throws(() => addManualFactor(db, "cx-qazyna", manual("R5")), /датами/u);
});

test("invalid dates and credential URLs are rejected before persistence", async (t) => {
  const db = fixture(t);
  const before = db.prepare("SELECT COUNT(*) AS count FROM advertisements").get().count;
  for (const publicationDate of ["2026-02-30", "2025-02-29", "tomorrow", "9999-01-01", "2009-12-31"]) {
    await assert.rejects(createAdvertisement(db, { text: "Учебная публикация", publicationDate }), /дату/u);
  }
  await assert.rejects(createAdvertisement(db, { text: "Учебная публикация", url: "https://login:secret@example.invalid" }), /пароль/u);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM advertisements").get().count, before);
});

test("contact-only match suggestions use saved phone and account", async (t) => {
  const db = fixture(t);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM complex_contacts WHERE type='PHONE'").get().count, 0, "demo seed must not invent callable phone contacts");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM advertisements WHERE phone IS NOT NULL").get().count, 0, "demo publications must not carry generated phone numbers");
  const complexId = db.prepare("SELECT id FROM complexes ORDER BY id LIMIT 1").get().id;
  db.prepare("INSERT INTO complex_contacts (id,complex_id,type,value,source_label,is_demo) VALUES (?,?,?,?,?,1)")
    .run("contact-test-phone", complexId, "PHONE", "+7 700 000 00 01", "Изолированная тестовая фикстура");
  const contact = db.prepare("SELECT * FROM complex_contacts WHERE type = 'PHONE' LIMIT 1").get();
  const ad = await createAdvertisement(db, { text: "Новые планировки квартир. Подробности по телефону.", phone: contact.value });
  assert.ok(ad.matches.some((item) => item.complexId === contact.complex_id));
  assert.ok(ad.proposedComplexId);
});

test("confirmed ad match is idempotent and cannot orphan existing evidence", async (t) => {
  const db = fixture(t);
  const ad = await createAdvertisement(db, { text: "ЖК Altai Residence. Внесите депозит 250 тыс ₸." });
  const match = confirmAdvertisementMatch(db, ad.id, "cx-altai");
  const factor = match.createdFactors.find((item) => item.code === "R2");
  const audits = db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count;
  assert.equal(confirmAdvertisementMatch(db, ad.id, "cx-altai").createdFactors.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count, audits);
  assert.throws(() => confirmAdvertisementMatch(db, ad.id, "cx-orda"), /уже связана/u);
  reviewFactor(db, factor.id, { status: "CONFIRMED", expectedStatus: "AI_HYPOTHESIS" });
  assert.throws(() => reviewFactor(db, factor.id, { status: "REJECTED", expectedStatus: "AI_HYPOTHESIS" }), /уже изменён/u);
  assert.equal(calculateComplexRisk(db, "cx-altai").score, 25);
});

test("signal context, factors and advertisements remain unchanged after later edits", async (t) => {
  const db = fixture(t);
  const signal = createSignal(db, "cx-aspan");
  assert.equal(signal.legacySnapshot, false);
  db.prepare("UPDATE complexes SET name = 'Changed', legal_basis_source = 'Changed' WHERE id = 'cx-aspan'").run();
  db.prepare("UPDATE advertisements SET text = 'Changed source' WHERE complex_id = 'cx-aspan'").run();
  const ad = await createAdvertisement(db, { text: "Ещё одна публикация. Внесите депозит 1 млн ₸." });
  confirmAdvertisementMatch(db, ad.id, "cx-aspan");
  const later = getSignalDetails(db, signal.id);
  assert.deepEqual(later.complex, signal.complex);
  assert.deepEqual(later.advertisements, signal.advertisements);
  assert.deepEqual(later.factorSnapshot, signal.factorSnapshot);
  assert.equal(listSignals(db).find((item) => item.id === signal.id).complexName, signal.complex.name);
  assert.equal(getOverview(db).recentSignals.find((item) => item.id === signal.id).complexName, signal.complex.name);
  assert.throws(() => db.prepare("UPDATE signals SET context_snapshot_json = '{}' WHERE id = ?").run(signal.id), /immutable/u);
  createSchema(db);
  assert.deepEqual(getSignalDetails(db, signal.id).contextSnapshot, signal.contextSnapshot);
});

test("legacy snapshots omit unrecoverable ad history and are explicitly identified", (t) => {
  const db = fixture(t);
  db.prepare("INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,status,created_by,created_at) VALUES ('legacy','cx-altai',0,'green','UNKNOWN','[]','DRAFT','Demo Analyst',?)").run(new Date().toISOString());
  const signal = getSignalDetails(db, "legacy");
  assert.equal(signal.legacySnapshot, true);
  assert.deepEqual(signal.advertisements, []);
  assert.equal(signal.complex.legalBasisStatus, "UNKNOWN");
  assert.equal(signal.complex.legalBasisSource, null);
});

test("signal numbering tolerates gaps and review requires valid transitions", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-14T20:00:00Z").getTime() });
  const db = fixture(t);
  const date = "2026";
  db.prepare("INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,status,created_by,created_at) VALUES (?,'cx-altai',0,'green','UNKNOWN','[]','DRAFT','Demo Analyst',?)").run("SQ-" + date + "-0025", new Date().toISOString());
  const signal = createSignal(db, "cx-altai");
  assert.equal(signal.id, "SQ-" + date + "-0026");
  assert.throws(() => transitionSignal(db, signal.id, { status: "ARCHIVED" }), /недоступен/u);
  transitionSignal(db, signal.id, { status: "NEEDS_REVIEW" });
  assert.throws(() => transitionSignal(db, signal.id, { status: "RETURNED" }), /комментарий/u);
  transitionSignal(db, signal.id, { status: "RETURNED", comment: "Уточните источник" });
  assert.equal(transitionSignal(db, signal.id, { status: "ARCHIVED" }).status, "ARCHIVED");
});
