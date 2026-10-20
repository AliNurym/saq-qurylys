import {createHash,randomUUID} from 'node:crypto';
import {inTransaction} from './db.mjs';
import {currentActor} from './access-service.mjs';
import {todayInKazakhstan} from './dates.mjs';
import {calculateComplexRisk,recordRiskIfChanged} from './complex-service.mjs';
import {getSettings} from './settings-service.mjs';
import {writeAudit} from './audit-service.mjs';

const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
const text=(value,min,max,label)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(400,label+': от '+min+' до '+max+' символов.');return value.trim();};
const validDate=(value,label)=>{const date=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)?new Date(value+'T12:00:00Z'):null;if(!date||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||value<'0001-01-01'||value>todayInKazakhstan())fail(400,label+': укажите существующую дату не позднее сегодняшней.');return value;};
const checkObject=(db,id)=>{const object=db.prepare('SELECT * FROM complexes WHERE id=?').get(id);if(!object)fail(404,'ЖК не найден.');return object;};
const select=`SELECT c.rowid AS sequence,c.*,i.received_date,i.registration_number,i.created_by,i.is_demo,i.fingerprint,
  r.id AS review_id,r.status AS review_status,r.checked_date,r.source AS review_source,r.evidence_text,r.reason,r.created_at AS reviewed_at,r.created_by AS reviewed_by
  FROM complaints c LEFT JOIN complaint_intakes i ON i.complaint_id=c.id LEFT JOIN complaint_reviews r ON r.id=(SELECT id FROM complaint_reviews WHERE complaint_id=c.id ORDER BY rowid DESC LIMIT 1)`;
function serialize(row) {
  if(!row)return null;
  return {id:row.id,complexId:row.complex_id,type:row.type,summary:row.summary,source:row.source,capturedAt:row.captured_at,receivedDate:row.received_date??null,registrationNumber:row.registration_number??null,createdBy:row.created_by??null,isDemo:row.is_demo===undefined||row.is_demo===null?null:Boolean(row.is_demo),legacy:!row.fingerprint,
    status:row.fingerprint?(row.review_status??'PENDING'):(row.verified?'LEGACY_CONFIRMED':'LEGACY_UNVERIFIED'),verified:Boolean(row.verified),latestReviewId:row.review_id??null,
    latestReview:row.review_id?{id:row.review_id,status:row.review_status,checkedDate:row.checked_date,source:row.review_source,evidenceText:row.evidence_text,reason:row.reason,createdAt:row.reviewed_at,createdBy:row.reviewed_by}:null};
}
const review=row=>({id:row.id,status:row.status,checkedDate:row.checked_date,source:row.source,evidenceText:row.evidence_text,reason:row.reason,createdAt:row.created_at,createdBy:row.created_by,previousReviewId:row.previous_review_id});
export function getComplaintDetails(db,complexId,complaintId) {
  const row=db.prepare(select+' WHERE c.complex_id=? AND c.id=?').get(complexId,complaintId);if(!row)return null;
  return {...serialize(row),reviews:db.prepare('SELECT * FROM complaint_reviews WHERE complaint_id=? ORDER BY rowid').all(complaintId).map(review)};
}
export function getComplaintSnapshot(db,complexId) {
  return db.prepare('SELECT id FROM complaints WHERE complex_id=? ORDER BY captured_at,id').all(complexId).map(row=>getComplaintDetails(db,complexId,row.id));
}
export function complaintSummaries(db,complexId) {
  return db.prepare(select+' WHERE c.complex_id=? ORDER BY c.rowid DESC').all(complexId).map(serialize);
}
export function listComplaints(db,complexId,{status='',type='',limit=10,before}={}) {
  checkObject(db,complexId);limit=Number(limit);
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'Размер страницы: от 1 до 100.');
  if(status&&!['PENDING','CONFIRMED','REJECTED','RESOLVED','LEGACY'].includes(status))fail(400,'Недопустимый статус обращения.');
  if(type&&!['INDIVIDUAL','COLLECTIVE'].includes(type))fail(400,'Недопустимый вид обращения.');
  const conditions=['c.complex_id=?'],params=[complexId];
  if(status){conditions.push(status==='LEGACY'?'i.complaint_id IS NULL':status==='PENDING'?'i.complaint_id IS NOT NULL AND r.id IS NULL':'r.status=?');if(!['PENDING','LEGACY'].includes(status))params.push(status);}
  if(type){conditions.push('c.type=?');params.push(type);}
  const where=()=>conditions.map(item=>'('+item+')').join(' AND ');
  const total=db.prepare('SELECT count(*) AS n FROM ('+select+' WHERE '+where()+')').get(...params).n;
  if(before) {
    let cursor;try{if(typeof before!=='string'||before.length>700||!/^[A-Za-z0-9_-]+$/u.test(before))throw new Error();cursor=JSON.parse(Buffer.from(before,'base64url').toString('utf8'));}catch{fail(400,'Некорректный курсор обращений.');}
    if(cursor?.complexId!==complexId||cursor.status!==status||cursor.type!==type||!Number.isSafeInteger(cursor.sequence)||cursor.sequence<1)fail(400,'Курсор не соответствует объекту или фильтрам.');conditions.push('c.rowid<?');params.push(cursor.sequence);
  }
  const rows=db.prepare(select+' WHERE '+where()+' ORDER BY c.rowid DESC LIMIT ?').all(...params,limit+1),page=rows.slice(0,limit);
  return {items:page.map(serialize),total,limit,nextCursor:rows.length>limit?Buffer.from(JSON.stringify({complexId,status,type,sequence:page.at(-1).sequence})).toString('base64url'):null,filters:{status,type}};
}
export function captureComplaint(db,complexId,input) {
  const type=input.type;if(!['INDIVIDUAL','COLLECTIVE'].includes(type))fail(400,'Выберите индивидуальное или коллективное обращение.');
  const receivedDate=validDate(input.receivedDate,'Дата поступления'),source=text(input.source,5,1000,'Источник'),summary=text(input.summary,10,6000,'Содержание'),registrationNumber=text(input.registrationNumber===undefined?'':input.registrationNumber,0,120,'Регистрационный номер');
  const fingerprint=createHash('sha256').update(JSON.stringify({complexId,type,receivedDate,source,summary,registrationNumber})).digest('hex');let id,created=false;
  inTransaction(db,()=>{
    const object=checkObject(db,complexId),existing=db.prepare('SELECT complaint_id FROM complaint_intakes WHERE fingerprint=?').get(fingerprint);if(existing){id=existing.complaint_id;return;}
    const before=calculateComplexRisk(db,complexId);id=randomUUID();const now=new Date().toISOString();
    db.prepare('INSERT INTO complaints (id,complex_id,type,verified,summary,source,captured_at) VALUES (?,?,?,0,?,?,?)').run(id,complexId,type,summary,source,now);
    db.prepare('INSERT INTO complaint_intakes VALUES (?,?,?,?,?,?)').run(id,receivedDate,registrationNumber,currentActor(),fingerprint,Number(object.is_demo));
    writeAudit(db,'COMPLEX',complexId,'COMPLAINT_CAPTURED',{complexId,complaintId:id,type,receivedDate});recordRiskIfChanged(db,complexId,before,'Зарегистрировано обращение для проверки');created=true;
  });
  return {created,complaint:getComplaintDetails(db,complexId,id),risk:calculateComplexRisk(db,complexId)};
}
export function reviewComplaint(db,complexId,complaintId,input) {
  const status=input.status;if(!['CONFIRMED','REJECTED','RESOLVED'].includes(status))fail(400,'Выберите решение по обращению.');
  const checkedDate=validDate(input.checkedDate,'Дата проверки'),source=text(input.source,5,1000,'Источник проверки'),evidence=text(input.evidenceText,10,4000,'Содержание проверки'),reason=text(input.reason,5,2000,'Основание решения');
  inTransaction(db,()=>{
    const object=checkObject(db,complexId),complaint=getComplaintDetails(db,complexId,complaintId);if(!complaint)fail(404,'Обращение не найдено.');
    if(complaint.legacy)fail(409,'Историческое обращение не имеет журнала приёма. Зарегистрируйте новый проверяемый материал.');
    if(input.expectedReviewId!==complaint.latestReviewId)fail(409,'По обращению уже внесено решение. Обновите карточку.');
    const allowed={PENDING:['CONFIRMED','REJECTED'],CONFIRMED:['RESOLVED','REJECTED'],REJECTED:['CONFIRMED'],RESOLVED:['CONFIRMED']};
    if(!allowed[complaint.status]?.includes(status))fail(409,'Переход '+complaint.status+' → '+status+' недоступен.');
    if(checkedDate<complaint.receivedDate)fail(400,'Дата проверки не может предшествовать поступлению обращения.');
    const before=calculateComplexRisk(db,complexId),id=randomUUID(),now=new Date().toISOString(),actor=currentActor();
    db.prepare('INSERT INTO complaint_reviews VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,complaintId,status,checkedDate,source,evidence,reason,now,actor,complaint.latestReviewId);
    db.prepare('UPDATE complaints SET verified=? WHERE id=?').run(Number(['CONFIRMED','RESOLVED'].includes(status)),complaintId);
    if(complaint.type==='COLLECTIVE') {
      const factor=db.prepare("SELECT id FROM risk_factors WHERE complex_id=? AND code='R4' AND source_type='COMPLAINT' AND source_id=?").get(complexId,complaintId),active=status==='CONFIRMED',context=JSON.stringify({complaintId,reviewId:id,status,checkedDate});
      if(factor)db.prepare('UPDATE risk_factors SET status=?,source_label=?,evidence_text=?,notes=?,confirmed_by=?,confirmed_at=?,rejected_by=?,rejected_at=?,context_json=? WHERE id=?').run(active?'CONFIRMED':'REJECTED',source,evidence,reason,active?actor:null,active?now:null,active?null:actor,active?null:now,context,factor.id);
      else if(active)db.prepare("INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_id,source_label,evidence_text,confidence,confirmed_by,confirmed_at,notes,is_demo,created_at,context_json) VALUES (?,?,'R4',?,'CONFIRMED','COMPLAINT',?,?,?,1,?,?,?,?,?,?)").run(randomUUID(),complexId,getSettings(db).weights.R4,complaintId,source,evidence,actor,now,reason,object.is_demo,now,context);
    }
    writeAudit(db,'COMPLEX',complexId,'COMPLAINT_REVIEWED',{complexId,complaintId,reviewId:id,from:complaint.status,status,checkedDate});recordRiskIfChanged(db,complexId,before,'Решение по обращению: '+status);
  });
  return {complaint:getComplaintDetails(db,complexId,complaintId),risk:calculateComplexRisk(db,complexId)};
}
