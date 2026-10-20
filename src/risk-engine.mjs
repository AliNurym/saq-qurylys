import { FACTORS, FACTOR_STATUS, LEGAL_BASIS, RISK_ZONE, SCORING_VERSION } from "./constants.mjs";

export const ZONE_POLICY_VERSION = "codemasters-8.0-saq-zones-v1";

export function calculateRisk(factors, legalBasisStatus = LEGAL_BASIS.UNKNOWN, settings = null, objectConditions = null) {
  if (!Array.isArray(factors)) throw new TypeError("factors must be an array");

  const normalized = factors
    .filter((factor) => factor && Object.hasOwn(FACTORS, factor.code))
    .map((factor) => ({
      ...factor,
      weight: FACTORS[factor.code].weight,
    }));
  const confirmedFactors = normalized.filter((factor) => factor.status === FACTOR_STATUS.CONFIRMED
    && (factor.code !== "R1" || legalBasisStatus === LEGAL_BASIS.CONFIRMED_ABSENT));
  const hypotheses = normalized.filter((factor) => factor.status === FACTOR_STATUS.AI_HYPOTHESIS);
  const unknownFactors = normalized.filter((factor) => factor.status === FACTOR_STATUS.UNKNOWN);
  const rejectedFactors = normalized.filter((factor) => factor.status === FACTOR_STATUS.REJECTED);
  const scoredFactors = [...new Map(confirmedFactors.map((factor) => [factor.code, factor])).values()];
  const has = (code) => scoredFactors.some((factor) => factor.code === code);
  const score = Math.max(0, Math.min(100, scoredFactors.reduce((sum, factor) => sum + factor.weight, 0)));

  const greenCheckMissing = legalBasisStatus === LEGAL_BASIS.CONFIRMED_VALID && objectConditions?.eligible !== true;
  const needsReview = [LEGAL_BASIS.UNKNOWN, LEGAL_BASIS.UNDER_REVIEW].includes(legalBasisStatus)
    || hypotheses.length > 0 || unknownFactors.length > 0 || greenCheckMissing;
  const redRuleSatisfied = score >= 60 && has("R1") && has("R2");
  const zone = redRuleSatisfied ? RISK_ZONE.RED : score >= 25 ? RISK_ZONE.YELLOW : RISK_ZONE.GREEN;

  const explanation = scoredFactors.map((factor) => ({
    code: factor.code,
    label: FACTORS[factor.code].label,
    points: factor.weight,
    evidenceCount: confirmedFactors.filter((item) => item.code === factor.code).length,
    evidenceText: factor.evidenceText ?? null,
    sourceType: factor.sourceType ?? null,
    sourceId: factor.sourceId ?? null,
  }));
  const zoneExplanation = redRuleSatisfied
    ? "Красная зона: набрано не менее 60 баллов и подтверждены R1 и R2"
    : score >= 60
      ? "Жёлтая зона: 60 или больше баллов, но комбинация подтверждённых R1 и R2 отсутствует"
      : score >= 25
        ? "Жёлтая зона: от 25 до 59 баллов; нужна углублённая ручная проверка"
        : "Зелёная зона: от 0 до 24 баллов; неизвестные сведения отдельно требуют проверки";
  explanation.push({ code: "ZONE_RULE", points: 0, label: zoneExplanation });

  if (greenCheckMissing) explanation.push({
    code: "OBJECT_CONDITIONS_REQUIRED",
    points: 0,
    label: "Дополнительные условия объекта требуют проверки; это не меняет балл базовой модели кейса",
    reason: objectConditions?.reason ?? "NOT_REVIEWED",
  });
  if ([LEGAL_BASIS.UNKNOWN, LEGAL_BASIS.UNDER_REVIEW].includes(legalBasisStatus)) {
    explanation.push({ code: "LEGAL_UNKNOWN", label: "Основание не проверено; R1 не начисляется", points: 0 });
  }

  return {
    score,
    zone,
    zonePolicyVersion: ZONE_POLICY_VERSION,
    confirmedFactors,
    scoredFactors,
    hypotheses,
    unknownFactors,
    rejectedFactors,
    needsReview,
    explanation,
    redRuleSatisfied,
    baseRedRuleSatisfied: redRuleSatisfied,
    qualifyingRedTriggers: [],
    greenEligibility: {
      eligible: objectConditions?.eligible === true,
      reason: objectConditions?.reason ?? "NOT_REVIEWED",
      reviewId: objectConditions?.latestReviewId ?? null,
      validThrough: objectConditions?.review?.validThrough ?? null,
    },
    scoringVersion: SCORING_VERSION,
    monitoringDays: zone === RISK_ZONE.GREEN ? 30 : zone === RISK_ZONE.YELLOW ? 7 : 0,
  };
}

export function displayRiskCategory(risk) {
  return risk.zone;
}

export const ACTOR = "Demo Analyst";
