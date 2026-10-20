import {createHash} from 'node:crypto';
import {currentUser,readScope} from './access-service.mjs';
import {kazakhstanDayBounds} from './dates.mjs';
import {serializeAudit} from './serializers.mjs';
const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function listAuditPage(db,input={}) {
  const limit=Number(input.limit??30),filters={};
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'Размер страницы журнала: от 1 до 100.');
  for(const key of ['entityType','action','from','to','complexId']) {
    const value=input[key]??'';if(typeof value!=='string'||value.length>300)fail(400,'Некорректный фильтр журнала.');filters[key]=value;
  }
  if(filters.entityType&&!/^[A-Z_]{1,40}$/u.test(filters.entityType)||filters.action&&!/^[A-Z0-9_]{1,100}$/u.test(filters.action))fail(400,'Некорректный тип или действие журнала.');
  if(filters.from)kazakhstanDayBounds(filters.from);if(filters.to)kazakhstanDayBounds(filters.to);
  if(filters.from&&filters.to&&filters.from>filters.to)fail(400,'Начало периода должно быть не позднее окончания.');
  const scope=readScope(db),user=currentUser(),role=user?.role??'LOCAL',conditions=[],values=[];
  let assignments=[];
  if(scope!==null) {
    const ids=[...scope].sort();
    assignments=db.prepare("SELECT id,status FROM signals WHERE status IN ('CONFIRMED','ARCHIVED') AND json_extract(routing_json,'$.recipient')=? ORDER BY id").all(role);
    if(!ids.length)conditions.push('0');
    else {
      const slots=ids.map(()=>'?').join(',');
      conditions.push(`((a.entity_type='COMPLEX' AND a.entity_id IN (${slots}) AND
          (a.action<>'SIGNAL_STATUS_CHANGED' OR EXISTS (SELECT 1 FROM signals scoped_signal
            WHERE scoped_signal.id=CASE WHEN json_valid(a.metadata_json) THEN json_extract(a.metadata_json,'$.signalId') END
              AND scoped_signal.complex_id=a.entity_id AND scoped_signal.status IN ('CONFIRMED','ARCHIVED')
              AND json_extract(scoped_signal.routing_json,'$.recipient')=?))) OR
        (a.entity_type='ADVERTISEMENT' AND EXISTS (SELECT 1 FROM advertisements d WHERE d.id=a.entity_id AND d.complex_id IN (${slots}))) OR
        (a.entity_type='SIGNAL' AND EXISTS (SELECT 1 FROM signals s WHERE s.id=a.entity_id AND s.status IN ('CONFIRMED','ARCHIVED') AND json_extract(s.routing_json,'$.recipient')=?)))`);
      values.push(...ids,role,...ids,role);
    }
  }
  if(filters.entityType){conditions.push('a.entity_type=?');values.push(filters.entityType);}
  if(filters.from){conditions.push('a.timestamp>=?');values.push(kazakhstanDayBounds(filters.from).start);}
  if(filters.to){conditions.push('a.timestamp<?');values.push(kazakhstanDayBounds(filters.to).endExclusive);}
  if(filters.complexId) {
    conditions.push(`((a.entity_type='COMPLEX' AND a.entity_id=?) OR
      (a.entity_type='ADVERTISEMENT' AND EXISTS (SELECT 1 FROM advertisements d WHERE d.id=a.entity_id AND d.complex_id=?)) OR
      (a.entity_type='SIGNAL' AND EXISTS (SELECT 1 FROM signals s WHERE s.id=a.entity_id AND s.complex_id=?)) OR
      (CASE WHEN json_valid(a.metadata_json) THEN json_extract(a.metadata_json,'$.complexId') END)=?)`);
    values.push(...Array(4).fill(filters.complexId));
  }
  const binding=hash({filters,limit,role,userId:user?.id??user?.username??null,assignments,scope:scope===null?null:[...scope].sort()});
  let cursor;
  if(input.before) {
    try {
      if(typeof input.before!=='string'||input.before.length>1000||!/^[A-Za-z0-9_-]+$/u.test(input.before))throw Error();
      cursor=JSON.parse(Buffer.from(input.before,'base64url').toString('utf8'));
      if(cursor.v!==1||!Number.isSafeInteger(cursor.sequence)||cursor.sequence<1||!Number.isSafeInteger(cursor.anchor)||cursor.anchor<cursor.sequence||typeof cursor.timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cursor.timestamp)||!Number.isFinite(Date.parse(cursor.timestamp))||typeof cursor.binding!=='string')throw Error();
    }catch{fail(400,'Некорректный курсор журнала.');}
    if(cursor.binding!==binding)fail(409,'Фильтры или доступные материалы изменились. Откройте начало журнала.');
  }
  const where=()=>conditions.length?' WHERE '+conditions.map(item=>'('+item+')').join(' AND '):'';
  const anchor=cursor?.anchor??db.prepare('SELECT COALESCE(MAX(a.rowid),0) AS n FROM audit_logs a'+where()).get(...values).n;
  conditions.push('a.rowid<=?');values.push(anchor);
  const actions=db.prepare('SELECT DISTINCT a.action FROM audit_logs a'+where()+' ORDER BY a.action').all(...values).map(row=>row.action);
  if(filters.action){conditions.push('a.action=?');values.push(filters.action);}
  const total=db.prepare('SELECT count(*) AS n FROM audit_logs a'+where()).get(...values).n;
  if(cursor){conditions.push('(a.timestamp<? OR (a.timestamp=? AND a.rowid<?))');values.push(cursor.timestamp,cursor.timestamp,cursor.sequence);}
  const rows=db.prepare('SELECT a.rowid AS sequence,a.* FROM audit_logs a'+where()+' ORDER BY a.timestamp DESC,a.rowid DESC LIMIT ?').all(...values,limit+1),page=rows.slice(0,limit),last=page.at(-1);
  const complex=filters.complexId&&(scope===null||scope.has(filters.complexId))?db.prepare('SELECT id,name,object_number AS objectNumber FROM complexes WHERE id=?').get(filters.complexId)??null:null;
  return {items:page.map(serializeAudit),actions,total,limit,complex,nextCursor:rows.length>limit?Buffer.from(JSON.stringify({v:1,binding,anchor,timestamp:last.timestamp,sequence:last.sequence})).toString('base64url'):null};
}
