import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase,createSchema } from '../src/db.mjs';
import { seedDemoData } from '../src/seed-data.mjs';
import { addConstructionObservation,reviewConstructionObservation } from '../src/construction-service.mjs';
import { getConstructionObservation,getConstructionPhoto,listConstructionObservations,getConstructionTrend } from '../src/construction-evidence.mjs';
import { getReadinessHistory } from '../src/readiness-service.mjs';
import { getComplexDetails,calculateComplexRisk } from '../src/complex-service.mjs';
import { savePassport } from '../src/passport-service.mjs';
import { addManualFactor,reviewFactor } from '../src/advertisement-service.mjs';
import { createSignal,getSignalDetails,transitionSignal,routeSignal } from '../src/signal-service.mjs';
import { renderSignalExport } from '../src/signal-export.mjs';
import { createUser,login } from '../src/access-service.mjs';
import { createHttpServer } from '../src/server.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve,basename } from 'node:path';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const fixture=t=>{const db=openDatabase(':memory:');seedDemoData(db);t.after(()=>db.close());return db;};
const input={observedDate:'2026-10-15',completionPercentage:40,source:'Выездной осмотр объекта',method:'Оценка специалистом по выполненным объёмам',description:'Синтетический снимок для проверки процесса',data:png};
const add=(db,patch={},cx='cx-qazyna')=>addConstructionObservation(db,cx,{...input,...patch}).observation;
const review=(db,observation,patch={})=>reviewConstructionObservation(db,observation.complexId,observation.id,{status:'CONFIRMED',expectedStatus:'PENDING',reason:'Проверено ответственным специалистом',applyToReadiness:true,expectedUpdatedAt:getComplexDetails(db,observation.complexId).updatedAt,...patch});
const manual={code:'R5',sourceLabel:'Сопоставленные источники',evidenceText:'Заявленная готовность выше проверенной',notes:'Проверены проценты, источники и даты'};

test('photo intake is immutable, idempotent and does not change readiness or scores before review',t=>{
  const db=fixture(t),before=getComplexDetails(db,'cx-qazyna'),risk=calculateComplexRisk(db,'cx-qazyna');
  const photo=add(db);assert.equal(photo.status,'PENDING');assert.equal(photo.width,1);assert.equal(photo.createdBy,'Demo Analyst');
  const retry=addConstructionObservation(db,'cx-qazyna',input);assert.equal(retry.created,false);assert.equal(retry.observation.id,photo.id);
  assert.deepEqual(calculateComplexRisk(db,'cx-qazyna'),risk);assert.equal(getComplexDetails(db,'cx-qazyna').verifiedCompletionPercentage,before.verifiedCompletionPercentage);
  assert.equal(getConstructionPhoto(db,'cx-qazyna',photo.id).bytes.length,68);assert.equal(getConstructionPhoto(db,'cx-aspan',photo.id),null);
  assert.throws(()=>db.prepare("UPDATE construction_observations SET completion_pct=99 WHERE id=?").run(photo.id),/immutable/u);
  assert.throws(()=>db.prepare('DELETE FROM construction_observations WHERE id=?').run(photo.id),/immutable/u);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='CONSTRUCTION_OBSERVATION_CREATED'").get().n,1);
});
test('invalid observation metadata and image data leave no partial evidence',t=>{
  const db=fixture(t);
  for(const patch of [{observedDate:'2099-01-01'},{observedDate:'2026-02-30'},{completionPercentage:true},{completionPercentage:''},{completionPercentage:101},{source:'x'},{method:'x'},{data:'abcd'},{supersedesId:'missing'}])assert.throws(()=>add(db,patch));
  assert.throws(()=>add(db,{},'missing'),error=>error.statusCode===404);
  assert.equal(listConstructionObservations(db,'cx-qazyna').total,0);
});
test('approval needs an explicit decision and fresh passport; rejection never changes readiness',t=>{
  const db=fixture(t),photo=add(db),before=getComplexDetails(db,'cx-qazyna');
  assert.throws(()=>review(db,photo,{applyToReadiness:undefined}),error=>error.statusCode===400);
  assert.throws(()=>review(db,photo,{expectedUpdatedAt:'stale'}),error=>error.statusCode===409);
  assert.equal(getConstructionObservation(db,photo.complexId,photo.id).status,'PENDING');
  review(db,photo,{status:'REJECTED',applyToReadiness:false});assert.equal(getComplexDetails(db,photo.complexId).verifiedCompletionPercentage,before.verifiedCompletionPercentage);
  assert.throws(()=>review(db,photo),error=>error.statusCode===409);
  assert.throws(()=>db.exec('DELETE FROM construction_reviews'),/immutable/u);
});
test('confirmed measurements record revisions, invalidate R5 and cannot revive its stale basis',t=>{
  const db=fixture(t),factor=addManualFactor(db,'cx-qazyna',manual).factor,photo=add(db);
  assert.equal(factor.context.readinessRevision,0);
  review(db,photo);const details=getComplexDetails(db,photo.complexId);
  assert.equal(details.verifiedCompletionPercentage,40);assert.equal(details.verifiedObservationId,photo.id);assert.equal(details.readinessRevision,1);
  assert.equal(db.prepare('SELECT status FROM risk_factors WHERE id=?').get(factor.id).status,'UNKNOWN');
  assert.throws(()=>reviewFactor(db,factor.id,{status:'CONFIRMED'}),error=>error.statusCode===409);
  const fresh=addManualFactor(db,photo.complexId,manual).factor;assert.equal(fresh.context.readinessRevision,1);assert.equal(fresh.context.verifiedObservationId,photo.id);
  assert.equal(getReadinessHistory(db,photo.complexId).items[0].observationId,photo.id);
  assert.throws(()=>db.exec('DELETE FROM readiness_history'),/immutable/u);
});
test('historical reports may be verified without replacing later readiness; replay never rewinds a new measurement',t=>{
  const db=fixture(t),photo=add(db),old=add(db,{observedDate:'2026-10-01'});review(db,photo);
  assert.throws(()=>review(db,old),error=>error.statusCode===409);
  review(db,old,{applyToReadiness:false});
  const newer=add(db,{observedDate:'2026-10-16',completionPercentage:45});review(db,newer);
  assert.equal(review(db,photo).idempotent,true);assert.equal(getComplexDetails(db,photo.complexId).verifiedObservationId,newer.id);
  assert.equal(getReadinessHistory(db,photo.complexId).total,2);
});
test('corrections preserve their originals, reject forked replacements and cannot leave an active measurement superseded',t=>{
  const db=fixture(t),original=add(db);review(db,original);
  const correction=add(db,{completionPercentage:42,supersedesId:original.id});
  assert.throws(()=>review(db,correction,{applyToReadiness:false}),error=>error.statusCode===409);
  review(db,correction);assert.equal(getConstructionObservation(db,original.complexId,original.id).supersededBy,correction.id);
  const fork=add(db,{completionPercentage:43,supersedesId:original.id});assert.throws(()=>review(db,fork),error=>error.statusCode===409);
  assert.deepEqual(getConstructionTrend(db,original.complexId).points.map(point=>point.percentage),[42]);
  const pending=add(db,{observedDate:'2026-10-14'}),replacement=add(db,{observedDate:'2026-10-14',supersedesId:pending.id,completionPercentage:30});review(db,replacement,{applyToReadiness:false});
  assert.throws(()=>review(db,pending,{applyToReadiness:false}),error=>error.statusCode===409);
});
test('manual passport changes preserve unchanged photo links, clear changed links and paginate immutable revisions',t=>{
  const db=fixture(t),photo=add(db);review(db,photo);const before=getComplexDetails(db,photo.complexId);
  const values={source:'Контроль паспорта',expectedUpdatedAt:before.updatedAt,verifiedCompletionPercentage:'40',verifiedCompletionSource:before.verifiedCompletionSource,verifiedCompletionCapturedAt:'2026-10-15'};
  savePassport(db,photo.complexId,values);let details=getComplexDetails(db,photo.complexId);assert.equal(details.verifiedObservationId,photo.id);assert.equal(details.readinessRevision,1);assert.notEqual(details.updatedAt,before.updatedAt);
  assert.throws(()=>savePassport(db,photo.complexId,values),error=>error.statusCode===409);
  details=savePassport(db,photo.complexId,{...values,expectedUpdatedAt:details.updatedAt,verifiedCompletionPercentage:'41'});assert.equal(details.verifiedObservationId,null);assert.equal(details.readinessRevision,2);
  const first=getReadinessHistory(db,photo.complexId,{limit:1});assert.equal(first.nextRevision,1);const second=getReadinessHistory(db,photo.complexId,{limit:1,afterRevision:first.nextRevision});assert.equal(second.items[0].revision,2);assert.equal(second.nextRevision,null);
  assert.throws(()=>getReadinessHistory(db,photo.complexId,{limit:0}),error=>error.statusCode===400);
});
test('reviewed trends preserve decreases and same-day disagreement without automatically asserting delay',t=>{
  const db=fixture(t),factorCount=db.prepare('SELECT count(*) AS n FROM risk_factors').get().n;
  for(const patch of [{observedDate:'2026-10-12',completionPercentage:25},{observedDate:'2026-10-13',completionPercentage:30},{observedDate:'2026-10-14',completionPercentage:28},{observedDate:'2026-10-14',completionPercentage:35},{observedDate:'2026-10-15',completionPercentage:40}])review(db,add(db,patch),{applyToReadiness:false});
  const trend=getConstructionTrend(db,'cx-qazyna');assert.equal(trend.totalPoints,5);assert.equal(trend.totalDates,4);assert.equal(trend.points[1].changePercentagePoints,5);
  assert.equal(trend.points[2].sameDayConflict,true);assert.equal(trend.points[3].sameDayConflict,true);assert.equal(trend.points[4].changePercentagePoints,null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM risk_factors').get().n,factorCount);
});
test('observation pagination never omits same-day uploads and rejects a cursor from another object',t=>{
  const db=fixture(t);for(let i=0;i<7;i++)add(db,{completionPercentage:i});const other=add(db,{},'cx-aspan');
  const ids=[];let before=null;do {const page=listConstructionObservations(db,'cx-qazyna',{limit:2,before});ids.push(...page.items.map(item=>item.id));before=page.nextCursor;}while(before);
  assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);
  assert.throws(()=>listConstructionObservations(db,'cx-qazyna',{before:other.id}),error=>error.statusCode===400);
});
test('photo and review persistence roll back completely when audit recording fails',t=>{
  const db=fixture(t);db.exec("CREATE TRIGGER reject_photo_audit BEFORE INSERT ON audit_logs WHEN NEW.action='CONSTRUCTION_OBSERVATION_CREATED' BEGIN SELECT RAISE(ABORT,'audit offline'); END;");
  assert.throws(()=>add(db),/audit offline/u);assert.equal(listConstructionObservations(db,'cx-qazyna').total,0);db.exec('DROP TRIGGER reject_photo_audit');
  const photo=add(db),before=getComplexDetails(db,photo.complexId);
  db.exec("CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit_logs WHEN NEW.action='CONSTRUCTION_OBSERVATION_CONFIRMED' BEGIN SELECT RAISE(ABORT,'audit offline'); END;");
  assert.throws(()=>review(db,photo),/audit offline/u);assert.equal(getConstructionObservation(db,photo.complexId,photo.id).status,'PENDING');assert.equal(getReadinessHistory(db,photo.complexId).total,0);assert.equal(getComplexDetails(db,photo.complexId).verifiedCompletionPercentage,before.verifiedCompletionPercentage);
  db.exec('DROP TRIGGER reject_review_audit');
  db.exec("CREATE TRIGGER reject_passport_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PASSPORT_UPDATED' BEGIN SELECT RAISE(ABORT,'audit offline'); END;");
  assert.throws(()=>savePassport(db,photo.complexId,{source:'Тест отката паспорта',verifiedCompletionPercentage:42,verifiedCompletionSource:'Осмотр',verifiedCompletionCapturedAt:'2026-10-15'}),/audit offline/u);
  assert.equal(getReadinessHistory(db,photo.complexId).total,0);assert.equal(getComplexDetails(db,photo.complexId).updatedAt,before.updatedAt);
});
test('new signals freeze photo bytes and readiness context; legacy signals never reconstruct live photo evidence',t=>{
  const db=fixture(t),photo=add(db,{source:'Осмотр <script>attack</script>'});review(db,photo);const signal=createSignal(db,photo.complexId),saved=JSON.stringify(signal.constructionEvidence);
  assert.equal(signal.constructionEvidence.activeObservation.photoData,png);const report=renderSignalExport(signal);assert.match(report,/data:image\/png;base64,/u);assert.match(report,/&lt;script&gt;attack&lt;\/script&gt;/u);assert.doesNotMatch(report,/<script>attack/u);
  review(db,add(db,{observedDate:'2026-10-16',completionPercentage:45}));assert.equal(JSON.stringify(getSignalDetails(db,signal.id).constructionEvidence),saved);
  db.prepare("INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,status,created_by,created_at) VALUES ('legacy','cx-qazyna',0,'green','UNKNOWN','[]','DRAFT','Demo Analyst',?)").run(new Date().toISOString());
  const old=getSignalDetails(db,'legacy');assert.equal(old.constructionEvidence,null);assert.match(renderSignalExport(old),/Текущие материалы не подставляются/u);
  const versionOne=db.prepare("SELECT id FROM signals WHERE id<>? AND id<>'legacy' LIMIT 1").get(signal.id);assert.equal(getSignalDetails(db,versionOne.id).constructionEvidence,null);
});
test('additive schema migrations and demo reset preserve evidence; a clean demo reset still works',t=>{
  const db=fixture(t);createSchema(db);seedDemoData(db,{reset:true});assert.equal(db.prepare('SELECT count(*) AS n FROM complexes').get().n,10);
  const photo=add(db);assert.throws(()=>seedDemoData(db,{reset:true}),/фотофиксацией/u);assert.ok(getConstructionPhoto(db,photo.complexId,photo.id));
  const other=fixture(t);savePassport(other,'cx-qazyna',{source:'Контроль',verifiedCompletionPercentage:41,verifiedCompletionSource:'Осмотр',verifiedCompletionCapturedAt:'2026-10-15'});assert.throws(()=>seedDemoData(other,{reset:true}),/историей/u);
});
test('HTTP photo routes enforce MIO writes, assigned-object scope and scoped photo identifiers',async t=>{
  const db=fixture(t),password='construction-test-password';
  createUser(db,{username:'administrator',role:'ADMIN',password});createUser(db,{username:'operator',role:'MIO',password});createUser(db,{username:'inspector',role:'GASK',password});
  const server=createHttpServer(db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const root='http://127.0.0.1:'+server.address().port;
  const tokens={};for(const name of ['administrator','operator','inspector'])tokens[name]=(await login(db,{username:name,password},name)).token;
  const api=(path,{method='GET',body,user='operator'}={})=>fetch(root+path,{method,headers:{Cookie:'saq_session='+tokens[user],'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const path='/api/complexes/cx-qazyna/observations';assert.equal((await api(path,{method:'POST',body:input,user:'administrator'})).status,403);assert.equal((await api(path,{method:'POST',body:input,user:'inspector'})).status,403);
  const created=await api(path,{method:'POST',body:input});assert.equal(created.status,201);const photo=(await created.json()).observation;assert.equal(photo.createdBy,'operator');
  for(const suffix of ['', '/'+photo.id,'/'+photo.id+'/photo'])assert.equal((await api(path+suffix,{user:'inspector'})).status,403);
  assert.equal((await api('/api/complexes/cx-qazyna/readiness-history',{user:'inspector'})).status,403);
  const signal=createSignal(db,'cx-qazyna');transitionSignal(db,signal.id,{status:'CONFIRMED',comment:'Проверено перед назначением'});routeSignal(db,signal.id,{recipient:'GASK',reason:'Назначение для проверки'});
  const image=await api(path+'/'+photo.id+'/photo',{user:'inspector'});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-sha256'),photo.sha256);assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),png);
  assert.equal((await api('/api/complexes/cx-aspan/observations/'+photo.id+'/photo',{user:'inspector'})).status,403);
  assert.equal((await api('/api/complexes/cx-aspan/observations/'+photo.id+'/photo')).status,404);
  const decision=await api(path+'/'+photo.id+'/review',{method:'POST',body:{status:'CONFIRMED',expectedStatus:'PENDING',reason:'Осмотр проверен ответственным',applyToReadiness:true,expectedUpdatedAt:getComplexDetails(db,'cx-qazyna').updatedAt}});assert.equal(decision.status,200);assert.equal((await decision.json()).observation.reviewedBy,'operator');
  assert.equal((await api('/api/complexes/missing/observations')).status,404);assert.equal((await api('/api/complexes/missing/readiness-history')).status,404);
});

test('photo bytes, immutable reviews, revision history and frozen exports survive database reopen',t=>{
  const directory=mkdtempSync(join(tmpdir(),'saq-construction-')),path=join(directory,'evidence.sqlite');let db;
  t.after(()=>{db?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('saq-construction-'));rmSync(directory,{recursive:true,force:true});});
  db=openDatabase(path);seedDemoData(db);const photo=add(db);review(db,photo);const signal=createSignal(db,photo.complexId),report=renderSignalExport(signal);db.close();db=null;
  db=openDatabase(path);assert.equal(getConstructionPhoto(db,photo.complexId,photo.id).bytes.length,68);assert.equal(getConstructionObservation(db,photo.complexId,photo.id).status,'CONFIRMED');assert.equal(getReadinessHistory(db,photo.complexId).total,1);assert.equal(renderSignalExport(getSignalDetails(db,signal.id)),report);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('bounded signal history explicitly reports truncation and the API can retrieve every revision',t=>{
  const db=fixture(t);
  for(let i=0;i<51;i++)review(db,add(db,{completionPercentage:i}),{applyToReadiness:true});
  const signal=createSignal(db,'cx-qazyna');assert.equal(signal.constructionEvidence.trend.totalPoints,51);assert.equal(signal.constructionEvidence.trend.points.length,50);assert.equal(signal.constructionEvidence.trend.truncated,true);
  assert.equal(signal.constructionEvidence.readinessHistory.total,51);assert.equal(signal.constructionEvidence.readinessHistory.items.length,50);assert.equal(signal.constructionEvidence.readinessHistory.truncated,true);
  assert.equal(getReadinessHistory(db,'cx-qazyna',{limit:200}).items.length,51);
});
