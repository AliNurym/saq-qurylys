import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../src/db.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { createHttpServer } from "../src/server.mjs";

process.env.AI_PROVIDER = "rule-based";

test("HTTP API serves assets, validates requests and completes the review workflow", async (t) => {
  const db = openDatabase(":memory:"); seedDemoData(db);
  const server = createHttpServer(db);
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = "http://127.0.0.1:" + server.address().port;
    const request = async (path, method = "GET", body) => {
      const response = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    };
    await t.test("HTML, styles and deep links are served", async () => {
      for (const path of ["/dashboard", "/complexes/cx-altai", "/styles.css", "/saq-theme.css", "/app.js"]) {
        const response = await fetch(base + path); assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("cache-control"), "no-cache"); await response.text();
      }
      const font = await fetch(base + "/fonts/InterVariable.woff2");
      assert.equal(font.status, 200);
      assert.equal(font.headers.get("content-type"), "font/woff2");
      assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString(), "wOF2");
      assert.equal((await request("/api/ads/missing")).status, 404);
    });
    await t.test("JSON type, malformed body, date and cross-site writes are rejected", async () => {
      assert.equal((await fetch(base + "/api/ads", { method: "POST", body: '{}' })).status, 415);
      assert.equal((await fetch(base + "/api/ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{bad' })).status, 400);
      assert.equal((await fetch(base + "/api/ads", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.invalid" }, body: '{}' })).status, 403);
      assert.equal((await request("/api/ads", "POST", { text: "Учебное объявление", publicationDate: "2026-02-30" })).status, 400);
    });
    await t.test("ad, factor, manual evidence, immutable signal and review audit", async () => {
      const created = await request("/api/ads", "POST", { platform: "Instagram", text: "ЖК Altai Residence. Внесите депозит 1,5 млн ₸." });
      assert.equal(created.status, 201); assert.equal(created.body.analysis.paymentOffer.amount, 1500000);
      const adId = created.body.id;
      const matched = await request("/api/ads/" + adId + "/match", "POST", { complexId: "cx-altai" });
      assert.equal(matched.status, 200); assert.equal(matched.body.risk.score, 0);
      const r2 = matched.body.createdFactors.find((factor) => factor.code === "R2");
      const reviewed = await request("/api/factors/" + r2.id + "/review", "POST", { status: "CONFIRMED", expectedStatus: "AI_HYPOTHESIS" });
      assert.equal(reviewed.status, 200); assert.equal(reviewed.body.risk.score, 25);
      assert.match(reviewed.body.factor.notes, /подтверждён/u);
      const signal = await request("/api/signals", "POST", { complexId: "cx-altai" });
      assert.equal(signal.status, 201); assert.equal(signal.body.scoreSnapshot, 25);
      const exportResponse = await fetch(base + "/api/signals/" + signal.body.id + "/export?download=1");
      assert.equal(exportResponse.status, 200);
      assert.match(exportResponse.headers.get("content-disposition"), /attachment/u);
      assert.ok((await exportResponse.text()).includes("1,5 млн ₸"));
      const previewResponse = await fetch(base + "/api/signals/" + signal.body.id + "/export");
      assert.match(previewResponse.headers.get("content-disposition"), /inline/u);
      assert.equal(previewResponse.status, 200);
      const manual = await request("/api/complexes/cx-altai/factors", "POST", { code: "R4", sourceLabel: "Учебное обращение", evidenceText: "Подтверждённое учебное коллективное обращение.", notes: "Источник проверен." });
      assert.equal(manual.status, 201); assert.equal(manual.body.risk.score, 40);
      const saved = await request("/api/signals/" + signal.body.id);
      assert.equal(saved.body.scoreSnapshot, 25); assert.equal(saved.body.currentRisk.score, 40);
      assert.deepEqual(saved.body.advertisements, signal.body.advertisements);
      assert.equal((await request("/api/signals/" + signal.body.id + "/status", "PATCH", { status: "NEEDS_REVIEW" })).status, 200);
      const confirmed = await request("/api/signals/" + signal.body.id + "/status", "PATCH", { status: "CONFIRMED", comment: "Учебная проверка выполнена." });
      assert.equal(confirmed.status, 200); assert.equal(confirmed.body.audit.length, 2);
      assert.equal((await request("/api/history?entity=SIGNAL")).body.items.some((item) => item.action === "SIGNAL_STATUS_CONFIRMED"), true);
      const filtered = await request("/api/ads?platform=Instagram&complexId=cx-altai");
      assert.ok(filtered.body.items.some((item) => item.id === adId));
      assert.ok(filtered.body.items.every((item) => item.platform === "Instagram" && (item.complexId === "cx-altai" || item.proposedComplexId === "cx-altai")));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve)); db.close();
  }
});
