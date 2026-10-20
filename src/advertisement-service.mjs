import { currentActor, readScope } from "./access-service.mjs";
import { randomUUID } from "node:crypto";
import { AD_STATUS, FACTORS, FACTOR_STATUS } from "./constants.mjs";
import { analyzeAdvertisement } from "./ai-analyzer.mjs";
import { matchAdvertisement } from "./entity-matcher.mjs";
import { calculateComplexRisk, recordRiskIfChanged } from "./complex-service.mjs";
import { inTransaction } from "./db.mjs";
import { writeAudit } from "./audit-service.mjs";
import { getAiConfig } from "./config.mjs";
import { getDataset } from "./dataset-service.mjs";
import { todayInKazakhstan, validPublicationDate } from "./dates.mjs";
import { serializeAdvertisement, serializeComplex, serializeFactor } from "./serializers.mjs";
import { listEvidence } from "./evidence-service.mjs";
import { matchRiskPhrases, getSettings } from "./settings-service.mjs";
import { getCollectionProvenance } from "./collection-evidence.mjs";

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function parseAnalysis(row) {
  if (!row) return null;
  try { return JSON.parse(row.analysis_json); } catch { return null; }
}

function latestAnalysis(db, advertisementId) {
  return db.prepare(
    "SELECT * FROM ai_analyses WHERE advertisement_id = ? ORDER BY created_at DESC LIMIT 1",
  ).get(advertisementId) ?? null;
}

function writeAnalysis(db, advertisementId, result) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO ai_analyses (id,advertisement_id,model,created_at,status,summary,detected_complex_name,detected_address,detected_developer,detected_phone,payment_detected,payment_type,amount,currency,confidence,evidence_text,analysis_source,analysis_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id, advertisementId, result.model ?? null, createdAt, "COMPLETED", result.summary,
    result.residentialComplex?.name ?? null, result.address?.value ?? null,
    result.developer?.name ?? null, result.phoneNumbers?.[0] ?? null,
    result.paymentOffer?.detected ? 1 : 0, result.paymentOffer?.type ?? null,
    result.paymentOffer?.amount ?? null, result.paymentOffer?.currency ?? null,
    result.paymentOffer?.confidence ?? 0, result.paymentOffer?.evidence ?? null,
    result.analysisSource, JSON.stringify(result),
  );
  return id;
}

function getMatchCandidates(db, ad, analysis) {
  const complexes = db.prepare("SELECT * FROM complexes").all().map(serializeComplex);
  const contacts = db.prepare("SELECT complex_id AS complexId,type,value FROM complex_contacts").all();
  return matchAdvertisement({
    ...ad,
    detectedComplexName: analysis?.residentialComplex?.name ?? "",
    detectedAddress: analysis?.address?.value ?? "",
    detectedDeveloper: analysis?.developer?.name ?? "",
  }, complexes, contacts);
}

export function listAdvertisementPlatforms(db,scope=null) {
  const rows=db.prepare('SELECT DISTINCT platform,complex_id FROM advertisements').all();
  return [...new Set(rows.filter(row=>!scope||scope.has(row.complex_id)).map(row=>row.platform))].sort((a,b)=>a.localeCompare(b,'ru'));
}

export function listAdvertisements(db, filters = {}, scope = null) {
  const rows = db.prepare(
    "SELECT a.*, c.name AS complex_name, p.name AS proposed_complex_name, x.payment_detected, x.confidence, x.analysis_source, x.analysis_json,o.id AS origin_id,o.published_at AS origin_published_at,o.observed_at AS origin_observed_at" +
    " FROM advertisements a LEFT JOIN complexes c ON c.id = a.complex_id LEFT JOIN complexes p ON p.id = a.suggested_complex_id" +
    " LEFT JOIN ai_analyses x ON x.id = (SELECT ai.id FROM ai_analyses ai WHERE ai.advertisement_id = a.id ORDER BY ai.created_at DESC LIMIT 1)" +
    " LEFT JOIN collected_publications o ON o.advertisement_id=a.id" +
    " ORDER BY a.publication_date DESC, a.created_at DESC",
  ).all();
  let ads = rows.map((row) => ({
    ...serializeAdvertisement(row),
    publicationDateBasis:row.origin_id?(row.origin_published_at?'SOURCE_DECLARED':'OBSERVED'):'MANUAL_DECLARED',
    observedAt:row.origin_observed_at??null,
    complexName: row.complex_name,
    proposedComplexName: row.proposed_complex_name,
    paymentDetected: Boolean(row.payment_detected),
    confidence: row.confidence ?? 0,
    analysisSource: row.analysis_source ?? null,
    analysis: parseAnalysis(row),
    riskPhrases: matchRiskPhrases(db, row.text),
  }));
  if (scope) ads=ads.filter(ad=>scope.has(ad.complexId));
  if (filters.status === "new") ads = ads.filter((ad) => [AD_STATUS.NEW, AD_STATUS.ANALYZED, AD_STATUS.MATCH_PENDING].includes(ad.linkStatus));
  if (filters.status === "reviewed") ads = ads.filter((ad) => ad.linkStatus === AD_STATUS.REVIEWED || ad.linkStatus === AD_STATUS.MATCHED);
  if (filters.status === "suspect") ads = ads.filter((ad) => ad.paymentDetected);
  if (filters.status === "unlinked") ads = ads.filter((ad) => !ad.complexId);
  if (filters.status === "high-confidence") ads = ads.filter((ad) => ad.confidence >= 0.85);
  if (filters.platform) ads = ads.filter((ad) => ad.platform === filters.platform);
  if (filters.complexId) ads = ads.filter((ad) => ad.complexId === filters.complexId || ad.proposedComplexId === filters.complexId);
  if (filters.query) {
    const query = filters.query.toLocaleLowerCase("ru-RU");
    ads = ads.filter((ad) => [ad.text, ad.platform, ad.account, ad.complexName, ad.proposedComplexName]
      .some((value) => String(value ?? "").toLocaleLowerCase("ru-RU").includes(query)));
  }
  if (filters.sort === "risk") ads.sort((a, b) => b.riskPhrases.reduce((sum,item)=>sum+item.weight,0)
    - a.riskPhrases.reduce((sum,item)=>sum+item.weight,0) || b.publicationDate.localeCompare(a.publicationDate));
  return ads;
}

export function getAdvertisementDetails(db, advertisementId) {
  const scope=readScope(db);
  const row = db.prepare(
    "SELECT a.*, c.name AS complex_name, c.city AS complex_city, p.name AS proposed_complex_name FROM advertisements a LEFT JOIN complexes c ON c.id = a.complex_id LEFT JOIN complexes p ON p.id = a.suggested_complex_id WHERE a.id = ?",
  ).get(advertisementId);
  if (!row) return null;
  const ad = serializeAdvertisement(row);
  const analysisRow = latestAnalysis(db, advertisementId);
  const analysis = parseAnalysis(analysisRow);
  const matches = getMatchCandidates(db, ad, analysis).filter(item=>!scope || scope.has(item.complexId));
  const relatedRows = db.prepare(
    "SELECT a.*, c.name AS complex_name FROM advertisements a LEFT JOIN complexes c ON c.id = a.complex_id ORDER BY a.publication_date DESC",
  ).all();
  const related = relatedRows.map((item) => ({
    ...serializeAdvertisement(item),
    complexName: item.complex_name,
  })).filter((item) => (!scope || scope.has(item.complexId)) && item.id !== ad.id && (
    (ad.phone && item.phone === ad.phone)
    || (ad.account && item.account && item.account.toLocaleLowerCase("ru-RU") === ad.account.toLocaleLowerCase("ru-RU"))
  ));
  const factors = db.prepare(
    "SELECT * FROM risk_factors WHERE source_id = ? ORDER BY created_at DESC",
  ).all(ad.id).map(serializeFactor);
  const complexRow = row.complex_id ? db.prepare("SELECT * FROM complexes WHERE id = ?").get(row.complex_id) : null;
  return {
    ...ad,
    complexName: row.complex_name,
    complexCity: row.complex_city,
    proposedComplexName: row.proposed_complex_name,
    evidenceFiles: listEvidence(db, advertisementId),
    collection: getCollectionProvenance(db, advertisementId),
    riskPhrases: matchRiskPhrases(db, ad.text),
    analysis,
    analysisMeta: analysisRow ? {
      id: analysisRow.id,
      model: analysisRow.model,
      status: analysisRow.status,
      createdAt: analysisRow.created_at,
      source: analysisRow.analysis_source,
    } : null,
    matches,
    factors,
    relatedActivity: {
      count: related.length,
      complexNames: [...new Set(related.map((item) => item.complexName).filter(Boolean))],
      advertisements: related.slice(0, 8),
    },
    currentComplexRisk: complexRow ? calculateComplexRisk(db, complexRow.id) : null,
  };
}

function validateAdvertisement(input) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < 5) fail(400, "Добавьте текст публикации длиной не менее 5 символов.");
  if (text.length > 12000) fail(400, "Текст публикации слишком длинный (максимум 12 000 символов).");
  const publicationDate = input.publicationDate || todayInKazakhstan();
  if (!validPublicationDate(publicationDate)) {
    fail(400, "Проверьте дату публикации.");
  }
  const url = String(input.url ?? "").trim();
  if (url.length > 500) fail(400, "Ссылка слишком длинная (максимум 500 символов).");
  if (url) {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { fail(400, "Введите корректный URL."); }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) fail(400, "Разрешены только ссылки http или https.");
    if (parsedUrl.username || parsedUrl.password) fail(400, "Ссылка не должна содержать логин или пароль.");
  }
  return {
    text,
    platform: String(input.platform || "Другое").slice(0, 60),
    account: String(input.account || "").trim().slice(0, 120) || null,
    phone: String(input.phone || "").trim().slice(0, 40) || null,
    url: url || null,
    notes: String(input.notes || "").trim().slice(0, 500) || null,
    publicationDate,
  };
}

async function analyzeAndStore(db, advertisementId, text) {
  const complexes = db.prepare("SELECT id,name FROM complexes").all();
  const config = getAiConfig();
  const analysis = await analyzeAdvertisement({
    text,
    complexes,
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });
  analysis.riskPhrases = matchRiskPhrases(db, text);
  writeAnalysis(db, advertisementId, analysis);
  const current = db.prepare("SELECT * FROM advertisements WHERE id = ?").get(advertisementId);
  if (current && !current.complex_id) {
    const proposed = getMatchCandidates(db, serializeAdvertisement(current), analysis);
    db.prepare("UPDATE advertisements SET suggested_complex_id = ?, link_status = ? WHERE id = ?")
      .run(proposed[0]?.complexId ?? null, proposed.length ? AD_STATUS.MATCH_PENDING : AD_STATUS.ANALYZED, advertisementId);
  } else if (current?.complex_id) {
    const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(current.complex_id);
    for (const hypothesis of analysis.riskFactorHypotheses) storeHypothesis(db, complex, current, hypothesis);
  }
  writeAudit(db, "ADVERTISEMENT", advertisementId, "ADVERTISEMENT_ANALYZED", {
    source: analysis.analysisSource,
    paymentDetected: analysis.paymentOffer.detected,
    confidence: analysis.paymentOffer.confidence,
  });
  return analysis;
}

// Synchronous persistence allows a collector to commit provenance and its archive atomically.
// Analysis is deliberately outside this transaction because providers can perform network I/O.
export function persistAdvertisement(db, input) {
  const values = validateAdvertisement(input ?? {});
  const id = "ad-" + randomUUID();
  const capturedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO advertisements (id,platform,account,phone,publication_date,url,text,screenshot_path,notes,captured_at,complex_id,suggested_complex_id,link_status,is_demo,created_at) VALUES (?,?,?,?,?,?,?,NULL,?,?,NULL,NULL,'NEW',?,?)",
  ).run(id, values.platform, values.account, values.phone, values.publicationDate, values.url, values.text, values.notes, capturedAt, Number(getDataset(db).isDemo), capturedAt);
  writeAudit(db, "ADVERTISEMENT", id, "ADVERTISEMENT_CREATED", { platform: values.platform, notes: values.notes });
  return id;
}

export async function createAdvertisement(db, input) {
  const id = inTransaction(db, () => persistAdvertisement(db, input));
  await analyzeAndStore(db, id, validateAdvertisement(input ?? {}).text);
  return getAdvertisementDetails(db, id);
}

export async function reanalyzeAdvertisement(db, advertisementId) {
  const ad = db.prepare("SELECT * FROM advertisements WHERE id = ?").get(advertisementId);
  if (!ad) fail(404, "Публикация не найдена.");
  await analyzeAndStore(db, advertisementId, ad.text);
  return getAdvertisementDetails(db, advertisementId);
}

function storeHypothesis(db, complex, advertisement, hypothesis) {
  if (!Object.hasOwn(FACTORS, hypothesis.factor) || !["R2", "R3"].includes(hypothesis.factor)) return null;
  if (!hypothesis.evidence || !advertisement.text.includes(hypothesis.evidence)) return null;
  if (hypothesis.factor === "R3" && complex.commissioning_status !== "UNDER_CONSTRUCTION") return null;
  const existing = db.prepare(
    "SELECT * FROM risk_factors WHERE complex_id = ? AND code = ? AND source_type = 'AI_EXTRACTION' AND source_id = ?",
  ).get(complex.id, hypothesis.factor, advertisement.id);
  if (existing) return serializeFactor(existing);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_id,source_label,evidence_text,confidence,notes,is_demo,created_at) VALUES (?,?,?,?,?,'AI_EXTRACTION',?,?,?,?,?,?,?)",
  ).run(
    id, complex.id, hypothesis.factor, getSettings(db).weights[hypothesis.factor], FACTOR_STATUS.AI_HYPOTHESIS,
    advertisement.id, "Извлечение из публикации " + advertisement.id, hypothesis.evidence,
    hypothesis.confidence, "Требует подтверждения аналитиком; баллы пока не начислены.", complex.is_demo, new Date().toISOString(),
  );
  return serializeFactor(db.prepare("SELECT * FROM risk_factors WHERE id = ?").get(id));
}

export function confirmAdvertisementMatch(db, advertisementId, complexId) {
  const ad = db.prepare("SELECT * FROM advertisements WHERE id = ?").get(advertisementId);
  const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId);
  if (!ad) fail(404, "Публикация не найдена.");
  if (!complex) fail(404, "Жилой комплекс не найден.");
  if (ad.complex_id && ad.complex_id !== complexId) fail(409, "Публикация уже связана с другим ЖК. Изменение связи требует отдельного пересмотра доказательств.");
  if (ad.complex_id === complexId) return { advertisement: getAdvertisementDetails(db, advertisementId), createdFactors: [], risk: calculateComplexRisk(db, complexId), scoreChanged: false };
  const analysis = parseAnalysis(latestAnalysis(db, advertisementId));
  const hypotheses = analysis?.riskFactorHypotheses ?? [];
  const beforeRisk = calculateComplexRisk(db, complexId);
  const savedFactors = [];
  inTransaction(db, () => {
    db.prepare("UPDATE advertisements SET complex_id = ?, suggested_complex_id = NULL, link_status = 'MATCHED' WHERE id = ?")
      .run(complexId, advertisementId);
    for (const hypothesis of hypotheses) {
      const factor = storeHypothesis(db, complex, ad, hypothesis);
      if (factor) savedFactors.push(factor);
    }
    writeAudit(db, "ADVERTISEMENT", advertisementId, "ADVERTISEMENT_MATCH_CONFIRMED", { complexId, complexName: complex.name });
    writeAudit(db, "COMPLEX", complexId, "ADVERTISEMENT_LINKED", { complexId, advertisementId, complexName: complex.name });
    db.prepare("UPDATE complexes SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), complexId);
  });
  const risk = calculateComplexRisk(db, complexId);
  return {
    advertisement: getAdvertisementDetails(db, advertisementId),
    createdFactors: savedFactors,
    risk,
    scoreChanged: beforeRisk.score !== risk.score,
  };
}

export function reviewFactor(db, factorId, input = {}) {
  return inTransaction(db,()=>reviewFactorRecord(db,factorId,input));
}
function reviewFactorRecord(db,factorId,input) {
  const status = input.status;
  if (![FACTOR_STATUS.CONFIRMED, FACTOR_STATUS.REJECTED, FACTOR_STATUS.UNKNOWN].includes(status)) {
    fail(400, "Недопустимый статус фактора.");
  }
  const factor = db.prepare("SELECT * FROM risk_factors WHERE id = ?").get(factorId);
  if (!factor) fail(404, "Фактор не найден.");
  if(factor.source_type==='COMPLAINT'&&db.prepare('SELECT 1 FROM complaint_intakes WHERE complaint_id=?').get(factor.source_id))fail(409,'Этот фактор управляется решением по обращению. Откройте вкладку обращений ЖК.');
  if (input.expectedStatus && input.expectedStatus !== factor.status) fail(409, "Фактор уже изменён. Обновите страницу перед повторной проверкой.");
  if (factor.status === status) return { factor: serializeFactor(factor), risk: calculateComplexRisk(db, factor.complex_id) };
  const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(factor.complex_id);
  if (status === FACTOR_STATUS.CONFIRMED) {
    validateFactorContext(factor.code, complex);
    if(factor.code==='R5') {
      const context=factor.context_json?JSON.parse(factor.context_json):null;
      if((context?.readinessRevision??0)!==complex.readiness_revision)fail(409,'Исходные сведения готовности изменились. Создайте новый R5 с актуальным доказательством.');
    }
  }
  if (factor.code === "R1" && status === FACTOR_STATUS.CONFIRMED && complex.legal_basis_status !== "CONFIRMED_ABSENT") {
    fail(409, "R1 можно подтвердить только при статусе «Подтверждено отсутствие» и указанном источнике проверки.");
  }
  if (status === FACTOR_STATUS.CONFIRMED && (!factor.evidence_text || !factor.source_label)) {
    fail(400, "Для подтверждения нужны источник и фрагмент доказательства.");
  }
  if (status === FACTOR_STATUS.CONFIRMED && ["ADVERTISEMENT", "AI_EXTRACTION"].includes(factor.source_type)) {
    const sourceAd = db.prepare("SELECT text, complex_id FROM advertisements WHERE id = ?").get(factor.source_id);
    if (!sourceAd || sourceAd.complex_id !== factor.complex_id || !sourceAd.text.includes(factor.evidence_text)) {
      fail(409, "Фрагмент доказательства не найден в исходном тексте публикации.");
    }
  }
  const actor = currentActor();
  const beforeRisk = calculateComplexRisk(db, factor.complex_id);
  const now = new Date().toISOString();
  const defaultNotes = ["Требует подтверждения аналитиком; баллы пока не начислены.", "Цитата проверена и фактор подтверждён аналитиком.", "Гипотеза отклонена аналитиком; баллы не начисляются.", "Доказательства требуют дополнительной проверки."].includes(factor.notes)
    ? (status === FACTOR_STATUS.CONFIRMED ? "Цитата проверена и фактор подтверждён аналитиком." : status === FACTOR_STATUS.REJECTED ? "Гипотеза отклонена аналитиком; баллы не начисляются." : "Доказательства требуют дополнительной проверки.")
    : null;
  {
    db.prepare(
      "UPDATE risk_factors SET status = ?, confirmed_by = ?, confirmed_at = ?, rejected_by = ?, rejected_at = ?, notes = COALESCE(?, notes) WHERE id = ?",
    ).run(
      status,
      status === FACTOR_STATUS.CONFIRMED ? actor : null,
      status === FACTOR_STATUS.CONFIRMED ? now : null,
      status === FACTOR_STATUS.REJECTED ? actor : null,
      status === FACTOR_STATUS.REJECTED ? now : null,
      input.notes ? String(input.notes).slice(0, 1000) : defaultNotes,
      factorId,
    );
    writeAudit(db, "COMPLEX", factor.complex_id, "RISK_FACTOR_" + status, {
      factorId, code: factor.code, sourceId: factor.source_id, evidenceText: factor.evidence_text,
    }, actor);
    recordRiskIfChanged(db, factor.complex_id, beforeRisk, factor.code + " " + status.toLowerCase(), actor);
  }
  return {
    factor: serializeFactor(db.prepare("SELECT * FROM risk_factors WHERE id = ?").get(factorId)),
    risk: calculateComplexRisk(db, factor.complex_id),
  };
}

function validateFactorContext(code, complex) {
  if (code === "R3" && complex.commissioning_status !== "UNDER_CONSTRUCTION") {
    fail(409, "R3 применим только к строящемуся жилью. Проверьте стадию объекта.");
  }
  if (code === "R5") {
    const declared = complex.declared_completion_pct;
    const verified = complex.verified_completion_pct;
    if (declared == null || verified == null || Math.abs(declared - verified) < 20
      || !complex.declared_completion_source || !complex.verified_completion_source
      || !complex.declared_completion_at || !complex.verified_completion_at) {
      fail(409, "R5 требует разницы не менее 20 п.п. и двух значений с источниками и датами проверки.");
    }
  }
}

export function addManualFactor(db, complexId, input = {}) {
  const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId);
  if (!complex) fail(404, "Жилой комплекс не найден.");
  const code = input.code;
  if (!['R1','R2','R3','R4','R5','R6'].includes(code)) fail(400, "Выберите фактор R1–R6.");
  const evidence = String(input.evidenceText ?? "").trim();
  const source = String(input.sourceLabel ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  if (!evidence || !source || !notes) fail(400, "Укажите источник, фрагмент доказательства и комментарий аналитика.");
  if (source.length > 500 || evidence.length > 12000 || notes.length > 1000) fail(400, "Превышена допустимая длина источника, доказательства или комментария.");
  validateFactorContext(code, complex);
  if (code === "R1" && complex.legal_basis_status !== "CONFIRMED_ABSENT") {
    fail(409, "Сначала внесите и подтвердите источник правовой проверки со статусом «Подтверждено отсутствие».");
  }
  if (code === "R5") {
    const declared = complex.declared_completion_pct;
    const verified = complex.verified_completion_pct;
    if (declared == null || verified == null || Math.abs(declared - verified) < 20
      || !complex.declared_completion_source || !complex.verified_completion_source
      || !complex.declared_completion_at || !complex.verified_completion_at) {
      fail(409, "R5 требует разницы не менее 20 п.п. и двух значений с источниками и датами проверки.");
    }
  }
  const id = randomUUID();
  const beforeRisk = calculateComplexRisk(db, complexId);
  const now = new Date().toISOString();
  inTransaction(db, () => {
    db.prepare(
      "INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_id,source_label,evidence_text,confidence,confirmed_by,confirmed_at,notes,is_demo,created_at,context_json) VALUES (?,?,?,?,?,'MANUAL_REVIEW',NULL,?,?,1,?,?,?,?,?,?)",
    ).run(id, complexId, code, getSettings(db).weights[code], FACTOR_STATUS.CONFIRMED, source, evidence, currentActor(), now, notes, complex.is_demo, now,
      code==='R5'?JSON.stringify({readinessRevision:complex.readiness_revision,declared:complex.declared_completion_pct,verified:complex.verified_completion_pct,verifiedObservationId:complex.verified_observation_id}):null);
    writeAudit(db, "COMPLEX", complexId, "MANUAL_FACTOR_CONFIRMED", { factorId: id, code, source, evidenceText: evidence, notes });
    recordRiskIfChanged(db, complexId, beforeRisk, code + " подтверждён вручную");
  });
  return {
    factor: serializeFactor(db.prepare("SELECT * FROM risk_factors WHERE id = ?").get(id)),
    risk: calculateComplexRisk(db, complexId),
  };
}

export function setLegalBasisStatus(db, complexId, input = {}) {
  return inTransaction(db,()=>setLegalBasisStatusRecord(db,complexId,input));
}
function setLegalBasisStatusRecord(db,complexId,input) {
  const status = input.status;
  if (!["UNKNOWN", "UNDER_REVIEW", "CONFIRMED_VALID", "CONFIRMED_ABSENT"].includes(status)) {
    fail(400, "Недопустимый статус правового основания.");
  }
  const source = String(input.sourceLabel ?? "").trim();
  const evidence = String(input.evidenceText ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  if (!source || !evidence || !notes) fail(400, "Для записи нужны источник, фрагмент документа и комментарий аналитика.");
  if (status === "CONFIRMED_ABSENT" && evidence.length < 12) {
    fail(400, "Укажите конкретный проверенный фрагмент и основание вывода; одного статуса недостаточно.");
  }
  const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId);
  if (!complex) fail(404, "Жилой комплекс не найден.");
  if(typeof input.expectedUpdatedAt!=='string'||!input.expectedUpdatedAt)fail(400,'Для решения нужна версия просмотренной карточки. Обновите карточку.');
  if(input.expectedUpdatedAt!==complex.updated_at)fail(409,'Карточка или правовая проверка уже изменены. Обновите сведения и сверьте их перед решением.');
  const beforeRisk = calculateComplexRisk(db, complexId);
  const now = new Date().toISOString();
  {
    db.prepare("UPDATE complexes SET legal_basis_status = ?, legal_basis_source = ?, legal_basis_checked_at = ? WHERE id = ?")
      .run(status, source, now, complexId);
    const passport=JSON.parse(complex.passport_json||'{}');
    if(passport.legalRecheck?.required&&['CONFIRMED_VALID','CONFIRMED_ABSENT'].includes(status)) {
      passport.legalRecheck={...passport.legalRecheck,required:false,resolvedAt:now,resolvedStatus:status,resolvedBy:currentActor()};
      db.prepare('UPDATE complexes SET passport_json=? WHERE id=?').run(JSON.stringify(passport),complexId);
    }
    if (status === "CONFIRMED_ABSENT") {
      const existing = db.prepare("SELECT id FROM risk_factors WHERE complex_id = ? AND code = 'R1' AND source_type = 'MANUAL_REVIEW' AND source_id = 'legal-basis'").get(complexId);
      if (!existing) {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_id,source_label,evidence_text,confidence,confirmed_by,confirmed_at,notes,is_demo,created_at) VALUES (?,?,'R1',?,'CONFIRMED','MANUAL_REVIEW','legal-basis',?,?,1,?,?,?,?,?)",
        ).run(id, complexId, getSettings(db).weights.R1, source, evidence, currentActor(), now, notes, complex.is_demo, now);
      } else {
        db.prepare(
          "UPDATE risk_factors SET weight = ?, status = 'CONFIRMED', source_label = ?, evidence_text = ?, confidence = 1, confirmed_by = ?, confirmed_at = ?, rejected_by = NULL, rejected_at = NULL, notes = ?, created_at = ? WHERE id = ?",
        ).run(getSettings(db).weights.R1, source, evidence, currentActor(), now, notes, now, existing.id);
      }
    } else {
      db.prepare(
        "UPDATE risk_factors SET status = 'REJECTED', rejected_by = ?, rejected_at = ?, confirmed_by = NULL, confirmed_at = NULL, notes = ? WHERE complex_id = ? AND code = 'R1' AND status IN ('CONFIRMED','UNKNOWN')",
      ).run(currentActor(), now, "Статус основания изменён после новой проверки: " + notes, complexId);
    }
    writeAudit(db, "COMPLEX", complexId, "LEGAL_BASIS_" + status, { source, evidenceText: evidence, notes, reviewedVersion:complex.updated_at });
    recordRiskIfChanged(db, complexId, beforeRisk, "Статус правового основания изменён на " + status);
  }
  return { complex: serializeComplex(db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId)), risk: calculateComplexRisk(db, complexId) };
}
