import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, closeDatabase } from "../src/db.mjs";
import { consultAiAssistant } from "../src/ai-assistant.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { renderAssistantPage } from "../public/assistant-ui.js";

test("AI Assistant: labels red-zone demo records as synthetic and avoids a legal verdict", async () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db, { pilot48: true });
    const result = await consultAiAssistant({
      query: "Законен ли ЖК Altai Grand Park?",
      lang: "ru",
      db,
    });

    assert.ok(result.answer, "Should return an answer");
    assert.ok(result.complex, "Should match the complex in database");
    assert.strictEqual(result.complex.name, "ЖК Altai Grand Park");
    assert.match(result.answer, /синтетическая демо-запись/u);
    assert.match(result.answer, /не устанавливает нарушение/u);
    assert.doesNotMatch(result.answer, /НЕ ИМЕЕТ ПРАВА|являются незаконными|воздержаться от сделок/u);
  } finally {
    closeDatabase(db);
  }
});

test("AI Assistant: consults in Kazakh language", async () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db, { pilot48: true });
    const result = await consultAiAssistant({
      query: "Altai Grand Park ТК үлестік қатысуға рұқсаты бар ма?",
      lang: "kz",
      db,
    });

    assert.ok(result.answer, "Should return an answer in Kazakh");
    assert.ok(result.complex, "Should match the complex");
    assert.strictEqual(result.complex.name, "ЖК Altai Grand Park");
    assert.ok(result.answer.includes("Заң") || result.answer.includes("рұқсат") || result.answer.includes("үлестік") || result.answer.includes("ҚР"), "Should contain Kazakh legal terms");
  } finally {
    closeDatabase(db);
  }
});

test("AI Assistant: green demo classification does not certify legal status", async () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db, { pilot48: true });
    const result = await consultAiAssistant({
      query: "ЖК Satpayev Elite законен?",
      lang: "ru",
      db,
    });
    assert.equal(result.complex.name, "ЖК Satpayev Elite");
    assert.match(result.answer, /синтетическая демо-запись/u);
    assert.match(result.answer, /не является гарантией законности/u);
    assert.doesNotMatch(result.answer, /строится в соответствии с законодательством|имеет законное право/u);
  } finally {
    closeDatabase(db);
  }
});

test("AI Assistant: general legal information avoids categorical claims about contract labels", async () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db, { pilot48: true });
    const result = await consultAiAssistant({
      query: "Какие способы организации долевого участия перечислены в законе?",
      lang: "ru",
      db,
    });
    assert.match(result.answer, /статья 7 Закона РК № 486-V/u);
    assert.match(result.answer, /не подключён к официальным реестрам/u);
    assert.doesNotMatch(result.answer, /договоры бронирования.*незаконны|образуют состав правонарушения/u);
  } finally {
    closeDatabase(db);
  }
});

test("AI Assistant: rejects empty query", async () => {
  const db = openDatabase(":memory:");
  try {
    await assert.rejects(
      async () => consultAiAssistant({ query: "   ", db }),
      /Запрос не может быть пустым/,
    );
  } finally {
    closeDatabase(db);
  }
});

test("AI assistant page discloses local demo scope and does not claim official real-time checks", () => {
  const html = renderAssistantPage({ ai: { mode: "Rule-based fallback" } });
  assert.match(html, /Демо-помощник по локальным данным/u);
  assert.match(html, /Госреестры не подключены/u);
  assert.match(html, /Демо-записи синтетические/u);
  assert.match(html, /Ответ не является официальным заключением/u);
  assert.doesNotMatch(html, /официальный цифровой советник|проверяю законность любого из 48|DeepSeek-V3 LLM/u);
});
