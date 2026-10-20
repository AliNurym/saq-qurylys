import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase,createSchema } from '../src/db.mjs';
import { createUser,listUsers,login,getSessionUser,withUser,updateUserAccess,resetUserPassword,revokeUserSessions,changeOwnPassword,logout,accessEnabled } from '../src/access-service.mjs';
import { configureDataset,assertDatasetReady } from '../src/dataset-service.mjs';
import { createHttpServer } from '../src/server.mjs';

const password='existing-password-123',replacement='replacement-password-456';
const fixture=t=>{const db=openDatabase(':memory:');t.after(()=>db.close());return db;};
const user=(db,name='employee',role='MIO')=>createUser(db,{username:name,role,password});
const requestFor=token=>({headers:{cookie:'saq_session='+token}});
const version=(db,id)=>listUsers(db).find(row=>row.id===id).updatedAt;
const update=(db,id,values)=>updateUserAccess(db,id,{reason:'Контроль изменения доступа',expectedUpdatedAt:version(db,id),...values});

test('additive user migration preserves existing passwords and defaults active accounts correctly',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL)");
  const createdAt='2020-01-01T00:00:00Z',salt='legacy-salt';
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('legacy','legacy.employee','MIO',salt,scryptSync(password,salt,64).toString('hex'),createdAt);
  createSchema(db);createSchema(db);
  const signed=await login(db,{username:'legacy.employee',password},'migration-test');
  assert.equal(signed.user.enabled,true);assert.equal(signed.user.mustChangePassword,false);assert.equal(signed.user.updatedAt,createdAt);
  assert.equal(getSessionUser(db,requestFor(signed.token)).id,'legacy');
  assert.equal(JSON.stringify(listUsers(db)).includes('password_hash'),false);assert.equal(JSON.stringify(getSessionUser(db,requestFor(signed.token))).includes('sessionTokenHash'),false);
});

test('disable/reactivate and role changes revoke every old session with real audit actors',async t=>{
  const db=fixture(t),admin=user(db,'administrator','ADMIN'),target=user(db);
  const first=await login(db,{username:target.username,password},'first'),second=await login(db,{username:target.username,password},'second');
  const disabled=withUser(admin,()=>update(db,target.id,{enabled:false}));
  assert.equal(disabled.enabled,false);assert.equal(getSessionUser(db,requestFor(first.token)),null);assert.equal(getSessionUser(db,requestFor(second.token)),null);
  await assert.rejects(login(db,{username:target.username,password},'third'),{statusCode:401});
  withUser(admin,()=>update(db,target.id,{enabled:true,role:'GASK'}));
  assert.equal(getSessionUser(db,requestFor(first.token)),null);
  const renewed=await login(db,{username:target.username,password},'fourth');assert.equal(renewed.user.role,'GASK');
  withUser(admin,()=>update(db,target.id,{role:'LAW_ENFORCEMENT'}));assert.equal(getSessionUser(db,requestFor(renewed.token)),null);
  const audit=db.prepare("SELECT * FROM audit_logs WHERE action='USER_ACCESS_UPDATED' ORDER BY rowid").all();
  assert.equal(audit.length,3);assert.ok(audit.every(row=>row.actor===admin.username));assert.equal(JSON.parse(audit[0].metadata_json).revokedSessions,2);
  assert.doesNotMatch(JSON.stringify(audit),/existing-password-123|password_hash|salt/u);
});

test('last active admin cannot be disabled/demoted and stale edits cannot replace another decision',t=>{
  const db=fixture(t),admin=user(db,'only.admin','ADMIN');
  for(const change of [{enabled:false},{role:'MIO'}])assert.throws(()=>update(db,admin.id,change),{statusCode:409});
  const other=user(db,'other.admin','ADMIN');update(db,admin.id,{enabled:false});
  assert.throws(()=>update(db,other.id,{role:'MIO'}),{statusCode:409});
  assert.throws(()=>updateUserAccess(db,admin.id,{enabled:true,reason:'Вернуть доступ',expectedUpdatedAt:admin.updatedAt}),{statusCode:409});
  assert.equal(accessEnabled(db),true);
  configureDataset(db,'working');assertDatasetReady(db);
  db.prepare('UPDATE users SET disabled_at=?').run(new Date().toISOString());assert.throws(()=>assertDatasetReady(db),/администратора/u);
  assert.equal(accessEnabled(db),true); // Disabled users never turn authentication back into demo access.
});

test('access changes and session revocation roll back together when audit persistence fails',async t=>{
  const db=fixture(t),target=user(db),signed=await login(db,{username:target.username,password},'atomic');
  db.exec("CREATE TRIGGER reject_access_audit BEFORE INSERT ON audit_logs WHEN NEW.action='USER_ACCESS_UPDATED' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>update(db,target.id,{enabled:false}),/audit unavailable/u);
  assert.equal(version(db,target.id),target.updatedAt);assert.equal(getSessionUser(db,requestFor(signed.token)).id,target.id);
});

test('password reset requires a changed password, revokes sessions and only self-change clears the temporary flag',async t=>{
  const db=fixture(t),target=user(db),signed=await login(db,{username:target.username,password},'reset');
  await assert.rejects(resetUserPassword(db,target.id,{newPassword:password,reason:'Восстановить доступ',expectedUpdatedAt:target.updatedAt}),{statusCode:400});
  const reset=await resetUserPassword(db,target.id,{newPassword:replacement,reason:'Восстановить доступ',expectedUpdatedAt:target.updatedAt});
  assert.equal(reset.user.mustChangePassword,true);assert.equal(reset.revokedSessions,1);assert.equal(getSessionUser(db,requestFor(signed.token)),null);
  await assert.rejects(login(db,{username:target.username,password},'old'),{statusCode:401});
  const temporary=await login(db,{username:target.username,password:replacement},'temporary');
  const actor=getSessionUser(db,requestFor(temporary.token));
  await assert.rejects(withUser(actor,()=>changeOwnPassword(db,{currentPassword:'incorrect',newPassword:'permanent-password-789'})),{statusCode:401});
  const changed=await withUser(actor,()=>changeOwnPassword(db,{currentPassword:replacement,newPassword:'permanent-password-789'}));
  assert.equal(changed.reauthenticate,true);assert.equal(getSessionUser(db,requestFor(temporary.token)),null);
  assert.equal((await login(db,{username:target.username,password:'permanent-password-789'},'permanent')).user.mustChangePassword,false);
});

test('inflight login cannot resurrect access revoked while password derivation was running',async t=>{
  const db=fixture(t),target=user(db),pending=login(db,{username:target.username,password},'inflight');
  update(db,target.id,{enabled:false});await assert.rejects(pending,{statusCode:401});
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});

test('async password operations reject a session or actor revoked before their commit',async t=>{
  const db=fixture(t),admin=user(db,'actor.admin','ADMIN'),target=user(db);
  const signed=await login(db,{username:target.username,password},'change');const actor=getSessionUser(db,requestFor(signed.token));
  const changing=withUser(actor,()=>changeOwnPassword(db,{currentPassword:password,newPassword:replacement}));
  logout(db,requestFor(signed.token));await assert.rejects(changing,{statusCode:401});
  assert.equal((await login(db,{username:target.username,password},'after')).user.id,target.id);
  const adminSession=await login(db,{username:admin.username,password},'admin');
  const resetting=withUser(getSessionUser(db,requestFor(adminSession.token)),()=>resetUserPassword(db,target.id,{newPassword:replacement,reason:'Проверка восстановления',expectedUpdatedAt:version(db,target.id)}));
  revokeUserSessions(db,admin.id,{reason:'Отзыв доступа администратора',expectedUpdatedAt:version(db,admin.id)});
  await assert.rejects(resetting,{statusCode:401});assert.equal((await login(db,{username:target.username,password},'unchanged')).user.id,target.id);
});

test('login budgets persist in SQLite, bound parallel guesses and expose no raw address keys',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'saq-access-')),path=join(dir,'access.sqlite');let db=openDatabase(path);
  t.after(()=>{db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('saq-access-'));rmSync(dir,{recursive:true,force:true});});
  const target=user(db),now=Date.now();
  const attempts=await Promise.allSettled(Array.from({length:12},()=>login(db,{username:target.username,password:'wrong'},'persistent-client',now)));
  assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.statusCode===401).length,10);
  assert.equal(attempts.filter(result=>result.status==='rejected'&&result.reason.statusCode===429).length,2);
  db.close();db=openDatabase(path);await assert.rejects(login(db,{username:target.username,password},'persistent-client',now+1),{statusCode:429});
  assert.ok(db.prepare('SELECT bucket FROM auth_attempts').all().every(row=>/^[0-9a-f]{64}$/u.test(row.bucket)));
  assert.equal((await login(db,{username:target.username,password},'persistent-client',now+600001)).user.id,target.id);
  const longName='x'.repeat(80);user(db,longName);
  await assert.rejects(login(db,{username:longName+'suffix',password},'not-truncated'),{statusCode:401});
});

async function start(t,db) {
  const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root='http://127.0.0.1:'+server.address().port;
  const api=(path,method='GET',body,token)=>fetch(root+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{cookie:'saq_session='+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {server,root,api};
}

test('HTTP roles, temporary passwords, session clearing and secret-free user lists are enforced',async t=>{
  const db=fixture(t),admin=user(db,'http.admin','ADMIN'),target=user(db),{api}=await start(t,db);
  const adminToken=(await login(db,{username:admin.username,password},'admin')).token,mioToken=(await login(db,{username:target.username,password},'mio')).token;
  const path='/api/admin/users/'+target.id;
  assert.equal((await api(path,'PATCH',{enabled:false,reason:'Контроль',expectedUpdatedAt:target.updatedAt},mioToken)).status,403);
  const reset=await api(path+'/password','POST',{newPassword:replacement,reason:'Контроль восстановления',expectedUpdatedAt:target.updatedAt},adminToken);assert.equal(reset.status,200);
  assert.equal((await api('/api/bootstrap','GET',undefined,mioToken)).status,401);
  const temporary=(await login(db,{username:target.username,password:replacement},'temporary')).token;
  assert.equal((await api('/api/bootstrap','GET',undefined,temporary)).status,403);
  assert.equal((await (await api('/api/auth/session','GET',undefined,temporary)).json()).user.mustChangePassword,true);
  const changed=await api('/api/auth/password','POST',{currentPassword:replacement,newPassword:'permanent-http-password'},temporary);
  assert.equal(changed.status,200);assert.match(changed.headers.get('set-cookie'),/Max-Age=0/u);
  const users=await (await api('/api/admin/users','GET',undefined,adminToken)).json();assert.doesNotMatch(JSON.stringify(users),/password_hash|salt|sessionTokenHash|existing-password/u);
  assert.equal((await api(path+'/revoke-sessions','POST',{reason:'Контроль отзыва',expectedUpdatedAt:version(db,target.id)},adminToken)).status,200);
  for(let i=0;i<10;i++)assert.equal((await api('/api/auth/login','POST',{username:'limited.account',password:'wrong'})).status,401);
  const limited=await api('/api/auth/login','POST',{username:'limited.account',password:'wrong'});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});

test('a slow HTTP write loses permission when its employee is disabled before the body arrives',async t=>{
  const db=fixture(t),target=user(db),{server,root}=await start(t,db),signed=await login(db,{username:target.username,password},'slow');
  const accepted=new Promise(resolve=>server.once('request',resolve));
  let client;const response=new Promise((resolve,reject)=>{
    client=httpRequest(root+'/api/ads',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'saq_session='+signed.token}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});client.on('error',reject);
  });
  client.write('{"text":');await accepted;
  update(db,target.id,{enabled:false});client.end(JSON.stringify('Публикация, которую нельзя сохранить после отзыва доступа')+'}');
  assert.equal(await response,401);assert.equal(db.prepare('SELECT count(*) AS n FROM advertisements').get().n,0);
});

test('local account setup refuses a first non-admin and creates an auditable working administrator without printing credentials',t=>{
  const dir=mkdtempSync(join(tmpdir(),'saq-access-cli-')),path=join(dir,'working.sqlite');let db;
  t.after(()=>{db?.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('saq-access-cli-'));rmSync(dir,{recursive:true,force:true});});
  const script=fileURLToPath(new URL('../scripts/create-user.mjs',import.meta.url));
  const options={encoding:'utf8',env:{...process.env,SAQ_DB_PATH:path,SAQ_USER_PASSWORD:password,SAQ_DATA_MODE:'working'}};
  const denied=spawnSync(process.execPath,[script,'first.operator','MIO'],options);assert.equal(denied.status,1);assert.match(denied.stderr,/First create an ADMIN/u);
  const created=spawnSync(process.execPath,[script,'first.admin','ADMIN'],options);assert.equal(created.status,0);assert.doesNotMatch(created.stdout,/existing-password-123|password_hash|salt/u);
  db=openDatabase(path);configureDataset(db,'working');assertDatasetReady(db);
  assert.equal(listUsers(db).length,1);assert.equal(listUsers(db)[0].role,'ADMIN');
  assert.equal(db.prepare("SELECT actor FROM audit_logs WHERE action='USER_CREATED'").get().actor,'Local setup');
});

test('new employees may require a personal password from creation without exposing initial credentials',async t=>{
 const db=fixture(t),admin=user(db,'onboarding.admin','ADMIN'),{api}=await start(t,db),adminToken=(await login(db,{username:admin.username,password},'onboarding-admin')).token;
 const before=listUsers(db).length;
 assert.throws(()=>createUser(db,{username:'invalid.flag',role:'MIO',password,mustChangePassword:'true'}),error=>error.statusCode===400);assert.equal(listUsers(db).length,before);
 const created=await api('/api/admin/users','POST',{username:'initial.employee',role:'MIO',password,mustChangePassword:true},adminToken);assert.equal(created.status,201);const employee=await created.json();assert.equal(employee.mustChangePassword,true);assert.equal(JSON.stringify(employee).includes(password),false);
 const record=db.prepare("SELECT metadata_json FROM audit_logs WHERE action='USER_CREATED' AND entity_id=?").get(employee.id);assert.equal(JSON.parse(record.metadata_json).mustChangePassword,true);assert.equal(record.metadata_json.includes(password),false);
 const temporary=(await login(db,{username:employee.username,password},'onboarding-employee')).token;
 assert.equal((await api('/api/bootstrap','GET',undefined,temporary)).status,403);
 const changed=await api('/api/auth/password','POST',{currentPassword:password,newPassword:replacement},temporary);assert.equal(changed.status,200);
 const personal=await login(db,{username:employee.username,password:replacement},'onboarding-personal');assert.equal(personal.user.mustChangePassword,false);assert.equal((await api('/api/bootstrap','GET',undefined,personal.token)).status,200);
});
