import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {openDatabase,createSchema} from '../src/db.mjs';
import {seedDemoData,clearDatabase} from '../src/seed-data.mjs';
import {ensureRedSignals,createSignal,transitionSignal} from '../src/signal-service.mjs';
import {calculateComplexRisk} from '../src/complex-service.mjs';
import {createHttpServer} from '../src/server.mjs';

const object='cx-dala';
function fixture(t) {const db=openDatabase(':memory:');seedDemoData(db);t.after(()=>db.close());return db;}
const state=db=>db.prepare('SELECT * FROM red_monitoring_state WHERE complex_id=?').get(object);
const cards=db=>db.prepare('SELECT * FROM signals WHERE complex_id=? ORDER BY rowid').all(object);
const changedEvidence=db=>db.prepare("UPDATE risk_factors SET evidence_text=evidence_text||' Уточнённый источник.' WHERE complex_id=? AND code='R2' AND status='CONFIRMED'").run(object);
const leaveRed=db=>db.prepare("UPDATE risk_factors SET status='REJECTED' WHERE complex_id=? AND code='R2'").run(object);
const returnRed=db=>db.prepare("UPDATE risk_factors SET status='CONFIRMED' WHERE complex_id=? AND code='R2'").run(object);

test('red re-entry produces a new review card even with identical score, evidence and formula',t=>{
  const db=fixture(t);ensureRedSignals(db);const first=state(db),original=cards(db),risk=calculateComplexRisk(db,object);
  transitionSignal(db,first.signal_id,{status:'CONFIRMED'});transitionSignal(db,first.signal_id,{status:'ARCHIVED'});
  assert.deepEqual(ensureRedSignals(db),[]);
  leaveRed(db);ensureRedSignals(db);assert.equal(state(db).is_red,0);
  returnRed(db);const ids=ensureRedSignals(db),second=state(db);
  assert.ok(ids.includes(second.signal_id));assert.notEqual(second.signal_id,first.signal_id);assert.equal(second.episode,2);assert.equal(second.fingerprint,first.fingerprint);
  assert.equal(calculateComplexRisk(db,object).score,risk.score);assert.equal(cards(db).length,original.length+1);
  assert.equal(db.prepare('SELECT status,routing_json FROM signals WHERE id=?').get(second.signal_id).status,'NEEDS_REVIEW');
  assert.equal(JSON.parse(db.prepare('SELECT routing_json FROM signals WHERE id=?').get(second.signal_id).routing_json).recipient,undefined);
  const audit=db.prepare("SELECT metadata_json FROM audit_logs WHERE entity_id=? AND action='RED_ZONE_NOTIFICATION'").get(second.signal_id);assert.equal(JSON.parse(audit.metadata_json).reason,'RED_ENTRY');
  assert.deepEqual(ensureRedSignals(db),[]);
});

test('changed confirmed evidence at unchanged score creates one new card and preserves the earlier snapshot',t=>{
  const db=fixture(t);ensureRedSignals(db);const first=state(db),before=db.prepare('SELECT * FROM signals WHERE id=?').get(first.signal_id),risk=calculateComplexRisk(db,object);
  changedEvidence(db);const ids=ensureRedSignals(db),next=state(db);
  assert.ok(ids.includes(next.signal_id));assert.notEqual(next.fingerprint,first.fingerprint);assert.equal(next.episode,first.episode);assert.equal(calculateComplexRisk(db,object).score,risk.score);
  assert.deepEqual(db.prepare('SELECT * FROM signals WHERE id=?').get(first.signal_id),before);assert.deepEqual(ensureRedSignals(db),[]);
  const audit=JSON.parse(db.prepare("SELECT metadata_json FROM audit_logs WHERE entity_id=? AND action='RED_ZONE_NOTIFICATION'").get(next.signal_id).metadata_json);assert.equal(audit.reason,'CONFIRMED_EVIDENCE_CHANGED');
});

test('pending/rejected evidence, object display changes and reordered JSON keys do not spam red notifications',t=>{
  const db=fixture(t);ensureRedSignals(db);const before=state(db);
  db.prepare("INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_id,evidence_text,created_at) VALUES ('pending-qa',?,'R4',15,'AI_HYPOTHESIS','MANUAL','qa','Требуется проверить','2026-10-19T01:00:00.000Z')").run(object);
  db.prepare("UPDATE complexes SET address=address||' уточнение' WHERE id=?").run(object);assert.deepEqual(ensureRedSignals(db),[]);
  db.prepare("UPDATE risk_factors SET status='REJECTED',evidence_text='Отклонено' WHERE id='pending-qa'").run();assert.deepEqual(ensureRedSignals(db),[]);
  db.prepare("UPDATE risk_factors SET context_json=? WHERE complex_id=? AND code='R2'").run('{"b":2,"a":1}',object);ensureRedSignals(db);const canonical=state(db);
  db.prepare("UPDATE risk_factors SET context_json=? WHERE complex_id=? AND code='R2'").run('{"a":1,"b":2}',object);assert.deepEqual(ensureRedSignals(db),[]);assert.equal(state(db).fingerprint,canonical.fingerprint);
  assert.equal(before.episode,canonical.episode);
});

test('a current manually created card is adopted without duplication on first observation or red re-entry',t=>{
  const db=fixture(t),manual=createSignal(db,object),raw=db.prepare('SELECT * FROM signals WHERE id=?').get(manual.id);
  ensureRedSignals(db);assert.equal(state(db).signal_id,manual.id);assert.deepEqual(db.prepare('SELECT * FROM signals WHERE id=?').get(manual.id),raw);
  leaveRed(db);ensureRedSignals(db);returnRed(db);const next=createSignal(db,object),count=cards(db).length;
  assert.deepEqual(ensureRedSignals(db),[]);assert.equal(state(db).signal_id,next.id);assert.equal(state(db).episode,2);assert.equal(cards(db).length,count);
  const audit=JSON.parse(db.prepare("SELECT metadata_json FROM audit_logs WHERE entity_id=? AND action='RED_ZONE_NOTIFICATION'").get(next.id).metadata_json);assert.equal(audit.reusedFreshManualCard,true);
});

test('a manual card observed before leaving red cannot suppress later re-entry',t=>{
  const db=fixture(t);ensureRedSignals(db);leaveRed(db);ensureRedSignals(db);
  returnRed(db);const stale=createSignal(db,object);leaveRed(db);ensureRedSignals(db);
  returnRed(db);const ids=ensureRedSignals(db);assert.ok(ids.includes(state(db).signal_id));assert.notEqual(state(db).signal_id,stale.id);
});

test('notification audit, card and monitoring state roll back atomically and the next run catches up',t=>{
  const db=fixture(t);ensureRedSignals(db);const before=state(db),oldCards=cards(db);changedEvidence(db);
  db.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON audit_logs WHEN NEW.action='RED_ZONE_NOTIFICATION' BEGIN SELECT RAISE(ABORT,'QA audit failure'); END;");
  assert.throws(()=>ensureRedSignals(db),/QA audit failure/u);assert.deepEqual(state(db),before);assert.deepEqual(cards(db),oldCards);
  db.exec('DROP TRIGGER fail_notification');assert.equal(ensureRedSignals(db).length,1);assert.notEqual(state(db).signal_id,before.signal_id);
});

test('card creation rolls back completely if snapshot audit fails',t=>{
  const db=fixture(t),before=cards(db);
  db.exec("CREATE TRIGGER fail_card BEFORE INSERT ON audit_logs WHEN NEW.action='SIGNAL_CREATED' BEGIN SELECT RAISE(ABORT,'QA snapshot failure'); END;");
  assert.throws(()=>createSignal(db,object),/QA snapshot failure/u);assert.deepEqual(cards(db),before);
});

test('additive monitoring schema preserves every existing signal and demo reset clears its references',t=>{
  const db=fixture(t),before=db.prepare('SELECT * FROM signals ORDER BY id').all();db.exec('DROP TABLE red_monitoring_state');createSchema(db);
  assert.deepEqual(db.prepare('SELECT * FROM signals ORDER BY id').all(),before);ensureRedSignals(db);assert.ok(state(db));
  clearDatabase(db);assert.equal(db.prepare('SELECT count(*) AS n FROM red_monitoring_state').get().n,0);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('independent processes share durable deduplication and detect re-entry across restarts',async t=>{
  const root=mkdtempSync(join(tmpdir(),'saq-red-')),path=join(root,'source.sqlite');let db=openDatabase(path);seedDemoData(db);db.close();
  t.after(()=>{if(db?.isOpen)db.close();const target=resolve(root);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('saq-red-'));rmSync(target,{recursive:true,force:true});});
  const dbModule=pathToFileURL(resolve('src/db.mjs')).href,signalsModule=pathToFileURL(resolve('src/signal-service.mjs')).href;
  const code='import {openDatabase} from '+JSON.stringify(dbModule)+'; import {ensureRedSignals} from '+JSON.stringify(signalsModule)+'; const db=openDatabase(process.argv[1]); try { console.log(JSON.stringify(ensureRedSignals(db))); } finally { db.close(); }';
  const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code,path],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',status=>status===0?resolve(JSON.parse(stdout)):reject(new Error(stderr)));});
  const results=await Promise.all([run(),run()]);assert.ok(results.flat().length>=1);assert.equal(new Set(results.flat()).size,results.flat().length);
  db=openDatabase(path);const first=state(db);leaveRed(db);db.close();await run();
  db=openDatabase(path);returnRed(db);db.close();await Promise.all([run(),run()]);
  db=openDatabase(path);assert.equal(state(db).episode,2);assert.notEqual(state(db).signal_id,first.signal_id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity_type='SIGNAL' AND action='RED_ZONE_NOTIFICATION' AND json_extract(metadata_json,'$.complexId')=? AND json_extract(metadata_json,'$.episode')=2").get(object).n,1);
});

test('HTTP ad review produces a fresh red card when new confirmed payment evidence leaves the score unchanged',async t=>{
  const db=fixture(t),server=createHttpServer(db,{collectionWorker:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port,initial=state(db),old=db.prepare('SELECT * FROM signals WHERE id=?').get(initial.signal_id),score=calculateComplexRisk(db,object).score;
    const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const payload=await response.json();assert.ok(response.ok,JSON.stringify(payload));return payload;};
    const ad=await post('/api/ads',{platform:'QA',text:'Внесите депозит 500 000 тенге за квартиру.'});
    const matched=await post('/api/ads/'+ad.id+'/match',{complexId:object}),factor=matched.createdFactors.find(item=>item.code==='R2');assert.ok(factor);
    assert.equal(state(db).signal_id,initial.signal_id,'unconfirmed publication does not generate a red notification');
    await post('/api/factors/'+factor.id+'/review',{status:'CONFIRMED',expectedStatus:'AI_HYPOTHESIS'});
    const next=state(db);assert.notEqual(next.signal_id,initial.signal_id);assert.equal(calculateComplexRisk(db,object).score,score);
    const saved=JSON.parse(db.prepare('SELECT factor_snapshot_json FROM signals WHERE id=?').get(next.signal_id).factor_snapshot_json);assert.ok(saved.some(item=>item.id===factor.id&&item.status==='CONFIRMED'));
    assert.deepEqual(db.prepare('SELECT * FROM signals WHERE id=?').get(initial.signal_id),old);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
