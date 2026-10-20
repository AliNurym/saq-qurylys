import test from "node:test";
import assert from "node:assert/strict";
import { renderPilotRoadmapSection } from "../public/pages-portfolio.js";

test("pilot roadmap presents TЗ phases as unverified plan, not completed results", () => {
  const html = renderPilotRoadmapSection();
  assert.match(html, /календарный план из ТЗ/u);
  assert.match(html, /Фактический ход пилота и результаты этапов в этой сборке не подтверждены/u);
  assert.equal((html.match(/Не подтверждено/gu) ?? []).length, 3);
  assert.match(html, /Критерий завершения/u);
  assert.doesNotMatch(html, /Завершено|В процессе \(Текущий\)|Выявлено 5 нарушений|Готовность к масштабированию на все 20 регионов/u);
});
