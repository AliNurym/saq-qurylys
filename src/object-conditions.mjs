import {createHash,randomUUID} from 'node:crypto';
import {inTransaction} from './db.mjs';
import {currentActor} from './access-service.mjs';
import {todayInKazakhstan,validPublicationDate} from './dates.mjs';
import {writeAudit} from './audit-service.mjs';
import {calculateComplexRisk,recordRiskIfChanged} from './complex-service.mjs';
const REVIEW_WINDOW_DAYS=30;
const OBJECT_CONDITIONS_POLICY_VERSION='object-conditions-v1';

export const CONDITION_KEYS=Object.freeze(['documentsMatch','constructionActive','complaintsClear','delaysClear']);
const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function objectConditionContext(db,complexId) {
  const row=db.prepare('SELECT * FROM complexes WHERE id=?').get(complexId);if(!row)fail(404,'ЖК не найден.');
  const passport=JSON.parse(row.passport_json||'{}');
  const context={schemaVersion:1,complex:Object.fromEntries(['id','name','object_number','city','address','developer_name','developer_bin','latitude','longitude','construction_stage','commissioning_status','legal_basis_type','legal_basis_status','legal_basis_source','legal_basis_checked_at','declared_completion_pct','declared_completion_source','declared_completion_at','verified_completion_pct','verified_completion_source','verified_completion_at','verified_observation_id','readiness_revision'].map(key=>[key,row[key]??null])),
    passport:{fields:passport.fields??{},source:passport.source??null,verificationMode:passport.verificationMode??null},
    complaints:db.prepare('SELECT * FROM complaints WHERE complex_id=? ORDER BY id').all(complexId),
    constructionEvents:db.prepare('SELECT * FROM construction_events WHERE complex_id=? ORDER BY id').all(complexId),
    contacts:db.prepare('SELECT * FROM complex_contacts WHERE complex_id=? ORDER BY id').all(complexId)};
  const complaintReviews=db.prepare('SELECT r.* FROM complaint_reviews r JOIN complaints c ON c.id=r.complaint_id WHERE c.complex_id=? ORDER BY r.id').all(complexId);
  if(complaintReviews.length)context.complaintReviews=complaintReviews;
  const json=JSON.stringify(canonical(context));return {json,sha256:createHash('sha256').update(json).digest('hex'),legalBasisStatus:row.legal_basis_status,isDemo:Boolean(row.is_demo)};
}
const view=row=>row?{id:row.id,complexId:row.complex_id,checkedDate:row.checked_date,validThrough:new Date(Date.parse(row.checked_date+'T12:00:00Z')+(row.review_window_days??30)*86400000).toISOString().slice(0,10),reviewWindowDays:row.review_window_days??30,policyVersion:row.policy_version??'object-conditions-v1',createdAt:row.created_at,createdBy:row.created_by,source:row.source,evidenceText:row.evidence_text,checks:JSON.parse(row.checks_json),contextSha256:row.context_sha256,isDemo:Boolean(row.is_demo)}:null;
export function getObjectConditions(db,complexId,now=new Date()) {
  const context=objectConditionContext(db,complexId),row=db.prepare('SELECT * FROM object_condition_reviews WHERE complex_id=? ORDER BY rowid DESC LIMIT 1').get(complexId),review=view(row),today=todayInKazakhstan(now);
  const reason=context.legalBasisStatus!=='CONFIRMED_VALID'?'LEGAL_NOT_VERIFIED':!review?'NOT_REVIEWED':review.policyVersion!==OBJECT_CONDITIONS_POLICY_VERSION?'POLICY_CHANGED':review.contextSha256!==context.sha256?'CONTEXT_CHANGED':today>review.validThrough?'EXPIRED':!CONDITION_KEYS.every(key=>review.checks[key]===true)?'CHECKS_FAILED':'ELIGIBLE';
  return {eligible:reason==='ELIGIBLE',reason,review,latestReviewId:review?.id??null,currentContextSha256:context.sha256,evaluationDate:today,reviewWindowDays:REVIEW_WINDOW_DAYS,policyVersion:OBJECT_CONDITIONS_POLICY_VERSION};
}
export function listObjectConditionReviews(db,complexId,{limit=10,before}={}) {
  limit=Number(limit);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'Размер страницы: от 1 до 100.');
  const params=[complexId];let cursor='';
  if(before) {
    let decoded;try{if(typeof before!=='string'||before.length>500||!/^[A-Za-z0-9_-]+$/u.test(before))throw new Error();decoded=JSON.parse(Buffer.from(before,'base64url').toString('utf8'));}catch{fail(400,'Некорректный курсор истории.');}
    if(decoded?.complexId!==complexId||!Number.isSafeInteger(decoded.sequence)||decoded.sequence<1)fail(400,'Курсор не соответствует объекту.');cursor=' AND rowid<?';params.push(decoded.sequence);
  }
  const rows=db.prepare('SELECT rowid AS sequence,* FROM object_condition_reviews WHERE complex_id=?'+cursor+' ORDER BY rowid DESC LIMIT ?').all(...params,limit+1),page=rows.slice(0,limit);
  return {items:page.map(view),total:db.prepare('SELECT count(*) AS n FROM object_condition_reviews WHERE complex_id=?').get(complexId).n,nextCursor:rows.length>limit?Buffer.from(JSON.stringify({complexId,sequence:page.at(-1).sequence})).toString('base64url'):null};
}
export function saveObjectConditions(db,complexId,input) {
  const source=typeof input.source==='string'?input.source.trim():'',evidence=typeof input.evidenceText==='string'?input.evidenceText.trim():'',checkedDate=input.checkedDate;
  if(source.length<5||source.length>1000||evidence.length<10||evidence.length>4000)fail(400,'Укажите источник (5–1000 символов) и содержание проверки (10–4000 символов).');
  if(!validPublicationDate(checkedDate)||checkedDate>todayInKazakhstan())fail(400,'Укажите существующую дату проверки не позднее сегодняшней.');
  if(!input.checks||CONDITION_KEYS.some(key=>typeof input.checks[key]!=='boolean'))fail(400,'Явно укажите результат всех четырёх проверок.');
  const checks=Object.fromEntries(CONDITION_KEYS.map(key=>[key,input.checks[key]]));
  let id;
  inTransaction(db,()=>{
    const before=getObjectConditions(db,complexId),context=objectConditionContext(db,complexId);
    if(context.legalBasisStatus!=='CONFIRMED_VALID')fail(409,'Сначала МИО должен подтвердить применимое правовое основание по источнику.');
    if(input.expectedContextSha256!==context.sha256||input.expectedReviewId!==before.latestReviewId)fail(409,'Сведения или последняя проверка уже изменены. Обновите карточку перед решением.');
    const riskBefore=calculateComplexRisk(db,complexId);id=randomUUID();
    db.prepare('INSERT INTO object_condition_reviews (id,complex_id,checked_date,created_at,created_by,source,evidence_text,checks_json,context_sha256,context_json,is_demo,review_window_days,policy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,complexId,checkedDate,new Date().toISOString(),currentActor(),source,evidence,JSON.stringify(checks),context.sha256,context.json,Number(context.isDemo),REVIEW_WINDOW_DAYS,OBJECT_CONDITIONS_POLICY_VERSION);
    const after=getObjectConditions(db,complexId);
    writeAudit(db,'COMPLEX',complexId,'OBJECT_CONDITIONS_REVIEWED',{complexId,reviewId:id,checkedDate,checks,contextSha256:context.sha256,eligible:after.eligible,reason:after.reason,source});
    recordRiskIfChanged(db,complexId,riskBefore,'Проверка условий зелёной зоны');
  });
  return {review:view(db.prepare('SELECT * FROM object_condition_reviews WHERE id=?').get(id)),state:getObjectConditions(db,complexId),risk:calculateComplexRisk(db,complexId)};
}
