export const ACTOR = "Demo Analyst";

export const LEGAL_BASIS = Object.freeze({
  UNKNOWN: "UNKNOWN",
  UNDER_REVIEW: "UNDER_REVIEW",
  CONFIRMED_VALID: "CONFIRMED_VALID",
  CONFIRMED_ABSENT: "CONFIRMED_ABSENT",
});

export const FACTOR_STATUS = Object.freeze({
  UNKNOWN: "UNKNOWN",
  AI_HYPOTHESIS: "AI_HYPOTHESIS",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
});

export const FACTORS = Object.freeze({
  R1: Object.freeze({ weight: 35, label: "Проверенными данными установлено отсутствие применимого правового основания" }),
  R2: Object.freeze({ weight: 25, label: "Прямое предложение внести деньги" }),
  R3: Object.freeze({ weight: 10, label: "Активная реклама строящегося жилья" }),
  R4: Object.freeze({ weight: 15, label: "Подтверждённое коллективное обращение" }),
  R5: Object.freeze({ weight: 10, label: "Расхождение заявленной и подтверждённой готовности на 20 процентных пунктов или больше" }),
  R6: Object.freeze({ weight: 5, label: "Подтверждённый простой или значимая просрочка" }),
  DELAY: Object.freeze({ weight: 0, label: "Подтверждённый простой или значимая просрочка" }),
  R6_SCHEDULE_LEGACY: Object.freeze({ weight: 0, label: "Историческая запись о соблюдении графика; в модели кейса баллов не даёт" }),
});

// These are independent red-zone conditions from the specification. They do
// not change the R1–R6 score and require analyst confirmation with evidence.
export const RED_TRIGGER_FACTORS = Object.freeze({
  RED_MASKING_CONTRACT: Object.freeze({ weight: 0, label: "Подтверждено применение договора, прикрывающего привлечение средств" }),
  RED_CONFIRMED_PAYMENT: Object.freeze({ weight: 0, label: "Подтверждены платежи граждан" }),
});

export const SCORING_VERSION = "codemasters-8.0-saq-2026-10-20-v1";

export const SIGNAL_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  CONFIRMED: "CONFIRMED",
  RETURNED: "RETURNED",
  ARCHIVED: "ARCHIVED",
});

export const AD_STATUS = Object.freeze({
  NEW: "NEW",
  ANALYZED: "ANALYZED",
  MATCH_PENDING: "MATCH_PENDING",
  MATCHED: "MATCHED",
  REVIEWED: "REVIEWED",
  REJECTED: "REJECTED",
});

export const RISK_ZONE = Object.freeze({
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
});

export const ALLOWED_LEGAL_BASIS = new Set(Object.values(LEGAL_BASIS));
export const ALLOWED_FACTOR_STATUS = new Set(Object.values(FACTOR_STATUS));
export const ALLOWED_SIGNAL_STATUS = new Set(Object.values(SIGNAL_STATUS));
export const ALLOWED_AD_STATUS = new Set(Object.values(AD_STATUS));
