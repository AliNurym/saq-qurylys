import { randomUUID, createHash } from 'node:crypto';
import { inTransaction } from './db.mjs';
import { writeAudit } from './audit-service.mjs';
import { withUser } from './access-service.mjs';
import { persistAdvertisement, reanalyzeAdvertisement } from './advertisement-service.mjs';
import { fetchPublicResource, validateSourceUrl } from './public-http.mjs';
import { parseSourceResponse } from './source-adapters.mjs';
import {SourceValidationError} from './collection-errors.mjs';
import {configuredPageCapture} from './page-capture.mjs';
import {decodeEvidenceImage} from './image-evidence.mjs';

const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
const stamp=now=>new Date(now).toISOString();
function safeJobDiagnostic(error,kind) {
  const message=typeof error?.message==='string'?error.message:'';
  const known={PAGE_CAPTURE_FAILED:'Не удалось создать снимок страницы. Проверьте настройку браузера и повторите задачу; материалы этой попытки не сохранены.',SOURCE_TOKEN_MISSING:'На сервере не задана переменная доступа источника.',SOURCE_DISABLED:'Источник отключён. Сбор отменён.',SOURCE_CHANGED:'Источник изменён во время загрузки. Прежний ответ не сохранён.'};
  if(kind==='COLLECT_SOURCE'&&Object.hasOwn(known,message))return {code:message,message:known[message]};
  if(kind==='COLLECT_SOURCE'&&error instanceof SourceValidationError)return {code:'INVALID_SOURCE_RESPONSE',message:error.message};
  if(kind==='COLLECT_SOURCE'&&/^Источник вернул HTTP \d{3}\.$/u.test(message))return {code:'SOURCE_HTTP_ERROR',message};
  return {code:kind==='COLLECT_SOURCE'?'SOURCE_PROCESSING_ERROR':'ANALYSIS_ERROR',message:'Не удалось обработать задачу. Проверьте доступность источника, формат и настройку доступа.'};
}
const publicSource=row=>row?{id:row.id,name:row.name,kind:row.kind,platform:row.platform,url:row.url,tokenEnv:row.token_env,
  tokenStatus:!row.token_env?'NOT_REQUIRED':process.env[row.token_env]?'CONFIGURED':'MISSING',enabled:Boolean(row.enabled),intervalMinutes:row.interval_minutes,nextRunAt:row.next_run_at,updatedAt:row.updated_at}:null;
export function listSources(db) {return db.prepare('SELECT * FROM collection_sources ORDER BY name,id').all().map(publicSource);}
export function getSource(db,id) {
  const source=publicSource(db.prepare('SELECT * FROM collection_sources WHERE id=?').get(id));if(!source)return null;
  const last=db.prepare("SELECT id FROM background_jobs WHERE kind='COLLECT_SOURCE' AND subject_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(id);
  return {...source,lastCollection:last?getJob(db,last.id):null,archiveCount:db.prepare('SELECT count(*) AS n FROM source_archives WHERE source_id=?').get(id).n,
    publicationCount:db.prepare('SELECT count(*) AS n FROM collected_publications WHERE source_id=?').get(id).n};
}

export function saveSource(db,input,id=null) {
  if(!input || typeof input!=='object')fail(400,'Укажите параметры источника.');
  const name=typeof input.name==='string'?input.name.trim():'';
  const platform=typeof input.platform==='string'?input.platform.trim():'';
  if(!name || name.length>120 || !platform || platform.length>60)fail(400,'Укажите название и платформу источника.');
  if(!['HTML_PAGE','JSON_FEED'].includes(input.kind))fail(400,'Выберите HTML_PAGE или JSON_FEED.');
  const url=validateSourceUrl(input.url).href;
  const interval=input.intervalMinutes??1440;
  if(!Number.isInteger(interval)||interval<60||interval>10080)fail(400,'Интервал: целое число от 60 до 10080 минут.');
  if(typeof input.enabled!=='boolean')fail(400,'Укажите enabled: true или false.');
  const tokenEnv=input.tokenEnv||null;
  if(tokenEnv!==null && (typeof tokenEnv!=='string'||!/^SAQ_SOURCE_[A-Z0-9_]{1,80}_TOKEN$/u.test(tokenEnv)))fail(400,'Для секрета укажите имя SAQ_SOURCE_..._TOKEN, без значения токена.');
  return inTransaction(db,()=>{
    const existing=id?db.prepare('SELECT * FROM collection_sources WHERE id=?').get(id):null;
    if(id && !existing)fail(404,'Источник не найден.');
    if(existing && input.expectedUpdatedAt!==existing.updated_at)fail(409,'Источник изменён. Загрузите его заново.');
    const now=stamp(Math.max(Date.now(),existing?Date.parse(existing.updated_at)+1:0));id??=randomUUID();
    db.prepare(`INSERT INTO collection_sources VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,kind=excluded.kind,platform=excluded.platform,url=excluded.url,token_env=excluded.token_env,
      enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at`)
      .run(id,name,input.kind,platform,url,tokenEnv,Number(input.enabled),interval,now,existing?.created_at||now,now);
    if(!input.enabled) {
      const cancelled=db.prepare("SELECT id FROM background_jobs WHERE kind='COLLECT_SOURCE' AND subject_id=? AND state='PENDING'").all(id);
      db.prepare("UPDATE background_jobs SET state='CANCELLED',finished_at=?,last_error='Источник отключён. Ожидающий сбор отменён.',last_error_code='SOURCE_DISABLED' WHERE kind='COLLECT_SOURCE' AND subject_id=? AND state='PENDING'").run(now,id);
      for(const job of cancelled)writeAudit(db,'JOB',job.id,'JOB_CANCELLED',{reason:'SOURCE_DISABLED',sourceId:id});
    }
    writeAudit(db,'SOURCE',id,existing?'SOURCE_UPDATED':'SOURCE_CREATED',{name,kind:input.kind,platform,enabled:input.enabled,intervalMinutes:interval});
    return publicSource(db.prepare('SELECT * FROM collection_sources WHERE id=?').get(id));
  });
}

function enqueue(db,kind,subjectId,now) {
  const existing=db.prepare("SELECT id FROM background_jobs WHERE kind=? AND subject_id=? AND state IN ('PENDING','RUNNING')").get(kind,subjectId);
  if(existing)return {id:existing.id,created:false};
  const id=randomUUID();
  db.prepare("INSERT INTO background_jobs(id,kind,subject_id,state,run_after,created_at) VALUES (?,?,?,'PENDING',?,?)").run(id,kind,subjectId,stamp(now),stamp(now));
  return {id,created:true};
}
export function enqueueSource(db,id,now=new Date(),expectedUpdatedAt) {
  return inTransaction(db,()=>{
    const source=db.prepare('SELECT enabled,updated_at FROM collection_sources WHERE id=?').get(id);
    if(!source)fail(404,'Источник не найден.');if(!source.enabled)fail(409,'Источник отключён.');
    if(expectedUpdatedAt!==undefined&&expectedUpdatedAt!==source.updated_at)fail(409,'Источник изменён. Загрузите актуальные настройки перед запуском.');
    const result=enqueue(db,'COLLECT_SOURCE',id,now);
    if(result.created)writeAudit(db,'SOURCE',id,'SOURCE_COLLECTION_QUEUED',{jobId:result.id});
    return result;
  });
}
export function scheduleCollections(db,now=new Date()) {
  return inTransaction(db,()=>{
    const scheduled=[];
    for(const source of db.prepare('SELECT * FROM collection_sources WHERE enabled=1 AND next_run_at<=?').all(stamp(now))) {
      const job=enqueue(db,'COLLECT_SOURCE',source.id,now);
      db.prepare('UPDATE collection_sources SET next_run_at=? WHERE id=?').run(stamp(new Date(now).getTime()+source.interval_minutes*60000),source.id);
      if(job.created) {writeAudit(db,'SOURCE',source.id,'SOURCE_COLLECTION_QUEUED',{jobId:job.id},'System');scheduled.push(job.id);}
    }
    return scheduled;
  });
}
export function listJobs(db) {
  return listJobPage(db,{limit:200}).items;
}
export function listJobPage(db,{limit=20,before=null,state='',kind='',sourceId=''}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>200)fail(400,'Очередь: limit от 1 до 200.');
  if(typeof state!=='string'||state&&!['PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED'].includes(state))fail(400,'Некорректное состояние задачи.');
  if(typeof kind!=='string'||kind&&!['COLLECT_SOURCE','ANALYZE_AD'].includes(kind))fail(400,'Некорректный тип задачи.');
  if(typeof sourceId!=='string'||sourceId.length>100)fail(400,'Некорректный источник очереди.');
  if(sourceId&&!db.prepare('SELECT 1 FROM collection_sources WHERE id=?').get(sourceId))fail(404,'Источник очереди не найден.');
  const clauses=[],params=[];
  if(state){clauses.push('j.state=?');params.push(state);}
  if(kind){clauses.push('j.kind=?');params.push(kind);}
  if(sourceId){clauses.push("((j.kind='COLLECT_SOURCE' AND j.subject_id=?) OR (j.kind='ANALYZE_AD' AND EXISTS(SELECT 1 FROM collected_publications p WHERE p.advertisement_id=j.subject_id AND p.source_id=?)))");params.push(sourceId,sourceId);}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=db.prepare('SELECT count(*) AS n FROM background_jobs j'+where).get(...params).n;
  const cursor=before?db.prepare('SELECT created_at,rowid FROM background_jobs WHERE id=?').get(before):null;
  if(before&&!cursor)fail(400,'Курсор задачи не найден.');
  const rows=db.prepare('SELECT j.id,j.kind,j.subject_id AS subjectId,j.state,j.attempts,j.max_attempts AS maxAttempts,j.run_after AS runAfter,j.lease_until AS leaseUntil,j.last_error AS lastError,j.last_error_code AS errorCode,j.result_json AS result,j.created_at AS createdAt,j.finished_at AS finishedAt FROM background_jobs j'+where+
    (cursor?(where?' AND ':' WHERE ')+'(j.created_at,j.rowid)<(?,?)':'')+' ORDER BY j.created_at DESC,j.rowid DESC LIMIT ?').all(...params,...(cursor?[cursor.created_at,cursor.rowid]:[]),limit+1);
  const items=rows.slice(0,limit).map(row=>({...row,result:row.result?JSON.parse(row.result):null}));
  return {items,total,nextCursor:rows.length>limit?items.at(-1).id:null,checkedAt:new Date().toISOString()};
}
export function getJob(db,id) {
  const row=db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id);
  if(!row)return null;
  const result=row.result_json?JSON.parse(row.result_json):null;
  const publications=row.kind==='COLLECT_SOURCE'&&result?.archiveId?db.prepare('SELECT p.advertisement_id AS advertisementId,p.published_at AS publishedAt,p.observed_at AS observedAt,substr(a.text,1,220) AS excerpt FROM collected_publications p JOIN advertisements a ON a.id=p.advertisement_id WHERE p.archive_id=? ORDER BY p.rowid LIMIT 100').all(result.archiveId):[];
  return {id:row.id,kind:row.kind,subjectId:row.subject_id,state:row.state,attempts:row.attempts,maxAttempts:row.max_attempts,
    runAfter:row.run_after,leaseUntil:row.lease_until,lastError:row.last_error,errorCode:row.last_error_code,result,createdAt:row.created_at,finishedAt:row.finished_at,publications,
    events:db.prepare("SELECT action,actor,timestamp,metadata_json FROM audit_logs WHERE entity_type='JOB' AND entity_id=? ORDER BY rowid DESC LIMIT 50").all(id).reverse().map(event=>({action:event.action,actor:event.actor,timestamp:event.timestamp,metadata:JSON.parse(event.metadata_json)}))};
}
export function retryJob(db,id) {
  return inTransaction(db,()=>{
    const job=db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id);
    if(!job)fail(404,'Задача не найдена.');if(job.state!=='FAILED')fail(409,'Повтор доступен только для завершившейся с ошибкой задачи.');
    if(job.kind==='COLLECT_SOURCE' && !db.prepare('SELECT 1 FROM collection_sources WHERE id=? AND enabled=1').get(job.subject_id))fail(409,'Источник отключён.');
    if(db.prepare("SELECT 1 FROM background_jobs WHERE kind=? AND subject_id=? AND state IN ('PENDING','RUNNING')").get(job.kind,job.subject_id))fail(409,'Уже есть активная задача.');
    db.prepare("UPDATE background_jobs SET state='PENDING',attempts=0,run_after=?,lease_until=NULL,lease_token=NULL,last_error=NULL,last_error_code=NULL,result_json=NULL,finished_at=NULL WHERE id=?").run(new Date().toISOString(),id);
    writeAudit(db,'JOB',id,'JOB_RETRIED',{});return {id,state:'PENDING'};
  });
}

export function claimJob(db,now=new Date()) {
  return inTransaction(db,()=>{
    const time=stamp(now);
    const exhausted=db.prepare("SELECT id FROM background_jobs WHERE state='RUNNING' AND lease_until<=? AND attempts>=max_attempts").all(time);
    for(const job of exhausted) {
      db.prepare("UPDATE background_jobs SET state='FAILED',lease_token=NULL,lease_until=NULL,finished_at=?,last_error='Превышено число попыток после остановки исполнителя.',last_error_code='LEASE_EXHAUSTED' WHERE id=?").run(time,job.id);
      writeAudit(db,'JOB',job.id,'JOB_FAILED',{reason:'LEASE_EXHAUSTED'},'System');
    }
    const job=db.prepare(`SELECT * FROM background_jobs WHERE attempts<max_attempts AND
      ((state='PENDING' AND run_after<=?) OR (state='RUNNING' AND lease_until<=?)) ORDER BY run_after,rowid LIMIT 1`).get(time,time);
    if(!job)return null;
    const token=randomUUID(),lease=stamp(new Date(now).getTime()+120000);
    db.prepare("UPDATE background_jobs SET state='RUNNING',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=?").run(lease,token,job.id);
    return {...job,state:'RUNNING',attempts:job.attempts+1,lease_until:lease,lease_token:token};
  });
}
function ownsJob(db,job) {
  return Boolean(db.prepare("SELECT 1 FROM background_jobs WHERE id=? AND state='RUNNING' AND lease_token=? AND lease_until>?").get(job.id,job.lease_token,new Date().toISOString()));
}
function persistCollection(db,job,source,resource,items,capture=null) {
  return inTransaction(db,()=>{
    const current=db.prepare('SELECT * FROM collection_sources WHERE id=?').get(source.id);
    if(!ownsJob(db,job))throw new Error('LEASE_LOST');
    if(!current?.enabled || current.updated_at!==source.updated_at)throw Object.assign(new Error('SOURCE_CHANGED'),{cancelled:true});
    const capturedAt=new Date().toISOString(),archiveId=randomUUID();
    const sourceSnapshot={name:source.name,kind:source.kind,platform:source.platform,url:source.url};
    let captureEvidenceId=null;
    if(capture) {
      const existing=db.prepare('SELECT p.advertisement_id FROM collected_publications p WHERE p.source_id=? AND p.external_id=? AND p.content_sha256=?').get(source.id,items[0].externalId,items[0].contentSha256);
      captureEvidenceId=existing?db.prepare('SELECT id FROM evidence_files WHERE advertisement_id=? AND sha256=? LIMIT 1').get(existing.advertisement_id,capture.sha256)?.id??null:null;
      captureEvidenceId??=randomUUID();
      sourceSnapshot.capture={evidenceId:captureEvidenceId,mime:capture.mime,sha256:capture.sha256,capturedAt:capture.capturedAt,provenance:capture.provenance};
    }
    db.prepare('INSERT INTO source_archives VALUES (?,?,?,?,?,?,?,?,?)').run(archiveId,source.id,job.id,resource.finalUrl,resource.mime,createHash('sha256').update(resource.bytes).digest('hex'),capturedAt,resource.bytes,JSON.stringify(sourceSnapshot));
    let inserted=0,duplicates=0;
    for(const item of items) {
      const existing=db.prepare('SELECT advertisement_id FROM collected_publications WHERE source_id=? AND external_id=? AND content_sha256=?').get(source.id,item.externalId,item.contentSha256);
      const adId=existing?.advertisement_id??persistAdvertisement(db,{...item,platform:source.platform});
      if(capture&&!db.prepare('SELECT 1 FROM evidence_files WHERE id=?').get(captureEvidenceId)) {
        db.prepare('INSERT INTO evidence_files VALUES (?,?,?,?,?,?)').run(captureEvidenceId,adId,capture.mime,capture.sha256,capture.capturedAt,capture.bytes);
        writeAudit(db,'ADVERTISEMENT',adId,'SOURCE_PAGE_CAPTURED',{evidenceId:captureEvidenceId,archiveId,sha256:capture.sha256,method:capture.provenance.method,partial:capture.provenance.partial,viewportOnly:capture.provenance.viewportOnly===true},'System');
      }
      if(existing){duplicates++;continue;}
      db.prepare('INSERT INTO collected_publications VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),source.id,item.externalId,item.contentSha256,adId,archiveId,item.publishedAt,capturedAt);
      enqueue(db,'ANALYZE_AD',adId,new Date());inserted++;
    }
    writeAudit(db,'SOURCE',source.id,'SOURCE_COLLECTED',{jobId:job.id,archiveId,inserted,duplicates,observed:items.length},'System');
    return {archiveId,inserted,duplicates,observed:items.length,capture:source.kind!=='HTML_PAGE'?{status:'NOT_APPLICABLE'}:capture?{status:capture.provenance.partial?'PARTIAL':'CAPTURED',evidenceId:captureEvidenceId,sha256:capture.sha256,viewportOnly:capture.provenance.viewportOnly===true}:{status:'NOT_CONFIGURED'}};
  });
}

export async function processNextJob(db,{fetcher=fetchPublicResource,screenshotter}={}) {
  const job=claimJob(db);if(!job)return null;
  return withUser({username:'System'},async()=>{
    try {
      let result;
      if(job.kind==='COLLECT_SOURCE') {
        const source=db.prepare('SELECT * FROM collection_sources WHERE id=?').get(job.subject_id);
        if(!source?.enabled)throw Object.assign(new Error('SOURCE_DISABLED'),{cancelled:true});
        const token=source.token_env?process.env[source.token_env]:'';
        if(source.token_env && !token)throw new Error('SOURCE_TOKEN_MISSING');
        const resource=await fetcher(source.url,{token});
        validateSourceUrl(resource.finalUrl);
        const items=parseSourceResponse(source,resource);let capture=null;
        if(source.kind==='HTML_PAGE') {
          try {
          const renderer=screenshotter===undefined?configuredPageCapture():screenshotter;
          if(renderer) {
            const rendered=await renderer(resource),decoded=decodeEvidenceImage(rendered.bytes.toString('base64'));
            const viewportOnly=rendered.provenance?.viewportOnly===true;
            if(rendered.provenance?.rootSha256!==createHash('sha256').update(resource.bytes).digest('hex')||rendered.provenance?.rootOrigin!==new URL(resource.finalUrl).origin||!['CONTROLLED_BROWSER_VIEWPORT','CONTROLLED_BROWSER_FULL_PAGE'].includes(rendered.provenance?.method)||viewportOnly!==(rendered.provenance.method==='CONTROLLED_BROWSER_VIEWPORT')||typeof rendered.provenance.partial!=='boolean'||!Number.isFinite(Date.parse(rendered.capturedAt))||decoded.width>1280||decoded.height>12500||decoded.width*decoded.height>16_000_000||(viewportOnly&&(decoded.width!==1280||decoded.height!==960))||(!viewportOnly&&(decoded.width!==1280||decoded.height<960||decoded.height!==Math.ceil(rendered.provenance.documentHeight)))||JSON.stringify(rendered.provenance).length>64000)throw Error('CAPTURE_INVALID_RESULT');
            capture={...decoded,capturedAt:rendered.capturedAt,provenance:rendered.provenance};
          }
          }catch{throw Error('PAGE_CAPTURE_FAILED');}
        }
        result=persistCollection(db,job,source,resource,items,capture);
      } else {
        await reanalyzeAdvertisement(db,job.subject_id);result={advertisementId:job.subject_id};
      }
      inTransaction(db,()=>{
        if(!ownsJob(db,job))return;
        db.prepare("UPDATE background_jobs SET state='SUCCEEDED',lease_until=NULL,lease_token=NULL,last_error=NULL,last_error_code=NULL,result_json=?,finished_at=? WHERE id=?").run(JSON.stringify(result),new Date().toISOString(),job.id);
        writeAudit(db,'JOB',job.id,'JOB_SUCCEEDED',{kind:job.kind},'System');
      });
    } catch(error) {
      inTransaction(db,()=>{
        if(!ownsJob(db,job))return;
        const state=error?.cancelled?'CANCELLED':job.attempts>=job.max_attempts?'FAILED':'PENDING';
        // Provider responses and credentials never enter the API-visible job error field.
        const diagnostic=safeJobDiagnostic(error,job.kind);
        const next=stamp(Date.now()+Math.min(3600000,30000*2**(job.attempts-1)));
        db.prepare('UPDATE background_jobs SET state=?,run_after=?,lease_until=NULL,lease_token=NULL,last_error=?,last_error_code=?,finished_at=? WHERE id=?').run(state,next,diagnostic.message,diagnostic.code,state==='PENDING'?null:new Date().toISOString(),job.id);
        writeAudit(db,'JOB',job.id,'JOB_'+state,{kind:job.kind,attempt:job.attempts,reason:diagnostic.code},'System');
      });
    }
    return getJob(db,job.id);
  });
}

