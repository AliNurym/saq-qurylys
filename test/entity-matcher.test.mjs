import test from "node:test";
import assert from "node:assert/strict";
import { matchAdvertisement } from "../src/entity-matcher.mjs";

const complexes = [
  { id: "a", name: "Aspan Residence", city: "Алматы", address: "улица Демонстрационная, 17", developerName: "Aspan Development Demo LLP" },
  { id: "b", name: "Orda Park", city: "Астана", address: "проспект Учебный, 4", developerName: "Orda Construction Demo LLP" },
];

test("an explicit complex name yields the strongest suggested match", () => {
  const matches = matchAdvertisement({ text: "Продажа квартир в Aspan Residence" }, complexes);
  assert.equal(matches[0].complexId, "a");
  assert.equal(matches[0].score, 0.54);
  assert.equal(matches[0].confidenceLabel, "possible");
});

test("a name and known contacts produce a possible match requiring analyst review", () => {
  const matches = matchAdvertisement(
    { text: "Квартиры в новом доме", detectedComplexName: "Aspan Residence", phone: "+7 700 000 00 01", account: "@aspan_demo" },
    complexes,
    [
      { complexId: "a", type: "PHONE", value: "+7 700 000 00 01" },
      { complexId: "a", type: "ACCOUNT", value: "@aspan_demo" },
    ],
  );
  assert.equal(matches[0].complexId, "a");
  assert.equal(matches[0].score, 0.6);
  assert.equal(matches[0].confidenceLabel, "possible");
});

test("text without identifiable name, address, developer, or contact has no automatic match", () => {
  const matches = matchAdvertisement({ text: "Уютная квартира. Подробности по телефону." }, complexes);
  assert.deepEqual(matches, []);
});
