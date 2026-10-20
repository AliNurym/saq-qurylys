import { currentActor, withUser } from "./access-service.mjs";
import { FACTORS, RED_TRIGGER_FACTORS, SIGNAL_STATUS, SCORING_VERSION } from "./constants.mjs";
import { calculateComplexRisk } from "./complex-service.mjs";
import { inTransaction } from "./db.mjs";
import { writeAudit } from "./audit-service.mjs";
import { serializeAdvertisement, serializeComplex, serializeFactor, serializeSignal } from "./serializers.mjs";
import { todayInKazakhstan } from "./dates.mjs";
import { listEvidence } from "./evidence-service.mjs";
import { getCollectionProvenance } from "./collection-evidence.mjs";
import { getBusinessCalendar, calculateBusinessDeadline } from "./business-calendar.mjs";
import { getConstructionSnapshot } from "./construction-evidence.mjs";
import { createHash } from 'node:crypto';
import {listSignalSummaries} from './signal-inbox.mjs';
import {getObjectConditions} from './object-conditions.mjs';
import {getComplaintSnapshot} from './complaint-service.mjs';

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function allowedTransition(current, next) {
  const transitions = {
    [SIGNAL_STATUS.DRAFT]: [SIGNAL_STATUS.NEEDS_REVIEW],
    [SIGNAL_STATUS.NEEDS_REVIEW]: [SIGNAL_STATUS.CONFIRMED, SIGNAL_STATUS.RETURNED],
    [SIGNAL_STATUS.RETURNED]: [SIGNAL_STATUS.NEEDS_REVIEW, SIGNAL_STATUS.ARCHIVED],
    [SIGNAL_STATUS.CONFIRMED]: [SIGNAL_STATUS.ARCHIVED],
    [SIGNAL_STATUS.ARCHIVED]: [],
  };
  return (transitions[current] ?? []).includes(next);
}

function getSignalRow(db, signalId) {
  return db.prepare(
    "SELECT s.*, c.name AS complex_name, c.city, c.address, c.developer_name, c.developer_bin, c.legal_basis_status, c.legal_basis_source FROM signals s JOIN complexes c ON c.id = s.complex_id WHERE s.id = ?",
  ).get(signalId) ?? null;
}

export function listSignals(db, status, scope = null) {
  return listSignalSummaries(db,{status:status??''},scope);
}

export function getSignalDetails(db, signalId) {
  const row = getSignalRow(db, signalId);
  if (!row) return null;
  const complex = serializeComplex(db.prepare("SELECT * FROM complexes WHERE id = ?").get(row.complex_id));
  const snapshot = serializeSignal(row);
  const audit = db.prepare(
    "SELECT * FROM audit_logs WHERE entity_type = 'SIGNAL' AND entity_id = ? ORDER BY timestamp ASC, rowid ASC",
  ).all(signalId).map((item) => {
    let metadata = {};
    try { metadata = JSON.parse(item.metadata_json); } catch {}
    return { id: item.id, entityType: item.entity_type, action: item.action, actor: item.actor, timestamp: item.timestamp, metadata };
  });
  return {
    ...snapshot,
    complex: snapshot.contextSnapshot?.complex ?? {
      id: complex.id, name: complex.name, city: complex.city, address: complex.address,
      developerName: complex.developerName, developerBin: complex.developerBin,
      isDemo: complex.isDemo,
      legalBasisStatus: snapshot.legalBasisSnapshot, legalBasisSource: null,
    },
    factorSnapshot: snapshot.factorSnapshot.map((factor) => ({
      ...factor,
      label: factor.label ?? FACTORS[factor.code]?.label ?? RED_TRIGGER_FACTORS[factor.code]?.label ?? factor.code,
    })),
    currentRisk: calculateComplexRisk(db, row.complex_id),
    advertisements: snapshot.contextSnapshot?.advertisements ?? [],
    constructionEvidence: snapshot.contextSnapshot?.constructionEvidence ?? null,
    objectConditions:snapshot.contextSnapshot?.objectConditions??null,
    complaints:snapshot.contextSnapshot?.complaints??null,
    audit,
  };
}

export function createSignal(db, complexId, { automatic = false } = {}) {
  return inTransaction(db,()=>createSignalRecord(db,complexId,{automatic}));
}

// Caller owns the transaction: capture evidence and save the card under the same write lock.
function createSignalRecord(db, complexId, { automatic = false } = {}) {
  const complex = db.prepare("SELECT * FROM complexes WHERE id = ?").get(complexId);
  if (!complex) fail(404, "Жилой комплекс не найден.");
  const risk = calculateComplexRisk(db, complexId);
  const factorRows = db.prepare("SELECT * FROM risk_factors WHERE complex_id = ? ORDER BY created_at").all(complexId);
  const factorSnapshot = factorRows.map((row) => {
    const factor = serializeFactor(row);
    return {
      id: factor.id,
      code: factor.code,
      label: FACTORS[factor.code]?.label ?? RED_TRIGGER_FACTORS[factor.code]?.label ?? factor.code,
      status: factor.status,
      weight: risk.confirmedFactors.find((item) => item.id === factor.id)?.weight ?? factor.weight,
      evidenceText: factor.evidenceText,
      sourceType: factor.sourceType,
      sourceId: factor.sourceId,
      sourceLabel: factor.sourceLabel,
      confirmedBy: factor.confirmedBy,
      confirmedAt: factor.confirmedAt,
      confidence: factor.confidence,
      notes: factor.notes,
      context: factor.context,
    };
  });
  const contextSnapshot = {
    version: 2,
    scoringVersion: risk.scoringVersion,
    zonePolicyVersion:risk.zonePolicyVersion,
    complex: serializeComplex(complex),
    constructionEvidence: getConstructionSnapshot(db,complexId),
    objectConditions:getObjectConditions(db,complexId),
    complaints:getComplaintSnapshot(db,complexId),
    advertisements: db.prepare("SELECT * FROM advertisements WHERE complex_id = ? ORDER BY publication_date DESC")
      .all(complexId).map((ad) => ({ ...serializeAdvertisement(ad), collection: getCollectionProvenance(db, ad.id), evidenceFiles: listEvidence(db, ad.id).map((file) => ({ ...file,
        data: Buffer.from(db.prepare("SELECT bytes FROM evidence_files WHERE id=?").get(file.id).bytes).toString("base64"),
      })) })),
    proposedActions: ["Запросить документы у застройщика", "Провести осмотр объекта", "Опросить обратившихся граждан", "При наличии оснований запросить сведения о поступлениях"],
    legalNotice: "Красная зона означает приоритет проверки и не устанавливает виновность. ИИ не принимает правовых решений.",
  };
  const year = todayInKazakhstan().slice(0, 4);
  const createdAt = new Date().toISOString();
  let id;
  {
    const sequence = Number(db.prepare("SELECT MAX(CAST(substr(id, 9) AS INTEGER)) AS last FROM signals WHERE id LIKE ?").get("SQ-" + year + "-%").last ?? 0) + 1;
    id = "SQ-" + year + "-" + String(sequence).padStart(4, "0");
    db.prepare(
      "INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,context_snapshot_json,status,created_by,created_at,comment) VALUES (?,?,?,?,?,?,?,'NEEDS_REVIEW',?,?,?)",
    ).run(id, complexId, risk.score, risk.zone, complex.legal_basis_status, JSON.stringify(factorSnapshot), JSON.stringify(contextSnapshot), currentActor(), createdAt, "Снимок создан для проверки аналитиком.");
    writeAudit(db, "SIGNAL", id, "SIGNAL_CREATED", {
      complexId, complexName: complex.name, score: risk.score, zone: risk.zone, automatic,
    });
    writeAudit(db, "COMPLEX", complexId, "SIGNAL_CREATED", { signalId: id, complexId, score: risk.score });
  }
  return getSignalDetails(db, id);
}

export function transitionSignal(db, signalId, input = {}) {
  return inTransaction(db,()=>transitionSignalRecord(db,signalId,input));
}
function transitionSignalRecord(db,signalId,input) {
  const row = getSignalRow(db, signalId);
  if (!row) fail(404, "Сигнал не найден.");
  const nextStatus = input.status;
  if (!Object.values(SIGNAL_STATUS).includes(nextStatus)) fail(400, "Недопустимый статус сигнала.");
  if (nextStatus === row.status) return getSignalDetails(db, signalId);
  if (!allowedTransition(row.status, nextStatus)) {
    fail(409, "Переход " + row.status + " → " + nextStatus + " недоступен.");
  }
  const routing=JSON.parse(row.routing_json||'{}');
  if(nextStatus===SIGNAL_STATUS.ARCHIVED&&routing.assignedAt&&!routing.result)fail(409,'Сначала получатель должен зафиксировать результат реагирования.');
  const comment = String(input.comment ?? "").trim();
  if (comment.length > 1000) fail(400, "Комментарий слишком длинный (максимум 1 000 символов).");
  if (nextStatus === SIGNAL_STATUS.RETURNED && !comment) {
    fail(400, "Укажите комментарий, чтобы вернуть сигнал на доработку.");
  }
  const now = new Date().toISOString();
  const isFinalReview = [SIGNAL_STATUS.CONFIRMED, SIGNAL_STATUS.RETURNED].includes(nextStatus);
  {
    db.prepare(
      "UPDATE signals SET status = ?, reviewed_by = ?, reviewed_at = ?, comment = ? WHERE id = ?",
    ).run(nextStatus, isFinalReview ? currentActor() : row.reviewed_by, isFinalReview ? now : row.reviewed_at, comment || row.comment, signalId);
    writeAudit(db, "SIGNAL", signalId, "SIGNAL_STATUS_" + nextStatus, {
      from: row.status, to: nextStatus, complexId: row.complex_id, comment,
    });
    writeAudit(db, "COMPLEX", row.complex_id, "SIGNAL_STATUS_CHANGED", {
      signalId, from: row.status, to: nextStatus, comment,
    });
  }
  return getSignalDetails(db, signalId);
}

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}

function redFingerprint(score,legalStatus,version,zonePolicyVersion,factors) {
  const confirmed=factors.filter(factor=>factor.status==='CONFIRMED'&&(Object.hasOwn(FACTORS,factor.code)||Object.hasOwn(RED_TRIGGER_FACTORS,factor.code)))
    .map(factor=>Object.fromEntries(['id','code','weight','sourceType','sourceId','sourceLabel','evidenceText','confirmedBy','confirmedAt','notes','context'].map(key=>[key,factor[key]??null])))
    .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return createHash('sha256').update(JSON.stringify(canonical({version,zonePolicyVersion,score,legalStatus,confirmed}))).digest('hex');
}

export function ensureRedSignals(db) {
  return withUser({username:'System'},()=>ensureRedSignalsAsSystem(db));
}
function ensureRedSignalsAsSystem(db) {
  const created=[];
  for(const {id,legal_basis_status:legalStatus} of db.prepare('SELECT id,legal_basis_status FROM complexes ORDER BY id').all())inTransaction(db,()=>{
    const risk=calculateComplexRisk(db,id),previous=db.prepare('SELECT * FROM red_monitoring_state WHERE complex_id=?').get(id),now=new Date().toISOString();
    const lastRowid=()=>db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM signals WHERE complex_id=?').get(id).n;
    if(risk.zone!=='red') {
      if(!previous)db.prepare('INSERT INTO red_monitoring_state (complex_id,is_red,episode,fingerprint,signal_id,last_signal_rowid,observed_at) VALUES (?,0,0,NULL,NULL,?,?)').run(id,lastRowid(),now);
      else if(previous.is_red||previous.last_signal_rowid!==lastRowid())db.prepare('UPDATE red_monitoring_state SET is_red=0,last_signal_rowid=?,observed_at=? WHERE complex_id=?').run(lastRowid(),now,id);
      return;
    }
    const fingerprint=redFingerprint(risk.score,legalStatus,risk.scoringVersion,risk.zonePolicyVersion,risk.confirmedFactors);
    if(previous?.is_red&&previous.fingerprint===fingerprint)return;
    const episode=(previous?.episode??0)+(previous?.is_red?0:1);
    // First observation after an additive upgrade may already have an equivalent card.
    // Later red re-entry is a new event even if the previous evidence/score is identical.
    const equivalent=db.prepare('SELECT id,score_snapshot,legal_basis_snapshot,factor_snapshot_json,context_snapshot_json FROM signals WHERE complex_id=? AND zone_snapshot=\'red\' AND rowid>? ORDER BY rowid DESC').all(id,previous?.last_signal_rowid??0)
      .find(signal=>{
        if(!signal.context_snapshot_json)return false;
        const snapshot=JSON.parse(signal.context_snapshot_json);
        return redFingerprint(signal.score_snapshot,signal.legal_basis_snapshot,snapshot.scoringVersion,snapshot.zonePolicyVersion??'legacy',JSON.parse(signal.factor_snapshot_json))===fingerprint;
      });
    let signalId=equivalent?.id;
    if(!signalId) {
      const signal=withUser({username:'System'},()=>createSignalRecord(db,id,{automatic:true}));signalId=signal.id;
      created.push(signalId);
    }
    if(!equivalent||previous)writeAudit(db,'SIGNAL',signalId,'RED_ZONE_NOTIFICATION',{complexId:id,channel:'INTERNAL_QUEUE',episode,fingerprint,reason:previous?.is_red?'CONFIRMED_EVIDENCE_CHANGED':'RED_ENTRY',reusedFreshManualCard:Boolean(equivalent)},'System');
    db.prepare('INSERT INTO red_monitoring_state (complex_id,is_red,episode,fingerprint,signal_id,last_signal_rowid,observed_at) VALUES (?,1,?,?,?,?,?) ON CONFLICT(complex_id) DO UPDATE SET is_red=1,episode=excluded.episode,fingerprint=excluded.fingerprint,signal_id=excluded.signal_id,last_signal_rowid=excluded.last_signal_rowid,observed_at=excluded.observed_at').run(id,episode,fingerprint,signalId,lastRowid(),now);
  });
  return created;
}

export function workingDayDeadline(start, count = 5, holidays = []) {
  return calculateBusinessDeadline(start,count,{nonWorkingDates:holidays});
}

export function routeSignal(db, signalId, input) {
  const recipient = input.recipient;
  if (!["MIO", "GASK", "LAW_ENFORCEMENT"].includes(recipient)) fail(400, "Выберите орган-получатель.");
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5 || reason.length > 2000) fail(400, "Укажите основание передачи (5–2000 символов).");
  inTransaction(db, () => {
    const row = getSignalRow(db, signalId);
    if (!row) fail(404, "Сигнал не найден.");
    if (!["NEEDS_REVIEW", "CONFIRMED"].includes(row.status)) fail(409, "Сначала передайте карточку на подтверждение.");
    if (JSON.parse(row.routing_json || "{}").assignedAt) fail(409, "Маршрут уже подтверждён и сохранён.");
    const now = new Date().toISOString(),calendar=getBusinessCalendar(db);
    const routing = { recipient, reason, assignedAt: now, approvedBy: currentActor(), mode: "INTERNAL_ONLY",
      dueDate:calculateBusinessDeadline(todayInKazakhstan(),5,calendar),calendar:calendar.configured?'OPERATOR_CONFIGURED':'WEEKDAYS_AND_CONFIGURED_EXCEPTIONS',
      calendarVersion:calendar.version,calendarDefinition:calendar };
    db.prepare("UPDATE signals SET status='CONFIRMED',reviewed_by=?,reviewed_at=?,routing_json=? WHERE id=?").run(currentActor(), now, JSON.stringify(routing), signalId);
    writeAudit(db, "SIGNAL", signalId, "SIGNAL_ROUTE_APPROVED", { complexId: row.complex_id, ...routing });
  });
  return getSignalDetails(db, signalId);
}

export function recordResponse(db, signalId, input) {
  const result = String(input.result ?? "").trim();
  if (result.length < 5 || result.length > 4000) fail(400, "Опишите результат реагирования (5–4000 символов).");
  inTransaction(db, () => {
    const row = getSignalRow(db, signalId);
    if (!row) fail(404, "Сигнал не найден.");
    const routing = JSON.parse(row.routing_json || "{}");
    if (!routing.assignedAt || row.status !== "CONFIRMED") fail(409, "Карточка ещё не назначена получателю.");
    if (routing.result) fail(409, "Результат уже сохранён.");
    const next = { ...routing, result, respondedAt: new Date().toISOString(), recordedBy: currentActor() };
    db.prepare("UPDATE signals SET routing_json=? WHERE id=?").run(JSON.stringify(next), signalId);
    writeAudit(db, "SIGNAL", signalId, "SIGNAL_RESPONSE_RECORDED", { complexId: row.complex_id, result });
  });
  return getSignalDetails(db, signalId);
}
