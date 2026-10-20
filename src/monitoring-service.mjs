import { calculateComplexRisk } from "./complex-service.mjs";
import { writeAudit } from "./audit-service.mjs";
import {withUser} from './access-service.mjs';
import {inTransaction} from './db.mjs';

// Recalculates saved evidence only. It never claims to have collected new sources.
export function runScheduledMonitoring(db, now = new Date()) {
  return withUser({username:'System'},()=>runMonitoringAsSystem(db,now));
}
function runMonitoringAsSystem(db,now) {
  const timestamp = now.toISOString();
  const completed = [];
  for(const {id} of db.prepare("SELECT id FROM complexes").all())inTransaction(db,()=>{
    const risk = calculateComplexRisk(db,id);
    const current = db.prepare("SELECT * FROM monitoring_runs WHERE complex_id=?").get(id);
    const changed = !current || current.zone !== risk.zone || current.score !== risk.score || current.scoring_version !== risk.scoringVersion;
    if (!changed && (!current.next_run_at || current.next_run_at > timestamp)) return;
    const next = risk.monitoringDays ? new Date(now.getTime() + risk.monitoringDays * 86400000).toISOString() : null;
      db.prepare("INSERT INTO monitoring_runs VALUES (?,?,?,?,?,?) ON CONFLICT(complex_id) DO UPDATE SET last_run_at=excluded.last_run_at,next_run_at=excluded.next_run_at,score=excluded.score,zone=excluded.zone,scoring_version=excluded.scoring_version")
        .run(id,timestamp,next,risk.score,risk.zone,risk.scoringVersion);
      writeAudit(db,"COMPLEX",id,"SCHEDULED_RISK_RECALCULATED",{complexId:id,score:risk.score,zone:risk.zone,nextRunAt:next,sourceCollection:false},"System");
    completed.push(id);
  });
  return completed;
}
