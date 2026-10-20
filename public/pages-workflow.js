import {
  analysisSourceLabel, auditActionLabel, button, confidenceLabel, emptyState, escapeHtml, evidenceHighlight, formatDate,
  icon, legalBadge, riskBadge, signalStatusBadge,
} from "./components.js";
import { t } from "./i18n.js";
import { queryString } from "./api.js";
import { renderEvidence, renderSignalWorkflow, L } from "./pilot-ui.js";
import { renderConstructionSnapshot } from './construction-ui.js';
import {renderSignalInbox} from './signal-inbox-ui.js';
import {renderConditionSnapshot} from './object-conditions-ui.js';
import {renderComplaintSnapshot,complaintRoute} from './complaints-ui.js';

const factorLabels = {
  R1: "wfFactorR1",
  R2: "wfFactorR2",
  R3: "wfFactorR3",
  R4: "wfFactorR4",
  R5: "wfFactorR5",
  R6: "wfFactorR6",
};

const matchReasonKeys = {
  "совпало название": "wfMatchReasonName",
  "совпал адрес": "wfMatchReasonAddress",
  "совпал застройщик": "wfMatchReasonDeveloper",
  "совпал телефон": "wfMatchReasonPhone",
  "совпал аккаунт": "wfMatchReasonAccount",
};

const entityTypeLabels = {
  COMPLEX: "wfEntityComplex",
  ADVERTISEMENT: "wfEntityAdvertisement",
  SIGNAL: "wfEntitySignal",
  SYSTEM: "wfEntitySystem",
};

function heading(title, subtitle, action = "") {
  return '<header class="page-heading"><div><h1>' + escapeHtml(title) + "</h1>" +
    (subtitle ? "<p>" + escapeHtml(subtitle) + "</p>" : "") +
    '</div><div class="heading-actions">' + action + "</div></header>";
}

function adLink(ad) {
  return '<a class="complex-link record-id" title="' + escapeHtml(ad.id) + '" data-route href="/advertisements/' + encodeURIComponent(ad.id) + '">' + escapeHtml(ad.id) + "</a>";
}

function statusFilterLink(label, value, selected, filters) {
  return '<a class="tab-link ' + (value === selected ? "active" : "") + '" data-route href="/advertisements' +
    queryString({ ...filters, status: value }) + '"' + (value === selected ? ' aria-current="page"' : '') + '>' + escapeHtml(label) + "</a>";
}

export function renderAdvertisements(items, status, filters = {}, complexes = [],platforms=[]) {
  const add = '<a class="button button-accent" data-route href="/advertisements/new">' + icon("plus") +
    "<span>" + escapeHtml(t("addAdvertisement")) + "</span></a>";
  const tabs = '<nav class="tabs" aria-label="' + escapeHtml(t("filters")) + '">' +
    statusFilterLink(t("all"), "", status, filters) + statusFilterLink(t("new"), "new", status, filters) +
    statusFilterLink(t("reviewed"), "reviewed", status, filters) + statusFilterLink(t("suspicious"), "suspect", status, filters) +
    statusFilterLink(t("unlinked"), "unlinked", status, filters) + statusFilterLink(t("highConfidence"), "high-confidence", status, filters) + "</nav>";
  const rows = items.length ? items.map((ad) => {
    const summary = ad.analysis?.paymentOffer?.evidence || ad.analysis?.activeSale?.evidence || "";
    const statusLabel = ad.sourceStatus === "REMOVED" ? L("Удалена в источнике; сведения сохранены", "Дереккөзден жойылған; мәліметтер сақталған") : ad.linkStatus === "MATCHED" ? t("ad_MATCHED")
      : ad.linkStatus === "MATCH_PENDING" ? t("pendingStatus") : t("new");
    return "<tr><td>" + adLink(ad) + '<span class="table-secondary">' + escapeHtml(statusLabel) + "</span></td>" +
      "<td>" + escapeHtml(ad.platform) + '<span class="table-secondary">' + escapeHtml(ad.account || "—") + "</span></td>" +
      "<td>" + (ad.publicationDateBasis==='OBSERVED'?escapeHtml(L('Дата публикации неизвестна','Жарияланым күні белгісіз'))+'<span class="table-secondary">'+escapeHtml(L('Наблюдение: ','Бақылау: ')+formatDate(ad.observedAt))+'</span>':escapeHtml(formatDate(ad.publicationDate))) + "</td>" +
      "<td>" + (ad.complexId ? '<a class="complex-link" data-route href="/complexes/' + encodeURIComponent(ad.complexId) + '">' +
        escapeHtml(ad.complexName) + "</a>" : ad.proposedComplexId ? '<span>' + escapeHtml(ad.proposedComplexName || t("wfProposed") + ": " + ad.proposedComplexId) + '</span><span class="table-secondary">' + escapeHtml(t("pendingStatus")) + "</span>" : '<span class="panel-meta">' + escapeHtml(t("unlinked")) + "</span>") + "</td>" +
      '<td class="ad-excerpt-cell"><div class="ad-text-preview">' + evidenceHighlight(summary || ad.text.slice(0, 125), summary) + "</div></td>" +
      "<td>" + (ad.paymentDetected ? '<span class="status-badge status-ai_hypothesis">' + escapeHtml(t("paymentDetected")) + "</span>" : "—") + "</td>" +
      "<td>" + (ad.confidence ? confidenceLabel(ad.confidence) : "—") + "</td>" +
      '<td><a class="row-arrow" data-route href="/advertisements/' + encodeURIComponent(ad.id) + '" aria-label="' + escapeHtml(t("details")) + '">' + icon("chevron") + "</a></td></tr>";
  }).join("") : '<tr><td colspan="8">' + emptyState(t("noAds")) + "</td></tr>";
  return heading(t("advertisements"), t("wfAdsSubtitle"), add) +
    '<form id="ad-filters" class="filter-bar ad-filters"><div class="field search-field"><label for="ad-query">' + escapeHtml(t("searchPublications")) + '</label><input id="ad-query" name="query" value="' + escapeHtml(filters.query || "") + '"></div>' +
    '<input type="hidden" name="status" value="' + escapeHtml(status) + '"><div class="field"><label for="ad-source-filter">' + escapeHtml(t("platform")) + '</label><select id="ad-source-filter" name="platform"><option value="">' + escapeHtml(t("allSources")) + '</option>' +
    [...new Set(["Instagram", "TikTok", "Telegram", "Сайт объявлений", "Сайт проекта", "Наружная реклама", "Другое",...platforms,...items.map(item=>item.platform),filters.platform].filter(Boolean))].map((platform) => '<option value="'+escapeHtml(platform)+'"' + (filters.platform === platform ? ' selected' : '') + '>' + escapeHtml(platform) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="ad-object-filter">' + escapeHtml(t("linkedComplex")) + '</label><select id="ad-object-filter" name="complexId"><option value="">' + escapeHtml(t("allObjects")) + '</option>' + complexes.map((complex) => '<option value="' + escapeHtml(complex.id) + '"' + (filters.complexId === complex.id ? ' selected' : '') + '>' + escapeHtml(complex.name) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="ad-sort">' + escapeHtml(L('Сортировка','Сұрыптау')) + '</label><select id="ad-sort" name="sort"><option value="risk"' + (filters.sort !== 'date' ? ' selected' : '') + '>' + escapeHtml(L('По весу формулировок','Тіркестер салмағы бойынша')) + '</option><option value="date"' + (filters.sort === 'date' ? ' selected' : '') + '>' + escapeHtml(L('По дате','Күні бойынша')) + '</option></select></div><div class="button-row"><button class="button button-primary" type="submit">' + escapeHtml(t("applyFilters")) + '</button><a class="button button-secondary" data-route href="/advertisements">' + escapeHtml(t("reset")) + '</a></div></form>' +
    '<section class="panel">' + tabs + '<div class="table-wrap"><table class="data-table ads-table"><thead><tr>' +
    "<th>ID / " + escapeHtml(t("linkStatus")) + "</th><th>" + escapeHtml(t("platform")) + " / " + escapeHtml(t("account")) +
    "</th><th>" + escapeHtml(t("date")) + "</th><th>" + escapeHtml(t("linkedComplex")) + "</th><th>" +
    escapeHtml(t("evidence")) + "</th><th>" + escapeHtml(t("paymentOffer")) + "</th><th>" +
    escapeHtml(t("confidence")) + '</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></section>";
}

const examples = [
  "Старт продаж в ЖК Altai Residence. Для бронирования квартиры внесите депозит 500 000 ₸.",
  "Открываем шоурум ЖК Orda Park. Приходите посмотреть планировки.",
  "Первоначальный взнос от 20%. Оформление квартиры уже сегодня.",
];

export function renderNewAdvertisement(meta = {demo:true}) {
  const sampleButtons = examples.map((value, index) => button(t("wfExample") + " " + (index + 1), "use-example", {
    className: "button button-secondary button-small",
    data: ' data-example-index="' + index + '"',
  })).join("");
  return heading(t("addAdvertisement"), t("newAdSubtitle")) +
    '<div class="detail-grid"><section class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("sourceData")) + '</h2>' +
    '<span class="demo-label">' + escapeHtml(t("demo")) + "</span></header><div class=\"panel-body\">" +
    '<form id="new-ad-form"><div class="form-grid">' +
    '<div class="field"><label for="ad-platform">' + escapeHtml(t("platform")) + '</label><select id="ad-platform" name="platform">' +
    '<option>Instagram</option><option>TikTok</option><option>Telegram</option><option>Сайт объявлений</option><option>Сайт проекта</option><option>Наружная реклама</option><option>Другое</option></select></div>' +
    '<div class="field"><label for="ad-date">' + escapeHtml(t("date")) + '</label><input id="ad-date" name="publicationDate" type="date" value="' + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda" }).format(new Date()) + '" required></div>' +
    '<div class="field"><label for="ad-account">' + escapeHtml(t("account")) + '</label><input id="ad-account" name="account" maxlength="120" placeholder="@demo_account"></div>' +
    '<div class="field"><label for="ad-phone">' + escapeHtml(t("phone")) + '</label><input id="ad-phone" name="phone" maxlength="40" placeholder="+7 700 000 00 00"></div>' +
    '<div class="field span-2"><label for="ad-url">' + escapeHtml(t("sourceUrl")) + '</label><input id="ad-url" name="url" maxlength="500" type="url" placeholder="https://example.invalid/publication"></div>' +
    '<div class="field span-2"><label for="ad-text">' + escapeHtml(t("publicationText")) + ' <span aria-hidden="true">*</span></label>' +
    '<textarea id="ad-text" name="text" minlength="5" maxlength="12000" required placeholder="' + escapeHtml(t("wfPublicationTextPlaceholder")) + '"></textarea>' +
    '<small>' + escapeHtml(t("textHelp")) + '</small></div>' +
    '<div class="field span-2"><label for="ad-notes">' + escapeHtml(t("notes")) + '</label><input id="ad-notes" name="notes" maxlength="500" placeholder="' + escapeHtml(t("wfNotesPlaceholder")) + '"></div>' +
    '</div><div id="ad-form-error" class="form-error" hidden></div><div class="form-actions">' +
    '<a class="button button-secondary" data-route href="/advertisements">' + escapeHtml(t("cancel")) +
    '</a><button id="ad-submit" class="button button-accent" type="submit">' + icon("search") +
    "<span>" + escapeHtml(t("analyze")) + "</span></button></div></form></div></section>" +
    '<aside class="detail-stack">' + (meta.demo ? '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("quickDemo")) + '</h2></header>' +
    '<div class="panel-body"><p class="form-help">' + escapeHtml(t("demoInputHelp")) + '</p>' +
    '<div class="button-row" style="margin-top:12px">' + sampleButtons + "</div></div></article>" : '') +
    '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("howAnalysisWorks")) + '</h2></header><div class="panel-body">' +
    '<div class="timeline"><div class="timeline-item"><div class="timeline-rail"><span class="timeline-node"></span></div><div class="timeline-copy"><div class="timeline-title">' + escapeHtml(t("extraction")) + '</div><div class="timeline-meta">' + escapeHtml(t("extractedFields")) + '</div></div></div>' +
    '<div class="timeline-item"><div class="timeline-rail"><span class="timeline-node"></span></div><div class="timeline-copy"><div class="timeline-title">' + escapeHtml(t("exactQuote")) + '</div><div class="timeline-meta">' + escapeHtml(t("quoteHelp")) + '</div></div></div>' +
    '<div class="timeline-item"><div class="timeline-rail"><span class="timeline-node"></span></div><div class="timeline-copy"><div class="timeline-title">' + escapeHtml(t("humanReview")) + '</div><div class="timeline-meta">' + escapeHtml(t("humanReviewHelp")) + '</div></div></div></div>' +
    '<div class="callout warning" style="margin-top:8px">' + escapeHtml(t("legalNoVerdict")) + "</div></div></article></aside></div>";
}

function matchCard(match, ad) {
  const label = match.confidenceLabel === "recommended" ? t("recommendedMatch")
    : match.confidenceLabel === "possible" ? t("possibleMatch") : t("weakMatch");
  const matchPercent = Math.round(match.score * 100);
  const scoreExplanation = t("matchScoreExplanation");
  const accessibleScore = escapeHtml(t("matchScore") + ": " + matchPercent + "%. " + scoreExplanation);
  return '<article class="match-card"><div><div class="match-name">' + escapeHtml(match.complexName) +
    " · " + escapeHtml(match.city) + '</div><div class="match-reasons">' + escapeHtml(match.reasons.map((reason) => matchReasonKeys[reason] ? t(matchReasonKeys[reason]) : reason).join(" · ") || t("wfWeakTextMatch")) +
    " · " + escapeHtml(label) + '</div><div class="table-secondary">' + escapeHtml(match.address) +
    '</div></div><div><div class="match-score" title="' + escapeHtml(scoreExplanation) + '" aria-label="' + accessibleScore + '"><span class="match-score-label">' +
    escapeHtml(t("matchScore")) + '</span><span>' + matchPercent + "%</span></div>" +
    button(t("confirmMatch"), "confirm-ad-match", {
      className: "button button-primary button-small",
      data: ' data-ad-id="' + escapeHtml(ad.id) + '" data-complex-id="' + escapeHtml(match.complexId) + '"',
    }) + "</div></article>";
}

function adFactorCard(factor, ad) {
  const statusLabels = { CONFIRMED: t("confirmed"), AI_HYPOTHESIS: t("aiHypothesis"), REJECTED: t("rejected"), UNKNOWN: t("unknown") };
  const actions = factor.status === "AI_HYPOTHESIS" ? '<div class="factor-actions">' +
    button(t("confirmFactor"), "review-factor-confirm", {
      className: "button button-success button-small",
      data: ' data-expected-status="' + escapeHtml(factor.status) + '" data-factor-id="' + escapeHtml(factor.id) + '" data-ad-id="' + escapeHtml(ad.id) + '"',
    }) +
    button(t("rejectFactor"), "review-factor-reject", {
      className: "button button-secondary button-small",
      data: ' data-expected-status="' + escapeHtml(factor.status) + '" data-factor-id="' + escapeHtml(factor.id) + '" data-ad-id="' + escapeHtml(ad.id) + '"',
    }) + "</div>" : "";
  return '<article class="factor-card"><div class="factor-head"><div><div class="factor-code">' + escapeHtml(factor.code) +
    " · " + escapeHtml(t("factorWeight")) + " " + escapeHtml(factor.weight) + "</div><h3 class=\"factor-title\">" +
    escapeHtml(factorLabels[factor.code] ? t(factorLabels[factor.code]) : factor.code) + '</h3></div><span class="status-badge status-' +
    escapeHtml(String(factor.status).toLowerCase()) + '">' + escapeHtml(statusLabels[factor.status] || factor.status) +
    "</span></div>" + (factor.evidenceText ? '<div class="evidence-box">' +
      evidenceHighlight(ad.text, factor.evidenceText) + "</div>" : "") +
    '<div class="evidence-source">' + icon("file") + escapeHtml(factor.sourceLabel || factor.sourceType) + "</div>" + actions + "</article>";
}

export function renderAdvertisementDetail(ad, complexes = []) {
  const analysis = ad.analysis;
  if (!analysis) return heading(ad.id, t("wfAnalysisNotStarted")) +
    '<button class="button button-primary" data-action="reanalyze-ad" data-ad-id="' + escapeHtml(ad.id) + '">' +
    escapeHtml(t("analyze")) + '</button><article class="panel"><header class="panel-header"><h2 class="panel-title">'+escapeHtml(t('originalText'))+'</h2></header><div class="panel-body original-publication">'+escapeHtml(ad.text)+'</div></article>'+renderEvidence(ad);
  const paymentEvidence = analysis.paymentOffer?.evidence;
  const highlighted = paymentEvidence || analysis.activeSale?.evidence;
  const warnings = (analysis.analysisSource === "Rule-based fallback" ? [t("localAnalysisNotice")] : analysis.warnings ?? []).map((warning) => '<div class="analysis-warning">' + escapeHtml(warning) + "</div>").join("");
  const matchPanel = ad.complexId
    ? '<div class="callout success">' + escapeHtml(t("wfPublicationLinked")) + ' <a class="complex-link" data-route href="/complexes/' +
      encodeURIComponent(ad.complexId) + '">' + escapeHtml(ad.complexName) + "</a>. " + escapeHtml(t("wfLinkConfirmedByAnalyst")) + "</div>"
    : ad.matches.length
      ? ad.matches.map((match) => matchCard(match, ad)).join("")
      : emptyState(t("wfNoMatch"));
  const manualMatch = ad.complexId ? "" : '<form id="manual-match-form" class="manual-match"><input type="hidden" name="adId" value="' + escapeHtml(ad.id) + '">' +
    '<div class="field"><label for="manual-match-complex">' + escapeHtml(t("manualMatch")) + '</label><select id="manual-match-complex" name="complexId" required>' +
    '<option value="">' + escapeHtml(t("chooseComplex")) + '</option>' + complexes.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name + " · " + item.city) + '</option>').join("") + '</select></div>' +
    '<button class="button button-secondary" type="submit">' + escapeHtml(t("confirmMatch")) + '</button></form>';
  const hypotheses = ad.factors.length ? ad.factors.map((factor) => adFactorCard(factor, ad)).join("")
    : ad.complexId ? emptyState(t("wfNoFactors")) : '<div class="callout">' + escapeHtml(t("wfConfirmComplexFirst")) + "</div>";
  const related = ad.relatedActivity.advertisements.length
    ? ad.relatedActivity.advertisements.map((item) => '<a class="related-item" data-route href="/advertisements/' + encodeURIComponent(item.id) +
      '"><span><strong>' + escapeHtml(item.platform) + '</strong><span class="table-secondary">' + escapeHtml(item.complexName || t("unlinked")) +
      "</span></span><span>" + escapeHtml(formatDate(item.publicationDate)) + "</span></a>").join("")
    : emptyState(t("noRelatedActivity"));
  return heading(t("publicationDetail"), ad.platform + " · " + (ad.collection&&!ad.collection.publishedAt?L('Наблюдение: ','Бақылау: '):'') + formatDate(ad.publicationDate) + " · " + ad.id,
    '<button class="button button-secondary" data-action="reanalyze-ad" data-ad-id="' + escapeHtml(ad.id) + '">' +
      icon("search") + "<span>" + escapeHtml(t("analyze")) + "</span></button>") +
    '<div class="analysis-grid"><div class="detail-stack">' +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("originalText")) +
      '</h2><span class="panel-meta">' + escapeHtml(ad.account || "—") + " · " + escapeHtml(formatDate(ad.capturedAt)) +
      '</span></header><div class="panel-body"><div class="original-publication">' +
      evidenceHighlight(ad.text, highlighted) + "</div>" +
      (ad.url ? '<div class="evidence-source">' + icon("external") + '<a href="' + escapeHtml(ad.url) +
        '" target="_blank" rel="noopener noreferrer">' + escapeHtml(t("wfOpenSource")) + "</a></div>" : "") +
      "</div></article>" +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("wfStructuredAnalysis")) + "</h2>" +
      '<span class="panel-meta">' + escapeHtml(analysisSourceLabel(analysis.analysisSource)) + "</span></header><div class=\"panel-body\">" +
      '<div class="analysis-summary"><div class="analysis-heading"><h3>' + escapeHtml(t("analysisMethod")) +
      '</h3><span class="status-badge status-ai_hypothesis">' + escapeHtml(analysisSourceLabel(analysis.analysisSource)) + "</span></div><p>" +
      escapeHtml(analysis.summary) + '</p><p class="confidence-note">' + escapeHtml(t("confidenceExplanation")) + "</p></div>" +
      '<dl class="info-list" style="margin-top:10px"><div class="info-row"><dt>' + escapeHtml(t("paymentOffer")) +
      '</dt><dd>' + (analysis.paymentOffer.detected ? escapeHtml(t("payment_" + (analysis.paymentOffer.type || "payment"))) : escapeHtml(t("noPaymentOffer"))) +
      "</dd></div><div class=\"info-row\"><dt>" + escapeHtml(t("amount")) + "</dt><dd>" +
      (analysis.paymentOffer.amount ? escapeHtml(new Intl.NumberFormat("ru-KZ").format(analysis.paymentOffer.amount) + " ₸") : "—") +
      "</dd></div><div class=\"info-row\"><dt>" + escapeHtml(t("wfComplexInText")) + "</dt><dd>" + escapeHtml(analysis.residentialComplex.name || "—") +
      "</dd></div><div class=\"info-row\"><dt>" + escapeHtml(t("confidence")) + "</dt><dd>" +
      confidenceLabel(analysis.paymentOffer.confidence) + "</dd></div></dl>" +
      (paymentEvidence ? '<div class="evidence-box">' + evidenceHighlight(ad.text, paymentEvidence) + "</div>" : "") +
      warnings + "</div></article>" +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("suggestedMatches")) +
      '</h2><span class="panel-meta">' + escapeHtml(t("wfAnalystConfirmsMatch")) + '</span></header><div class="panel-body">' +
      matchPanel + manualMatch + "</div></article>" +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("hypotheses")) +
      '</h2><span class="panel-meta">' + escapeHtml(t("wfZeroUntilConfirmed")) + '</span></header><div class="panel-body">' +
      hypotheses + "</div></article></div>" +
      '<aside class="detail-stack">' + (ad.currentComplexRisk ? '<article class="panel"><div class="panel-body"><p class="panel-title">' + escapeHtml(t("currentRisk")) + '</p><div class="current-risk">' + riskBadge(ad.currentComplexRisk.zone === "green" && ad.currentComplexRisk.needsReview ? "review" : ad.currentComplexRisk.zone, ad.currentComplexRisk.score) + '</div><p class="form-help">' + escapeHtml(t("uniqueFactors")) + '</p></div></article>' : '') + '<article class="panel"><header class="panel-header"><h2 class="panel-title">' +
      escapeHtml(t("relatedActivity")) + '</h2><span class="panel-meta">' + escapeHtml(ad.relatedActivity.count) +
      "</span></header><div class=\"panel-body related-list\">" + related + "</div></article>" +
      '<article class="panel"><header class="panel-header"><h2 class="panel-title">' + escapeHtml(t("wfMetadata")) + '</h2></header><div class="panel-body"><dl class="info-list">' +
      '<div class="info-row"><dt>' + escapeHtml(t("platform")) + "</dt><dd>" + escapeHtml(ad.platform) + "</dd></div>" +
      '<div class="info-row"><dt>' + escapeHtml(ad.collection&&!ad.collection.publishedAt?L("Дата наблюдения","Бақылау күні"):t("date")) + "</dt><dd>" + escapeHtml(formatDate(ad.publicationDate)) + "</dd></div>" +
      '<div class="info-row"><dt>' + escapeHtml(t("phone")) + "</dt><dd>" + escapeHtml(ad.phone || "—") + "</dd></div>" +
      '<div class="info-row"><dt>' + escapeHtml(t("linkStatus")) + "</dt><dd>" + escapeHtml(t("ad_" + ad.linkStatus)) + "</dd></div>" +
      "</dl>" + (ad.complexId ? '<a class="button button-secondary button-small" data-route href="/complexes/' + encodeURIComponent(ad.complexId) + '">' +
        icon("registry") + "<span>" + escapeHtml(t("openComplex")) + "</span></a>" : "") +
      "</div></article></aside></div>" + renderEvidence(ad);
}

export function renderSignals(page) { return renderSignalInbox(page); }

function snapshotFactor(factor,complexId) {
  const source = factor.sourceId && ["ADVERTISEMENT", "AI_EXTRACTION"].includes(factor.sourceType)
    ? '<a class="text-link" data-route href="/advertisements/' + encodeURIComponent(factor.sourceId) + '">' + escapeHtml(factor.sourceLabel || factor.sourceId) + "</a>"
    : factor.sourceType==='COMPLAINT'&&factor.sourceId?'<a class="text-link" data-route href="'+escapeHtml(complaintRoute(complexId,{complaint:factor.sourceId}))+'">'+escapeHtml(L('Открыть текущее обращение','Ағымдағы өтінішті ашу'))+'</a>':escapeHtml(factor.sourceLabel || factor.sourceType || "—");
  return '<article class="factor-card"><div class="factor-head"><div><div class="factor-code">' + escapeHtml(factor.code) +
    " · " + escapeHtml(t("factorWeight")) + " " + escapeHtml(factor.weight) + "</div><h3 class=\"factor-title\">" +
    escapeHtml(factor.label || (factorLabels[factor.code] ? t(factorLabels[factor.code]) : factor.code)) + '</h3></div><span class="status-badge status-' +
    escapeHtml(String(factor.status).toLowerCase()) + '">' + escapeHtml(factor.status === "CONFIRMED" ? t("confirmed") :
      factor.status === "AI_HYPOTHESIS" ? t("aiHypothesis") : factor.status === "REJECTED" ? t("rejected") : t("unknown")) +
    "</span></div>" + (factor.evidenceText ? '<div class="evidence-box">' + escapeHtml(factor.evidenceText) + "</div>" : "") +
    '<div class="evidence-source">' + icon("file") + source + "</div>" +
    (factor.confirmedBy ? '<div class="factor-meta" style="margin-top:5px">' + escapeHtml(t("confirmed")) + ": " +
      escapeHtml(factor.confirmedBy) + (factor.confirmedAt ? " · " + escapeHtml(formatDate(factor.confirmedAt)) : "") + "</div>" : "") +
    "</article>";
}

function signalAudit(signal) {
  if (!signal.audit.length) return emptyState(t("noHistory"));
  return '<div class="timeline">' + signal.audit.map((item) => '<div class="timeline-item"><div class="timeline-rail"><span class="timeline-node"></span></div>' +
    '<div class="timeline-copy"><div class="timeline-title">' + escapeHtml(auditActionLabel(item.action)) +
    '</div><div class="timeline-meta">' + escapeHtml(item.actor) + " · " + escapeHtml(formatDate(item.timestamp, { withTime: true })) +
    "</div></div></div>").join("") + "</div>";
}

export function renderSignal(signal) {
  const confirmed = signal.factorSnapshot.filter((item) => item.status === "CONFIRMED");
  const hypotheses = signal.factorSnapshot.filter((item) => item.status === "AI_HYPOTHESIS");
  let actionBlock = "";
  if (signal.status === "DRAFT") {
    actionBlock = button(t("sendReview"), "signal-status", {
      className: "button button-primary",
      data: ' data-signal-id="' + escapeHtml(signal.id) + '" data-status="NEEDS_REVIEW"',
    });
  } else if (signal.status === "NEEDS_REVIEW") {
    actionBlock = button(t("confirmSignal"), "signal-status", {
      className: "button button-success",
      data: ' data-signal-id="' + escapeHtml(signal.id) + '" data-status="CONFIRMED"',
    }) + button(t("returnSignal"), "signal-status", {
      className: "button button-danger",
      data: ' data-signal-id="' + escapeHtml(signal.id) + '" data-status="RETURNED"',
    });
  } else if (signal.status === "RETURNED") {
    actionBlock = button(t("sendReview"), "signal-status", {
      className: "button button-primary",
      data: ' data-signal-id="' + escapeHtml(signal.id) + '" data-status="NEEDS_REVIEW"',
    });
  }
  if (["CONFIRMED", "RETURNED"].includes(signal.status)&&!(signal.routing?.assignedAt&&!signal.routing?.result)) actionBlock += button(t("archiveSignal"), "signal-status", {
    className: "button button-secondary", data: ' data-signal-id="' + escapeHtml(signal.id) + '" data-status="ARCHIVED"',
  });
  const legalLabel = {
    UNKNOWN: t("notChecked"), UNDER_REVIEW: t("underReview"),
    CONFIRMED_VALID: t("confirmedValid"), CONFIRMED_ABSENT: t("confirmedAbsent"),
  }[signal.legalBasisSnapshot] || t("unknown");
  const adsSection = signal.advertisements?.length
    ? '<section class="report-section"><h2>' + escapeHtml(t("allAdvertisements")) + '</h2><div class="related-list">' +
      signal.advertisements.map((ad) => '<a class="related-item" data-route href="/advertisements/' + encodeURIComponent(ad.id) +
      '"><span><strong>' + escapeHtml(ad.platform) + '</strong><span class="table-secondary">' +
      escapeHtml(ad.text) + "</span><span class=\"table-secondary\">" + escapeHtml(t("capturedAt") + ": " + formatDate(ad.capturedAt, { withTime: true })) + "</span></span><span>" + escapeHtml(formatDate(ad.publicationDate)) + "</span></a>").join("") +
      "</div></section>"
    : signal.legacySnapshot ? "" : '<section class="report-section"><h2>' + escapeHtml(t("allAdvertisements")) +
      '</h2><p class="report-empty">' + escapeHtml(t("noAds")) + "</p></section>";
  return heading(t("reportTitle"), "", '<a class="button button-primary" href="/api/signals/' + encodeURIComponent(signal.id) + '/export" target="_blank" rel="noopener">' + icon("print") + '<span>' + escapeHtml(t("printVersion")) + '</span></a><a class="button button-secondary" href="/api/signals/' + encodeURIComponent(signal.id) + '/export?download=1" download>' + icon("file") + '<span>' + escapeHtml(t("downloadReport")) + '</span></a>') +
    '<article class="panel signal-report"><header class="report-header"><div class="report-title-row"><div><span class="report-record-label">' +
    escapeHtml(t("signalId")) + '</span><h2 class="report-record-id">' + escapeHtml(signal.id) + '</h2><div class="report-subtitle">' +
    escapeHtml(t("demo")) + " · " + escapeHtml(formatDate(signal.createdAt, { long: true, withTime: true })) + "</div></div>" +
    '<div class="button-row no-print">' + actionBlock + "</div></div></header>" +
    '<div class="report-status-callout">' + signalStatusBadge(signal.status) + '<span class="panel-meta">' +
    (signal.reviewedBy ? escapeHtml(signal.reviewedBy + " · " + formatDate(signal.reviewedAt, { withTime: true })) : escapeHtml(t("pendingStatus"))) + "</span></div>" +
    (signal.complex.isDemo ? '<div class="snapshot-banner" role="note">' + escapeHtml(L("Демо-сценарий: объект, источники, статусы и подтверждения синтетические. Реальные сотрудники и госреестры эти записи не проверяли.", "Демо-сценарий: нысан, дереккөздер, мәртебелер мен растаулар синтетикалық. Бұл жазбаларды нақты қызметкерлер мен мемлекеттік тізілімдер тексермеген.")) + '</div>' : '') +
    (signal.legacySnapshot ? '<div class="snapshot-banner legacy-notice">' + escapeHtml(t("legacySnapshot")) + '</div>' : '') +
    '<div class="report-grid"><div class="report-data"><span>' + escapeHtml(t("wfComplexShort")) + '</span><strong>' + escapeHtml(signal.complex.name) +
    '</strong></div><div class="report-data"><span>' + escapeHtml(t("address")) + '</span><strong>' +
    escapeHtml(signal.complex.address) + '</strong></div><div class="report-data"><span>' + escapeHtml(t("developer")) +
    '</span><strong>' + escapeHtml(signal.complex.developerName) + '</strong></div><div class="report-data"><span>' + escapeHtml(t("wfBusinessId")) + '</span><strong>' +
    escapeHtml(signal.complex.developerBin) + '</strong></div><div class="report-data"><span>' + escapeHtml(t("score")) +
    '</span><strong>' + escapeHtml(signal.scoreSnapshot) + " / 100 · " + escapeHtml(riskLabel(signal.zoneSnapshot)) +
    '</strong></div><div class="report-data"><span>' + escapeHtml(t("legalStatus")) + '</span><strong>' +
    escapeHtml(legalLabel) + '</strong></div><div class="report-data"><span>' + escapeHtml(t("author")) +
    '</span><strong>' + escapeHtml(signal.createdBy) + '</strong></div><div class="report-data"><span>' +
    escapeHtml(t("signalStatus")) + '</span><strong>' + escapeHtml(signalStatusText(signal.status)) + "</strong></div>" +
    '<div class="report-data"><span>' + escapeHtml(t("wfConfirmedFactors")) + '</span><strong>' + confirmed.length + " · " + escapeHtml(t("wfHypothesesLabel")) + " " + hypotheses.length + "</strong></div></div>" +
    '<div class="snapshot-banner">' + escapeHtml(t("snapshotNotice")) + " " + escapeHtml(t("uniqueFactors")) + " " + escapeHtml(t("notLegalConclusion")) + "</div>" +
    '<div class="snapshot-banner no-print"><a class="text-link" data-route href="/complexes/' + encodeURIComponent(signal.complexId) + '?tab=risk">' + escapeHtml(t("currentRisk")) + ': ' + signal.currentRisk.score + ' / 100</a></div>' +
    '<section class="report-section"><h2>' + escapeHtml(t("riskFactors")) + '</h2>' +
    (signal.factorSnapshot.length ? signal.factorSnapshot.map(factor=>snapshotFactor(factor,signal.complexId)).join("") : emptyState(t("wfNoSnapshotFactors"))) +
    "</section>" +
    adsSection + renderConstructionSnapshot(signal) + renderConditionSnapshot(signal) + renderComplaintSnapshot(signal) + renderSignalWorkflow(signal) +
    '<section class="report-section"><h2>' + escapeHtml(t("wfComment")) + '</h2><p>' + escapeHtml(signal.comment || "—") + '</p>' +
    (signal.status === "NEEDS_REVIEW" ? '<label class="field no-print"><span class="field-label">' +
      escapeHtml(t("commentRequired")) + '</span><textarea id="signal-comment" class="report-comment" maxlength="1000" aria-describedby="signal-comment-help" placeholder="' + escapeHtml(t("wfReturnReasonPlaceholder")) + '"></textarea><small id="signal-comment-help" class="form-help">' + escapeHtml(t("wfReturnReasonHelp")) + '</small></label>' : "") +
    '</section><section class="report-section"><h2>' + escapeHtml(t("auditHistory")) + '</h2>' + signalAudit(signal) + "</section>" +
    '<footer class="report-disclaimer">' + escapeHtml(t("demoDisclaimer")) + " " + escapeHtml(t("notLegalConclusion")) + "</footer></article>";
}

function riskLabel(zone) {
  return zone === "red" ? t("red") : zone === "yellow" ? t("yellow") : t("green");
}
function signalStatusText(status) {
  return { DRAFT: t("draft"), NEEDS_REVIEW: t("needsReviewSignal"), CONFIRMED: t("confirmed"), RETURNED: t("returned"), ARCHIVED: t("archived") }[status] || status;
}

function auditStatusText(status) {
  return {
    UNKNOWN: t("notChecked"),
    UNDER_REVIEW: t("underReview"),
    CONFIRMED_VALID: t("confirmedValid"),
    CONFIRMED_ABSENT: t("confirmedAbsent"),
  }[status] || signalStatusText(status);
}

function metadataValueText(value) {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function historyMetadataSummary(metadata) {
  if (metadata === null || metadata === undefined) return escapeHtml(t("wfNoAuditMetadata"));
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return escapeHtml(metadataValueText(metadata));
  }

  const parts = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(metadata, key) && metadata[key] !== null && metadata[key] !== "";
  const add = (label, value) => parts.push('<span class="audit-summary-item"><strong>' + escapeHtml(label) + '</strong> ' + escapeHtml(metadataValueText(value)) + "</span>");

  if (has("from") || has("to")) {
    const from = has("from") ? auditStatusText(metadata.from) : "—";
    const to = has("to") ? auditStatusText(metadata.to) : "—";
    add(t("wfStatusTransition"), from + " → " + to);
  }
  if (has("complexName")) add(t("wfComplexNameLabel"), metadata.complexName);
  if (has("complexId")) add(t("wfComplexIdLabel"), metadata.complexId);
  if (has("code")) add(t("wfFactorCodeLabel"), metadata.code);
  if (has("score")) add(t("wfScoreLabel"), metadata.score);
  if (has("comment")) add(t("wfCommentLabel"), metadata.comment);
  for (const key of ["evidenceText", "quote", "quotation"]) {
    if (has(key)) add(t("wfEvidenceQuoteLabel"), metadata[key]);
  }

  return parts.length ? parts.join(" · ") : escapeHtml(t("wfNoAuditSummary"));
}

function fullAuditMetadata(metadata) {
  if (typeof metadata === "string") return metadata;
  const json = JSON.stringify(metadata, null, 2);
  return json === undefined ? String(metadata) : json;
}

export function renderHistory(items, params, allActions,page={}) {
  const entityLabel=entity=>entityTypeLabels[entity]?t(entityTypeLabels[entity]):({USER:L('Сотрудник','Қызметкер'),SOURCE:L('Источник сбора','Жинау дереккөзі'),JOB:L('Задание','Тапсырма')})[entity]??entity;
  const value = (key) => escapeHtml(params.get(key) || "");
  const entities = ["COMPLEX", "ADVERTISEMENT", "SIGNAL", "SYSTEM","USER","SOURCE","JOB"];
  const entityOptions = '<option value="">' + escapeHtml(t("all")) + "</option>" + entities.map((entity) =>
    '<option value="' + entity + '"' + (value("entity") === entity ? " selected" : "") + ">" + escapeHtml(entityLabel(entity)) + "</option>").join("");
  const actions = allActions ?? [...new Set(items.map((item) => item.action))].sort();
  const actionOptions = '<option value="">' + escapeHtml(t("all")) + "</option>" + actions.map((action) =>
    '<option value="' + escapeHtml(action) + '"' + (value("action") === action ? " selected" : "") + ">" + escapeHtml(auditActionLabel(action)) + "</option>").join("");
  const rows = items.length ? items.map((item) => "<tr><td>" + escapeHtml(formatDate(item.timestamp, { withTime: true })) + "</td>" +
    "<td>" + escapeHtml(item.actor) + "</td><td>" + escapeHtml(entityLabel(item.entityType)) + '<span class="table-secondary">' +
    escapeHtml(item.entityId) + "</span></td><td>" + escapeHtml(auditActionLabel(item.action)) + "</td>" +
    '<td class="audit-detail"><div class="audit-summary">' + historyMetadataSummary(item.metadata) +
    '</div><details class="audit-raw"><summary>' + escapeHtml(t("wfFullAuditRecord")) + "</summary><pre>" +
    escapeHtml(fullAuditMetadata(item.metadata)) + "</pre></details></td></tr>").join("")
    : '<tr><td colspan="5">' + emptyState(t("noHistory")) + "</td></tr>";
  const first=new URLSearchParams(params);first.delete('before');const earlier=new URLSearchParams(first);if(page.nextCursor)earlier.set('before',page.nextCursor);
  const pagination='<nav class="toolbar" aria-label="'+escapeHtml(L('Страницы журнала','Журнал беттері'))+'"><span class="panel-meta">'+escapeHtml(L('Записей на странице: ','Беттегі жазбалар: '))+items.length+' · '+escapeHtml(L('Всего по фильтрам: ','Сүзгі бойынша барлығы: '))+(page.total??items.length)+'</span><div class="toolbar-end">'+(params.get('before')?'<a class="button button-secondary" data-route href="/history?'+escapeHtml(first.toString())+'">'+escapeHtml(L('К началу','Басына'))+'</a>':'')+(page.nextCursor?'<a class="button button-secondary" data-route href="/history?'+escapeHtml(earlier.toString())+'">'+escapeHtml(L('Ранее','Ертерек'))+'</a>':'')+'</div></nav>';
  return heading(t("history"), t("wfHistorySubtitle")) +
    (page.complex?'<p class="source-note">'+escapeHtml(L('История объекта: ','Нысан тарихы: '))+'<a data-route href="/complexes/'+encodeURIComponent(page.complex.id)+'?tab=timeline">'+escapeHtml(page.complex.objectNumber+' · '+page.complex.name)+'</a></p>':'')+
    '<form id="history-filters" class="filter-bar">'+(params.get('complexId')?'<input type="hidden" name="complexId" value="'+value('complexId')+'">':'')+'<div class="field"><label for="history-entity">' +
    escapeHtml(t("entity")) + '</label><select id="history-entity" name="entity">' + entityOptions + "</select></div>" +
    '<div class="field"><label for="history-action">' + escapeHtml(t("action")) +
    '</label><select id="history-action" name="action">' + actionOptions + "</select></div>" +
    '<div class="field"><label for="history-from">' + escapeHtml(t("fromDate")) + '</label><input id="history-from" type="date" name="from" value="' + value("from") + '"></div>' +
    '<div class="field"><label for="history-to">' + escapeHtml(t("toDate")) + '</label><input id="history-to" type="date" name="to" value="' + value("to") + '"></div>' +
    '<button type="submit" class="button button-primary">' + icon("filter") + "<span>" + escapeHtml(t("applyFilters")) + "</span></button>" +
    '<a class="button button-secondary" data-route href="/history">' + escapeHtml(t("reset")) + "</a></form>" +
    pagination+'<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>' +
    escapeHtml(t("date")) + "</th><th>" + escapeHtml(t("author")) + "</th><th>" + escapeHtml(t("entity")) +
    "</th><th>" + escapeHtml(t("action")) + "</th><th>" + escapeHtml(t("details")) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div></section>"+pagination;
}
