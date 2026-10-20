import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDatabase, openDatabase } from "../src/db.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { confirmAdvertisementMatch, createAdvertisement, reviewFactor, setLegalBasisStatus } from "../src/advertisement-service.mjs";
import { createSignal, transitionSignal } from "../src/signal-service.mjs";

const db = openDatabase(":memory:");
seedDemoData(db);

after(() => {
  closeDatabase(db);
});

test("new ad → confirmed match → analyst factor review → signal snapshot and audit", async () => {
  const initial = db.prepare("SELECT * FROM complexes WHERE id = 'cx-altai'").get();
  assert.equal(initial.legal_basis_status, "UNKNOWN");

  const created = await createAdvertisement(db, {
    platform: "Instagram",
    account: "@walkthrough_demo",
    publicationDate: new Date().toISOString().slice(0, 10),
    text: "ЖК Altai Residence: для фиксации квартиры внесите депозит 250 000 ₸.",
    notes: "Integration walkthrough source",
  });
  const adId = created.id;
  assert.equal(created.analysis.paymentOffer.detected, true);
  assert.equal(created.linkStatus, "MATCH_PENDING");
  assert.equal(created.proposedComplexId, "cx-altai");

  const match = confirmAdvertisementMatch(db, adId, "cx-altai");
  assert.equal(match.advertisement.complexId, "cx-altai");
  assert.equal(match.risk.score, 0);
  const r2 = match.createdFactors.find((factor) => factor.code === "R2");
  assert.ok(r2, "link confirmation should create a reviewable R2 hypothesis");
  assert.equal(r2.status, "AI_HYPOTHESIS");
  assert.equal(match.risk.score, 0, "hypothesis does not add risk points");

  const reviewed = reviewFactor(db, r2.id, {
    status: "CONFIRMED",
    notes: "The exact source excerpt was checked by the analyst.",
  });
  assert.equal(reviewed.risk.score, 25);
  assert.equal(reviewed.risk.zone, "yellow", "R2 alone is yellow while legal basis is unknown");
  assert.equal(reviewed.risk.redRuleSatisfied, false);

  const signal = createSignal(db, "cx-altai");
  assert.equal(signal.scoreSnapshot, 25);
  assert.equal(signal.status, "NEEDS_REVIEW");
  assert.ok(signal.factorSnapshot.some((factor) => factor.id === r2.id && factor.status === "CONFIRMED"));

  const queued = transitionSignal(db, signal.id, {
    status: "NEEDS_REVIEW",
    comment: "Ready for second-person review.",
  });
  assert.equal(queued.status, "NEEDS_REVIEW");
  const confirmed = transitionSignal(db, signal.id, {
    status: "CONFIRMED",
    comment: "Evidence and rule application checked.",
  });
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.scoreSnapshot, 25);

  assert.throws(
    () => db.prepare("UPDATE signals SET score_snapshot = 61 WHERE id = ?").run(signal.id),
    /Signal snapshots are immutable/u,
  );
  const actions = db.prepare("SELECT action FROM audit_logs WHERE entity_id IN (?,?,?)").all(adId, signal.id, "cx-altai").map((row) => row.action);
  assert.ok(actions.includes("ADVERTISEMENT_CREATED"));
  assert.ok(actions.includes("ADVERTISEMENT_ANALYZED"));
  assert.ok(actions.includes("ADVERTISEMENT_MATCH_CONFIRMED"));
  assert.ok(actions.includes("RISK_FACTOR_CONFIRMED"));
  assert.ok(actions.includes("SIGNAL_CREATED"));
  assert.ok(actions.includes("SIGNAL_STATUS_CONFIRMED"));

  const legalEntry = (status, sourceLabel, evidenceText) => ({
    expectedUpdatedAt:db.prepare("SELECT updated_at FROM complexes WHERE id='cx-altai'").get().updated_at,
    status,
    sourceLabel,
    evidenceText,
    notes: "Repeated review verifies the same R1 record is updated.",
  });
  setLegalBasisStatus(db, "cx-altai", legalEntry("CONFIRMED_ABSENT", "Demo review 1", "No applicable basis in reviewed demo file."));
  setLegalBasisStatus(db, "cx-altai", legalEntry("CONFIRMED_VALID", "Demo review 2", "Valid demo guarantee recorded in reviewed file."));
  setLegalBasisStatus(db, "cx-altai", legalEntry("CONFIRMED_ABSENT", "Demo review 3", "No applicable basis in updated demo file."));
  const legalR1 = db.prepare("SELECT * FROM risk_factors WHERE complex_id = 'cx-altai' AND code = 'R1' AND source_type = 'MANUAL_REVIEW' AND source_id = 'legal-basis'").all();
  assert.equal(legalR1.length, 1);
  assert.equal(legalR1[0].status, "CONFIRMED");
  assert.equal(legalR1[0].source_label, "Demo review 3");
});
