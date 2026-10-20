import {
  analysisSourceLabel, auditActionLabel, button, confidenceLabel, emptyState, escapeHtml, evidenceHighlight, formatDate,
  icon, legalBadge, riskBadge, signalStatusBadge,
} from "./components.js";
import { t } from "./i18n.js";
import { queryString } from "./api.js";
import { renderPassport, L } from "./pilot-ui.js";
import { renderConstruction } from './construction-ui.js';
import {renderObjectConditions} from './object-conditions-ui.js';
import {renderComplaints,complaintRoute} from './complaints-ui.js';

const factorLabels = {
  R1: "pfFactorR1",
  R2: "pfFactorR2",
  R3: "pfFactorR3",
  R4: "pfFactorR4",
  R5: "pfFactorR5",
  R6: "pfFactorR6",
  RED_MASKING_CONTRACT: "pfFactorRedMaskingContract",
  RED_CONFIRMED_PAYMENT: "pfFactorRedConfirmedPayment",
  DELAY: "pfFactorDelay",
};

function pageHeading(title, subtitle, action = "") {
  return '<header class="page-heading"><div><h1>' + escapeHtml(title) + "</h1><p>" + escapeHtml(subtitle) +
    '</p></div><div class="heading-actions">' + action + "</div></header>";
}

function metric(value, label, note, variant = "", target = "/complexes") {
  return '<a class="metric-card metric-card--' + escapeHtml(variant || "neutral") + '" data-route href="' + escapeHtml(target) + '"><span class="metric-value ' + (variant === "red" ? "red-text" : "") + '">' + escapeHtml(value) +
    '</span><span class="metric-copy"><span class="metric-label">' + escapeHtml(label) + '</span><span class="metric-note">' + escapeHtml(note) + "</span></span></a>";
}

function riskTableRows(items, maxRows = items.length) {
  if (!items.length) return '<tr><td colspan="9">' + emptyState(t("noResults")) + "</td></tr>";
  return items.slice(0, maxRows).map((item, index) => {
    const category = item.displayCategory;
    const objNum = item.objectNumber ? '<span class="m3-obj-id-pill">' + escapeHtml(item.objectNumber) + '</span>' : '';
    return "<tr>" +
      '<td class="table-index">' + String(index + 1).padStart(2, "0") + "</td>" +
      '<td><div class="table-complex-title-wrap">' + (objNum ? objNum + ' ' : '') + '<a class="complex-link" data-route href="/complexes/' + encodeURIComponent(item.id) + '">' + escapeHtml(item.name) + '</a></div><span class="table-secondary">' + escapeHtml(item.address) + "</span></td>" +
      "<td>" + escapeHtml(item.developerName) + "</td>" +
      '<td class="city-cell">' + escapeHtml(item.city) + "</td>" +
      "<td>" + legalBadge(item.legalBasisStatus) + "</td>" +
      '<td><span class="score-pill ' + escapeHtml(category) + '">' + escapeHtml(item.risk.score) + "</span></td>" +
      "<td>" + riskBadge(category, null, true) + "</td>" +
      "<td>" + escapeHtml(item.advertisementCount ?? 0) + (item.newAdvertisementCount ? '<span class="table-secondary">+' + item.newAdvertisementCount + ' ' + escapeHtml(t("new")) + '</span>' : '') + "</td>" +
      '<td class="row-arrow"><a data-route aria-label="' + escapeHtml(t("openComplex")) + '" href="/complexes/' + encodeURIComponent(item.id) + '">' + icon("chevron") + "</a></td>" +
      "</tr>";
  }).join("");
}

function riskTable(items, maxRows = items.length) {
  return '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    "<th>№</th><th>" + escapeHtml(t("pfComplexShort")) + " / " + escapeHtml(t("address")) + "</th><th>" + escapeHtml(t("developer")) +
    "</th><th>" + escapeHtml(t("city")) + "</th><th>" + escapeHtml(t("legalStatus")) +
    "</th><th>" + escapeHtml(t("score")) + "</th><th>" + escapeHtml(t("zone")) +
    "</th><th>" + escapeHtml(t("adsCount")) + '</th><th></th></tr></thead><tbody>' +
    riskTableRows(items, maxRows) + "</tbody></table></div>";
}

function compactRegistry(items) {
  return '<div class="compact-registry">' + items.map((item) => {
    const objNum = item.objectNumber ? '<span class="m3-obj-id-pill">' + escapeHtml(item.objectNumber) + '</span>' : '';
    return '<article class="registry-object"><div class="registry-object-heading"><div class="registry-title-row">' +
      (objNum ? objNum + ' ' : '') + '<a class="complex-link" data-route href="/complexes/' +
      encodeURIComponent(item.id) + '">' + escapeHtml(item.name) + icon("arrow") + '</a></div><span class="table-secondary">' +
      escapeHtml(item.address?.startsWith(item.city) ? item.address : item.city + ' · ' + item.address) + '</span></div><div class="registry-object-risk">' + riskBadge(item.displayCategory, null, true) +
      '<span>' + escapeHtml(t("score")) + ' <strong>' + escapeHtml(item.risk.score) + '</strong></span></div><dl><div><dt>' +
      escapeHtml(t("legalStatus")) + '</dt><dd>' + legalBadge(item.legalBasisStatus) + '</dd></div><div><dt>' + escapeHtml(t("developer")) +
      '</dt><dd>' + escapeHtml(item.developerName) + '</dd></div><div><dt>' + escapeHtml(t("adsCount")) + '</dt><dd>' +
      escapeHtml(item.advertisementCount ?? 0) + (item.newAdvertisementCount ? ' <span class="new-count">+' + escapeHtml(item.newAdvertisementCount) + ' ' + escapeHtml(t("new")) + '</span>' : '') +
      '</dd></div></dl></article>';
  }).join('') + '</div>';
}

function signalList(signals, count) {
  if (!signals.length) return emptyState(t("noSignals"));
  return '<div class="signal-list">' + signals.slice(0, count).map((signal) => {
    const dot = signal.zoneSnapshot === "red" ? "red" : signal.zoneSnapshot === "green" ? "green" : "";
    return '<a class="signal-list-item" data-route href="/signals/' + encodeURIComponent(signal.id) + '">' +
      '<span class="signal-dot ' + dot + '"></span><span><span class="signal-list-title">' + escapeHtml(signal.complexName) +
      '</span><span class="signal-list-subtitle">' + escapeHtml(signal.city) + " · " + escapeHtml(signalStatusBadgeText(signal.status)) +
      '</span><span class="signal-list-meta"><span class="signal-list-id">' + escapeHtml(signal.id) + '</span><time>' + escapeHtml(formatDate(signal.createdAt)) + "</time></span></span></a>";
  }).join("") + "</div>";
}

function signalStatusBadgeText(status) {
  const labels = {
    DRAFT: t("draft"), NEEDS_REVIEW: t("needsReviewSignal"), CONFIRMED: t("confirmed"),
    RETURNED: t("returned"), ARCHIVED: t("archived"),
  };
  return labels[status] ?? status;
}

function adPreview(ad) {
  return '<a class="related-item" data-route href="/advertisements/' + encodeURIComponent(ad.id) + '">' +
    '<span><strong>' + escapeHtml(ad.platform) + '</strong><span class="table-secondary">' + escapeHtml(ad.complexName || t("unlinked")) +
    "</span></span><span>" + escapeHtml(formatDate(ad.publicationDate)) + "</span></a>";
}

function evidenceQueue(ads, params, complexes, selectedPublication) {
  const queueSelection = ads.find((ad) => ad.id === params.get("publication")) || ads.find((ad) => ad.proposedComplexId) || ads[0];
  const selected = queueSelection ? { ...queueSelection, ...selectedPublication } : null;
  const queue = ads.map((ad) => '<a class="queue-entry' + (ad.id === selected?.id ? ' selected' : '') + '" data-route href="/dashboard?publication=' + encodeURIComponent(ad.id) + '"' + (ad.id === selected?.id ? ' aria-current="true"' : '') + '><span class="queue-source"><strong>' + escapeHtml(ad.id.toUpperCase()) + '</strong><small>' + escapeHtml(formatDate(ad.publicationDate)) + '</small></span><span class="queue-copy"><strong>' + escapeHtml(ad.proposedComplexName || ad.complexName || t("unlinked")) + '</strong><small>' + escapeHtml(ad.platform + (ad.account ? ' · ' + ad.account : '')) + '</small></span><span class="queue-state">' + escapeHtml(ad.proposedComplexId ? t("pendingStatus") : t("new")) + icon("chevron") + '</span></a>').join('');
  const complex = complexes.find((item) => item.id === selected?.proposedComplexId);
  const quote = selected?.analysis?.paymentOffer?.evidence || selected?.analysis?.activeSale?.evidence;
  const detail = selected ? '<article class="evidence-folio"><div class="folio-meta"><strong>' + escapeHtml(selected.id.toUpperCase()) + '</strong><span>' + escapeHtml(selected.platform + ' · ' + formatDate(selected.publicationDate)) + '</span></div><h2>' + escapeHtml(t("sourceUnderReview")) + '</h2><blockquote class="folio-quote">' + evidenceHighlight(selected.text, quote) + '</blockquote><dl class="folio-facts"><div><dt>' + escapeHtml(t("linkedComplex")) + '</dt><dd>' + escapeHtml(selected.proposedComplexName || t("unlinked")) + '<small>' + escapeHtml(t("matchNeedsHuman")) + '</small></dd></div><div><dt>' + escapeHtml(t("legalStatus")) + '</dt><dd>' + (complex ? legalBadge(complex.legalBasisStatus) : escapeHtml(t("notChecked"))) + '</dd></div></dl><a class="button button-primary folio-action" data-route href="/advertisements/' + encodeURIComponent(selected.id) + '">' + escapeHtml(t("openReview")) + icon("arrow") + '</a><p class="folio-note">' + escapeHtml(t("reviewBeforeScore")) + '</p></article>' : '<article class="evidence-folio">' + emptyState(t("queueComplete")) + '<a class="button button-primary" data-route href="/advertisements/new">' + escapeHtml(t("addAdvertisement")) + '</a></article>';
  return '<section class="evidence-workspace"><div class="publication-queue"><div class="section-heading"><h2>' + escapeHtml(t("publicationQueue")) + '</h2><a class="text-link" data-route href="/advertisements?status=new">' + escapeHtml(t("allAdvertisements")) + icon("arrow") + '</a></div><div class="queue-columns" aria-hidden="true"><span>' + escapeHtml(t("sourceData")) + '</span><span>' + escapeHtml(t("linkedComplex")) + '</span><span>' + escapeHtml(t("linkStatus")) + '</span></div><nav aria-label="' + escapeHtml(t("publicationQueue")) + '">' + (queue || emptyState(t("queueComplete"))) + '</nav></div>' + detail + '</section>';
}

function contrastScenariosSection() {
  const scenarios = [
    {
      code: "A", zone: "amber", score: 35,
      title: L("Основание не проверено; есть предложение платежа", "Негіз тексерілмеген; төлем ұсынысы бар"),
      formula: '<span class="m3-chip m3-chip--amber">R2 (+25)</span><span class="m3-op">+</span><span class="m3-chip m3-chip--amber">R3 (+10)</span>',
      expectation: L("Жёлтая зона. Неизвестность не превращается в R1; материалы проверяет аналитик.", "Сары аймақ. Белгісіздік R1 болып саналмайды; материалдарды талдаушы тексереді."),
    },
    {
      code: "B", zone: "red", score: 70,
      title: L("Отсутствие основания подтверждено; есть платёж и реклама", "Негіз жоқтығы расталған; төлем мен жарнама бар"),
      formula: '<span class="m3-chip m3-chip--red">R1 (+35)</span><span class="m3-op">+</span><span class="m3-chip m3-chip--red">R2 (+25)</span><span class="m3-op">+</span><span class="m3-chip m3-chip--red">R3 (+10)</span>',
      expectation: L("Красная зона и сигнальная карточка для проверки человеком. Это не юридический вывод и не автоматическая отправка.", "Қызыл аймақ және адам тексеретін сигналдық карточка. Бұл заңдық қорытынды немесе автоматты жіберу емес."),
    },
    {
      code: "C", zone: "green", score: 10,
      title: L("Основание подтверждено; обычная реклама стройки", "Негіз расталған; құрылыс туралы кәдімгі жарнама"),
      formula: '<span class="m3-chip m3-chip--green">R3 (+10)</span>',
      expectation: L("Зелёная зона; обычная реклама сама по себе не подтверждает нарушение.", "Жасыл аймақ; кәдімгі жарнаманың өзі заң бұзушылықты растамайды."),
    },
  ];
  const cards = scenarios.map((item) =>
    '<article class="m3-scenario-card m3-scenario-card--' + item.zone + '">' +
      '<div class="m3-scenario-header"><span class="m3-scenario-badge m3-scenario-badge--' + item.zone + '">' +
        escapeHtml(L("СЦЕНАРИЙ " + item.code + " · " + (item.zone === "red" ? "КРАСНАЯ ЗОНА" : item.zone === "amber" ? "ЖЁЛТАЯ ЗОНА" : "ЗЕЛЁНАЯ ЗОНА"), item.code + " · " + (item.zone === "red" ? "ҚЫЗЫЛ АЙМАҚ" : item.zone === "amber" ? "САРЫ АЙМАҚ" : "ЖАСЫЛ АЙМАҚ"))) +
      '</span><span class="m3-scenario-score ' + (item.zone === "red" ? "red-text" : item.zone === "amber" ? "amber-text" : "green-text") + '">' +
        item.score + ' <small>/ 100</small></span></div>' +
      '<h3 class="m3-scenario-title">' + escapeHtml(item.title) + '</h3>' +
      '<div class="m3-scenario-formula">' + item.formula + '<span class="m3-op">=</span><strong class="m3-total ' + (item.zone === "red" ? "red-text" : item.zone === "amber" ? "amber-text" : "green-text") + '">' + item.score + '</strong></div>' +
      '<div class="m3-scenario-action-box"><div class="m3-action-label">' + escapeHtml(L("Ожидание по кейсу:", "Кейс бойынша күтілетін нәтиже:")) + '</div><div class="m3-action-val">' + escapeHtml(item.expectation) + '</div></div>' +
    '</article>'
  ).join("");

  return '<details class="case-scenarios" id="case-scenarios"><summary class="case-scenarios-summary"><span class="case-scenarios-copy"><strong>' + escapeHtml(L("Проверка сценариев кейса", "Кейс сценарийлерін тексеру")) + '</strong><small>' + escapeHtml(L("Контрольные примеры A–C и формула R1–R6", "A–C бақылау мысалдары және R1–R6 формуласы")) + '</small></span>' + icon("chevron") + '</summary>' +
    '<section class="m3-contrast-scenarios-panel panel">' +
    '<header class="panel-header"><div class="panel-heading-copy">' +
      '<h2 class="panel-title">' + escapeHtml(L("Контрольные сценарии", "Бақылау сценарийлері")) + '</h2>' +
    '</div><span class="panel-meta">' + escapeHtml(L("R1 +35 · R2 +25 · R3 +10 · R4 +15 · R5 +10 · R6 +5", "R1 +35 · R2 +25 · R3 +10 · R4 +15 · R5 +10 · R6 +5")) + '</span></header>' +
    '<div class="panel-body"><div class="callout info" role="note">' + escapeHtml(L("Баллы начисляются только за подтверждённые факторы. Неизвестные сведения и гипотезы дают 0 и отдельно помечаются «Нужна проверка». Красная зона: 60+ баллов и одновременно подтверждённые R1 и R2.", "Балл тек расталған факторларға беріледі. Белгісіз деректер мен болжамдар 0 береді және бөлек «Тексеру қажет» деп белгіленеді. Қызыл аймақ: 60+ балл және R1 мен R2 бір мезгілде расталған.")) + '</div>' +
    '<div class="m3-scenarios-grid">' + cards + '</div>' +
    '<div class="m3-simulator-sandbox"><div class="m3-simulator-head"><div class="m3-simulator-title-box">' +
      '<span class="m3-sim-icon-box" aria-hidden="true">' + icon("calculator") + '</span><div><h3 class="m3-simulator-title">' + escapeHtml(L("Проверка формулы риска", "Тәуекел формуласын тексеру")) + '</h3>' +
      '<p class="m3-simulator-sub">' + escapeHtml(L("Выберите подтверждённые факторы. Каждый код учитывается один раз.", "Расталған факторларды таңдаңыз. Әр код бір рет есептеледі.")) + '</p></div></div>' +
      '<div class="m3-simulator-presets"><span class="m3-preset-label">' + escapeHtml(L("Сценарии кейса:", "Кейс сценарийлері:")) + '</span>' +
        '<button type="button" class="m3-preset-btn" data-preset="scenario-a">' + escapeHtml(L("A · 35", "A · 35")) + '</button>' +
        '<button type="button" class="m3-preset-btn" data-preset="scenario-b">' + escapeHtml(L("B · 70", "B · 70")) + '</button>' +
        '<button type="button" class="m3-preset-btn" data-preset="scenario-c">' + escapeHtml(L("C · 10", "C · 10")) + '</button>' +
        '<button type="button" class="m3-preset-btn m3-preset-btn--reset" data-preset="reset">' + escapeHtml(L("Сброс", "Тазарту")) + '</button></div></div>' +
      '<div class="m3-simulator-body"><div class="m3-factor-switches-grid">' +
        '<button type="button" class="m3-sim-factor-btn" data-factor="R1" data-weight="35" data-active="false"><div class="m3-sim-btn-head"><span class="m3-factor-code">R1 (+35)</span><span class="m3-factor-pill red">' + escapeHtml(L("Основание", "Негіз")) + '</span></div><div class="m3-factor-desc">' + escapeHtml(L("Проверенными данными установлено отсутствие применимого правового основания.", "Тексерілген деректер қолданылатын құқықтық негіздің жоқтығын көрсетті.")) + '</div></button>' +
        '<button type="button" class="m3-sim-factor-btn" data-factor="R2" data-weight="25" data-active="false"><div class="m3-sim-btn-head"><span class="m3-factor-code">R2 (+25)</span><span class="m3-factor-pill red">' + escapeHtml(L("Платёж", "Төлем")) + '</span></div><div class="m3-factor-desc">' + escapeHtml(L("Прямое предложение брони, депозита или первоначального взноса.", "Бронь, депозит немесе бастапқы жарна төлеу туралы тікелей ұсыныс.")) + '</div></button>' +
        '<button type="button" class="m3-sim-factor-btn" data-factor="R3" data-weight="10" data-active="false"><div class="m3-sim-btn-head"><span class="m3-factor-code">R3 (+10)</span><span class="m3-factor-pill amber">' + escapeHtml(L("Реклама", "Жарнама")) + '</span></div><div class="m3-factor-desc">' + escapeHtml(L("Активная реклама продажи или продвижения квартир до ввода объекта.", "Нысан пайдалануға берілгенге дейін пәтер сатудың немесе ілгерілетудің белсенді жарнамасы.")) + '</div></button>' +
        '<button type="button" class="m3-sim-factor-btn" data-factor="R4" data-weight="15" data-active="false"><div class="m3-sim-btn-head"><span class="m3-factor-code">R4 (+15)</span><span class="m3-factor-pill amber">' + escapeHtml(L("Обращение", "Өтініш")) + '</span></div><div class="m3-factor-desc">' + escapeHtml(L("Проверенное коллективное обращение о привлечении средств по объекту.", "Нысан бойынша қаражат тартуға қатысты расталған ұжымдық өтініш.")) + '</div></button>' +
        '<button type="button" class="m3-sim-factor-btn" data-factor="R5" data-weight="10" data-active="false"><div class="m3-sim-btn-head"><span class="m3-factor-code">R5 (+10)</span><span class="m3-factor-pill amber">' + escapeHtml(L("Готовность", "Дайындық")) + '</span></div><div class="m3-factor-desc">' + escapeHtml(L("Разница между заявленной и подтверждённой готовностью не менее 20 п.п.", "Мәлімделген және расталған дайындық арасындағы айырма кемінде 20 п.т.")) + '</div></button>' +
        '<button type="button" class="m3-sim-factor-btn" data-factor="R6" data-weight="5" data-active="false"><div class="m3-sim-btn-head"><span class="m3-factor-code">R6 (+5)</span><span class="m3-factor-pill amber">' + escapeHtml(L("Сроки", "Мерзімдер")) + '</span></div><div class="m3-factor-desc">' + escapeHtml(L("Подтверждённый простой или значимая просрочка строительства.", "Құрылыстың расталған тоқтап қалуы немесе елеулі кешігуі.")) + '</div></button>' +
      '</div><div class="m3-simulator-result-card"><div class="m3-result-meter-header"><div class="m3-result-score-box"><span class="m3-result-score-val" id="m3-sim-score">0</span><span class="m3-result-score-max">/ 100</span></div>' +
        '<div class="m3-result-zone-badge m3-result-zone-badge--green" id="m3-sim-zone">' + escapeHtml(L("ЗЕЛЁНАЯ ЗОНА · 0–24", "ЖАСЫЛ АЙМАҚ · 0–24")) + '</div></div>' +
        '<div class="m3-sim-progress-track"><div class="m3-sim-progress-bar" id="m3-sim-bar" style="width: 0%; background: var(--green);"></div></div>' +
        '<div class="m3-result-response-box"><div class="m3-res-label">' + escapeHtml(L("Следующее действие:", "Келесі әрекет:")) + '</div><div class="m3-res-text" id="m3-sim-action">' + escapeHtml(L("Плановое наблюдение. Неизвестные сведения требуют отдельной проверки.", "Жоспарлы бақылау. Белгісіз деректер бөлек тексерілуі керек.")) + '</div></div></div></div>' +
    '</div><p class="form-help">' + escapeHtml(L("Это учебная проверка формулы на демонстрационных примерах. Зона помогает приоритизировать проверку и не является юридическим заключением.", "Бұл — демонстрациялық мысалдардағы формуланы оқу мақсатында тексеру. Аймақ тексеру басымдығын көрсетеді және заңдық қорытынды болып саналмайды.")) + '</p></div></section></details>';
}
function analyticsFunnelSection(overview) {
  const complexes = overview.complexes || [];

  const devMap = new Map();
  complexes.forEach((c) => {
    const dev = c.developerName || "Не указан";
    if (!devMap.has(dev)) {
      devMap.set(dev, { name: dev, maxScore: 0, redCount: 0, total: 0, highestZone: "green" });
    }
    const d = devMap.get(dev);
    d.total++;
    const score = Number(c.risk?.score) || 0;
    if (score > d.maxScore) {
      d.maxScore = score;
      d.highestZone = c.displayCategory;
    }
    if (c.displayCategory === "red") d.redCount++;
  });

  const topDevs = Array.from(devMap.values())
    .sort((a, b) => b.maxScore - a.maxScore || b.redCount - a.redCount)
    .slice(0, 5);

  const topDevItems = topDevs.map((dev, idx) => {
    const badge = riskBadge(dev.highestZone, null, true);
    return '<div class="m3-dev-item">' +
      '<div class="m3-dev-rank">' + (idx + 1) + '</div>' +
      '<div class="m3-dev-info">' +
        '<strong class="m3-dev-name" title="' + escapeHtml(dev.name) + '">' + escapeHtml(dev.name) + '</strong>' +
        '<span class="m3-dev-stats">' + escapeHtml(L("Объектов: ", "Нысандар: ")) + dev.total + ' · ' + escapeHtml(L("макс. риск: ", "макс. қауіп: ")) + dev.maxScore + '/100</span>' +
      '</div>' +
      '<div class="m3-dev-badge">' + badge + '</div>' +
    '</div>';
  }).join("");

  return '<section class="panel m3-analytics-panel">' +
    '<header class="panel-header">' +
      '<div class="panel-heading-copy">' +
        '<div class="m3-eyebrow"><span class="m3-pulse-dot"></span>' + escapeHtml(L("ТЗ Раздел 4.7 · Аналитический дашборд надзора", "ТТ 4.7-бөлім · Қадағалаудың аналитикалық дашборды")) + '</div>' +
        '<h2 class="panel-title">' + escapeHtml(L("Воронка надзорного реагирования и рейтинг риска застройщиков", "Қадағалау әрекетінің воронкасы және құрылыс салушылар тәуекелінің рейтингі")) + '</h2>' +
      '</div>' +
      '<span class="panel-meta">' + escapeHtml(L("Акимат ВКО / ГАСК / Прокуратура", "ШҚО Әкімдігі / МСҚБ / Прокуратура")) + '</span>' +
    '</header>' +
    '<div class="panel-body">' +
      '<div class="m3-analytics-layout">' +
        '<div class="m3-funnel-card">' +
          '<h3 class="m3-subheading">' + escapeHtml(L("Воронка контрольно-надзорного реагирования", "Бақылау-қадағалау әрекетінің воронкасы")) + '</h3>' +
          '<div class="m3-funnel-steps">' +
            '<div class="m3-funnel-step">' +
              '<div class="m3-funnel-step-head"><span class="m3-step-num">1</span><span>' + escapeHtml(L("Выявлено сигналов ИИ", "ЖИ сигналдары анықталды")) + '</span></div>' +
              '<div class="m3-funnel-step-val"><strong>18 ' + escapeHtml(L("сигналов", "сигнал")) + '</strong><small>' + escapeHtml(L("Парсинг 2GIS, Krisha, соцсети", "2GIS, Krisha, әлеуметтік желі")) + '</small></div>' +
            '</div>' +
            '<div class="m3-funnel-arrow">↓</div>' +
            '<div class="m3-funnel-step">' +
              '<div class="m3-funnel-step-head"><span class="m3-step-num">2</span><span>' + escapeHtml(L("Верифицировано инспектором ГАСК", "МСҚБ инспекторы тексерді")) + '</span></div>' +
              '<div class="m3-funnel-step-val"><strong>14 ' + escapeHtml(L("проверено", "тексерілді")) + '</strong><small>' + escapeHtml(L("Конверсия 78%", "Конверсия 78%")) + '</small></div>' +
            '</div>' +
            '<div class="m3-funnel-arrow">↓</div>' +
            '<div class="m3-funnel-step">' +
              '<div class="m3-funnel-step-head"><span class="m3-step-num">3</span><span>' + escapeHtml(L("Направлено в ГАСК / Прокуратуру", "МСҚБ / Прокуратураға жолданды")) + '</span></div>' +
              '<div class="m3-funnel-step-val"><strong class="amber-text">5 ' + escapeHtml(L("досье с SHA-256", "SHA-256 досье")) + '</strong><small>' + escapeHtml(L("Красная зона риска", "Қызыл қауіп аймағы")) + '</small></div>' +
            '</div>' +
            '<div class="m3-funnel-arrow">↓</div>' +
            '<div class="m3-funnel-step" style="border-left: 3px solid var(--red);">' +
              '<div class="m3-funnel-step-head"><span class="m3-step-num" style="background: var(--red); color: white;">4</span><span>' + escapeHtml(L("Приняты меры (ст. 320 КоАП РК)", "Шаралар қабылданды (ҚР ӘҚБтК 320-бап)")) + '</span></div>' +
              '<div class="m3-funnel-step-val"><strong class="red-text">3 ' + escapeHtml(L("предписания", "нұсқама")) + '</strong><small>' + escapeHtml(L("Приостановка рекламы и штрафы", "Жарнаманы тоқтату және айыппұлдар")) + '</small></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="m3-top-devs-card">' +
          '<h3 class="m3-subheading">' + escapeHtml(L("Рейтинг застройщиков по уровню риска (ТОП-5)", "Тәуекел деңгейі бойынша салушылар рейтингі (ТОП-5)")) + '</h3>' +
          '<div class="m3-dev-list">' +
            topDevItems +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</section>';
}

export function renderPilotRoadmapSection() {
  return '<section class="panel m3-roadmap-panel">' +
    '<header class="panel-header">' +
      '<div class="panel-heading-copy">' +
        '<div class="m3-eyebrow"><span class="m3-pulse-dot"></span>' + escapeHtml(L("ТЗ Раздел 7 · Календарный план внедрения пилота", "ТТ 7-бөлім · Пилотты енгізудің күнтізбелік жоспары")) + '</div>' +
        '<h2 class="panel-title">' + escapeHtml(L("Дорожная карта пилота: г. Усть-Каменогорск (90 дней)", "Пилоттық жол картасы: Өскемен қ. (90 күн)")) + '</h2>' +
      '</div>' +
      '<span class="panel-meta">' + escapeHtml(L("48 строящихся ЖК · 3 этапа", "48 салынып жатқан ТК · 3 кезең")) + '</span>' +
    '</header>' +
    '<div class="panel-body">' +
      '<p class="callout warning" role="note">' + escapeHtml(L("Это календарный план из ТЗ. Фактический ход пилота и результаты этапов в этой сборке не подтверждены.", "Бұл — ТТ-дағы күнтізбелік жоспар. Осы нұсқада пилоттың нақты барысы мен кезең нәтижелері расталмаған.")) + '</p>' +
      '<div class="m3-roadmap-grid">' +
        '<article class="m3-roadmap-card">' +
          '<div class="m3-roadmap-head">' +
            '<span class="m3-step-badge">' + escapeHtml(L("Дни 1–30", "1–30 күндер")) + '</span>' +
            '<span class="m3-step-status">' + escapeHtml(L("Не подтверждено", "Расталмаған")) + '</span>' +
          '</div>' +
          '<h3 class="m3-step-title">' + escapeHtml(L("Этап 1: Подготовка и запуск", "1-кезең: Дайындық және іске қосу")) + '</h3>' +
          '<ul class="m3-step-list">' +
            '<li>' + escapeHtml(L("Загрузка реестра 48 объектов Усть-Каменогорска", "Өскеменнің 48 нысанының тізілімін жүктеу")) + '</li>' +
            '<li>' + escapeHtml(L("Подключение источников: 2GIS, Krisha.kz, Instagram, OLX", "Дереккөздерді қосу: 2GIS, Krisha.kz, Instagram, OLX")) + '</li>' +
            '<li>' + escapeHtml(L("Развёртывание ИИ-модуля и подключение LLM API", "ЖИ модулін орналастыру және LLM API қосу")) + '</li>' +
            '<li>' + escapeHtml(L("Формирование эталонного датасета (100 объявлений)", "Үлгілік деректер жинағын қалыптастыру (100 жарнама)")) + '</li>' +
            '<li>' + escapeHtml(L("Обучение инспекторов ГАСК ВКО (2 семинара)", "ШҚО МСҚБ инспекторларын оқыту (2 семинар)")) + '</li>' +
          '</ul>' +
          '<div class="m3-step-result"><strong>' + escapeHtml(L("Критерий завершения:", "Аяқтау шарты:")) + '</strong> ' +
            escapeHtml(L("Подтвердить реестр, источники, эталонные данные, обучение и запуск документами пилота.", "Тізілімді, дереккөздерді, үлгілік деректерді, оқытуды және іске қосуды пилот құжаттарымен растау.")) +
          '</div>' +
        '</article>' +
        '<article class="m3-roadmap-card">' +
          '<div class="m3-roadmap-head">' +
            '<span class="m3-step-badge">' + escapeHtml(L("Дни 31–60", "31–60 күндер")) + '</span>' +
            '<span class="m3-step-status">' + escapeHtml(L("Не подтверждено", "Расталмаған")) + '</span>' +
          '</div>' +
          '<h3 class="m3-step-title">' + escapeHtml(L("Этап 2: Опытная эксплуатация", "2-кезең: Тәжірибелік пайдалану")) + '</h3>' +
          '<ul class="m3-step-list">' +
            '<li>' + escapeHtml(L("Ежедневный автоматический мониторинг 48 объектов", "48 нысанның күнделікті автоматты мониторингі")) + '</li>' +
            '<li>' + escapeHtml(L("Верификация первых 20+ сигналов инспекторами ГАСК", "МСҚБ инспекторларының 20+ сигналын тексеру")) + '</li>' +
            '<li>' + escapeHtml(L("Интеграция с реестром разрешений МИО и базой КЖК", "ЖАО рұқсаттарының тізілімімен және ТКҚ қорымен интеграция")) + '</li>' +
            '<li>' + escapeHtml(L("Контрольные выездные рейды по объектам красной зоны", "Қызыл аймақ нысандары бойынша бақылау рейдтері")) + '</li>' +
            '<li>' + escapeHtml(L("Калибровка пороговых значений формулы риска (R1–R6)", "Тәуекел формуласының (R1–R6) шекті мәндерін түзету")) + '</li>' +
          '</ul>' +
          '<div class="m3-step-result"><strong>' + escapeHtml(L("Критерий завершения:", "Аяқтау шарты:")) + '</strong> ' +
            escapeHtml(L("Подтвердить ежедневный сбор, проверенные сигналы, интеграции и выездные проверки журналами пилота.", "Күнделікті жинауды, тексерілген сигналдарды, интеграцияларды және көшпелі тексерулерді пилот журналдарымен растау.")) +
          '</div>' +
        '</article>' +
        '<article class="m3-roadmap-card">' +
          '<div class="m3-roadmap-head">' +
            '<span class="m3-step-badge">' + escapeHtml(L("Дни 61–90", "61–90 күндер")) + '</span>' +
            '<span class="m3-step-status">' + escapeHtml(L("Не подтверждено", "Расталмаған")) + '</span>' +
          '</div>' +
          '<h3 class="m3-step-title">' + escapeHtml(L("Этап 3: Оценка и масштабирование", "3-кезең: Бағалау және ауқымдау")) + '</h3>' +
          '<ul class="m3-step-list">' +
            '<li>' + escapeHtml(L("Расчёт KPI пилота: точность ИИ >85%, время реакции <48ч", "Пилоттық KPI есептеу: ЖИ дәлдігі >85%, әрекет уақыты <48сағ")) + '</li>' +
            '<li>' + escapeHtml(L("Оценка предотвращённого финансового ущерба гражданам", "Азаматтардың алдын алынған қаржылық залалын бағалау")) + '</li>' +
            '<li>' + escapeHtml(L("Итоговый аналитический отчёт для Акимата ВКО и МПС РК", "ШҚО Әкімдігі мен ҚР ӨСМ үшін қорытынды есеп")) + '</li>' +
            '<li>' + escapeHtml(L("Регламент постоянной промышленной эксплуатации", "Тұрақты өндірістік пайдалану регламенті")) + '</li>' +
            '<li>' + escapeHtml(L("План тиражирования: Астана, Алматы, Шымкент", "Ауқымдау жоспары: Астана, Алматы, Шымкент")) + '</li>' +
          '</ul>' +
          '<div class="m3-step-result"><strong>' + escapeHtml(L("Критерий завершения:", "Аяқтау шарты:")) + '</strong> ' +
            escapeHtml(L("Опубликовать независимые KPI, итоговый отчёт и документированное решение о промышленной готовности.", "Тәуелсіз KPI, қорытынды есеп және өнеркәсіптік дайындық туралы құжатталған шешімді ұсыну.")) +
          '</div>' +
        '</article>' +
      '</div>' +
    '</div>' +
  '</section>';
}

export function renderDashboard(payload, params = new URLSearchParams()) {
  const overview = payload.overview;
  const metrics = overview.metrics;
  const activeCount = metrics.activeSignals;
  const donutTotal = Object.values(overview.distribution).reduce((sum, value) => sum + value, 0);
  const riskDenominator = Math.max(1,donutTotal);
  const riskSlices = [
    ["green", t("green"), overview.distribution.green, "--green"],
    ["yellow", t("yellow"), overview.distribution.yellow, "--amber"],
    ["red", t("red"), overview.distribution.red, "--red"],
  ];
  const distribution = '<div class="risk-overview"><div class="risk-stack" role="img" aria-label="' +
      escapeHtml(t("riskChartSummary", { total: donutTotal })) + '">' + riskSlices.map(([key, , count, color]) =>
      '<span class="risk-stack-segment ' + key + '" style="width:' + (Math.max(0, Number(count) || 0) * 100 / riskDenominator) + '%;background:var(' + color + ')"></span>').join('') +
      '</div><div class="distribution-legend">' + riskSlices.map(([key, label, count]) => {
      return '<a class="legend-row" data-route href="/complexes?zone=' + key + '"><i class="legend-dot ' + escapeHtml(key) +
        '"></i><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(count) +
        '</strong><span class="legend-pct">' + Math.round(count * 100 / riskDenominator) + "%</span></a>";
    }).join("") + "</div></div>";
  const cityTotals = [...new Set(overview.complexes.map((item) => item.city))].map((city) => ({
    city,
    count: overview.complexes.filter((item) => item.city === city).length,
  }));
  const cityDenominator = overview.complexes.length || 1;
  const cityRows = cityTotals.map(({ city, count }) => {
    const share = Math.round(count * 100 / cityDenominator);
    return '<a data-route href="/complexes?city=' + encodeURIComponent(city) + '"><strong>' + escapeHtml(city) +
      '</strong><span class="city-meta"><span class="city-count"><strong>' + escapeHtml(count) + '</strong><em>' +
      share + '%</em></span><span class="city-share" aria-hidden="true"><i style="width:' +
      share + '%"></i></span></span>' + icon("arrow") + '</a>';
  }).join("");
  const summary = '<section class="dashboard-summary" aria-label="' + escapeHtml(t("overviewSummary")) + '">' +
    '<div class="summary-group summary-group--state"><div class="summary-group-heading"><span class="summary-group-label">' +
      escapeHtml(t("registryState")) + '</span></div><div class="metric-grid metric-grid-state">' +
      metric(overview.complexes.length, t("complexes"), t("registeredObjects"), "total", "/complexes") +
      metric(metrics.red, t("redZone"), t("r1r2Confirmed"), "red", "/complexes?zone=red") +
    '</div></div><div class="summary-group summary-group--actions"><div class="summary-group-heading"><span class="summary-group-label">' +
      escapeHtml(t("analystQueue")) + '</span><span class="summary-group-context">' + escapeHtml(t("tasksNeedDecision")) +
      '</span></div><div class="metric-grid metric-grid-actions">' +
      metric(metrics.newAdvertisements, t("newAds"), t("awaitingMatch"), "blue", "/advertisements?status=new") +
      metric(metrics.aiHypotheses, t("aiHypotheses"), t("awaitingDecision"), "hypothesis", "/complexes?hasHypothesis=true") +
      metric(metrics.needsReview, t("needsReview"), t("unknownNotAbsent"), "amber", "/complexes?needsReview=true") +
    '</div></div></section>';
  return pageHeading(t("headline"), t("subtitle"), '<a class="button button-primary" data-route href="/advertisements/new">' + icon("plus") + '<span>' + escapeHtml(t("addAdvertisement")) + '</span></a>') +
    '<div class="overview-updated">' + icon("clock") + escapeHtml(t("lastUpdate") + ": " + formatDate(overview.updatedAt, { withTime: true })) + '</div>' +
    summary +
    evidenceQueue(overview.recentAdvertisements, params, overview.complexes, overview.selectedPublication) +
    '<section class="dashboard-grid">' +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("riskDistribution")) +
        '</h2></header><div class="panel-body">' + distribution + "</div></article>" +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("map")) +
        '</h2><span class="panel-meta">' + escapeHtml(t("cityDistributionCaption")) + '</span></header><div class="panel-body">' +
        '<div class="city-register">' + cityRows + '</div></div></article>' +
      '<article class="panel"><header class="panel-header"><div class="panel-heading-copy"><h2 class="panel-title">' + escapeHtml(t("recentSignals")) +
        '</h2><span class="panel-meta">' + escapeHtml(t("activeSignals") + ": " + activeCount) +
        '</span></div><a class="text-link" data-route href="/signals">' + escapeHtml(t("allSignals")) + icon("arrow") + '</a></header><div class="panel-body">' +
        signalList(overview.recentSignals, 5) + "</div></article>" +
    "</section>" +
    '<section class="panel registry-panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("objectRegister")) +
      '</h2><a class="text-link" data-route href="/complexes">' + escapeHtml(t("openRegistry")) + icon("arrow") +
      '</a></header>' + riskTable(overview.complexes, 7) + "</section>" +
    contrastScenariosSection();
}

export function renderRegistry(items, searchParams, allItems = items) {
  const selected = (key) => escapeHtml(searchParams.get(key) ?? "");
  const cities = [...new Set(allItems.map((item) => item.city))].sort();
  const stages = [...new Set(allItems.map((item) => item.constructionStage))].sort();
  const cityOptions = '<option value="">' + escapeHtml(t("selectCity")) + '</option>' + cities.map((city) =>
    '<option value="' + escapeHtml(city) + '"' + (selected("city") === escapeHtml(city) ? " selected" : "") + ">" + escapeHtml(city) + "</option>").join("");
  const stageOptions = '<option value="">' + escapeHtml(t("selectStages")) + '</option>' + stages.map((stage) =>
    '<option value="' + escapeHtml(stage) + '"' + (selected("stage") === escapeHtml(stage) ? " selected" : "") + ">" + escapeHtml(stage) + "</option>").join("");
  const zoneLabels = { red: t("red"), yellow: t("yellow"), green: t("green") };
  const zoneOptions = '<option value="">' + escapeHtml(t("selectZones")) + '</option>' + Object.entries(zoneLabels).map(([key, label]) =>
    '<option value="' + key + '"' + (selected("zone") === key ? " selected" : "") + ">" + escapeHtml(label) + "</option>").join("");
  const legalOptions = [
    ["", t("selectStatuses")], ["UNKNOWN", t("notChecked")], ["UNDER_REVIEW", t("underReview")],
    ["CONFIRMED_VALID", t("confirmedValid")], ["CONFIRMED_ABSENT", t("confirmedAbsent")],
  ].map(([value, label]) => '<option value="' + value + '"' + (selected("legalStatus") === value ? " selected" : "") + ">" + escapeHtml(label) + "</option>").join("");
  const sortOptions = [["score-desc", t("sortRisk")], ["name", t("sortName")], ["updated", t("sortUpdated")]]
    .map(([value, label]) => '<option value="' + value + '"' + (selected("sort") === value ? " selected" : "") + ">" + escapeHtml(label) + "</option>").join("");
  const action = '<a class="button button-accent" data-route href="/complexes/new">' + icon("plus") + "<span>" + escapeHtml(L("Добавить объект", "Нысан қосу")) + "</span></a>";
  const legalLabels = { UNKNOWN: t("notChecked"), UNDER_REVIEW: t("underReview"), CONFIRMED_VALID: t("confirmedValid"), CONFIRMED_ABSENT: t("confirmedAbsent") };
  const activeFilters = [
    ["query", searchParams.get("query")], ["zone", zoneLabels[searchParams.get("zone")]], ["city", searchParams.get("city")],
    ["legalStatus", legalLabels[searchParams.get("legalStatus")]], ["stage", searchParams.get("stage")],
    ["hasNew", searchParams.get("hasNew") === "true" ? t("hasNewAds") : ""],
    ["hasHypothesis", searchParams.get("hasHypothesis") === "true" ? t("hasHypothesis") : ""],
    ["needsReview", searchParams.get("needsReview") === "true" ? t("needsReview") : ""],
  ].filter(([, label]) => label);
  const chips = activeFilters.map(([key, label]) => {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete(key);
    return '<a class="filter-chip" data-route href="/complexes' + escapeHtml(remaining.size ? '?' + remaining : '') + '" aria-label="' +
      escapeHtml(t("removeFilter") + ': ' + label) + '">' + escapeHtml(label) + icon("close") + '</a>';
  }).join('');
  const moreCount = activeFilters.filter(([key]) => ["legalStatus", "stage", "hasNew", "hasHypothesis"].includes(key)).length;
  return pageHeading(t("registry"), t("registrySubtitle"), '<a class="button button-secondary" data-route href="/complexes/import">' + escapeHtml(L("Импорт CSV","CSV импорты")) + '</a>' + action) +
    '<form id="registry-filters" class="filter-bar registry-filters" aria-label="' + escapeHtml(t("filters")) + '">' +
      (searchParams.get("needsReview") === "true" ? '<input type="hidden" name="needsReview" value="true">' : '') +
      '<div class="registry-filter-main"><div class="field search-field"><label for="registry-query">' + escapeHtml(t("searchRegistry")) + '</label><div class="registry-search-input">' + icon("search") + '<input id="registry-query" type="search" name="query" value="' + selected("query") + '" placeholder="' + escapeHtml(t("searchObjects")) + '"></div></div>' +
      '<div class="field"><label for="registry-zone">' + escapeHtml(t("zone")) + '</label><select id="registry-zone" name="zone">' + zoneOptions + "</select></div>" +
      '<div class="field"><label for="registry-city">' + escapeHtml(t("city")) + '</label><select id="registry-city" name="city">' + cityOptions + "</select></div>" +
      '<div class="field"><label for="registry-sort">' + escapeHtml(t("sortBy")) + '</label><select id="registry-sort" name="sort">' + sortOptions + '</select></div></div>' +
      '<details class="registry-filter-more"' + (moreCount ? ' open' : '') + '><summary>' + icon("filter") + escapeHtml(t("moreFilters")) + (moreCount ? '<span class="filter-count">' + moreCount + '</span>' : '') + icon("chevron") + '</summary><div class="registry-filter-fields">' +
      '<div class="field"><label for="registry-legal">' + escapeHtml(t("legalStatus")) + '</label><select id="registry-legal" name="legalStatus">' + legalOptions + "</select></div>" +
      '<div class="field"><label for="registry-stage">' + escapeHtml(t("stage")) + '</label><select id="registry-stage" name="stage">' + stageOptions + "</select></div>" +
      '<label class="checkbox-field"><input type="checkbox" name="hasNew" value="true"' + (selected("hasNew") === "true" ? " checked" : "") + ">" + escapeHtml(t("hasNewAds")) + "</label>" +
      '<label class="checkbox-field"><input type="checkbox" name="hasHypothesis" value="true"' + (selected("hasHypothesis") === "true" ? " checked" : "") + ">" + escapeHtml(t("hasHypothesis")) + "</label>" +
      '</div></details><div class="registry-filter-actions"><div class="active-filters" aria-label="' + escapeHtml(t("activeFilters")) + '">' + chips + '</div><div class="button-row"><button class="button button-primary" type="submit">' + icon("search") + "<span>" + escapeHtml(t("showObjects")) + "</span></button>" +
      (activeFilters.length || searchParams.has("sort") ? '<a class="button button-secondary" data-route href="/complexes"><span>' + escapeHtml(t("reset")) + '</span></a>' : '') + '</div></div></form>' +
    '<div class="toolbar"><div class="toolbar-start"><span class="panel-meta">' + escapeHtml(t("pfObjectsInList")) + ": " + items.length + "</span></div><div class=\"toolbar-end\">" +
      '<span class="panel-meta">' + escapeHtml(t("legalNoVerdict")) + "</span>" +
      '<div class="m3-view-toggle" role="group" aria-label="' + escapeHtml(L('Режим отображения', 'Көрініс режимі')) + '">' +
        '<button type="button" class="m3-toggle-btn is-active" data-action="toggle-registry-view" data-view="table" title="' + escapeHtml(L('Таблица', 'Кесте')) + '">' + icon('registry') + '<span>' + escapeHtml(L('Таблица', 'Кесте')) + '</span></button>' +
        '<button type="button" class="m3-toggle-btn" data-action="toggle-registry-view" data-view="cards" title="' + escapeHtml(L('Карточки', 'Карточкалар')) + '">' + icon('overview') + '<span>' + escapeHtml(L('Карточки', 'Карточкалар')) + '</span></button>' +
      '</div></div></div>' +
    (items.length ? '<section class="panel registry-results view-table">' + riskTable(items) + compactRegistry(items) + '</section>' :
      '<section class="panel registry-empty">' + icon("search") + '<h2>' + escapeHtml(t("noResults")) + '</h2><p>' + escapeHtml(t("filterRecovery")) + '</p><a class="button button-secondary" data-route href="/complexes">' + escapeHtml(t("clearFilters")) + '</a></section>');
}

function tabLink(complexId, tab, label, current) {
  return '<a class="tab-link ' + (tab === current ? "active" : "") + '" data-route href="/complexes/' +
    encodeURIComponent(complexId) + queryString({ tab }) + '" aria-current="' + (tab === current ? "page" : "false") + '">' +
    escapeHtml(label) + "</a>";
}

function sourceNote(source, date) {
  return '<div class="source-note">' + icon("file") + "<span><strong>" + escapeHtml(t("source")) + ":</strong> " +
    escapeHtml(source || t("noLegalInfo")) + (date ? " · " + escapeHtml(formatDate(date)) : "") + "</span></div>";
}

function completionCard(complex) {
  const difference = complex.declaredCompletionPercentage != null && complex.verifiedCompletionPercentage != null
    ? Math.abs(complex.declaredCompletionPercentage - complex.verifiedCompletionPercentage) : null;
  return '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("completion")) +
    '</h2><span class="panel-meta">' + escapeHtml(complex.constructionStage) + '</span></header><div class="panel-body">' +
    '<dl class="info-list"><div class="info-row"><dt>' + escapeHtml(t("declared")) + '</dt><dd>' +
    (complex.declaredCompletionPercentage == null ? "—" : escapeHtml(complex.declaredCompletionPercentage + "%")) +
    "</dd></div><div class=\"info-row\"><dt>" + escapeHtml(t("verified")) + "</dt><dd>" +
    (complex.verifiedCompletionPercentage == null ? "—" : escapeHtml(complex.verifiedCompletionPercentage + "%")) +
    "</dd></div><div class=\"info-row\"><dt>" + escapeHtml(t("pfCompletionDifference")) + "</dt><dd>" + (difference == null ? "—" : escapeHtml(difference + " " + t("pfPercentagePoint"))) +
    "</dd></div></dl>" + sourceNote(complex.declaredCompletionSource, complex.declaredCompletionCapturedAt) +
    sourceNote(complex.verifiedCompletionSource, complex.verifiedCompletionCapturedAt) + "</div></article>";
}

function legalCard(complex, compact = false) {
  const unknown = ["UNKNOWN", "UNDER_REVIEW"].includes(complex.legalBasisStatus);
  const message = unknown
    ? '<div class="callout warning">' + escapeHtml(t("legalUnknownTip")) + "</div>"
    : '<div class="callout ' + (complex.legalBasisStatus === "CONFIRMED_ABSENT" ? "danger" : "success") + '">' +
      escapeHtml(complex.legalBasisStatus === "CONFIRMED_ABSENT"
        ? t("pfDemoLegalAbsence")
        : t("pfDemoLegalStatus")) + "</div>";
  return '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("legalStatus")) +
    '</h2>' + legalBadge(complex.legalBasisStatus) + '</header><div class="panel-body"><dl class="info-list">' +
    '<div class="info-row"><dt>' + escapeHtml(t("pfBasisType")) + "</dt><dd>" + escapeHtml(complex.legalBasisType || t("noLegalInfo")) + "</dd></div>" +
    '<div class="info-row"><dt>' + escapeHtml(t("verification")) + '</dt><dd>' + legalBadge(complex.legalBasisStatus) + "</dd></div>" +
    '<div class="info-row"><dt>' + escapeHtml(t("pfChecked")) + "</dt><dd>" + escapeHtml(complex.legalBasisCheckedAt ? formatDate(complex.legalBasisCheckedAt) : "—") + "</dd></div>" +
    "</dl>" + sourceNote(complex.legalBasisSource, complex.legalBasisCheckedAt) + message +
    (complex.passport?.legalRecheck?.required?'<div class="callout warning" data-legal-recheck>'+escapeHtml(L('Реквизиты участка, компании или документов изменены. Прежняя правовая проверка требует пересмотра; источник и дата выше относятся к прежнему решению.','Жер учаскесі, компания немесе құжат деректері өзгерді. Бұрынғы құқықтық тексеруді қайта қарау қажет; жоғарыдағы дереккөз бен күн бұрынғы шешімге қатысты.'))+'</div>':'')+
    (!compact ? button(t("reviewLegal"), "show-legal-form", { className: "button button-secondary button-small", icon: "file" }) : "") +
    "</div></article>";
}

function factorCard(factor, complex, compact = false) {
  const label = factorLabels[factor.code] ? t(factorLabels[factor.code]) : factor.code;
  const actions = !(factor.sourceType==='COMPLAINT'&&factor.context?.complaintId)&&(factor.status === "AI_HYPOTHESIS" || factor.status === "UNKNOWN")
    ? '<div class="factor-actions">' +
      button(t("confirmFactor"), "review-factor-confirm", {
        className: "button button-success button-small", icon: "check",
        data: ' data-expected-status="' + escapeHtml(factor.status) + '" data-factor-id="' + escapeHtml(factor.id) + '" data-complex-id="' + escapeHtml(complex.id) + '"',
        disabled: factor.code === "R1" && complex.legalBasisStatus !== "CONFIRMED_ABSENT",
      }) +
      button(t("rejectFactor"), "review-factor-reject", {
        className: "button button-secondary button-small",
        data: ' data-expected-status="' + escapeHtml(factor.status) + '" data-factor-id="' + escapeHtml(factor.id) + '" data-complex-id="' + escapeHtml(complex.id) + '"',
      }) +
      "</div>"
    : "";
  const source = factor.sourceId && ["ADVERTISEMENT", "AI_EXTRACTION"].includes(factor.sourceType)
    ? '<a class="text-link" data-route href="/advertisements/' + encodeURIComponent(factor.sourceId) + '">' + escapeHtml(t("openPublication")) + '</a>'
    : factor.sourceType==='COMPLAINT'&&factor.sourceId?'<a class="text-link" data-route href="'+escapeHtml(complaintRoute(complex.id,{complaint:factor.sourceId}))+'">'+escapeHtml(L('Открыть обращение','Өтінішті ашу'))+'</a>':escapeHtml(factor.sourceLabel || factor.sourceType);
  return '<article class="factor-card"><div class="factor-head"><div><div class="factor-code">' + escapeHtml(factor.code) +
    " · " + escapeHtml(t("factorWeight")) + " " + escapeHtml(factor.weight) + "</div><h3 class=\"factor-title\">" + escapeHtml(label) +
    "</h3></div>" + factorStatusBadgeHtml(factor.status) + '</div>' +
    (factor.evidenceText ? '<div class="evidence-box">' + evidenceHighlight(factor.evidenceText, factor.evidenceText) + "</div>" : "") +
    '<div class="evidence-source">' + icon("file") + source +
    (factor.confirmedAt ? " · " + escapeHtml(formatDate(factor.confirmedAt)) : "") + "</div>" +
    (factor.confidence != null ? '<div class="factor-meta" style="margin-top:5px">' + escapeHtml(t("confidence")) + ": " + confidenceLabel(factor.confidence) + "</div>" : "") +
    (factor.notes ? '<div class="factor-meta" style="margin-top:5px">' + escapeHtml(factor.notes) + "</div>" : "") +
    actions + "</article>";
}

function factorStatusBadgeHtml(status) {
  const labels = { CONFIRMED: t("confirmed"), AI_HYPOTHESIS: t("aiHypothesis"), UNKNOWN: t("unknown"), REJECTED: t("rejected") };
  return '<span class="status-badge status-' + escapeHtml(String(status).toLowerCase()) + '">' + escapeHtml(labels[status] || status) + "</span>";
}

function factorsPanel(complex, factors) {
  if (!factors.length) return emptyState(t("pfNoConfirmedFactors"));
  return '<div class="risk-factor-list">' + factors.map((factor) => factorCard(factor, complex)).join("") + "</div>";
}

function connectedEntitiesPanel(complex) {
  const contacts = complex.contacts || [];
  const fields = complex.passport?.fields || {};
  const items = [];
  if (fields.authorizedCompany) items.push({ label: L("Уполномоченная компания", "Уәкілетті компания"), value: fields.authorizedCompany, icon: "registry" });
  if (fields.director) items.push({ label: L("Руководитель", "Басшы"), value: fields.director, icon: "file" });
  if (fields.founders) items.push({ label: L("Учредители", "Құрылтайшылар"), value: fields.founders, icon: "file" });
  if (fields.salesOffices) items.push({ label: L("Отдел продаж", "Сату бөлімі"), value: fields.salesOffices, icon: "mapPin" });
  if (fields.websites) items.push({ label: L("Сайты проекта", "Жоба сайттары"), value: fields.websites, icon: "ads" });
  if (fields.bankDetails) items.push({ label: L("Банковские реквизиты", "Банк деректемелері"), value: fields.bankDetails, icon: "signal" });
  for (const c of contacts) {
    items.push({ label: c.sourceLabel || (c.type === "PHONE" ? L("Телефон", "Телефон") : L("Рекламный аккаунт", "Жарнама аккаунты")), value: c.value, icon: c.type === "PHONE" ? "phone" : "ads" });
  }

  if (!items.length) return "";
  return '<article class="panel m3-connected-entities"><header class="panel-header"><h2 class="panel-title">' +
    escapeHtml(L("Связанные сущности и каналы продаж", "Байланысты нысандар мен сату арналары")) +
    '</h2><span class="panel-meta">' + items.length + ' ' + escapeHtml(L("контактов / реквизитов", "байланыс")) + '</span></header><div class="panel-body">' +
    '<div class="m3-entity-chips-grid">' +
    items.map(it => '<div class="m3-entity-chip"><div class="m3-entity-icon">' + icon(it.icon || "file") + '</div><div class="m3-entity-info"><div class="m3-entity-label">' + escapeHtml(it.label) + '</div><div class="m3-entity-val">' + escapeHtml(it.value) + '</div></div></div>').join('') +
    '</div></div></article>';
}

function overviewTab(complex) {
  const confirmed = complex.factors.filter((item) => item.status === "CONFIRMED");
  const pending = complex.factors.filter((item) => item.status === "AI_HYPOTHESIS");
  const recentAds = complex.advertisements.slice(0, 3);
  const historyItems = complex.audit.slice(0, 5);
  return (complex.isDemo ? '<p class="callout warning" role="note">' + escapeHtml(L("Демо-сценарий: сведения об объекте, компании, документах и проверках вымышлены. Официальные источники не сверялись.", "Демо-сценарий: нысан, компания, құжаттар мен тексерулер туралы мәліметтер ойдан шығарылған. Ресми дереккөздермен салыстырылмаған.")) + '</p>' : '') +
    '<div class="detail-grid"><div class="detail-stack">' + completionCard(complex) + legalCard(complex, true) +
    '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("riskFactors")) +
    '</h2><span class="panel-meta">' + escapeHtml(t("pfConfirmedCountLabel")) + ": " + escapeHtml(confirmed.length) + " · " +
    escapeHtml(t("pfHypothesisCountLabel")) + ": " + escapeHtml(pending.length) + "</span></header><div class=\"panel-body\">" + factorsPanel(complex, complex.factors.slice(0, 5)) +
    '<a class="text-link" data-route href="/complexes/' + encodeURIComponent(complex.id) + '?tab=risk">' +
    escapeHtml(t("pfShowAllFactors")) + icon("arrow") + "</a></div></article></div>" +
    '<div class="detail-stack"><article class="panel"><header class="panel-header"><h2 class="panel-title">' +
    escapeHtml(t("allAdvertisements")) + '</h2><a class="text-link" data-route href="/advertisements/new">' +
    escapeHtml(t("addAdvertisement")) + icon("plus") + '</a></header><div class="panel-body related-list">' +
    (recentAds.length ? recentAds.map((ad) => adPreview(ad)).join("") : emptyState(t("noAds"))) + "</div></article>" +
    '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("auditHistory")) +
    '</h2><a class="text-link" data-route href="/complexes/' + encodeURIComponent(complex.id) + '?tab=timeline">' + escapeHtml(t("pfAllHistory")) +
    icon("arrow") + '</a></header><div class="panel-body">' + timeline(historyItems, (item) => auditActionLabel(item.action)) +
    "</div></article></div></div>" + connectedEntitiesPanel(complex);
}

function legalReviewForm(complex) {
  return '<form id="legal-review-form" class="panel-body" data-current-version="' + escapeHtml(complex.updatedAt) + '" hidden>' +
    '<div class="form-grid"><div class="field span-2"><label for="legal-status">' + escapeHtml(t("legalResult")) +
    '</label><select id="legal-status" name="status" required><option value="UNKNOWN">' + escapeHtml(t("notChecked")) + '</option>' +
    '<option value="UNDER_REVIEW">' + escapeHtml(t("underReview")) + '</option><option value="CONFIRMED_VALID">' + escapeHtml(t("confirmedValid")) + '</option>' +
    '<option value="CONFIRMED_ABSENT">' + escapeHtml(t("confirmedAbsent")) + '</option></select></div>' +
    '<div class="field span-2"><label for="legal-source">' + escapeHtml(t("source")) +
    '</label><input id="legal-source" name="sourceLabel" required placeholder="' + escapeHtml(t("pfLegalSourcePlaceholder")) + '"></div>' +
    '<div class="field span-2"><label for="legal-evidence">' + escapeHtml(t("sourceFragment")) +
    '</label><textarea id="legal-evidence" name="evidenceText" required placeholder="' + escapeHtml(t("pfLegalEvidencePlaceholder")) + '"></textarea></div>' +
    '<div class="field span-2"><label for="legal-notes">' + escapeHtml(t("analystComment")) +
    '</label><textarea id="legal-notes" name="notes" required placeholder="' + escapeHtml(t("pfLegalNotesPlaceholder")) + '"></textarea></div></div>' +
    '<p class="form-help">' + escapeHtml(t("legalUnknownTip")) + " " + escapeHtml(t("pfR1LegalTip")) + "</p>" +
    '<input type="hidden" name="complexId" value="' + escapeHtml(complex.id) + '">' +
    '<input id="legal-reviewed-version" type="hidden" name="expectedUpdatedAt" value="' + escapeHtml(complex.updatedAt) + '">' +
    '<p id="legal-review-status" class="form-help" role="status" aria-live="polite"></p>' +
    '<button type="button" class="button button-secondary" data-action="legal-review-refresh" hidden>' + escapeHtml(t('refresh')) + '</button>' +
    '<div class="form-actions"><button type="button" class="button button-secondary" data-action="hide-legal-form">' + escapeHtml(t("cancel")) +
    '</button><button type="submit" class="button button-primary">' + escapeHtml(t("saveReview")) + "</button></div></form>";
}

function legalHistoryLabel(action) {
  if(action==='LEGAL_BASIS_INVALIDATED')return L('Реквизиты изменены — нужна повторная правовая проверка','Деректемелер өзгерді — құқықтық тексеруді қайталау қажет');
  const status = action.slice("LEGAL_BASIS_".length);
  const labels = {
    UNKNOWN: t("notChecked"),
    UNDER_REVIEW: t("underReview"),
    CONFIRMED_VALID: t("confirmedValid"),
    CONFIRMED_ABSENT: t("confirmedAbsent"),
  };
  return t("pfStatusPrefix") + ": " + (labels[status] || status.replaceAll("_", " "));
}

function legalTab(complex) {
  return '<div class="detail-grid"><div class="detail-stack">' + legalCard(complex) +
    '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("pfLegalBasisHistory")) + '</h2></header><div class="panel-body">' +
    timeline(complex.audit.filter((item) => item.action.startsWith("LEGAL_BASIS_")), (item) => legalHistoryLabel(item.action)) +
    '</div></article></div><article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("pfAnalystLegalReview")) + '</h2></header>' +
    legalReviewForm(complex) + '<div class="panel-body callout warning">' + escapeHtml(t("legalUnknownTip")) + "</div></article></div>";
}

function adsTab(complex) {
  return '<div class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("allAdvertisements")) +
    '</h2><a class="button button-accent button-small" data-route href="/advertisements/new">' + icon("plus") +
    "<span>" + escapeHtml(t("addAdvertisement")) + "</span></a></header><div class=\"panel-body related-list\">" +
    (complex.advertisements.length ? complex.advertisements.map((ad) => adPreview(ad)).join("") : emptyState(t("noAds"))) +
    "</div></div>";
}

function manualFactorForm(complex) {
  return '<form id="manual-factor-form" class="panel-body"><div class="form-grid">' +
    '<div class="field"><label for="manual-code">' + escapeHtml(t("factorCode")) +
    '</label><select id="manual-code" name="code"><option value="R1">R1 · ' + escapeHtml(t(factorLabels.R1)) + '</option><option value="R2">R2 · ' + escapeHtml(t(factorLabels.R2)) + '</option>' +
    '<option value="R3">R3 · ' + escapeHtml(t(factorLabels.R3)) + '</option><option value="R4">R4 · ' + escapeHtml(t(factorLabels.R4)) + '</option><option value="R5">R5 · ' + escapeHtml(t(factorLabels.R5)) + '</option><option value="R6">R6 · ' + escapeHtml(t(factorLabels.R6)) + '</option>' +
    '</select></div>' +
    '<div class="field"><label for="manual-source">' + escapeHtml(t("source")) + '</label><input id="manual-source" name="sourceLabel" required></div>' +
    '<div class="field span-2"><label for="manual-evidence">' + escapeHtml(t("evidenceText")) + '</label><textarea id="manual-evidence" name="evidenceText" required></textarea></div>' +
    '<div class="field span-2"><label for="manual-notes">' + escapeHtml(t("analystComment")) + '</label><textarea id="manual-notes" name="notes" required></textarea></div></div>' +
    '<p class="form-help">' + escapeHtml(t("pfManualFactorInstructions")) + '</p>' +
    '<div class="form-actions"><button class="button button-primary" type="submit">' + escapeHtml(t("addFactor")) + "</button></div></form>";
}

function riskTab(complex) {
  const confirmed = complex.risk.scoredFactors;
  const max = Math.max(1, complex.risk.score);
  const breakdown = confirmed.map((factor) =>
    '<div class="score-breakdown-row"><span>' + escapeHtml(factor.code) + "</span><div><div>" +
    escapeHtml(t(factorLabels[factor.code] || factor.code)) + '</div><div class="score-bar"><span style="width:' +
    Math.min(100, Math.max(7, Math.abs(factor.weight) / max * 100)).toFixed(0) + '%"></span></div></div><strong>' + (factor.weight > 0 ? "+" : "") + escapeHtml(factor.weight) + "</strong></div>").join("");
  return '<div class="detail-grid"><div class="detail-stack"><article class="panel"><header class="panel-header"><h2 class="panel-title">' +
    escapeHtml(t("scoreExplanation")) + '</h2>' + riskBadge(complex.displayCategory, complex.risk.score) +
    '</header><div class="panel-body"><div class="callout">' + escapeHtml(t("legalNoVerdict")) + "</div><div class=\"score-breakdown\" style=\"margin-top:15px\">" +
    (breakdown || emptyState(t("pfNoConfirmedScore"))) + "</div><div class=\"source-note\" style=\"margin-top:14px\">" +
    escapeHtml(t("uniqueFactors")) + " " + escapeHtml(t("pfRiskFormula")) +
    "</div></div></article>" + completionCard(complex) + "</div>" +
    '<div class="detail-stack"><article class="panel"><header class="panel-header"><h2 class="panel-title">' +
    escapeHtml(t("riskFactors")) + '</h2><span class="panel-meta">' + escapeHtml(t("pfRecordCountLabel")) + ": " + escapeHtml(complex.factors.length) + "</span></header><div class=\"panel-body\">" +
    factorsPanel(complex, complex.factors) + "</div></article><article class=\"panel\"><header class=\"panel-header\"><h2 class=\"panel-title\">" +
    escapeHtml(t("manualFactor")) + '</h2></header>' + manualFactorForm(complex) + "</article></div></div>";
}

function timeline(items, getTitle) {
  if (!items.length) return emptyState(t("noHistory"));
  return '<div class="timeline">' + items.map((item) => '<div class="timeline-item"><div class="timeline-rail"><span class="timeline-node"></span></div>' +
    '<div class="timeline-copy"><div class="timeline-title">' + escapeHtml(getTitle(item)) +
    '</div><div class="timeline-meta">' + escapeHtml(item.actor || "") + " · " + escapeHtml(formatDate(item.timestamp || item.createdAt, { withTime: true })) +
    "</div></div></div>").join("") + "</div>";
}

function historyTab(complex) {
  const items = complex.audit.map((item) => ({ ...item, title: auditActionLabel(item.action) }));
  const riskRows = complex.riskHistory.map((item) => ({
    timestamp: item.createdAt, actor: item.actor,
    action: t("pfScoreLabel") + ": " + item.score + " · " + item.reason,
  }));
  return '<div class="detail-grid"><article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("pfScoreHistory")) + '</h2></header><div class="panel-body">' +
    timeline(riskRows, (item) => item.action) + "</div></article><article class=\"panel\"><header class=\"panel-header\"><h2 class=\"panel-title\">" +
    escapeHtml(t("auditHistory")) + '</h2><a class="text-link" data-route href="/history?complexId='+encodeURIComponent(complex.id)+'">'+escapeHtml(L('Полная история','Толық тарих'))+'</a></header><div class="panel-body">' + timeline(items, (item) => item.action) + "</div></article></div>";
}

function signalsTab(complex) {
  const body = complex.signals.length ? complex.signals.map((signal) => '<a class="related-item" data-route href="/signals/' +
    encodeURIComponent(signal.id) + '"><span><strong>' + escapeHtml(signal.id) +
    '</strong><span class="table-secondary">' + escapeHtml(formatDate(signal.createdAt)) + "</span></span><span>" +
    signalStatusBadge(signal.status) + "</span></a>").join("") : emptyState(t("pfNoComplexSignals"));
  return '<div class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("pfSignalsTitle")) + " · " + escapeHtml(complex.signals.length) +
    '</h2><button class="button button-accent button-small" data-action="create-signal" data-complex-id="' + escapeHtml(complex.id) + '">' +
    icon("plus") + "<span>" + escapeHtml(t("createSignal")) + "</span></button></header><div class=\"panel-body related-list\">" + body + "</div></div>";
}

function radialScoreGaugeHtml(score, category) {
  const num = Math.max(0, Math.min(100, Number(score) || 0));
  const radius = 38;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (circ * num) / 100;
  const strokeColor = category === "red" ? "var(--red)" : category === "yellow" ? "var(--amber)" : "var(--green)";
  return '<div class="m3-radial-gauge-box m3-radial-gauge-box--' + escapeHtml(category) + '">' +
    '<svg class="m3-radial-gauge-svg" viewBox="0 0 96 96" width="92" height="92" aria-hidden="true">' +
      '<circle class="m3-gauge-track" cx="48" cy="48" r="' + radius + '" fill="none" stroke-width="7" />' +
      '<circle class="m3-gauge-value" cx="48" cy="48" r="' + radius + '" fill="none" stroke-width="7" stroke-linecap="round" stroke="' + strokeColor + '" ' +
      'stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '" transform="rotate(-90 48 48)" />' +
    '</svg>' +
    '<div class="m3-radial-gauge-number">' +
      '<span class="hero-score-value">' + num + '</span>' +
      '<span class="m3-gauge-denom">/ 100</span>' +
    '</div>' +
  '</div>';
}

export function renderComplex(complex, searchParams) {
  const current = searchParams.get("tab") || "overview";
  const tabMap = {
    overview: ["overviewTab", overviewTab],
    passport: ["passportTab", renderPassport],
    construction: ["constructionTab", renderConstruction],
    complaints: ['complaintsTab',renderComplaints],
    legal: ["legalTab", complex=>legalTab(complex)+renderObjectConditions(complex)],
    ads: ["adsTab", adsTab],
    risk: ["riskTab", riskTab],
    timeline: ["timelineTab", historyTab],
    signals: ["signalsTab", signalsTab],
  };
  const [labelKey, render] = tabMap[current] ?? tabMap.overview;
  const actions = '<a class="button button-secondary button-small" data-route href="/advertisements/new">' + icon("plus") +
    "<span>" + escapeHtml(t("addAdvertisement")) + "</span></a>" +
    '<button class="button button-accent button-small" data-action="create-signal" data-complex-id="' + escapeHtml(complex.id) + '">' +
    icon("file") + "<span>" + escapeHtml(t("createSignal")) + "</span></button>";
  return '<div class="panel"><section class="complex-hero"><div><div class="complex-title-row"><h1>' + escapeHtml(complex.name) +
    '</h1>' + (complex.objectNumber ? '<span class="m3-obj-id-pill m3-obj-id-pill--hero">' + escapeHtml(complex.objectNumber) + '</span>' : '') +
    '<span class="demo-label">' + escapeHtml(t("demo")) + '</span></div><div class="complex-meta-grid">' +
    '<div class="complex-meta-item">' + icon("mapPin") + "<span>" + escapeHtml(complex.address) + "</span></div>" +
    "<div class=\"complex-meta-item\"><span>" + escapeHtml(t("developer")) + ": <strong>" + escapeHtml(complex.developerName) + "</strong></span></div>" +
    "<div class=\"complex-meta-item\"><span>" + escapeHtml(t("pfBusinessId")) + ": <strong>" + escapeHtml(complex.developerBin) + "</strong></span></div>" +
    "<div class=\"complex-meta-item\"><span>" + escapeHtml(t("stage")) + ": <strong>" + escapeHtml(complex.constructionStage) + "</strong></span></div>" +
    "</div></div><div class=\"hero-score\">" +
    radialScoreGaugeHtml(complex.risk.score, complex.displayCategory) +
    '<div class="hero-score-details">' +
      '<div class="hero-score-badge-wrap">' + riskBadge(complex.displayCategory, null) + '</div>' +
      '<p>' + escapeHtml(complex.displayCategory === "red" ? t("priorityReview") : complex.risk.needsReview ? t("needsReview") : complex.displayCategory === "yellow" ? t("reviewPriority") : complex.displayCategory === "review" ? t("needsReview") : t("lowRisk")) +
      "<br><small class=\"hero-score-sub\">" + escapeHtml(t("legalNoVerdict")) + "</small></p>" +
    '</div></div></section>' +
    '<nav class="tabs" aria-label="' + escapeHtml(t("pfComplexCardAria")) + '">' + [
      tabLink(complex.id, "overview", t("overviewTab"), current),
      tabLink(complex.id, "passport", L("Паспорт", "Паспорт"), current),
      tabLink(complex.id, "construction", L("Ход строительства", "Құрылыс барысы"), current),
      tabLink(complex.id, 'complaints', L('Обращения','Өтініштер'),current),
      tabLink(complex.id, "legal", t("legalTab"), current),
      tabLink(complex.id, "ads", t("adsTab"), current),
      tabLink(complex.id, "risk", t("riskTab"), current),
      tabLink(complex.id, "timeline", t("timelineTab"), current),
      tabLink(complex.id, "signals", t("signalsTab"), current),
    ].join("") + "</nav>" +
    '<section class="page-content" style="padding-top:15px;padding-bottom:18px">' +
    '<div class="toolbar"><div class="toolbar-start">' + legalBadge(complex.legalBasisStatus) +
    '<span class="panel-meta">' + escapeHtml(t("pfPublicationCountLabel")) + ": " + complex.advertisements.length + " · " + escapeHtml(t("pfSignalCountLabel")) + ": " + complex.signals.length + "</span></div><div class=\"toolbar-end\">" +
    actions + "</div></div>" + render(complex) + "</section></div>";
}
