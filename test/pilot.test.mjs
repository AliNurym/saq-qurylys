import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createSchema } from "../src/db.mjs";
import { seedDemoData } from "../src/seed-data.mjs";
import { addManualFactor } from "../src/advertisement-service.mjs";
import { getComplexDetails } from "../src/complex-service.mjs";
import { savePassport, createComplex } from "../src/passport-service.mjs";
import { getSettings, saveSettings, matchRiskPhrases } from "../src/settings-service.mjs";
import { calculateComplexRisk } from "../src/complex-service.mjs";
import { addEvidence, markSourceRemoved, listEvidence } from "../src/evidence-service.mjs";
import { createSignal, ensureRedSignals, routeSignal, recordResponse, getSignalDetails, workingDayDeadline, transitionSignal } from "../src/signal-service.mjs";
import { createUser } from "../src/access-service.mjs";
import { createHttpServer } from "../src/server.mjs";
import { renderSignalExport } from "../src/signal-export.mjs";
import { renderSignalWorkflow } from "../public/pilot-ui.js";
import { runScheduledMonitoring } from "../src/monitoring-service.mjs";

const fixture = (t) => { const db=openDatabase(":memory:");seedDemoData(db);t.after(()=>db.close());return db; };
const manual = {code:"R5",sourceLabel:"Контрольный источник",evidenceText:"Сверенные значения готовности",notes:"Проверены источники и даты"};
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

test("saved-evidence recalculation uses persistent 7/30 day intervals and catches up after downtime",(t)=>{
 const db=fixture(t),now=new Date('2026-10-17T09:00:00Z');
 assert.equal(runScheduledMonitoring(db,now).length,10);assert.equal(runScheduledMonitoring(db,now).length,0);
 const green=db.prepare("SELECT next_run_at FROM monitoring_runs WHERE complex_id='cx-samal'").get();
 const yellow=db.prepare("SELECT next_run_at FROM monitoring_runs WHERE complex_id='cx-aspan'").get();
 assert.equal(green.next_run_at,'2026-11-16T09:00:00.000Z');assert.equal(yellow.next_run_at,'2026-10-24T09:00:00.000Z');
 const due=runScheduledMonitoring(db,new Date('2026-10-25T09:00:00Z'));
 assert.ok(due.includes('cx-aspan'));assert.equal(due.includes('cx-samal'),false);assert.equal(due.includes('cx-dala'),false);
});

test("a new object starts at zero points with an explicit review flag",(t)=>{
 const db=fixture(t), values={name:"Тестовый ЖК",city:"Усть-Каменогорск",address:"Тестовый адрес 1",developerName:"Тестовая компания",developerBin:"000000000099",latitude:"49.95",longitude:"82.61"};
 const created=createComplex(db,values);assert.equal(created.objectNumber,"SQ-OBJ-0011");assert.equal(created.risk.zone,"green");assert.equal(created.risk.needsReview,true);assert.equal(created.legalBasisStatus,"UNKNOWN");
 assert.notEqual(createComplex(db,values).objectNumber,created.objectNumber);
 assert.throws(()=>createComplex(db,{...values,latitude:""}),/координаты/u);
});

test("readiness changes invalidate R5; saving unrelated fields preserves unchanged dated evidence",(t)=>{
 const db=fixture(t),current=getComplexDetails(db,"cx-qazyna");
 const values={source:"Контрольный паспорт"};
 for(const prefix of ["declared","verified"]) for(const suffix of ["CompletionPercentage","CompletionSource","CompletionCapturedAt"]) values[prefix+suffix]=suffix.endsWith("At")?current[prefix+suffix].slice(0,10):String(current[prefix+suffix]);
 savePassport(db,current.id,values);
 assert.equal(db.prepare("SELECT status FROM risk_factors WHERE complex_id=? AND code='R5'").get(current.id).status,"CONFIRMED");
 savePassport(db,current.id,{...values,declaredCompletionPercentage:"30"});
 assert.equal(db.prepare("SELECT status FROM risk_factors WHERE complex_id=? AND code='R5'").get(current.id).status,"UNKNOWN");
});

test("dictionary settings receive a new version without changing fixed scores or old signals",(t)=>{
 const db=fixture(t),snapshot=createSignal(db,"cx-aspan"),before=getSettings(db);
 const next=saveSettings(db,{expectedVersion:before.version,weights:before.weights,dictionary:[{phrase:"проверяемый депозит",weight:80}]});
 assert.notEqual(next.version,before.version);assert.equal(calculateComplexRisk(db,"cx-aspan").score,35);
 assert.equal(addManualFactor(db,"cx-altai",{...manual,code:"R2"}).factor.weight,25);
 assert.equal(getSignalDetails(db,snapshot.id).scoreSnapshot,35);
 assert.deepEqual(matchRiskPhrases(db,"Новый ПРОВЕРЯЕМЫЙ ДЕПОЗИТ по договору"),[{phrase:"ПРОВЕРЯЕМЫЙ ДЕПОЗИТ",weight:80}]);
 assert.throws(()=>saveSettings(db,{...next,expectedVersion:before.version}),/уже изменены/u);
 assert.throws(()=>saveSettings(db,{...next,expectedVersion:next.version,weights:{...next.weights,R6:4}}),/зафиксирован/u);
});

test("R5 needs an absolute difference of at least 20 points, sources, and dates", (t)=>{
 const db=fixture(t);
 for(const [declared,actual] of [[30,70],[70,70],[89,70],[70,50],[50,70]]) {
  db.prepare("UPDATE complexes SET declared_completion_pct=?,verified_completion_pct=?,declared_completion_source='ad',verified_completion_source='inspection',declared_completion_at='2026-10-16',verified_completion_at='2026-10-16' WHERE id='cx-altai'").run(declared,actual);
  if(Math.abs(declared-actual)<20) assert.throws(()=>addManualFactor(db,"cx-altai",manual),/20 п\.п/u);
  else assert.equal(addManualFactor(db,"cx-altai",manual).risk.score,10);
 }
});

test("migration preserves historical snapshots and converts legacy delay without reinterpreting new R6",(t)=>{
 const db=fixture(t); const signal=createSignal(db,"cx-arman");
 db.prepare("INSERT INTO app_settings VALUES ('risk',?)").run(JSON.stringify({version:"legacy-pilot",weights:{R1:40,R2:20,R3:15,R4:15,R5:10,R6:-15,DELAY:0},dictionary:[{phrase:"старый словарь",weight:10}]}));
 db.prepare("UPDATE risk_factors SET code='R6',weight=-15 WHERE complex_id='cx-arman' AND code='R6'").run();
 db.prepare("DELETE FROM schema_versions WHERE version IN ('pilot-v1','codemasters-8.0-saq-v1')").run();
 createSchema(db);
 assert.ok(db.prepare("SELECT 1 FROM risk_factors WHERE complex_id='cx-arman' AND code='R6_SCHEDULE_LEGACY'").get());
 assert.equal(db.prepare("SELECT weight FROM risk_factors WHERE complex_id='cx-qazyna' AND code='R6'").get().weight,5);
 assert.equal(getSettings(db).weights.R2,25);assert.deepEqual(getSettings(db).dictionary,[{phrase:"старый словарь",weight:10}]);
 assert.deepEqual(getSignalDetails(db,signal.id).contextSnapshot,signal.contextSnapshot);
 addManualFactor(db,"cx-altai",{...manual,code:"R6"});
 createSchema(db);
 assert.equal(db.prepare("SELECT weight FROM risk_factors WHERE complex_id='cx-altai' AND code='R6'").get().weight,5);
 assert.match(getComplexDetails(db,"cx-altai").objectNumber,/^SQ-OBJ-\d{4}$/u);
});

test("passport writes are auditable, conflict-checked, and frozen into new signals",(t)=>{
 const db=fixture(t); const initial=getComplexDetails(db,"cx-aspan");
 const saved=savePassport(db,"cx-aspan",{expectedUpdatedAt:initial.updatedAt,source:"Документ для теста",cadastralNumber:"TEST-001",paymentEvidence:"Платёж документально не подтверждён",kazreestr:"Не проверено"});
 assert.equal(saved.passport.fields.cadastralNumber,"TEST-001");
 const signal=createSignal(db,"cx-aspan");
 const signalHtml=renderSignalWorkflow(getSignalDetails(db,signal.id));
 assert.match(signalHtml,/Государственные реестры не подключены/u);
 assert.match(signalHtml,/Общий источник паспорта: Документ для теста/u);
 savePassport(db,"cx-aspan",{source:"Следующая проверка",cadastralNumber:"TEST-002"});
 assert.equal(getSignalDetails(db,signal.id).complex.passport.fields.cadastralNumber,"TEST-001");
 assert.throws(()=>savePassport(db,"cx-aspan",{source:"Test",expectedUpdatedAt:initial.updatedAt}),/уже изменена/u);
 assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action='PASSPORT_UPDATED'").get());
});

test("saved evidence is immutable, survives source removal and is embedded in standalone export",(t)=>{
 const db=fixture(t); const file=addEvidence(db,"ad-001",{data:png});
 assert.equal(file.mime,"image/png");assert.equal(file.sha256.length,64);
 assert.throws(()=>db.prepare("UPDATE evidence_files SET sha256='changed' WHERE id=?").run(file.id),/immutable/u);
 assert.throws(()=>db.prepare("DELETE FROM evidence_files WHERE id=?").run(file.id),/immutable/u);
 markSourceRemoved(db,"ad-001"); assert.equal(listEvidence(db,"ad-001").length,1);
 const signal=createSignal(db,"cx-aspan"), html=renderSignalExport(signal);
 assert.ok(html.includes(png)); assert.ok(html.includes(file.sha256));assert.ok(html.includes("Сведения о проверке реестров"));
 assert.throws(()=>addEvidence(db,"ad-001",{data:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}),/PNG/u);
});

test("red signals are generated once, require review and do not assign themselves a recipient",(t)=>{
 const db=fixture(t); const ids=ensureRedSignals(db);assert.ok(ids.length>=1);
 assert.equal(ensureRedSignals(db).length,0);
 const signal=db.prepare("SELECT * FROM signals WHERE complex_id='cx-dala' ORDER BY created_at DESC LIMIT 1").get();
 assert.equal(signal.status,"NEEDS_REVIEW");assert.equal(JSON.parse(signal.routing_json).assignedAt,undefined);
 assert.match(signal.id,/^SQ-\d{4}-\d{4}$/u);
 transitionSignal(db,signal.id,{status:"CONFIRMED"});transitionSignal(db,signal.id,{status:"ARCHIVED"});
 assert.equal(ensureRedSignals(db).length,0,"archiving an unchanged assessment must not create duplicate notifications");
});

test("routing requires a reason, uses five working days and locks the recorded response",(t)=>{
 const db=fixture(t);const signal=createSignal(db,"cx-aspan");
 assert.equal(workingDayDeadline("2026-10-16"),"2026-10-23");
 assert.equal(workingDayDeadline("2026-10-16",5,["2026-10-19"]),"2026-10-26");
 assert.throws(()=>routeSignal(db,signal.id,{recipient:"GASK",reason:""}),/основание/u);
 assert.throws(()=>recordResponse(db,signal.id,{result:"Проверка проведена"}),/не назначена/u);
 const routed=routeSignal(db,signal.id,{recipient:"GASK",reason:"Проверить приложенные сведения"});
 assert.equal(routed.status,"CONFIRMED");assert.equal(routed.routing.mode,"INTERNAL_ONLY");
 assert.throws(()=>routeSignal(db,signal.id,{recipient:"MIO",reason:"Повторное назначение"}),/уже/u);
 assert.equal(recordResponse(db,signal.id,{result:"Назначен осмотр, документы запрошены"}).routing.result,"Назначен осмотр, документы запрошены");
 assert.throws(()=>recordResponse(db,signal.id,{result:"Замена результата"}),/уже сохранён/u);
});

test("authenticated HTTP workflow denies anonymous approvals and enforces recipient roles with real actors",async(t)=>{
 const db=fixture(t);createUser(db,{username:"mio.test",role:"MIO",password:"test-password-123"});createUser(db,{username:"gask.test",role:"GASK",password:"test-password-456"});
 const server=createHttpServer(db);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try {
  const base="http://127.0.0.1:"+server.address().port;
  const req=async(path,method="GET",body,cookie)=>fetch(base+path,{method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await req("/api/complexes")).status,401);
  const signin=async(username,password)=>{const res=await req("/api/auth/login","POST",{username,password});assert.equal(res.status,200);return res.headers.get("set-cookie").split(";")[0];};
  const mio=await signin("mio.test","test-password-123"),gask=await signin("gask.test","test-password-456");
  assert.equal((await (await req("/api/signals","GET",undefined,gask)).json()).items.length,0);
  assert.equal((await req("/api/complexes/cx-aspan","GET",undefined,gask)).status,403);
  assert.equal((await req("/api/admin/settings","GET",undefined,mio)).status,403);
  assert.equal((await req("/api/signals","POST",{complexId:"cx-aspan"},gask)).status,403);
  const signal=await (await req("/api/signals","POST",{complexId:"cx-aspan"},mio)).json();
  assert.equal(signal.createdBy,"mio.test");
  assert.equal((await req("/api/signals/"+signal.id+"/route","POST",{recipient:"GASK",reason:"Проверить доказательства"},gask)).status,403);
  const route="/api/signals/"+signal.id+"/route",result="/api/signals/"+signal.id+"/response";
  assert.equal((await req(route,"POST",{recipient:"GASK",reason:"Проверить доказательства"},mio)).status,200);
  const assigned=await (await req("/api/signals","GET",undefined,gask)).json();
  assert.deepEqual(assigned.items.map(item=>item.id),[signal.id]);
  assert.equal((await req("/api/signals/SIG-20261014-002","GET",undefined,gask)).status,403);
  assert.equal((await req(result,"POST",{result:"Документы проверены"},mio)).status,403);
  const responded=await (await req(result,"POST",{result:"Документы проверены"},gask)).json();
  assert.equal(responded.routing.recordedBy,"gask.test");
  assert.ok(responded.audit.some(item=>item.actor==="mio.test"&&item.action==="SIGNAL_ROUTE_APPROVED"));
  await req("/api/auth/logout","POST",{},mio);assert.equal((await req("/api/complexes","GET",undefined,mio)).status,401);
 } finally {await new Promise(resolve=>server.close(resolve));}
});

test("first administrator setup disables demo writes and grants settings access only after login",async(t)=>{
 const db=fixture(t),server=createHttpServer(db);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try {
  const base="http://127.0.0.1:"+server.address().port;
  const req=async(path,method="GET",body,cookie)=>fetch(base+path,{method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await req("/api/admin/users","POST",{username:"first.mio",role:"MIO",password:"first-password-123"})).status,400);
  assert.equal((await req("/api/admin/users","POST",{username:"first.admin",role:"ADMIN",password:"first-password-123"})).status,201);
  assert.equal((await req("/api/admin/settings")).status,401);
  const signin=await req("/api/auth/login","POST",{username:"first.admin",password:"first-password-123"});
  const cookie=signin.headers.get("set-cookie").split(";")[0];
  const settings=await (await req("/api/admin/settings","GET",undefined,cookie)).json();
  const saved=await req("/api/admin/settings","PUT",{...settings,expectedVersion:settings.version,weights:settings.weights,dictionary:[]},cookie);
  assert.equal(saved.status,200);const savedSettings=await saved.json();assert.equal(savedSettings.weights.R2,25);
  assert.equal((await req("/api/admin/settings","PUT",{...settings,expectedVersion:savedSettings.version,weights:{...settings.weights,R2:23},dictionary:[]},cookie)).status,400);
  assert.equal((await req("/api/admin/users","POST",{username:"next.mio",role:"MIO",password:"second-password-123"},cookie)).status,201);
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action='USER_CREATED' AND actor='first.admin'").get());
 } finally {await new Promise(resolve=>server.close(resolve));}
});
