import { randomUUID } from 'node:crypto';
import { currentActor } from './access-service.mjs';
import { writeAudit } from './audit-service.mjs';

// Called only inside the caller's transaction, together with passport/review and risk history.
export function persistReadinessChange(db,complexId,kind,entry,reason) {
  if(!['DECLARED','VERIFIED'].includes(kind))throw new TypeError('Unknown readiness kind');
  const row=db.prepare('SELECT * FROM complexes WHERE id=?').get(complexId),column=kind==='VERIFIED'?'verified':'declared';
  const changed=row[column+'_completion_pct']!==entry.value||row[column+'_completion_source']!==entry.source||row[column+'_completion_at']!==entry.date;
  const observationId=kind==='VERIFIED'?(entry.observationId??(changed?null:row.verified_observation_id)):null;
  if(!changed && (kind!=='VERIFIED'||row.verified_observation_id===observationId))return false;
  const now=new Date().toISOString(),revision=row.readiness_revision+1;
  db.prepare('UPDATE complexes SET '+column+'_completion_pct=?,'+column+'_completion_source=?,'+column+'_completion_at=?,readiness_revision=?'+(kind==='VERIFIED'?',verified_observation_id=?':'')+' WHERE id=?')
    .run(entry.value,entry.source,entry.date,revision,...(kind==='VERIFIED'?[observationId]:[]),complexId);
  db.prepare("UPDATE risk_factors SET status='UNKNOWN',confirmed_by=NULL,confirmed_at=NULL WHERE complex_id=? AND code='R5' AND status='CONFIRMED'").run(complexId);
  db.prepare('INSERT INTO readiness_history VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),complexId,kind,entry.value,entry.source,entry.date,observationId,revision,reason,now,currentActor());
  writeAudit(db,'COMPLEX',complexId,'READINESS_UPDATED',{column,value:entry.value,source:entry.source,date:entry.date,observationId,revision,reason});
  return true;
}

export function getReadinessHistory(db,complexId,{limit=50,afterRevision=0}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(afterRevision)||afterRevision<0)throw Object.assign(new Error('История: limit 1–200 и afterRevision от 0.'),{statusCode:400});
  const rows=db.prepare('SELECT id,kind,percentage,source,captured_at AS capturedAt,observation_id AS observationId,revision,reason,created_at AS createdAt,created_by AS createdBy FROM readiness_history WHERE complex_id=? AND revision>? ORDER BY revision ASC LIMIT ?').all(complexId,afterRevision,limit+1);
  const hasMore=rows.length>limit,items=rows.slice(0,limit);
  return {items,total:db.prepare('SELECT count(*) AS n FROM readiness_history WHERE complex_id=?').get(complexId).n,nextRevision:hasMore?items.at(-1).revision:null};
}
