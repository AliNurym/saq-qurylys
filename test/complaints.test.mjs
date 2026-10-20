import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,createSchema} from '../src/db.mjs';
import {createComplex} from '../src/passport-service.mjs';
import {calculateComplexRisk,getComplexDetails} from '../src/complex-service.mjs';
import {captureComplaint,reviewComplaint,getComplaintDetails,listComplaints} from '../src/complaint-service.mjs';
import {getObjectConditions,saveObjectConditions} from '../src/object-conditions.mjs';
import {setLegalBasisStatus,reviewFactor} from '../src/advertisement-service.mjs';
import {createSignal,getSignalDetails,routeSignal} from '../src/signal-service.mjs';
import {renderSignalExport} from '../src/signal-export.mjs';
import {createUser,login,withUser} from '../src/access-service.mjs';
import {createHttpServer} from '../src/server.mjs';
import {todayInKazakhstan} from '../src/dates.mjs';
import {clearDatabase} from '../src/seed-data.mjs';
const today=()=>todayInKazakhstan(),count=(db,table)=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
const intake=(overrides={})=>({type:'COLLECTIVE',receivedDate:today(),source:'Учебный журнал приёма обращений',registrationNumber:'QA-0001',summary:'Коллективное учебное обращение по строительству и условиям продажи.',...overrides});
function fixture(t) {const db=openDatabase(':memory:');t.after(()=>db.close());const object=createComplex(db,{name:'QA объект обращений',city:'Усть-Каменогорск',address:'Учебный адрес',developerName:'QA организация',developerBin:'000000000099',latitude:49.95,longitude:82.61});return {db,id:object.id};}
function decision(db,id,complaintId,status='CONFIRMED',overrides={}) {const current=getComplaintDetails(db,id,complaintId);return {status,checkedDate:today(),source:'Учебный источник сверки обращения',evidenceText:'Проверены содержание, принадлежность объекту и коллективный характер обращения.',reason:'Решение по источнику, синтетический пример',expectedReviewId:current?.latestReviewId??null,...overrides};}
const capture=(db,id,overrides={})=>withUser({username:'qa.mio',role:'MIO'},()=>captureComplaint(db,id,intake(overrides)));
const review=(db,id,caseId,status='CONFIRMED',overrides={})=>withUser({username:'qa.mio',role:'MIO'},()=>reviewComplaint(db,id,caseId,decision(db,id,caseId,status,overrides)));
function allowGreen(db,id) {
  if(db.prepare('SELECT legal_basis_status FROM complexes WHERE id=?').get(id).legal_basis_status!=='CONFIRMED_VALID')setLegalBasisStatus(db,id,{status:'CONFIRMED_VALID',sourceLabel:'QA документ основания',evidenceText:'Учебное основание проверено по источнику.',notes:'Синтетическая проверка без внешнего реестра.',expectedUpdatedAt:getComplexDetails(db,id).updatedAt});
  const state=getObjectConditions(db,id);return saveObjectConditions(db,id,{checkedDate:today(),source:'QA проверка условий объекта',evidenceText:'Проверены документы, строительство, жалобы и просрочка.',checks:{documentsMatch:true,constructionActive:true,complaintsClear:true,delaysClear:true},expectedContextSha256:state.currentContextSha256,expectedReviewId:state.latestReviewId});
}
test('capture is pending, idempotent and unscored; adding a complaint invalidates an earlier green-condition review',t=>{
  const {db,id}=fixture(t);allowGreen(db,id);assert.equal(calculateComplexRisk(db,id).zone,'green');const first=capture(db,id),second=capture(db,id);
  assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(first.complaint.id,second.complaint.id);assert.equal(first.complaint.status,'PENDING');assert.equal(first.complaint.createdBy,'qa.mio');assert.equal(first.risk.score,0);assert.equal(first.risk.zone,'green');assert.equal(first.risk.needsReview,true);assert.equal(getObjectConditions(db,id).reason,'CONTEXT_CHANGED');assert.equal(count(db,'complaint_intakes'),1);
});
test('only verified collective cases contribute R4; individual verification never adds collective points',t=>{
  for(const type of ['INDIVIDUAL','COLLECTIVE']){const db=openDatabase(':memory:');try{const object=createComplex(db,{name:'QA',city:'Город',address:'Адрес',developerName:'Компания',developerBin:'000000000099',latitude:49,longitude:82});const captured=capture(db,object.id,{type}),saved=review(db,object.id,captured.complaint.id);assert.equal(saved.risk.score,type==='COLLECTIVE'?15:0);assert.equal(saved.complaint.status,'CONFIRMED');assert.equal(saved.complaint.verified,true);}finally{db.close();}}
});
test('multiple collective cases count once; resolving one does not clear another, and reopening keeps full history',t=>{
  const {db,id}=fixture(t),a=capture(db,id).complaint,b=capture(db,id,{registrationNumber:'QA-0002',summary:'Другое коллективное учебное обращение по этому объекту.'}).complaint;
  review(db,id,a.id);review(db,id,b.id);assert.equal(calculateComplexRisk(db,id).score,15);review(db,id,a.id,'RESOLVED');assert.equal(calculateComplexRisk(db,id).score,15);review(db,id,b.id,'RESOLVED');assert.equal(calculateComplexRisk(db,id).score,0);
  const reopened=review(db,id,a.id);assert.equal(reopened.risk.score,15);assert.deepEqual(reopened.complaint.reviews.map(item=>item.status),['CONFIRMED','RESOLVED','CONFIRMED']);assert.equal(reopened.complaint.reviews[2].previousReviewId,reopened.complaint.reviews[1].id);
});
test('complaint-linked R4 cannot bypass its lifecycle through the generic factor endpoint',t=>{
  const {db,id}=fixture(t),item=capture(db,id).complaint;review(db,id,item.id);const factor=db.prepare("SELECT id FROM risk_factors WHERE source_type='COMPLAINT' AND source_id=?").get(item.id);
  assert.throws(()=>reviewFactor(db,factor.id,{status:'REJECTED',expectedStatus:'CONFIRMED'}),{statusCode:409});assert.equal(getComplaintDetails(db,id,item.id).status,'CONFIRMED');assert.equal(calculateComplexRisk(db,id).score,15);
});
test('body, intake and review log are immutable; verification projection must follow the latest decision',t=>{
  const {db,id}=fixture(t),item=capture(db,id).complaint;const saved=review(db,id,item.id);
  assert.throws(()=>db.prepare('UPDATE complaints SET summary=? WHERE id=?').run('Changed',item.id),/immutable/u);assert.throws(()=>db.prepare('UPDATE complaint_intakes SET registration_number=? WHERE complaint_id=?').run('Changed',item.id),/immutable/u);
  assert.throws(()=>db.prepare('UPDATE complaint_reviews SET reason=? WHERE id=?').run('Changed',saved.complaint.latestReviewId),/immutable/u);assert.throws(()=>db.prepare('DELETE FROM complaint_reviews WHERE id=?').run(saved.complaint.latestReviewId),/immutable/u);assert.throws(()=>db.prepare('UPDATE complaints SET verified=0 WHERE id=?').run(item.id),/review history/u);
});
test('stale or missing expected review rejects the whole decision without a second review or factor',t=>{
  const {db,id}=fixture(t),item=capture(db,id).complaint,stale=decision(db,id,item.id);review(db,id,item.id);
  assert.throws(()=>reviewComplaint(db,id,item.id,stale),{statusCode:409});assert.throws(()=>review(db,id,item.id,'RESOLVED',{expectedReviewId:undefined}),{statusCode:409});assert.equal(count(db,'complaint_reviews'),1);assert.equal(count(db,'risk_factors'),1);
});
test('validation rejects impossible/future dates, early reviews, missing evidence and invalid transitions',t=>{
  const {db,id}=fixture(t);
  for(const bad of [{type:'OTHER'},{receivedDate:'2026-02-30'},{receivedDate:'0000-01-01'},{receivedDate:todayInKazakhstan(new Date(Date.now()+86400000))},{summary:'short'},{source:''},{registrationNumber:null}])assert.throws(()=>capture(db,id,bad),{statusCode:400});
  assert.equal(capture(db,id,{receivedDate:'2009-12-31'}).complaint.receivedDate,'2009-12-31','historical receipt dates have no arbitrary 2010 cutoff');
  const item=capture(db,id).complaint;assert.throws(()=>review(db,id,item.id,'RESOLVED'),{statusCode:409});assert.throws(()=>review(db,id,item.id,'CONFIRMED',{checkedDate:todayInKazakhstan(new Date(Date.now()-86400000))}),{statusCode:400});assert.throws(()=>review(db,id,item.id,'CONFIRMED',{evidenceText:''}),{statusCode:400});assert.equal(count(db,'complaint_reviews'),0);
});
test('legacy records keep their original fields and cannot acquire invented intake/review history',t=>{
  const {db,id}=fixture(t);db.prepare('INSERT INTO complaints VALUES (?,?,?,?,?,?,?)').run('old',id,'COLLECTIVE',1,'Историческое учебное обращение','Старый источник','2026-10-01T03:00:00Z');const before=db.prepare('SELECT * FROM complaints').all();createSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM complaints').all(),before);const old=getComplaintDetails(db,id,'old');assert.equal(old.status,'LEGACY_CONFIRMED');assert.equal(old.receivedDate,null);assert.equal(old.createdBy,null);assert.deepEqual(old.reviews,[]);assert.throws(()=>review(db,id,'old'),{statusCode:409});assert.equal(listComplaints(db,id,{status:'LEGACY'}).total,1);
});
test('audit failure rolls back intake and review together with factors, projection and risk history',t=>{
  const {db,id}=fixture(t);db.exec("CREATE TRIGGER fail_intake BEFORE INSERT ON audit_logs WHEN NEW.action='COMPLAINT_CAPTURED' BEGIN SELECT RAISE(ABORT,'QA intake audit failure'); END;");assert.throws(()=>capture(db,id),/QA intake audit failure/u);assert.equal(count(db,'complaints'),0);assert.equal(count(db,'complaint_intakes'),0);db.exec('DROP TRIGGER fail_intake');
  const item=capture(db,id).complaint,before=count(db,'risk_history');db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON audit_logs WHEN NEW.action='COMPLAINT_REVIEWED' BEGIN SELECT RAISE(ABORT,'QA review audit failure'); END;");assert.throws(()=>review(db,id,item.id),/QA review audit failure/u);assert.equal(count(db,'complaint_reviews'),0);assert.equal(count(db,'risk_factors'),0);assert.equal(getComplaintDetails(db,id,item.id).verified,false);assert.equal(count(db,'risk_history'),before);
});
test('resolution invalidates a condition review even when historical complaint verification remains true',t=>{
  const {db,id}=fixture(t),item=capture(db,id).complaint;review(db,id,item.id);allowGreen(db,id);const before=getObjectConditions(db,id);assert.equal(before.eligible,true);assert.equal(calculateComplexRisk(db,id).zone,'green');
  const resolved=review(db,id,item.id,'RESOLVED');assert.equal(resolved.complaint.verified,true);assert.equal(getComplexDetails(db,id).complaints[0].status,'RESOLVED');assert.equal(resolved.risk.score,0);assert.equal(getObjectConditions(db,id).reason,'CONTEXT_CHANGED');assert.equal(resolved.risk.zone,'green');assert.equal(resolved.risk.needsReview,true);allowGreen(db,id);assert.equal(calculateComplexRisk(db,id).zone,'green');
});
test('new signal and offline export freeze the receipt and decision; old snapshots do not reconstruct complaints',t=>{
  const {db,id}=fixture(t),item=capture(db,id,{registrationNumber:'QA <номер>'}).complaint;review(db,id,item.id);const signal=createSignal(db,id),html=renderSignalExport(signal);assert.equal(signal.complaints[0].status,'CONFIRMED');assert.match(html,/QA &lt;номер&gt;/u);
  review(db,id,item.id,'RESOLVED');assert.equal(getSignalDetails(db,signal.id).complaints[0].status,'CONFIRMED');assert.equal(renderSignalExport(getSignalDetails(db,signal.id)),html);assert.match(renderSignalExport({...signal,complaints:null}),/Текущие обращения не подставляются/u);
});
test('filters and cursors reach all receipts and cannot cross objects or status filters',t=>{
  const {db,id}=fixture(t);for(let i=0;i<7;i++)capture(db,id,{registrationNumber:'QA-'+i,type:i%2?'INDIVIDUAL':'COLLECTIVE'});
  const all=[];let before;do{const page=listComplaints(db,id,{limit:2,before});all.push(...page.items.map(item=>item.id));before=page.nextCursor;}while(before);assert.equal(new Set(all).size,7);assert.equal(listComplaints(db,id,{type:'COLLECTIVE'}).total,4);
  const page=listComplaints(db,id,{limit:2});assert.throws(()=>listComplaints(db,id,{status:'CONFIRMED',before:page.nextCursor}),{statusCode:400});assert.throws(()=>listComplaints(db,id,{status:'OTHER'}),{statusCode:400});assert.equal(getComplaintDetails(db,'other',all[0]),null);
});
test('demo reset cannot delete manually registered complaint evidence and its history',t=>{
  const {db,id}=fixture(t),item=capture(db,id).complaint;review(db,id,item.id);assert.throws(()=>clearDatabase(db),/зарегистрированными обращениями/u);assert.equal(getComplaintDetails(db,id,item.id).reviews.length,1);
});
test('HTTP intake/review are MIO-only, duplicate intake is idempotent and simultaneous decisions conflict',async t=>{
  const {db,id}=fixture(t),password='complaint-password-2026',tokens={};for(const [name,role] of [['qa.admin','ADMIN'],['qa.mio','MIO'],['qa.gask','GASK']]){createUser(db,{username:name,password,role});tokens[name]=(await login(db,{username:name,password},name)).token;}
  const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const root='http://127.0.0.1:'+server.address().port,base='/api/complexes/'+id+'/complaints',req=(path,token,body)=>fetch(root+path,{method:body?'POST':'GET',headers:{...(token?{Cookie:'saq_session='+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await req(base)).status,401);assert.equal((await req(base,tokens['qa.admin'],intake())).status,403);assert.equal((await req(base,tokens['qa.gask'],intake())).status,403);
    const created=await req(base,tokens['qa.mio'],intake());assert.equal(created.status,201);const item=(await created.json()).complaint;assert.equal((await req(base,tokens['qa.mio'],intake())).status,200);
    const body=decision(db,id,item.id),results=await Promise.all([req(base+'/'+item.id+'/review',tokens['qa.mio'],body),req(base+'/'+item.id+'/review',tokens['qa.mio'],body)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal(count(db,'complaint_reviews'),1);
    assert.equal((await req(base+'/'+item.id,tokens['qa.gask'])).status,403);const signal=createSignal(db,id);routeSignal(db,signal.id,{recipient:'GASK',reason:'Учебное назначение материала получателю'});assert.equal((await req(base+'/'+item.id,tokens['qa.gask'])).status,200);assert.equal((await req(base+'/'+item.id+'/review',tokens['qa.gask'],decision(db,id,item.id,'RESOLVED'))).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
