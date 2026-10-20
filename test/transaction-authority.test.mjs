import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../src/db.mjs';
import {createComplex} from '../src/passport-service.mjs';
import {createUser,login,getSessionUser} from '../src/access-service.mjs';
import {getSettings} from '../src/settings-service.mjs';
import {createSignal} from '../src/signal-service.mjs';
import {todayInKazakhstan} from '../src/dates.mjs';

const moduleUrl=name=>pathToFileURL(resolve('src',name)).href;
const workerCode=`import {openDatabase} from ${JSON.stringify(moduleUrl('db.mjs'))};import {createHttpServer} from ${JSON.stringify(moduleUrl('server.mjs'))};import {getHttpPolicy} from ${JSON.stringify(moduleUrl('http-policy.mjs'))};
const db=openDatabase(process.argv[1]),server=createHttpServer(db,{collectionWorker:false,httpPolicy:getHttpPolicy({})}),actual=db.exec.bind(db);let armed=false;
db.exec=function(sql){if(armed&&/^BEGIN\\b/iu.test(sql)){armed=false;process.send({kind:'begin'});}return actual(sql);};
server.on('request',(req,res)=>res.once('finish',()=>process.send({kind:'finished',status:res.statusCode,path:req.url})));
process.on('message',message=>{if(message.kind==='arm'){armed=true;process.send({kind:'armed'});}if(message.kind==='stop'){server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}});
server.listen(0,'127.0.0.1',()=>process.send({kind:'ready',port:server.address().port}));`;

async function fixture(t,role='MIO') {
  const root=mkdtempSync(join(tmpdir(),'saq-transaction-auth-')),dbPath=join(root,'source.sqlite'),db=openDatabase(dbPath),password='transaction-password-2026';
  const admin=createUser(db,{username:'race.admin',password,role:'ADMIN'}),mio=createUser(db,{username:'race.mio',password,role:'MIO'});createUser(db,{username:'race.other.admin',password,role:'ADMIN'});
  const actor=role==='ADMIN'?admin:mio,token=(await login(db,{username:actor.username,password},'qa-fixture')).token;
  const object=createComplex(db,{name:'QA transaction object',city:'Город',address:'Учебный адрес',developerName:'QA компания',developerBin:'000000000099',latitude:49,longitude:82});
  const child=spawn(process.execPath,['--input-type=module','-e',workerCode,dbPath],{stdio:['ignore','pipe','pipe','ipc']}),queued=[],waiting=[];let stderr='',locked=false;
  child.stderr.on('data',chunk=>stderr+=chunk);
  const closed=new Promise(resolve=>child.once('close',code=>{for(const waiter of waiting.splice(0)){clearTimeout(waiter.timer);waiter.reject(new Error('Worker closed '+code+': '+stderr));}resolve(code);}));
  child.on('message',message=>{const index=waiting.findIndex(waiter=>waiter.kind===message.kind);if(index>=0){const waiter=waiting.splice(index,1)[0];clearTimeout(waiter.timer);waiter.resolve(message);}else queued.push(message);});
  const wait=kind=>new Promise((resolve,reject)=>{const index=queued.findIndex(message=>message.kind===kind);if(index>=0)return resolve(queued.splice(index,1)[0]);const waiter={kind,resolve,reject,timer:setTimeout(()=>{waiting.splice(waiting.indexOf(waiter),1);reject(new Error('Worker timeout '+kind+': '+stderr));},10000)};waiting.push(waiter);});
  t.after(async()=>{
    if(locked)db.exec('ROLLBACK');
    if(child.exitCode===null&&child.connected)child.send({kind:'stop'});
    const timeout=setTimeout(()=>child.kill(),3000);await closed;clearTimeout(timeout);db.close();const target=resolve(root);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('saq-transaction-auth-'));rmSync(target,{recursive:true,force:true});
  });
  const ready=await wait('ready'),base='http://127.0.0.1:'+ready.port;
  const intake={type:'COLLECTIVE',receivedDate:todayInKazakhstan(),source:'QA local registration source',summary:'Synthetic receipt for checking transaction authorization.'};
  async function runLocked({mutate,path='/api/complexes/'+object.id+'/complaints',method='POST',body=intake}) {
    child.send({kind:'arm'});await wait('armed');db.exec('BEGIN IMMEDIATE');locked=true;
    mutate();
    const pending=fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:'saq_session='+token},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    // WAL readers still see the old actor/record; the HTTP worker then queues for this writer.
    await wait('begin');await new Promise(resolve=>setTimeout(resolve,60));db.exec('COMMIT');locked=false;
    const response=await pending,payload=await response.json();await wait('finished');return {status:response.status,headers:response.headers,body:payload};
  }
  return {db,actor,admin,mio,object,password,token,base,runLocked,wait,stderr:()=>stderr,complaintCount:()=>db.prepare('SELECT count(*) AS n FROM complaints').get().n};
}
const nextVersion=actor=>new Date(Math.max(Date.now(),Date.parse(actor.updatedAt)+1)).toISOString();

test('HTTP write waiting behind another writer cannot use an employee disabled after initial authorization',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>{f.db.prepare('UPDATE users SET disabled_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(),nextVersion(f.actor),f.actor.id);f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.actor.id);}});
  assert.equal(result.status,401);assert.equal(f.complaintCount(),0);assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='COMPLAINT_CAPTURED'").get().n,0);
});
test('HTTP write rejects a role/version change committed while its BEGIN waited',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>f.db.prepare("UPDATE users SET role='GASK',updated_at=? WHERE id=?").run(nextVersion(f.actor),f.actor.id)});assert.equal(result.status,401);assert.equal(f.complaintCount(),0);
});
test('revoking only the current session is enough to reject a queued write',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.actor.id)});assert.equal(result.status,401);assert.equal(f.complaintCount(),0);
});
test('session expiration is checked again after acquiring the writer lock',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>f.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(new Date(Date.now()-1000).toISOString(),f.actor.id)});assert.equal(result.status,401);assert.equal(f.complaintCount(),0);
});
test('credential version change without session deletion prevents an old actor from writing',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>f.db.prepare('UPDATE users SET updated_at=? WHERE id=?').run(nextVersion(f.actor),f.actor.id)});assert.equal(result.status,401);assert.equal(f.complaintCount(),0);
});
test('role identity is compared even if an external change omitted the version bump',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>f.db.prepare("UPDATE users SET role='GASK' WHERE id=?").run(f.actor.id)});assert.equal(result.status,401);assert.equal(f.complaintCount(),0);
});
test('an unrelated concurrent writer does not reject an unchanged authorized actor',async t=>{
  const f=await fixture(t),result=await f.runLocked({mutate:()=>f.db.prepare('UPDATE complexes SET address=? WHERE id=?').run('Уточнённый QA адрес',f.object.id)});assert.equal(result.status,201);assert.equal(f.complaintCount(),1);assert.equal(result.body.complaint.createdBy,f.actor.username);
});
test('administrator settings use the same transaction authority fence',async t=>{
  const f=await fixture(t,'ADMIN'),settings=getSettings(f.db),result=await f.runLocked({path:'/api/admin/settings',method:'PUT',body:{...settings,expectedVersion:settings.version},mutate:()=>f.db.prepare('UPDATE users SET disabled_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(),nextVersion(f.actor),f.actor.id)});assert.equal(result.status,401);assert.equal(getSettings(f.db).version,settings.version);
});
test('settings compare expected version after waiting and cannot overwrite the other writer',async t=>{
  const f=await fixture(t,'ADMIN'),before=getSettings(f.db),saved={...before,version:'qa-concurrent-version',weights:{...before.weights,R2:27}},result=await f.runLocked({path:'/api/admin/settings',method:'PUT',body:{...before,expectedVersion:before.version},mutate:()=>f.db.prepare("INSERT INTO app_settings VALUES ('risk',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify(saved))});assert.equal(result.status,409);assert.deepEqual(getSettings(f.db),saved);
});

test('legal review rejects a passport version changed while waiting for the writer lock',async t=>{
  const f=await fixture(t),before=f.db.prepare('SELECT updated_at FROM complexes WHERE id=?').get(f.object.id).updated_at;
  const result=await f.runLocked({path:'/api/complexes/'+f.object.id+'/legal-basis',body:{status:'CONFIRMED_ABSENT',sourceLabel:'QA legal source',evidenceText:'Synthetic legal finding for a previously reviewed parcel.',notes:'Review must stay bound to the examined passport.',expectedUpdatedAt:before},mutate:()=>f.db.prepare('UPDATE complexes SET passport_json=?,updated_at=? WHERE id=?').run(JSON.stringify({fields:{cadastralNumber:'QA-new-parcel'}}),new Date(Date.parse(before)+1000).toISOString(),f.object.id)});
  assert.equal(result.status,409);assert.equal(f.db.prepare('SELECT legal_basis_status FROM complexes WHERE id=?').get(f.object.id).legal_basis_status,'UNKNOWN');assert.equal(f.db.prepare("SELECT count(*) AS n FROM risk_factors WHERE complex_id=? AND code='R1'").get(f.object.id).n,0);assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity_id=? AND action LIKE 'LEGAL_BASIS_%'").get(f.object.id).n,0);
});
test('factor review checks expected status inside its locked transaction',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_label,evidence_text,created_at) VALUES ('qa-factor',?,'R2',20,'AI_HYPOTHESIS','MANUAL_REVIEW','QA источник','Проверенное предложение денег',?)").run(f.object.id,new Date().toISOString());
  const result=await f.runLocked({path:'/api/factors/qa-factor/review',body:{status:'CONFIRMED',expectedStatus:'AI_HYPOTHESIS'},mutate:()=>f.db.prepare("UPDATE risk_factors SET status='REJECTED',notes='Concurrent decision' WHERE id='qa-factor'").run()});assert.equal(result.status,409);assert.equal(f.db.prepare("SELECT status FROM risk_factors WHERE id='qa-factor'").get().status,'REJECTED');
});
test('signal transition cannot approve a card another writer has returned for correction',async t=>{
  const f=await fixture(t),signal=createSignal(f.db,f.object.id),result=await f.runLocked({path:'/api/signals/'+signal.id+'/status',method:'PATCH',body:{status:'CONFIRMED'},mutate:()=>f.db.prepare("UPDATE signals SET status='RETURNED',comment='Concurrent return' WHERE id=?").run(signal.id)});assert.equal(result.status,409);assert.equal(f.db.prepare('SELECT status FROM signals WHERE id=?').get(signal.id).status,'RETURNED');
});
test('logout remains idempotent when its owner is disabled during the wait and still clears the cookie',async t=>{
  const f=await fixture(t),result=await f.runLocked({path:'/api/auth/logout',body:{},mutate:()=>f.db.prepare('UPDATE users SET disabled_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(),nextVersion(f.actor),f.actor.id)});assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/Max-Age=0/u);assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(f.actor.id).n,0);
});
test('new credential login is independent of an old cookie whose owner is revoked while it waits',async t=>{
  const f=await fixture(t),result=await f.runLocked({path:'/api/auth/login',body:{username:f.admin.username,password:f.password},mutate:()=>f.db.prepare('UPDATE users SET disabled_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(),nextVersion(f.actor),f.actor.id)});assert.equal(result.status,200);assert.equal(result.body.user.role,'ADMIN');const cookie=result.headers.get('set-cookie').split(';')[0];assert.equal(getSessionUser(f.db,{headers:{cookie}}).id,f.admin.id);
});
test('system monitoring after logout does not borrow the now-invalid employee session',async t=>{
  const f=await fixture(t);f.db.prepare("UPDATE complexes SET legal_basis_status='CONFIRMED_ABSENT' WHERE id=?").run(f.object.id);for(const code of ['R1','R2','R3'])f.db.prepare("INSERT INTO risk_factors (id,complex_id,code,weight,status,source_type,source_label,evidence_text,created_at) VALUES (?,?,?,0,'CONFIRMED','MANUAL_REVIEW','QA источник','Проверенная учебная информация',?)").run('qa-'+code,f.object.id,code,new Date().toISOString());
  const response=await fetch(f.base+'/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'saq_session='+f.token},body:'{}'});assert.equal(response.status,200);await response.json();await f.wait('finished');const signal=f.db.prepare("SELECT * FROM signals WHERE complex_id=? AND created_by='System'").get(f.object.id);assert.ok(signal);assert.equal(signal.zone_snapshot,'red');assert.doesNotMatch(f.stderr(),/Automatic monitoring failed/u);
});
