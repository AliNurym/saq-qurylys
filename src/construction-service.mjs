import { randomUUID,createHash } from 'node:crypto';
import { inTransaction } from './db.mjs';
import { currentActor } from './access-service.mjs';
import { writeAudit } from './audit-service.mjs';
import { validPublicationDate } from './dates.mjs';
import { decodeEvidenceImage } from './image-evidence.mjs';
import { getConstructionObservation } from './construction-evidence.mjs';
import { persistReadinessChange } from './readiness-service.mjs';
import { calculateComplexRisk,recordRiskIfChanged } from './complex-service.mjs';

const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
function text(value,label,min,max) {
  if(typeof value!=='string'||value.trim().length<min||value.length>max)fail(400,label+': от '+min+' до '+max+' символов.');
  return value.trim();
}
export function addConstructionObservation(db,complexId,input={}) {
  if(!validPublicationDate(input.observedDate))fail(400,'Укажите существующую дату наблюдения не позднее сегодняшней.');
  if(!['number','string'].includes(typeof input.completionPercentage)||String(input.completionPercentage).trim()==='')fail(400,'Укажите готовность от 0 до 100.');
  const percentage=Number(input.completionPercentage);
  if(!Number.isFinite(percentage)||percentage<0||percentage>100)fail(400,'Укажите готовность от 0 до 100.');
  const source=text(input.source,'Источник фотоотчёта',3,500),method=text(input.method,'Метод определения готовности',10,1000),description=text(input.description??'','Описание',0,2000);
  const supersedesId=input.supersedesId??null;
  if(supersedesId!==null&&(typeof supersedesId!=='string'||!supersedesId||supersedesId.length>100))fail(400,'Некорректный идентификатор исправляемого фотоотчёта.');
  const photo=decodeEvidenceImage(input.data);
  const fingerprint=createHash('sha256').update(JSON.stringify({observedDate:input.observedDate,percentage,source,method,description,supersedesId,sha256:photo.sha256})).digest('hex');
  return inTransaction(db,()=>{
    if(!db.prepare('SELECT 1 FROM complexes WHERE id=?').get(complexId))fail(404,'ЖК не найден.');
    if(supersedesId&&!getConstructionObservation(db,complexId,supersedesId))fail(404,'Исправляемый фотоотчёт не найден у этого ЖК.');
    const existing=db.prepare('SELECT id FROM construction_observations WHERE complex_id=? AND fingerprint=?').get(complexId,fingerprint);
    if(existing)return {created:false,observation:getConstructionObservation(db,complexId,existing.id)};
    const id=randomUUID(),now=new Date().toISOString();
    db.prepare('INSERT INTO construction_observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,complexId,input.observedDate,percentage,source,method,description,supersedesId,photo.mime,photo.sha256,photo.width,photo.height,photo.bytes,fingerprint,now,currentActor());
    writeAudit(db,'COMPLEX',complexId,'CONSTRUCTION_OBSERVATION_CREATED',{observationId:id,observedDate:input.observedDate,percentage,sha256:photo.sha256,supersedesId});
    return {created:true,observation:getConstructionObservation(db,complexId,id)};
  });
}

export function reviewConstructionObservation(db,complexId,id,input={}) {
  if(!['CONFIRMED','REJECTED'].includes(input.status)||input.expectedStatus!=='PENDING')fail(400,'Укажите CONFIRMED или REJECTED и expectedStatus: PENDING.');
  const reason=text(input.reason,'Результат проверки',5,1000);
  if(input.status==='CONFIRMED'&&typeof input.applyToReadiness!=='boolean')fail(400,'Явно укажите applyToReadiness: true или false.');
  if(input.status==='REJECTED'&&input.applyToReadiness)fail(400,'Отклонённый фотоотчёт нельзя применять к готовности.');
  const applied=input.status==='CONFIRMED'&&input.applyToReadiness===true;
  return inTransaction(db,()=>{
    const observation=getConstructionObservation(db,complexId,id);
    if(!observation)fail(404,'Фотоотчёт не найден.');
    if(observation.status!=='PENDING') {
      if(observation.status===input.status&&observation.reviewReason===reason&&observation.applied===applied)return {idempotent:true,observation};
      fail(409,'Решение по фотоотчёту уже сохранено. Для исправления создайте новый отчёт.');
    }
    const complex=db.prepare('SELECT * FROM complexes WHERE id=?').get(complexId);
    if(input.status==='CONFIRMED'&&observation.supersededBy)fail(409,'Фотоотчёт уже исправлен. Подтверждайте последнюю запись цепочки.');
    if(input.status==='CONFIRMED'&&observation.supersedesId) {
      const parent=getConstructionObservation(db,complexId,observation.supersedesId);
      if(parent.supersededBy)fail(409,'Фотоотчёт уже исправлен. Укажите последний отчёт цепочки.');
      if(parent.id===complex.verified_observation_id&&!applied)fail(409,'Исправление текущего измерения необходимо явно применить к готовности.');
    }
    if(applied) {
      if(input.expectedUpdatedAt!==complex.updated_at)fail(409,'Паспорт изменён. Обновите карточку перед применением фотоотчёта.');
      if(complex.verified_completion_at&&observation.observedDate<complex.verified_completion_at.slice(0,10))fail(409,'Историческое наблюдение не заменяет более позднюю готовность. Подтвердите его без применения.');
    }
    const beforeRisk=applied?calculateComplexRisk(db,complexId):null,now=new Date().toISOString();
    db.prepare('INSERT INTO construction_reviews VALUES (?,?,?,?,?,?)').run(id,input.status,reason,Number(applied),now,currentActor());
    if(applied) {
      persistReadinessChange(db,complexId,'VERIFIED',{value:observation.completionPercentage,source:'Фотофиксация #'+id,date:observation.observedDate+'T12:00:00.000Z',observationId:id},reason);
      recordRiskIfChanged(db,complexId,beforeRisk,'Готовность применена из проверенного фотоотчёта');
    }
    writeAudit(db,'COMPLEX',complexId,'CONSTRUCTION_OBSERVATION_'+input.status,{observationId:id,reason,applied,supersedesId:observation.supersedesId});
    return {idempotent:false,observation:getConstructionObservation(db,complexId,id)};
  });
}
