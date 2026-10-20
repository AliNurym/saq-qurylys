import { FACTOR_STATUS, LEGAL_BASIS } from "./constants.mjs";
import { calculateRisk, displayRiskCategory } from "./risk-engine.mjs";
import { serializeAdvertisement, serializeComplex, serializeFactor } from "./serializers.mjs";
import { getComplexAudit } from "./audit-service.mjs";
import { todayInKazakhstan } from "./dates.mjs";
import { currentActor } from "./access-service.mjs";
import { getSettings } from "./settings-service.mjs";
import { listConstructionObservations,getConstructionTrend } from "./construction-evidence.mjs";
import { getReadinessHistory } from "./readiness-service.mjs";
import {listSignalPage,listSignalSummaries} from './signal-inbox.mjs';
import {getObjectConditions} from './object-conditions.mjs';
import {complaintSummaries} from './complaint-service.mjs';

function factorsByComplex(db) {
  const groups = new Map();
  for (const row of db.prepare("SELECT * FROM risk_factors ORDER BY created_at").all()) {
    if (!groups.has(row.complex_id)) groups.set(row.complex_id, []);
    groups.get(row.complex_id).push(row);
  }
  return groups;
}

function buildComplexView(db,row, factors = [], settings = null) {
  const complex = serializeComplex(row);
  const risk = calculateRisk(factors.map(serializeFactor), complex.legalBasisStatus, settings,complex.legalBasisStatus==='CONFIRMED_VALID'?getObjectConditions(db,row.id):null);
  return {
    ...complex,
    risk,
    displayCategory: displayRiskCategory(risk, complex.legalBasisStatus),
    factorCount: factors.length,
  };
}

export function calculateComplexRisk(db, complexId) {
  const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId);
  if (!complex) return null;
  const factors = db.prepare("SELECT * FROM risk_factors WHERE complex_id = ?").all(complexId).map(serializeFactor);
  return calculateRisk(factors, complex.legal_basis_status, getSettings(db),complex.legal_basis_status==='CONFIRMED_VALID'?getObjectConditions(db,complexId):null);
}

export function recordRiskIfChanged(db, complexId, beforeRisk, reason, actor = currentActor()) {
  const afterRisk = calculateComplexRisk(db, complexId);
  const current=db.prepare('SELECT updated_at FROM complexes WHERE id=?').get(complexId);
  if(current)db.prepare("UPDATE complexes SET updated_at = ? WHERE id = ?").run(new Date(Math.max(Date.now(),Date.parse(current.updated_at)+1)).toISOString(), complexId);
  if (!afterRisk || !beforeRisk || (afterRisk.score === beforeRisk.score && afterRisk.zone === beforeRisk.zone)) return afterRisk;
  db.prepare(
    "INSERT INTO risk_history (complex_id,score,zone,reason,actor,created_at) VALUES (?,?,?,?,?,?)",
  ).run(complexId, afterRisk.score, afterRisk.zone, reason, actor, new Date().toISOString());
  return afterRisk;
}

export function listComplexes(db, filters = {}, scope = null) {
  const rows = db.prepare(
    "SELECT c.*," +
    " (SELECT COUNT(*) FROM advertisements a WHERE a.complex_id = c.id) AS advertisement_count," +
    " (SELECT COUNT(*) FROM advertisements a WHERE (a.complex_id = c.id OR a.suggested_complex_id = c.id) AND a.link_status IN ('NEW','ANALYZED','MATCH_PENDING')) AS new_ad_count," +
    " (SELECT COUNT(*) FROM risk_factors f WHERE f.complex_id = c.id AND f.status = 'AI_HYPOTHESIS') AS hypothesis_count" +
    " FROM complexes c ORDER BY c.name",
  ).all();
  const factorMap = factorsByComplex(db);
  const settings = getSettings(db);
  let items = rows.map((row) => ({
    ...buildComplexView(db,row, factorMap.get(row.id) ?? [], settings),
    advertisementCount: row.advertisement_count,
    newAdvertisementCount: row.new_ad_count,
    hypothesisCount: row.hypothesis_count,
  }));
  if(scope) items=items.filter(item=>scope.has(item.id));

  if (filters.query) {
    const needle = filters.query.toLocaleLowerCase("ru-RU").trim();
    items = items.filter((item) => [
      item.name, item.city, item.address, item.developerName, item.developerBin,
    ].some((value) => String(value ?? "").toLocaleLowerCase("ru-RU").includes(needle)));
  }
  if (filters.zone) items = items.filter((item) => item.displayCategory === filters.zone);
  if (filters.legalStatus) items = items.filter((item) => item.legalBasisStatus === filters.legalStatus);
  if (filters.stage) items = items.filter((item) => item.constructionStage === filters.stage);
  if (filters.city) items = items.filter((item) => item.city === filters.city);
  if (filters.district) items = items.filter((item) => item.passport.fields?.district === filters.district);
  if (filters.hasNew === "true") items = items.filter((item) => item.newAdvertisementCount > 0);
  if (filters.hasHypothesis === "true") items = items.filter((item) => item.hypothesisCount > 0);
  if (filters.needsReview === "true") items = items.filter((item) => item.risk.needsReview);

  if (filters.sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  else if (filters.sort === "updated") items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else items.sort((a, b) => b.risk.score - a.risk.score || a.name.localeCompare(b.name, "ru"));
  return items;
}

export function getComplexDetails(db, complexId) {
  const row = db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId);
  if (!row) return null;
  const factors = db.prepare("SELECT * FROM risk_factors WHERE complex_id = ? ORDER BY created_at DESC").all(complexId);
  const complex = buildComplexView(db,row, factors, getSettings(db));
  const advertisements = db.prepare(
    "SELECT a.*, c.name AS complex_name FROM advertisements a LEFT JOIN complexes c ON c.id = a.complex_id WHERE a.complex_id = ? ORDER BY a.publication_date DESC",
  ).all(complexId).map((ad) => ({ ...serializeAdvertisement(ad), complexName: ad.complex_name }));
  const signals = listSignalSummaries(db,{complexId});
  const events = db.prepare("SELECT * FROM construction_events WHERE complex_id = ? ORDER BY event_date DESC").all(complexId);
  const complaints = complaintSummaries(db,complexId);
  const history = db.prepare("SELECT * FROM risk_history WHERE complex_id = ? ORDER BY created_at DESC").all(complexId);
  const audit = getComplexAudit(db, complexId);
  const contacts = db.prepare("SELECT * FROM complex_contacts WHERE complex_id = ? ORDER BY type, value").all(complexId);
  return {
    ...complex,
    contacts: contacts.map(c => ({ id: c.id, type: c.type, value: c.value, sourceLabel: c.source_label })),
    factors: factors.map(serializeFactor),
    constructionObservations:listConstructionObservations(db,complexId,{limit:20}),
    readinessHistory:getReadinessHistory(db,complexId),
    readinessTrend:getConstructionTrend(db,complexId),
    readinessComparison:{declaredPercentage:complex.declaredCompletionPercentage,verifiedPercentage:complex.verifiedCompletionPercentage,
      gapPercentagePoints:complex.declaredCompletionPercentage!=null&&complex.verifiedCompletionPercentage!=null?complex.declaredCompletionPercentage-complex.verifiedCompletionPercentage:null,
      sameObservationDate:Boolean(complex.declaredCompletionCapturedAt&&complex.verifiedCompletionCapturedAt&&complex.declaredCompletionCapturedAt.slice(0,10)===complex.verifiedCompletionCapturedAt.slice(0,10))},
    advertisements,
    signals,
    objectConditions:getObjectConditions(db,complexId),
    constructionEvents: events.map((event) => ({
      id: event.id, type: event.type, date: event.event_date, description: event.description,
      source: event.source, confirmed: Boolean(event.confirmed),
    })),
    complaints,
    riskHistory: history.map((item) => ({
      score: item.score, zone: item.zone, reason: item.reason, actor: item.actor, createdAt: item.created_at,
    })),
    advertisementsLast7Days: advertisements.filter((ad) => ad.publicationDate >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).length,
    monitoring: db.prepare("SELECT last_run_at AS lastRunAt,next_run_at AS nextRunAt FROM monitoring_runs WHERE complex_id=?").get(complexId) ?? null,
    audit,
  };
}

export function getOverview(db, scope = null) {
  const complexes = listComplexes(db,{},scope);
  const today = todayInKazakhstan();
  const recentAdvertisements = db.prepare(
    "SELECT a.*, c.name AS complex_name, p.name AS proposed_complex_name FROM advertisements a LEFT JOIN complexes c ON c.id = a.complex_id LEFT JOIN complexes p ON p.id = a.suggested_complex_id WHERE a.link_status IN ('NEW','ANALYZED','MATCH_PENDING') ORDER BY a.publication_date DESC, a.created_at DESC",
  ).all().filter(ad=>!scope || scope.has(ad.complex_id));
  const newAdvertisementCount = recentAdvertisements.length;
  const factors = db.prepare("SELECT complex_id,status FROM risk_factors").all().filter(factor=>!scope || scope.has(factor.complex_id));
  const signalPage=listSignalPage(db,{limit:8},scope);
  const activeSignalCount=signalPage.summary.review;
  const categoryCounts = { green: 0, yellow: 0, red: 0, review: 0 };
  for (const complex of complexes) categoryCounts[complex.displayCategory] += 1;
  return {
    asOf: today,
    updatedAt: db.prepare("SELECT MAX(stamp) AS stamp FROM (SELECT updated_at AS stamp FROM complexes UNION ALL SELECT created_at FROM advertisements UNION ALL SELECT timestamp FROM audit_logs)").get().stamp,
    metrics: {
      complexes: complexes.length,
      red: categoryCounts.red,
      yellow: categoryCounts.yellow,
      needsReview: complexes.filter((item) => item.risk.needsReview).length,
      newAdvertisements: newAdvertisementCount,
      aiHypotheses: factors.filter((item) => item.status === FACTOR_STATUS.AI_HYPOTHESIS).length,
      activeSignals: activeSignalCount,
      awaitingResponses:signalPage.summary.awaiting,
      overdueSignals:signalPage.summary.overdue,
    },
    distribution: categoryCounts,
    topRisk: [...complexes].sort((a, b) => b.risk.score - a.risk.score).slice(0, 5),
    complexes,
    recentSignals: signalPage.items,
    recentAdvertisements: recentAdvertisements.slice(0, 8).map((item) => ({
      ...serializeAdvertisement(item), complexName: item.complex_name, proposedComplexName: item.proposed_complex_name,
    })),
  };
}

export function listCities(db) {
  return db.prepare("SELECT DISTINCT city FROM complexes ORDER BY city").all().map((row) => row.city);
}

export function listLegalStatuses() {
  return Object.values(LEGAL_BASIS);
}
