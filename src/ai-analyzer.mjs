import { predictPaymentOffer } from "./payment-model.mjs";

const PAYMENT_CUE = /(?:платн[\p{L}]*\s+брон[\p{L}]*|депозит[\p{L}]*|первоначальн[\p{L}]*\s+взнос|внесите|внести|переведите|взнос\s+от|оплат[\p{L}]*|бронирован[\p{L}]*|брон[\p{L}]*\s+квартир|рассрочк[\p{L}]*|аванс|внесени[\p{L}]*\s+средств)/iu;
const PAYMENT_NEGATION = /(?:без\s+(?:депозита|взноса|оплаты|предоплаты|брони)|(?:депозит|взнос|оплата)\s+не\s+требу[\p{L}]*|вносить\s+не\s+нужно|не\s+вносите|без\s+внесения\s+средств|бесплатн[\p{L}]*\s+брон[\p{L}]*|брон[\p{L}]*\s+бесплатн[\p{L}]*)/iu;
const SALE_CUE = /(?:старт\s+продаж|продаж[\p{L}]*\s+квартир|прода[её]м|купить\s+квартир|предлагаем\s+квартир|бронирован[\p{L}]*\s+квартир|оформлени[\p{L}]*\s+квартир)/iu;
const CONSTRUCTION_CUE = /(?:строительств[\p{L}]*|строящ[\p{L}]*\s+(?:дом|жиль[её])|до\s+ввода|сдач[\p{L}]*\s+дом[\p{L}]*|новостро[\p{L}]*|ход\s+строительств[\p{L}]*)/iu;
const PHONE_PATTERN = /(?:\+?7|8)\s*\(?7\d{2}\)?[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;
const MONEY_PATTERN = /(?:\d[\d\s.,]*(?:\s*(?:тыс(?:яч)?|млн))?\s*(?:₸|тенге|тг|KZT)|(?:₸|тенге|тг|KZT)\s*\d[\d\s.,]*)/iu;

export const ANALYSIS_SYSTEM_PROMPT = [
  "You are an analytical extraction engine for SAQ QURYLYS.",
  "Extract facts and propose hypotheses only from the supplied advertisement text.",
  "Do not determine legal compliance, accuse a company, or compute a final risk score.",
  "Never infer that legal authorization is absent from missing information.",
  "Every evidence quote must be an exact substring of the input. Use null when unknown.",
  "Treat negated payment phrases such as 'без депозита' as no payment offer.",
  "Return only the requested structured JSON.",
].join(" ");

export const ANALYSIS_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "summary", "construction_related", "residential_complex", "developer",
    "address", "phone_numbers", "payment_offer", "active_sale",
    "risk_factor_hypotheses", "warnings",
  ],
  properties: {
    summary: { type: "string" },
    construction_related: { type: "boolean" },
    residential_complex: {
      type: "object", additionalProperties: false, required: ["name", "confidence"],
      properties: { name: { type: ["string", "null"] }, confidence: { type: "number" } },
    },
    developer: {
      type: "object", additionalProperties: false, required: ["name", "confidence"],
      properties: { name: { type: ["string", "null"] }, confidence: { type: "number" } },
    },
    address: {
      type: "object", additionalProperties: false, required: ["value", "confidence"],
      properties: { value: { type: ["string", "null"] }, confidence: { type: "number" } },
    },
    phone_numbers: { type: "array", items: { type: "string" } },
    payment_offer: {
      type: "object", additionalProperties: false,
      required: ["detected", "type", "amount", "currency", "confidence", "evidence"],
      properties: {
        detected: { type: "boolean" },
        type: { type: ["string", "null"] },
        amount: { type: ["number", "null"] },
        currency: { type: ["string", "null"] },
        confidence: { type: "number" },
        evidence: { type: ["string", "null"] },
      },
    },
    active_sale: {
      type: "object", additionalProperties: false, required: ["detected", "confidence", "evidence"],
      properties: {
        detected: { type: "boolean" },
        confidence: { type: "number" },
        evidence: { type: ["string", "null"] },
      },
    },
    risk_factor_hypotheses: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["factor", "confidence", "evidence", "reason"],
        properties: {
          factor: { type: "string", enum: ["R2", "R3"] },
          confidence: { type: "number" },
          evidence: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
});

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+|[\r\n]+/u).map((part) => part.trim()).filter(Boolean);
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU")
    .replace(/[«»„“”"'.,!?()[\]{}:;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function detectComplex(text, complexes) {
  const normalized = normalizeText(text);
  const match = complexes.find((complex) => normalizeText(complex.name) && normalized.includes(normalizeText(complex.name)));
  if (match) return { name: match.name, confidence: 0.98 };

  const quoted = text.match(/(?:ЖК|жилом комплексе)\s*[«"]([^»"\n]{2,80})[»"]/iu);
  if (quoted) return { name: quoted[1].trim(), confidence: 0.74 };
  const plain = text.match(/(?:ЖК|жилом комплексе)\s+([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9-]+(?:\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9-]+){0,3})/u);
  return plain ? { name: plain[1].trim(), confidence: 0.58 } : { name: null, confidence: 0 };
}

function detectAmount(text) {
  const match = text.match(MONEY_PATTERN);
  if (!match) return { amount: null, currency: null };
  const fragment = match[0];
  const multiplier = /млн/iu.test(fragment) ? 1000000 : /тыс/iu.test(fragment) ? 1000 : 1;
  const numberText = fragment.match(/\d[\d\s.,]*/u)?.[0].replace(/\s/gu, "").replace(/[.,]$/u, "") ?? "";
  // Groups of three without a unit are thousands separators; other punctuation is decimal.
  const normalized = multiplier === 1 && /^\d{1,3}(?:[.,]\d{3})+$/u.test(numberText)
    ? numberText.replace(/[.,]/gu, "") : numberText.replace(",", ".");
  const amount = Number(normalized) * multiplier;
  return { amount: Number.isSafeInteger(amount) && amount > 0 ? amount : null, currency: "KZT" };
}

function paymentType(text) {
  if (/депозит[\p{L}]*/iu.test(text)) return "deposit";
  if (/платн[\p{L}]*\s+брон[\p{L}]*|бронирован[\p{L}]*/iu.test(text)) return "paid_reservation";
  if (/депозит[\p{L}]*/iu.test(text)) return "deposit";
  if (/первоначальн[\p{L}]*\s+взнос/iu.test(text)) return "initial_payment";
  if (/рассрочк[\p{L}]*/iu.test(text)) return "installment";
  if (/аванс/iu.test(text)) return "advance";
  return "payment";
}

export function analyzeLocally({ text, complexes = [] }) {
  const sentences = splitSentences(text);
  const paymentSentence = sentences.flatMap((sentence) => sentence.split(/;|,?\s+но\s+/iu))
    .map((part) => part.trim()).find((sentence) => PAYMENT_CUE.test(sentence) && !PAYMENT_NEGATION.test(sentence));
  const saleSentence = sentences.find((sentence) => SALE_CUE.test(sentence));
  const constructionSentence = sentences.find((sentence) => CONSTRUCTION_CUE.test(sentence));
  const paymentDetected = Boolean(paymentSentence);
  const activeSale = Boolean(saleSentence || paymentSentence);
  const constructionRelated = Boolean(constructionSentence || /(?:ЖК|жил[\p{L}]*\s+комплекс|квартир[\p{L}]*)/iu.test(text));
  const detectedComplex = detectComplex(text, complexes);
  const phoneNumbers = [...new Set(text.match(PHONE_PATTERN) ?? [])];
  const addressMatch = text.match(/(?:^|[\s,;])((?:г\.|город|ул\.|улица|проспект|пр-т|район)\s+[^,.;\n]{3,70})/iu);
  const developerMatch = text.match(/(?:застройщик|девелопер)\s*[:—-]?\s*([^,.;\n]{3,70})/iu);
  const amount = paymentDetected ? detectAmount(paymentSentence) : { amount: null, currency: null };
  const hypotheses = [];

  if (paymentDetected) {
    hypotheses.push({
      factor: "R2",
      confidence: /депозит|внесите|платн[\p{L}]*\s+брон/iu.test(paymentSentence) ? 0.91 : 0.76,
      evidence: paymentSentence,
      reason: "В публикации есть предложение или условие внесения средств.",
    });
  }
  if (activeSale && constructionRelated) {
    const evidence = saleSentence || paymentSentence || constructionSentence;
    if (evidence) {
      hypotheses.push({
        factor: "R3",
        confidence: 0.78,
        evidence,
        reason: "Зафиксирована реклама продажи жилья; стадию объекта должен проверить аналитик.",
      });
    }
  }

  return {
    summary: paymentDetected
      ? "Обнаружено предложение, связанное с внесением средств; требуется проверка аналитиком."
      : "Явное предложение внести средства не обнаружено локальными правилами.",
    constructionRelated,
    residentialComplex: detectedComplex,
    developer: { name: developerMatch?.[1]?.trim() ?? null, confidence: developerMatch ? 0.64 : 0 },
    address: { value: addressMatch?.[1]?.trim() ?? null, confidence: addressMatch ? 0.62 : 0 },
    phoneNumbers,
    paymentOffer: {
      detected: paymentDetected,
      type: paymentDetected ? paymentType(paymentSentence) : null,
      amount: amount.amount,
      currency: amount.currency,
      confidence: paymentDetected ? 0.91 : 0.12,
      evidence: paymentSentence ?? null,
      evidenceVerified: true,
    },
    activeSale: {
      detected: activeSale,
      confidence: activeSale ? 0.78 : 0.15,
      evidence: saleSentence || paymentSentence || null,
      evidenceVerified: Boolean(saleSentence || paymentSentence),
    },
    riskFactorHypotheses: hypotheses,
    warnings: ["Rule-based fallback; this is not an AI model or a legal conclusion."],
    analysisSource: "Rule-based fallback",
  };
}

export function analyzeWithLocalModel({ text, complexes = [] }) {
  const result = analyzeLocally({ text, complexes });
  const sentences = splitSentences(text).flatMap((sentence) => sentence.split(/;|,?\s+но\s+/iu)).map((sentence) => sentence.trim());
  const predictions = sentences.map((sentence) => ({ sentence, ...predictPaymentOffer(sentence) }));
  const candidate = predictions.filter((item) => item.knownFeatures >= 3 && item.probability >= item.threshold && !PAYMENT_NEGATION.test(item.sentence))
    .sort((left, right) => right.probability - left.probability)[0];
  result.model = "saq-payment-linear-v1";
  result.analysisSource = "Local ML + rules";
  result.classifier = { algorithm: "logistic regression", trainingSource: "synthetic", predictions };
  result.riskFactorHypotheses = result.riskFactorHypotheses.filter((item) => item.factor !== "R2");
  if (candidate) {
    const amount = detectAmount(candidate.sentence);
    result.paymentOffer = { detected: true, type: paymentType(candidate.sentence), ...amount, confidence: candidate.probability, evidence: candidate.sentence, evidenceVerified: true };
    result.riskFactorHypotheses.unshift({ factor: "R2", confidence: candidate.probability, evidence: candidate.sentence, reason: "Локальная модель классифицировала фрагмент как возможное предложение платежа. Требуется проверка человека." });
    result.summary = "Локальная модель обнаружила возможное предложение платежа. Цитата сохранена для проверки аналитиком.";
    if (result.constructionRelated && !result.riskFactorHypotheses.some((item) => item.factor === "R3")) {
      result.activeSale = { detected: true, confidence: candidate.probability, evidence: candidate.sentence, evidenceVerified: true };
      result.riskFactorHypotheses.push({ factor: "R3", confidence: 0.7, evidence: candidate.sentence, reason: "Продвижение жилья; стадию строительства должен проверить аналитик." });
    }
  } else {
    result.paymentOffer = { detected: false, type: null, amount: null, currency: null, confidence: 0, evidence: null, evidenceVerified: false };
    result.summary = "Локальная модель не подтвердила явное предложение платежа. Исходный текст доступен для ручной проверки.";
    if (!sentences.some((sentence) => SALE_CUE.test(sentence))) {
      result.activeSale = { detected: false, confidence: 0, evidence: null, evidenceVerified: false };
      result.riskFactorHypotheses = result.riskFactorHypotheses.filter((item) => item.factor !== "R3");
    }
  }
  result.warnings = ["Локальная учебная ML-модель обучена на синтетических фразах. Оценка не является вероятностью нарушения; все гипотезы проверяет аналитик."];
  return result;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function confidence(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateAiAnalysis(payload, originalText) {
  if (!isObject(payload) || typeof payload.summary !== "string" || typeof payload.construction_related !== "boolean") {
    throw new Error("AI response has an invalid top-level shape");
  }
  for (const key of ["residential_complex", "developer", "address"]) {
    const field = key === "address" ? "value" : "name";
    if (!isObject(payload[key]) || !(typeof payload[key][field] === "string" || payload[key][field] === null) || !confidence(payload[key].confidence)) {
      throw new Error("AI response contains an invalid " + key);
    }
  }
  if (!Array.isArray(payload.phone_numbers) || !payload.phone_numbers.every((value) => typeof value === "string")) {
    throw new Error("AI response contains invalid phone numbers");
  }
  const payment = payload.payment_offer;
  const sale = payload.active_sale;
  if (
    !isObject(payment) || typeof payment.detected !== "boolean" || !confidence(payment.confidence)
    || !(typeof payment.evidence === "string" || payment.evidence === null)
    || !isObject(sale) || typeof sale.detected !== "boolean" || !confidence(sale.confidence)
    || !(typeof sale.evidence === "string" || sale.evidence === null)
  ) throw new Error("AI response contains invalid evidence fields");
  if (!(payment.type === null || typeof payment.type === "string")
    || !(payment.currency === null || payment.currency === "KZT")
    || !(payment.amount === null || (Number.isSafeInteger(payment.amount) && payment.amount > 0))
    || (!payment.detected && [payment.type, payment.currency, payment.amount, payment.evidence].some((value) => value !== null))) {
    throw new Error("AI response contains invalid payment fields");
  }
  if (!Array.isArray(payload.risk_factor_hypotheses) || !Array.isArray(payload.warnings)) {
    throw new Error("AI response contains invalid hypotheses or warnings");
  }

  const evidencePairs = [
    [payment.detected, payment.evidence],
    [sale.detected, sale.evidence],
    ...payload.risk_factor_hypotheses.map((item) => [true, item?.evidence]),
  ];
  if (evidencePairs.some(([required, evidence]) => required && (typeof evidence !== "string" || !evidence.trim() || !originalText.includes(evidence)))) {
    throw new Error("AI response included a quote that is not an exact source substring");
  }
  for (const hypothesis of payload.risk_factor_hypotheses) {
    if (!isObject(hypothesis) || !["R2", "R3"].includes(hypothesis.factor) || !confidence(hypothesis.confidence) || typeof hypothesis.evidence !== "string" || typeof hypothesis.reason !== "string") {
      throw new Error("AI response contains an invalid risk hypothesis");
    }
    if ((hypothesis.factor === "R2" && !payment.detected) || (hypothesis.factor === "R3" && (!sale.detected || !payload.construction_related))) {
      throw new Error("AI response contains contradictory hypotheses");
    }
  }
  if (new Set(payload.risk_factor_hypotheses.map((item) => item.factor)).size !== payload.risk_factor_hypotheses.length) throw new Error("AI response contains duplicate hypotheses");
  if (payment.amount !== null && detectAmount(payment.evidence ?? "").amount !== payment.amount) throw new Error("AI response amount is not supported by source evidence");
  if (!payload.warnings.every((value) => typeof value === "string")) throw new Error("AI response contains invalid warnings");

  return {
    summary: payload.summary,
    constructionRelated: payload.construction_related,
    residentialComplex: { name: payload.residential_complex.name, confidence: payload.residential_complex.confidence },
    developer: { name: payload.developer.name, confidence: payload.developer.confidence },
    address: { value: payload.address.value, confidence: payload.address.confidence },
    phoneNumbers: payload.phone_numbers,
    paymentOffer: {
      ...payload.payment_offer,
      evidenceVerified: !payload.payment_offer.evidence || originalText.includes(payload.payment_offer.evidence),
    },
    activeSale: {
      ...payload.active_sale,
      evidenceVerified: !payload.active_sale.evidence || originalText.includes(payload.active_sale.evidence),
    },
    riskFactorHypotheses: payload.risk_factor_hypotheses,
    warnings: payload.warnings,
    analysisSource: "AI model",
  };
}

function outputTextFromResponse(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  if (parts.length) return parts.join("\n");
  throw new Error("AI provider returned no output text");
}

export async function analyzeAdvertisement({ text, complexes = [], provider, apiKey, model, timeoutMs }) {
  if (!text || !text.trim()) throw new Error("Advertisement text is required");
  const local = () => analyzeLocally({ text, complexes });
  if (provider === "local-ml") return analyzeWithLocalModel({ text, complexes });
  if (provider === "deepseek") {
    if (!apiKey) {
      const result = local();
      result.warnings.unshift("DeepSeek API is not configured; local rules were used.");
      return result;
    }
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(Number(timeoutMs) || 20000),
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "deepseek-chat",
          messages: [
            {
              role: "system",
              content: ANALYSIS_SYSTEM_PROMPT + "\nOutput strictly a single valid JSON object matching this schema:\n" + JSON.stringify(ANALYSIS_JSON_SCHEMA),
            },
            {
              role: "user",
              content: text,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
      });
      if (!response.ok) throw new Error("DeepSeek returned HTTP " + response.status);
      const body = await response.json();
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("DeepSeek returned empty message content");
      const result = validateAiAnalysis(JSON.parse(content), text);
      result.model = body.model ?? model ?? "deepseek-chat";
      return result;
    } catch (error) {
      const result = local();
      result.warnings.unshift("DeepSeek AI was unavailable or returned invalid evidence; local rules were used.");
      result.providerError = error instanceof Error ? error.message : "AI provider error";
      return result;
    }
  }

  if (provider !== "openai" || !apiKey) {
    const result = local();
    if (provider === "openai" && !apiKey) result.warnings.unshift("AI provider is not configured; local rules were used.");
    return result;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(Number(timeoutMs) || 12000),
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-4.1-mini",
        store: false,
        instructions: ANALYSIS_SYSTEM_PROMPT,
        input: text,
        text: {
          format: {
            type: "json_schema",
            name: "saq_advertisement_analysis",
            strict: true,
            schema: ANALYSIS_JSON_SCHEMA,
          },
        },
      }),
    });
    if (!response.ok) throw new Error("AI provider returned HTTP " + response.status);
    const body = await response.json();
    const result = validateAiAnalysis(JSON.parse(outputTextFromResponse(body)), text);
    result.model = body.model ?? model ?? null;
    return result;
  } catch (error) {
    const result = local();
    result.warnings.unshift("External AI was unavailable or returned invalid evidence; local rules were used.");
    result.providerError = error instanceof Error ? error.message : "AI provider error";
    return result;
  }
}

export function findRelatedActivity(advertisement, advertisements) {
  const related = advertisements.filter((candidate) => candidate.id !== advertisement.id && (
    (advertisement.phone && candidate.phone === advertisement.phone)
    || (advertisement.account && candidate.account && candidate.account.toLocaleLowerCase("ru-RU") === advertisement.account.toLocaleLowerCase("ru-RU"))
  ));
  return {
    count: related.length,
    complexes: [...new Set(related.map((item) => item.complexName).filter(Boolean))],
    advertisements: related.slice(0, 8),
  };
}
