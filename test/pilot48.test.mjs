import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { listComplexes, getOverview, getComplexDetails } from "../src/complex-service.mjs";
import { listSignals, getSignalDetails } from "../src/signal-service.mjs";
import { renderPassport, renderSignalWorkflow } from "../public/pilot-ui.js";

test("optional 48-record synthetic profile remains clearly demo-only", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());

  const result = seedDemoData(db, { pilot48: true });
  assert.equal(result.seeded, true);
  assert.equal(result.complexes, 48);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM complex_contacts WHERE type='PHONE'").get().count, 0, "48-card synthetic seed must not invent callable phone contacts");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM advertisements WHERE phone IS NOT NULL").get().count, 0, "synthetic ads must not expose generated phone values");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM advertisements WHERE text LIKE '%+7 %'").get().count, 0, "synthetic source text must not contain phone numbers");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ai_analyses WHERE detected_phone IS NOT NULL").get().count, 0, "demo analyses must not derive callable phone contacts");

  const overview = getOverview(db);
  assert.equal(overview.complexes.length, 48);
  for (const complex of overview.complexes) {
    for (const field of ["director", "founders", "bankDetails"]) {
      assert.equal(complex.passport.fields[field], "Не предоставлено в демо; требуется первичный источник.", `Synthetic ${field} must not resemble a real person or account`);
    }
  }
  assert.equal(overview.distribution.red + overview.distribution.yellow + overview.distribution.green, 48);

  // Verify all are in Ust-Kamenogorsk
  assert.ok(overview.complexes.every(c => c.city === "Усть-Каменогорск"));

  // Synthetic signal cards never imply a real recipient decision.
  const signals = listSignals(db);
  assert.equal(signals.length, 5, "The optional pilot fixture contains five illustrative signal cards");
  assert.ok(signals.every(signal => signal.status === "NEEDS_REVIEW"), "Synthetic signals must not contain a fabricated MIO decision");
  for (const signal of signals) {
    const detail = getSignalDetails(db, signal.id);
    assert.equal(detail.reviewedBy, null);
    assert.equal(detail.reviewedAt, null);
    assert.deepEqual(detail.routing, {}, "Demo seed must not claim an external assignment or response");
  }

  // Verify passport fields (cadastral, district, BIN)
  const red1 = overview.complexes.find(c => c.id === "cx-ertis-deluxe");
  assert.equal(red1.passport.fields.district, "Центр");
  assert.equal(red1.isDemo, true);
  assert.equal(red1.passport.verificationMode, "DEMO_SCENARIO");
  assert.equal(red1.passport.checkedAt, null, "Synthetic passport must not show an official verification time");
  assert.match(red1.passport.source, /Синтетическая демонстрационная фикстура/u);
  assert.match(red1.legalBasisSource, /реальный источник не предоставлен/u);
  const syntheticFactor = db.prepare("SELECT evidence_text, source_label FROM risk_factors WHERE complex_id=? AND code='R1'").get(red1.id);
  assert.match(syntheticFactor.evidence_text, /^Демо-сценарий; текст синтетический, не первичный документ:/u);
  assert.match(syntheticFactor.source_label, /^Демо-сценарий/u);
  assert.equal(red1.developerBin, "240140012301");
  assert.ok(red1.passport.fields.cadastralNumber);
  assert.equal(red1.risk.zone, "red");
  assert.ok(red1.risk.score >= 70);

  // Verify district filtering
  const centerComplexes = listComplexes(db, { district: "Центр" });
  assert.ok(centerComplexes.length > 0);
  assert.ok(centerComplexes.every(c => c.passport.fields.district === "Центр"));

  const kshtComplexes = listComplexes(db, { district: "КШТ" });
  assert.ok(kshtComplexes.length > 0);
  assert.ok(kshtComplexes.every(c => c.passport.fields.district === "КШТ"));
});

test("Contrast scenarios A, B, C from TZ Section 5 work exactly as specified", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seedDemoData(db, { pilot48: true });

  const overview = getOverview(db);

  // Кейс A: Основание не проверено (UNKNOWN), реклама/бронь -> Жёлтая зона
  const caseA = overview.complexes.find(c => c.id === "cx-utepov-comfort");
  assert.ok(caseA, "cx-utepov-comfort exists");
  assert.equal(caseA.legalBasisStatus, "UNKNOWN");
  assert.equal(caseA.risk.zone, "yellow");
  assert.equal(caseA.risk.confirmedFactors.some(f => f.code === "R1"), false, "Unknown basis must NOT turn into R1");

  // Кейс B: Установлено отсутствие законного основания + сбор денег -> Красная зона (>= 60 + R1+R2)
  const caseB = overview.complexes.find(c => c.id === "cx-ertis-deluxe");
  assert.ok(caseB, "cx-ertis-deluxe exists");
  assert.equal(caseB.legalBasisStatus, "CONFIRMED_ABSENT");
  assert.equal(caseB.risk.zone, "red");
  assert.ok(caseB.risk.score >= 60);
  assert.ok(caseB.risk.confirmedFactors.some(f => f.code === "R1"));
  assert.ok(caseB.risk.confirmedFactors.some(f => f.code === "R2"));

  // Кейс C: Действующая гарантия/разрешение подтверждены, обычная реклама -> Зелёная зона
  const caseC = overview.complexes.find(c => c.id === "cx-satpayev-elite");
  assert.ok(caseC, "cx-satpayev-elite exists");
  assert.equal(caseC.legalBasisStatus, "CONFIRMED_VALID");
  assert.equal(caseC.displayCategory, "green");
  assert.equal(caseC.risk.zone, "green");
  assert.equal(caseC.risk.confirmedFactors.some(f => f.code === "R1"), false, "Valid guarantee must not score R1");
});

test("Connected entities and contact channels are exposed in complex details (TZ Section 4.2)", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seedDemoData(db, { pilot48: true });

  const details = getComplexDetails(db, "cx-ertis-deluxe");
  assert.ok(details);
  assert.ok(Array.isArray(details.contacts), "Contacts must be an array");
  assert.equal(details.contacts.length, 1, "Synthetic records must not invent a callable phone number");

  const phone = details.contacts.find(c => c.type === "PHONE");
  assert.equal(phone, undefined);

  const web = details.contacts.find(c => c.type === "ACCOUNT");
  assert.ok(web, "Must have website contact");
  assert.match(web.value, /^Демо-сценарий/u);

  // Keep the form shape while avoiding fabricated personal and bank-account data.
  assert.ok(details.passport.fields.salesOffices);
  assert.equal(details.passport.fields.bankDetails, "Не предоставлено в демо; требуется первичный источник.");
  assert.equal(details.passport.fields.director, "Не предоставлено в демо; требуется первичный источник.");
});

test("synthetic passports and signal cards clearly disclose their demo-only evidence", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seedDemoData(db, { pilot48: true });

  const complex = getComplexDetails(db, "cx-ertis-deluxe");
  assert.match(renderPassport(complex), /Демо-сценарий: паспорт, источники, даты и статусы вымышлены/u);

  const signal = getSignalDetails(db, "SQ-2026-0001");
  assert.match(renderSignalWorkflow(signal), /Демо-сценарий: паспорт, правовые статусы, публикации и решения синтетические/u);
  assert.match(signal.comment, /назначение получателю и результат отсутствуют/u);
});


