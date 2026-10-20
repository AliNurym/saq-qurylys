import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAdvertisement, analyzeWithLocalModel } from "../src/ai-analyzer.mjs";
import { predictPaymentOffer } from "../src/payment-model.mjs";

test("offline model generalizes to a new phrasing and returns an exact reviewable quote", () => {
  const text = "ЖК Altai Residence. Закрепление выбранной квартиры производится после оплаты резерва.";
  const result = analyzeWithLocalModel({ text, complexes: [{ name: "Altai Residence" }] });
  assert.equal(result.analysisSource, "Local ML + rules");
  assert.equal(result.model, "saq-payment-linear-v1");
  assert.equal(result.paymentOffer.detected, true);
  assert.ok(text.includes(result.paymentOffer.evidence));
  assert.ok(result.riskFactorHypotheses.some((item) => item.factor === "R2"));
  assert.equal(result.riskFactorHypotheses.some((item) => item.factor === "R1"), false);
});

test("offline model handles an unseen amount and ordinary showroom/no-payment negatives", async () => {
  const result = await analyzeAdvertisement({ text: "В ЖК Altai Residence для фиксации квартиры внесите депозит 2,75 млн ₸.", provider: "local-ml" });
  assert.equal(result.paymentOffer.amount, 2750000);
  for (const text of ["ЖК Orda Park приглашает на бесплатную экскурсию в шоурум.", "В ЖК Samal City действует бронь без депозита и без оплаты.", "Бесплатное бронирование квартиры."]) {
    assert.equal(analyzeWithLocalModel({ text }).paymentOffer.detected, false, text);
  }
});

test("model inference is deterministic and distinguishes unrelated bank deposits", () => {
  const text = "Банк предлагает накопительный депозит с новой ставкой.";
  assert.deepEqual(predictPaymentOffer(text), predictPaymentOffer(text));
  assert.equal(analyzeWithLocalModel({ text }).paymentOffer.detected, false);
});
