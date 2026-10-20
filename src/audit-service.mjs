import { currentActor, readScope, signalVisible } from "./access-service.mjs";
import { randomUUID } from "node:crypto";

import { kazakhstanDayBounds } from "./dates.mjs";
import {listAuditPage} from './audit-page.mjs';

export function writeAudit(db, entityType, entityId, action, metadata = {}, actor = currentActor()) {
  const timestamp = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO audit_logs (id,entity_type,entity_id,action,actor,timestamp,metadata_json) VALUES (?,?,?,?,?,?,?)",
  ).run(id, entityType, entityId, action, actor, timestamp, JSON.stringify(metadata));
  return { id, timestamp };
}

export function listAudit(db, filters = {}) {
  const scope=readScope(db);
  const conditions = [];
  const values = [];
  if (filters.entityType) {
    conditions.push("entity_type = ?");
    values.push(filters.entityType);
  }
  if (filters.action) {
    conditions.push("action = ?");
    values.push(filters.action);
  }
  if (filters.from) {
    conditions.push("timestamp >= ?");
    values.push(kazakhstanDayBounds(filters.from).start);
  }
  if (filters.to) {
    conditions.push("timestamp < ?");
    values.push(kazakhstanDayBounds(filters.to).endExclusive);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  return db.prepare(
    "SELECT * FROM audit_logs " + where + " ORDER BY timestamp DESC LIMIT 250",
  ).all(...values).filter(row=>{
    if(!scope)return true;
    if(row.entity_type === "COMPLEX")return scope.has(row.entity_id);
    if(row.entity_type === "SIGNAL") {
      const signal=db.prepare("SELECT * FROM signals WHERE id=?").get(row.entity_id);
      return signal && signalVisible(signal);
    }
    if(row.entity_type === "ADVERTISEMENT") {
      const ad=db.prepare("SELECT complex_id FROM advertisements WHERE id=?").get(row.entity_id);
      return ad && scope.has(ad.complex_id);
    }
    return false;
  });
}

export function recordRiskSnapshot(db, complexId, risk, reason, actor = currentActor()) {
  db.prepare(
    "INSERT INTO risk_history (complex_id,score,zone,reason,actor,created_at) VALUES (?,?,?,?,?,?)",
  ).run(complexId, risk.score, risk.zone, reason, actor, new Date().toISOString());
}

export function getComplexAudit(db, complexId) {
  return listAuditPage(db,{complexId,limit:100}).items;
}
