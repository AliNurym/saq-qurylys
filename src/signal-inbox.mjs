import {createHash} from 'node:crypto';
import {currentUser} from './access-service.mjs';
import {SIGNAL_STATUS} from './constants.mjs';
import {todayInKazakhstan} from './dates.mjs';

const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
const recipients=['MIO','GASK','LAW_ENFORCEMENT'];
const responses=['UNASSIGNED','AWAITING','OVERDUE','RESPONDED','ARCHIVED'];
const projection=`s.rowid AS sequence,s.id,s.complex_id,s.score_snapshot,s.zone_snapshot,s.legal_basis_snapshot,s.status,s.created_by,s.created_at,s.reviewed_by,s.reviewed_at,
  COALESCE(json_extract(s.context_snapshot_json,'$.complex.name'),c.name) AS complex_name,
  COALESCE(json_extract(s.context_snapshot_json,'$.complex.city'),c.city) AS city,
  (s.context_snapshot_json IS NULL) AS legacy_snapshot,
  json_extract(s.routing_json,'$.recipient') AS recipient,json_extract(s.routing_json,'$.assignedAt') AS assigned_at,
  json_extract(s.routing_json,'$.dueDate') AS due_date,json_extract(s.routing_json,'$.respondedAt') AS responded_at,
  (json_extract(s.routing_json,'$.result') IS NOT NULL) AS has_result`;

function visible(scope) {
  const conditions=[],values=[],role=currentUser()?.role;
  if(role&&!['MIO','ADMIN'].includes(role)) {conditions.push("s.status IN ('CONFIRMED','ARCHIVED') AND json_extract(s.routing_json,'$.recipient')=?");values.push(role);}
  if(scope) {
    if(!scope.size)conditions.push('0');
    else{conditions.push('s.complex_id IN ('+[...scope].map(()=>'?').join(',')+')');values.push(...scope);}
  }
  return {sql:conditions.length?' WHERE '+conditions.map(item=>'('+item+')').join(' AND '):'',values,role:role??'LOCAL'};
}
function query(scope,today) {
  const access=visible(scope);
  return {...access,values:[...access.values,today],sql:`WITH records AS (SELECT ${projection} FROM signals s JOIN complexes c ON c.id=s.complex_id${access.sql}),
    classified AS (SELECT *,CASE WHEN status='ARCHIVED' THEN 'ARCHIVED'
      WHEN has_result THEN 'RESPONDED'
      WHEN assigned_at IS NULL THEN 'UNASSIGNED'
      WHEN status='CONFIRMED' AND due_date IS NOT NULL AND due_date<? THEN 'OVERDUE'
      ELSE 'AWAITING' END AS response_state FROM records),
    queue AS (SELECT *,CASE WHEN response_state='OVERDUE' THEN 0 WHEN response_state='AWAITING' THEN 1 WHEN response_state='UNASSIGNED' THEN 2 WHEN response_state='RESPONDED' THEN 3 ELSE 4 END AS priority,
      CASE WHEN response_state IN ('OVERDUE','AWAITING') THEN COALESCE(due_date,'9999-12-31') ELSE '9999-12-31' END AS due_sort FROM classified)`};
}
function summary(row) {
  return {id:row.id,complexId:row.complex_id,complexName:row.complex_name,city:row.city,scoreSnapshot:row.score_snapshot,zoneSnapshot:row.zone_snapshot,legalBasisSnapshot:row.legal_basis_snapshot,
    status:row.status,createdBy:row.created_by,createdAt:row.created_at,reviewedBy:row.reviewed_by,reviewedAt:row.reviewed_at,legacySnapshot:Boolean(row.legacy_snapshot),
    routing:{recipient:row.recipient,assignedAt:row.assigned_at,dueDate:row.due_date,respondedAt:row.responded_at},hasResponse:Boolean(row.has_result),responseState:row.response_state,overdue:row.response_state==='OVERDUE'};
}
function validate(options) {
  const {status='',recipient='',response='',sort='newest',search='',complexId=''}=options;
  if(status&&!Object.values(SIGNAL_STATUS).includes(status))fail(400,'Недопустимый статус сигнала.');
  if(recipient&&!recipients.includes(recipient))fail(400,'Недопустимый орган-получатель.');
  if(response&&!responses.includes(response))fail(400,'Недопустимый фильтр реагирования.');
  if(!['newest','deadline'].includes(sort))fail(400,'Недопустимая сортировка сигналов.');
  if(typeof search!=='string'||search.length>200||typeof complexId!=='string'||complexId.length>200)fail(400,'Слишком длинный поисковый запрос.');
  return {status,recipient,response,sort,search:search.trim(),complexId};
}
function filters(db,values) {
  const conditions=[],params=[];
  for(const [key,column] of [['status','status'],['recipient','recipient'],['complexId','complex_id']])if(values[key]){conditions.push(column+'=?');params.push(values[key]);}
  if(values.response){conditions.push(values.response==='AWAITING'?"response_state IN ('AWAITING','OVERDUE')":values.response==='RESPONDED'?'has_result=1':'response_state=?');if(!['AWAITING','RESPONDED'].includes(values.response))params.push(values.response);}
  if(values.search) {
    db.function('saq_casefold',{deterministic:true},value=>String(value??'').toLocaleLowerCase('ru'));
    conditions.push("instr(saq_casefold(id||' '||complex_name||' '||city),?)>0");params.push(values.search.toLocaleLowerCase('ru'));
  }
  return {conditions,params};
}
const where=clauses=>clauses.length?' WHERE '+clauses.map(clause=>'('+clause+')').join(' AND '):'';

export function listSignalSummaries(db,options={},scope=null) {
  const normalized=validate(options),base=query(scope,todayInKazakhstan()),selected=filters(db,normalized);
  return db.prepare(base.sql+' SELECT * FROM queue'+where(selected.conditions)+' ORDER BY created_at DESC,sequence DESC').all(...base.values,...selected.params).map(summary);
}

export function listSignalPage(db,options={},scope=null) {
  const normalized=validate(options),limit=Number(options.limit??20),now=options.now??new Date(),today=todayInKazakhstan(now);
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'Размер страницы: от 1 до 100.');
  const base=query(scope,today),selected=filters(db,normalized),binding=createHash('sha256').update(JSON.stringify({filters:normalized,role:base.role,scope:scope?[...scope].sort():null})).digest('hex');
  const metrics=db.prepare(base.sql+` SELECT count(*) AS total,
    COALESCE(sum(status IN ('DRAFT','NEEDS_REVIEW','RETURNED')),0) AS review,
    COALESCE(sum(status='NEEDS_REVIEW'),0) AS needsReview,
    COALESCE(sum(response_state IN ('AWAITING','OVERDUE')),0) AS awaiting,
    COALESCE(sum(response_state='OVERDUE'),0) AS overdue,
    COALESCE(sum(has_result),0) AS responded FROM queue`).get(...base.values);
  const total=db.prepare(base.sql+' SELECT count(*) AS n FROM queue'+where(selected.conditions)).get(...base.values,...selected.params).n;
  let cursor;
  if(options.before) {
    if(typeof options.before!=='string'||options.before.length>1400||!/^[A-Za-z0-9_-]+$/u.test(options.before))fail(400,'Некорректный курсор списка.');
    try{cursor=JSON.parse(Buffer.from(options.before,'base64url').toString('utf8'));}catch{fail(400,'Некорректный курсор списка.');}
    if(cursor?.v!==1||cursor.binding!==binding||!Number.isSafeInteger(cursor.sequence)||cursor.sequence<1||typeof cursor.createdAt!=='string'||cursor.createdAt.length>40||!Number.isInteger(cursor.priority)||cursor.priority<0||cursor.priority>4||!/^\d{4}-\d{2}-\d{2}$/u.test(cursor.dueSort??''))fail(400,'Курсор не соответствует фильтрам. Откройте первую страницу.');
    if(cursor.today!==today)fail(409,'Дата расчёта сроков изменилась. Обновите список.');
    if(normalized.sort==='newest'){selected.conditions.push('(created_at,sequence)<(?,?)');selected.params.push(cursor.createdAt,cursor.sequence);}
    else {
      selected.conditions.push('priority>? OR (priority=? AND due_sort>?) OR (priority=? AND due_sort=? AND created_at<?) OR (priority=? AND due_sort=? AND created_at=? AND sequence<?)');
      selected.params.push(cursor.priority,cursor.priority,cursor.dueSort,cursor.priority,cursor.dueSort,cursor.createdAt,cursor.priority,cursor.dueSort,cursor.createdAt,cursor.sequence);
    }
  }
  const order=normalized.sort==='deadline'?'priority ASC,due_sort ASC,created_at DESC,sequence DESC':'created_at DESC,sequence DESC';
  const rows=db.prepare(base.sql+' SELECT * FROM queue'+where(selected.conditions)+' ORDER BY '+order+' LIMIT ?').all(...base.values,...selected.params,limit+1),items=rows.slice(0,limit),last=items.at(-1);
  const nextCursor=rows.length>limit?Buffer.from(JSON.stringify({v:1,binding,today,sequence:last.sequence,createdAt:last.created_at,priority:last.priority,dueSort:last.due_sort})).toString('base64url'):null;
  return {items:items.map(summary),total,limit,nextCursor,filters:normalized,summary:metrics,summaryScope:'ALL_VISIBLE_SIGNALS',evaluationDate:today,checkedAt:now.toISOString()};
}
