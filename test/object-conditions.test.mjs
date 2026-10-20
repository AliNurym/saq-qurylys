import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,createSchema} from '../src/db.mjs';
import {createComplex,savePassport} from '../src/passport-service.mjs';
import {setLegalBasisStatus} from '../src/advertisement-service.mjs';
import {calculateComplexRisk,getComplexDetails} from '../src/complex-service.mjs';
import {calculateRisk,ZONE_POLICY_VERSION} from '../src/risk-engine.mjs';
import {getObjectConditions,saveObjectConditions,listObjectConditionReviews,CONDITION_KEYS} from '../src/object-conditions.mjs';
import {todayInKazakhstan} from '../src/dates.mjs';
import {createSignal,getSignalDetails} from '../src/signal-service.mjs';
import {renderSignalExport} from '../src/signal-export.mjs';
import {createUser,withUser,login} from '../src/access-service.mjs';
import {createHttpServer} from '../src/server.mjs';
const checks=()=>Object.fromEntries(CONDITION_KEYS.map(key=>[key,true]));
const dateAgo=days=>todayInKazakhstan(new Date(Date.now()-days*86400000));
function fixture(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const object=createComplex(db,{name:'QA объект условий',city:'Усть-Каменогорск',address:'Условный адрес',developerName:'QA организация',developerBin:'000000000099',latitude:49.95,longitude:82.61});
  db.prepare("UPDATE complexes SET legal_basis_status='CONFIRMED_VALID',legal_basis_source='Изолированная фикстура правовой проверки',legal_basis_checked_at=? WHERE id=?").run(new Date().toISOString(),object.id);
  return {db,id:object.id};
}
function input(db,id,overrides={}) {const state=getObjectConditions(db,id);return {source:'Учебный отчёт проверки объекта',evidenceText:'Проверены реквизиты документов, объект, ход строительства и обращения.',checkedDate:todayInKazakhstan(),checks:checks(),expectedContextSha256:state.currentContextSha256,expectedReviewId:state.latestReviewId,...overrides};}
const save=(db,id,overrides={})=>withUser({username:'qa.mio',role:'MIO'},()=>saveObjectConditions(db,id,input(db,id,overrides)));

test('case zone follows the fixed score while object checks remain a separate review signal',t=>{
  const {db,id}=fixture(t);assert.equal(calculateComplexRisk(db,id).zone,'green');assert.equal(calculateComplexRisk(db,id).needsReview,true);assert.equal(getObjectConditions(db,id).reason,'NOT_REVIEWED');assert.equal(calculateComplexRisk(db,id).score,0);
  const saved=save(db,id);assert.equal(saved.state.eligible,true);assert.equal(saved.review.createdBy,'qa.mio');assert.equal(saved.risk.zone,'green');assert.equal(saved.risk.score,0);
  assert.equal(saved.risk.monitoringDays,30);assert.equal(getComplexDetails(db,id).objectConditions.review.id,saved.review.id);
});
test('unconfirmed object conditions remain separate review items in the fixed case score',t=>{
  const {db,id}=fixture(t);save(db,id);
  for(const key of CONDITION_KEYS){const saved=save(db,id,{checks:{...checks(),[key]:false}});assert.equal(saved.state.reason,'CHECKS_FAILED');assert.equal(saved.risk.zone,'green');assert.equal(saved.risk.needsReview,true);assert.equal(saved.risk.score,0);}
  assert.equal(listObjectConditionReviews(db,id).total,5);
});
test('source/identity/readiness context changes invalidate green while bookkeeping timestamps do not',t=>{
  const {db,id}=fixture(t);save(db,id);const initial=getObjectConditions(db,id);
  db.prepare('UPDATE complexes SET updated_at=? WHERE id=?').run(new Date(Date.now()+500).toISOString(),id);assert.equal(getObjectConditions(db,id).eligible,true);
  db.prepare('UPDATE complexes SET address=? WHERE id=?').run('Уточнённый участок QA',id);assert.equal(getObjectConditions(db,id).reason,'CONTEXT_CHANGED');assert.equal(calculateComplexRisk(db,id).zone,'green');assert.equal(calculateComplexRisk(db,id).needsReview,true);
  save(db,id);savePassport(db,id,{source:'Новая ручная сверка паспорта',cadastralNumber:'QA-001'});assert.equal(getObjectConditions(db,id).reason,'LEGAL_NOT_VERIFIED');assert.equal(calculateComplexRisk(db,id).zone,'green');assert.throws(()=>save(db,id),{statusCode:409});
  setLegalBasisStatus(db,id,{status:'CONFIRMED_VALID',sourceLabel:'Повторная учебная проверка',evidenceText:'Документ относится к уточнённому участку QA-001.',notes:'Изолированная повторная сверка',expectedUpdatedAt:db.prepare('SELECT updated_at FROM complexes WHERE id=?').get(id).updated_at});
  save(db,id);db.prepare('UPDATE complexes SET readiness_revision=readiness_revision+1 WHERE id=?').run(id);assert.equal(getObjectConditions(db,id).reason,'CONTEXT_CHANGED');assert.notEqual(getObjectConditions(db,id).currentContextSha256,initial.currentContextSha256);
});
test('new complaints invalidate the review; risk factors still independently block green after all checks pass',t=>{
  const {db,id}=fixture(t);save(db,id);db.prepare('INSERT INTO complaints VALUES (?,?,?,?,?,?,?)').run('qa-complaint',id,'COLLECTIVE',0,'Новое обращение для проверки','QA источник',new Date().toISOString());
  assert.equal(getObjectConditions(db,id).reason,'CONTEXT_CHANGED');save(db,id);
  for(const code of ['R2','R4','R5','DELAY']) {
    db.prepare("INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_label,evidence_text,created_at) VALUES (?,?,?,0,'CONFIRMED','MANUAL_REVIEW','QA источник','Проверенное обстоятельство',?)").run('qa-'+code,id,code,new Date().toISOString());
    assert.equal(calculateComplexRisk(db,id).zone,'yellow');
  }
});
test('review validity is bounded to thirty calendar days and future observation dates are rejected',t=>{
  const {db,id}=fixture(t);const boundary=save(db,id,{checkedDate:dateAgo(30)});assert.equal(boundary.state.eligible,true);
  const expired=save(db,id,{checkedDate:dateAgo(31)});assert.equal(expired.state.reason,'EXPIRED');assert.equal(expired.risk.zone,'green');assert.equal(expired.risk.needsReview,true);
  const pastState=getObjectConditions(db,id,new Date(Date.now()+31*86400000));assert.equal(pastState.eligible,false);assert.equal(calculateRisk([],'CONFIRMED_VALID',null,pastState).zone,'green');
  assert.throws(()=>save(db,id,{checkedDate:dateAgo(-1)}),{statusCode:400});assert.throws(()=>save(db,id,{checkedDate:'2026-02-30'}),{statusCode:400});
});
test('all booleans, evidence, legal verification and optimistic context/version guards are required',t=>{
  const {db,id}=fixture(t),stale=input(db,id);save(db,id);assert.throws(()=>saveObjectConditions(db,id,stale),{statusCode:409});
  for(const bad of [{checks:{documentsMatch:true}},{checks:{...checks(),constructionActive:'true'}},{source:'bad'},{evidenceText:''},{expectedContextSha256:'wrong'},{expectedReviewId:undefined}])assert.throws(()=>save(db,id,bad),{statusCode:bad.expectedContextSha256||Object.hasOwn(bad,'expectedReviewId')?409:400});
  const current=input(db,id);db.prepare("UPDATE complexes SET legal_basis_status='UNKNOWN' WHERE id=?").run(id);assert.throws(()=>saveObjectConditions(db,id,current),{statusCode:409});assert.equal(getObjectConditions(db,id).reason,'LEGAL_NOT_VERIFIED');
});
test('reviews and their source context are immutable; audit failure rolls back review, risk history and object version',t=>{
  const {db,id}=fixture(t),saved=save(db,id);assert.throws(()=>db.prepare('UPDATE object_condition_reviews SET source=? WHERE id=?').run('Changed',saved.review.id),/immutable/u);assert.throws(()=>db.prepare('DELETE FROM object_condition_reviews WHERE id=?').run(saved.review.id),/immutable/u);
  const state=getObjectConditions(db,id),before=db.prepare('SELECT * FROM complexes WHERE id=?').get(id),count=db.prepare('SELECT count(*) AS n FROM risk_history').get().n;
  db.exec("CREATE TRIGGER fail_condition_audit BEFORE INSERT ON audit_logs WHEN NEW.action='OBJECT_CONDITIONS_REVIEWED' BEGIN SELECT RAISE(ABORT,'QA condition audit failure'); END;");
  assert.throws(()=>save(db,id,{checks:{...checks(),delaysClear:false}}),/QA condition audit failure/u);assert.deepEqual(getObjectConditions(db,id),state);assert.deepEqual(db.prepare('SELECT * FROM complexes WHERE id=?').get(id),before);assert.equal(db.prepare('SELECT count(*) AS n FROM risk_history').get().n,count);
});
test('history paginates all immutable decisions and rejects a cursor for another object',t=>{
  const {db,id}=fixture(t);for(let i=0;i<7;i++)save(db,id,{evidenceText:'Учебная проверка со своими источниками, версия '+i});
  const ids=[];let before;do{const page=listObjectConditionReviews(db,id,{limit:2,before});ids.push(...page.items.map(item=>item.id));before=page.nextCursor;}while(before);
  assert.equal(ids.length,7);assert.equal(new Set(ids).size,7);const page=listObjectConditionReviews(db,id,{limit:2});assert.throws(()=>listObjectConditionReviews(db,'another',{before:page.nextCursor}),{statusCode:400});
});
test('new signal freezes human decision and legacy export never reconstructs a current review',t=>{
  const {db,id}=fixture(t);const saved=save(db,id),signal=createSignal(db,id),html=renderSignalExport(signal);assert.equal(signal.zoneSnapshot,'green');assert.equal(signal.objectConditions.review.id,saved.review.id);assert.match(html,/Учебный отчёт проверки объекта/u);
  save(db,id,{source:'Более поздний новый источник',checks:{...checks(),constructionActive:false}});assert.equal(calculateComplexRisk(db,id).zone,'green');assert.deepEqual(getSignalDetails(db,signal.id).objectConditions,signal.objectConditions);assert.equal(renderSignalExport(getSignalDetails(db,signal.id)),html);
  const legacy={...signal,objectConditions:null,contextSnapshot:null,legacySnapshot:true};assert.match(renderSignalExport(legacy),/Текущие решения не подставляются/u);
});
test('additive migration never invents positive reviews or rewrites existing signal snapshots',t=>{
  const {db,id}=fixture(t),signal=createSignal(db,id),before=db.prepare('SELECT * FROM signals WHERE id=?').get(signal.id);db.exec('DROP TABLE object_condition_reviews');createSchema(db);
  assert.equal(getObjectConditions(db,id).reason,'NOT_REVIEWED');assert.deepEqual(db.prepare('SELECT * FROM signals WHERE id=?').get(signal.id),before);assert.equal(calculateComplexRisk(db,id).zone,'green');
});
test('HTTP requires MIO for review and returns explicit conflict rather than overwriting a concurrent decision',async t=>{
  const {db,id}=fixture(t),password='conditions-password-2026';for(const [username,role] of [['condition.admin','ADMIN'],['condition.mio','MIO'],['condition.gask','GASK']])createUser(db,{username,password,role});
  const tokens={};for(const username of ['condition.admin','condition.mio','condition.gask'])tokens[username]=(await login(db,{username,password},username)).token;
  const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const root='http://127.0.0.1:'+server.address().port,path='/api/complexes/'+id+'/conditions',request=(token,body)=>fetch(root+path,{method:body?'POST':'GET',headers:{...(token?{Cookie:'saq_session='+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await request()).status,401);const values=input(db,id);assert.equal((await request(tokens['condition.admin'],values)).status,403);assert.equal((await request(tokens['condition.gask'],values)).status,403);
    const result=await request(tokens['condition.mio'],values);assert.equal(result.status,201);assert.equal((await result.json()).risk.zone,'green');assert.equal((await request(tokens['condition.mio'],values)).status,409);
    const read=await request(tokens['condition.admin']);assert.equal(read.status,200);assert.equal((await read.json()).state.review.createdBy,'condition.mio');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('review stores its policy/window and a different policy cannot silently grant current green eligibility',t=>{
  const {db,id}=fixture(t),saved=save(db,id);assert.equal(saved.review.policyVersion,'object-conditions-v1');assert.equal(saved.review.reviewWindowDays,30);assert.equal(saved.risk.zonePolicyVersion,ZONE_POLICY_VERSION);
  db.prepare("INSERT INTO object_condition_reviews (id,complex_id,checked_date,created_at,created_by,source,evidence_text,checks_json,context_sha256,context_json,is_demo,review_window_days,policy_version) SELECT 'qa-other-policy',complex_id,checked_date,created_at,created_by,source,evidence_text,checks_json,context_sha256,context_json,is_demo,review_window_days,'other-policy' FROM object_condition_reviews WHERE id=?").run(saved.review.id);
  assert.equal(getObjectConditions(db,id).reason,'POLICY_CHANGED');assert.equal(calculateComplexRisk(db,id).zone,'green');assert.equal(calculateComplexRisk(db,id).needsReview,true);assert.equal(getObjectConditions(db,id).review.policyVersion,'other-policy');
});

test('adding explicit policy/window columns preserves the original V1 decision and original column bytes',t=>{
  const {db,id}=fixture(t);save(db,id);db.exec('ALTER TABLE object_condition_reviews DROP COLUMN policy_version; ALTER TABLE object_condition_reviews DROP COLUMN review_window_days');
  const before=db.prepare('SELECT * FROM object_condition_reviews').all(),columns=Object.keys(before[0]).map(key=>'"'+key+'"').join(',');createSchema(db);
  assert.deepEqual(db.prepare('SELECT '+columns+' FROM object_condition_reviews').all(),before);assert.equal(getObjectConditions(db,id).review.policyVersion,'object-conditions-v1');assert.equal(getObjectConditions(db,id).review.reviewWindowDays,30);assert.equal(getObjectConditions(db,id).eligible,true);
});
