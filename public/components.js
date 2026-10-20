import { getLocale, t } from "./i18n.js";
export const localeText=(ru,kz)=>getLocale()==='kz'?kz:ru;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

const iconPaths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  registry: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  ads: '<path d="M3 11v2a2 2 0 0 0 2 2h2l9 4V5l-9 4H5a2 2 0 0 0-2 2Z"/><path d="m7 15 2 6h3l-2-5M19 9l2-2M19 15l2 2"/>',
  signal: '<path d="m12 3 9 16H3L12 3Z"/><path d="M12 9v4M12 16h.01"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M3 12a9 9 0 0 1 2.5-6.2"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  mapPin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
  print: '<path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7zM17 11h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 13h8M8 17h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  radar: '<path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M16.24 7.76A6 6 0 0 0 7.76 16.24M12 12h.01"/><path d="m12 12 3-3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
};

export function icon(name, className = "") {
  const path = iconPaths[name] ?? iconPaths.file;
  return '<svg class="icon ' + escapeHtml(className) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
}

export function formatDate(value, options = {}) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? value + "T12:00:00Z" : value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  const kazakh = getLocale() === "kz";
  return new Intl.DateTimeFormat("ru-KZ", {
    timeZone: "Asia/Qyzylorda", day: "2-digit", month: kazakh ? "2-digit" : options.long ? "long" : "short", year: "numeric",
    ...(options.withTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : {}),
  }).format(date);
}

export function auditActionLabel(action) {
  const statusKey = { UNKNOWN: "unknown", UNDER_REVIEW: "underReview", CONFIRMED_VALID: "confirmedValid", CONFIRMED_ABSENT: "confirmedAbsent", CONFIRMED: "confirmed", REJECTED: "rejected", DRAFT: "draft", NEEDS_REVIEW: "needsReviewSignal", RETURNED: "returned", ARCHIVED: "archived" };
  for (const [prefix, key] of [["SIGNAL_STATUS_", "signalStatus"], ["RISK_FACTOR_", "riskFactors"], ["LEGAL_BASIS_", "legalStatus"]]) {
    const status = action.startsWith(prefix) ? action.slice(prefix.length) : null;
    if (statusKey[status]) return t(key) + ": " + t(statusKey[status]);
  }
  const label = t("audit_" + action);
  return label === "audit_" + action ? action.replaceAll("_", " ") : label;
}

export function analysisSourceLabel(source) {
  return source === "AI model" ? t("aiModel") : source === "Local ML + rules" ? t("localModel") : t("localRules");
}

export function timeAgo(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "Сегодня";
  if (days === 1) return "Вчера";
  if (days < 7) return days + " дн. назад";
  return formatDate(value);
}

export function riskBadge(category, score, compact = false) {
  const label = category === "red" ? t("red")
    : category === "yellow" ? t("yellow")
      : category === "review" ? t("needsReview") : t("green");
  const numeric = Number.isFinite(score) ? '<span class="risk-badge-score">' + escapeHtml(score) + '</span>' : "";
  return '<span class="risk-badge risk-' + escapeHtml(category) + (compact ? " compact" : "") + '">' +
    '<span class="risk-dot" aria-hidden="true"></span><span>' + label + "</span>" + numeric + "</span>";
}

export function legalBadge(status) {
  const labels = {
    UNKNOWN: t("notChecked"),
    UNDER_REVIEW: t("underReview"),
    CONFIRMED_VALID: t("confirmedValid"),
    CONFIRMED_ABSENT: t("confirmedAbsent"),
  };
  return '<span class="legal-badge legal-' + escapeHtml(String(status).toLowerCase()) + '">' +
    escapeHtml(labels[status] ?? t("unknown")) + "</span>";
}

export function factorStatusBadge(status) {
  const label = status === "CONFIRMED" ? t("confirmed")
    : status === "REJECTED" ? t("rejected")
      : status === "AI_HYPOTHESIS" ? t("aiHypothesis") : t("unknown");
  return '<span class="status-badge status-' + escapeHtml(String(status).toLowerCase()) + '">' + escapeHtml(label) + "</span>";
}

export function signalStatusBadge(status) {
  const labels = {
    DRAFT: t("draft"),
    NEEDS_REVIEW: t("needsReviewSignal"),
    CONFIRMED: t("confirmed"),
    RETURNED: t("returned"),
    ARCHIVED: t("archived"),
  };
  return '<span class="signal-status signal-' + escapeHtml(String(status).toLowerCase()) + '">' + escapeHtml(labels[status] ?? status) + "</span>";
}

export function evidenceHighlight(content, highlight) {
  const source = String(content ?? "");
  const quote = String(highlight ?? "");
  if (!quote || !source.includes(quote)) return escapeHtml(source);
  const index = source.indexOf(quote);
  return escapeHtml(source.slice(0, index)) + "<mark>" + escapeHtml(quote) + "</mark>" + escapeHtml(source.slice(index + quote.length));
}

export function confidenceLabel(_value) {
  const explanation = escapeHtml(t("confidenceExplanation"));
  return '<span class="confidence confidence-uncalibrated" title="' + explanation + '" aria-label="' + explanation + '">' +
    escapeHtml(t("uncalibrated")) + "</span>";
}

export function emptyState(message, action = "") {
  return '<div class="empty-state"><div class="empty-icon">' + icon("file") + "</div><p>" +
    escapeHtml(message) + "</p>" + action + "</div>";
}

export function button(label, action, options = {}) {
  const cls = options.className || "button button-secondary";
  const disabled = options.disabled ? " disabled" : "";
  return '<button type="button" class="' + escapeHtml(cls) + '" data-action="' + escapeHtml(action) + '"' +
    (options.data ?? "") + disabled + ">" + (options.icon ? icon(options.icon) : "") +
    '<span>' + escapeHtml(label) + "</span></button>";
}
