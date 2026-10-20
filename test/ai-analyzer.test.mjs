import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally, validateAiAnalysis } from "../src/ai-analyzer.mjs";

test("extracts a new deposit offer, exact evidence, amount, and named complex", () => {
  const text = "Старт продаж в ЖК Aspan Residence. Для бронирования квартиры внесите депозит 500 000 ₸.";
  const result = analyzeLocally({
    text,
    complexes: [{ name: "Aspan Residence" }],
  });
  assert.equal(result.paymentOffer.detected, true);
  assert.equal(result.paymentOffer.amount, 500000);
  assert.equal(result.paymentOffer.currency, "KZT");
  assert.equal(result.residentialComplex.name, "Aspan Residence");
  assert.ok(text.includes(result.paymentOffer.evidence));
  assert.ok(result.riskFactorHypotheses.some((item) => item.factor === "R2"));
  assert.equal(result.analysisSource, "Rule-based fallback");
});

test("ordinary showroom text does not produce an R2 hypothesis", () => {
  const result = analyzeLocally({ text: "Открываем шоурум ЖК Orda Park. Приходите посмотреть планировки." });
  assert.equal(result.paymentOffer.detected, false);
  assert.equal(result.riskFactorHypotheses.some((item) => item.factor === "R2"), false);
});

test("negated no-deposit wording is not treated as a payment offer", () => {
  const result = analyzeLocally({ text: "В ЖК Samal City действует бронь без депозита и без оплаты." });
  assert.equal(result.paymentOffer.detected, false);
});

test("provider evidence must be an exact substring of the submitted text", () => {
  const text = "Продажа квартир в ЖК Aspan Residence.";
  const payload = {
    summary: "Offer found",
    construction_related: true,
    residential_complex: { name: "Aspan Residence", confidence: 0.9 },
    developer: { name: null, confidence: 0 },
    address: { value: null, confidence: 0 },
    phone_numbers: [],
    payment_offer: {
      detected: true, type: "deposit", amount: 500000, currency: "KZT", confidence: 0.95,
      evidence: "Внесите депозит 500 000 ₸",
    },
    active_sale: { detected: true, confidence: 0.8, evidence: "Продажа квартир в ЖК Aspan Residence." },
    risk_factor_hypotheses: [],
    warnings: [],
  };
  assert.throws(() => validateAiAnalysis(payload, text), /exact source substring/u);
});

test("money parser handles millions, thousands and decimal punctuation", () => {
  for (const [phrase, expected] of [["1,5 млн ₸", 1500000], ["250 тыс тенге", 250000], ["500 000 ₸", 500000], ["1.25 млн KZT", 1250000], ["500.000 ₸", 500000]]) {
    assert.equal(analyzeLocally({ text: "Внесите депозит " + phrase + "." }).paymentOffer.amount, expected, phrase);
  }
});

test("free reservations are not payment offers, but an explicit separate deposit is", () => {
  assert.equal(analyzeLocally({ text: "Бесплатное бронирование квартир в ЖК Altai Residence." }).paymentOffer.detected, false);
  assert.equal(analyzeLocally({ text: "Бронирование бесплатно, но внесите депозит 500 000 ₸." }).paymentOffer.detected, true);
});

function validPayload() {
  return {
    summary: "Deposit offer", construction_related: true,
    residential_complex: { name: null, confidence: 0 }, developer: { name: null, confidence: 0 },
    address: { value: null, confidence: 0 }, phone_numbers: [],
    payment_offer: { detected: true, type: "deposit", amount: 500000, currency: "KZT", confidence: 0.9, evidence: "Внесите депозит 500 000 ₸." },
    active_sale: { detected: false, confidence: 0.1, evidence: null }, risk_factor_hypotheses: [], warnings: [],
  };
}
test("provider validator rejects empty quotes, wrong shapes and unsupported amounts", () => {
  const text = "Внесите депозит 500 000 ₸.";
  assert.equal(validateAiAnalysis(validPayload(), text).paymentOffer.amount, 500000);
  for (const mutate of [
    (p) => { p.address.value = { malformed: true }; },
    (p) => { p.payment_offer.evidence = ""; },
    (p) => { p.payment_offer.amount = 5000000; },
    (p) => { p.payment_offer.amount = "500000"; },
    (p) => { p.payment_offer.detected = false; },
    (p) => { p.risk_factor_hypotheses = [{ factor: "R3", confidence: 0.8, evidence: text, reason: "unsupported sale" }]; },
  ]) {
    const payload = validPayload(); mutate(payload);
    assert.throws(() => validateAiAnalysis(payload, text));
  }
});
