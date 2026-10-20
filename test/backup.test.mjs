import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,mkdirSync,symlinkSync,unlinkSync } from 'node:fs';
import { join,resolve,dirname,basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.mjs';
import { seedDemoData } from '../src/seed-data.mjs';
import { createUser,login,getSessionUser } from '../src/access-service.mjs';
import { saveSource,enqueueSource,processNextJob } from '../src/collection-service.mjs';
import { getSignalDetails } from '../src/signal-service.mjs';
import { renderSignalExport } from '../src/signal-export.mjs';
import { configureDataset } from '../src/dataset-service.mjs';
import { createHttpServer } from '../src/server.mjs';
import { createBackup,verifyBackup,restoreBackup } from '../src/backup-service.mjs';
import {captureComplaint,reviewComplaint} from '../src/complaint-service.mjs';
import {todayInKazakhstan} from '../src/dates.mjs';

const project=fileURLToPath(new URL('..',import.meta.url));
const password='backup-test-password-2026';
function fixture(t,{working=false}={}) {
  const root=mkdtempSync(join(tmpdir(),'saq-backup-')),source=join(root,'source.sqlite'),db=openDatabase(source);
  if(working)configureDataset(db,'working');else seedDemoData(db);
  createUser(db,{username:'backup.admin',password,role:'ADMIN'});
  t.after(()=>{if(db.isOpen)db.close();const resolved=resolve(root);assert.equal(dirname(resolved),resolve(tmpdir()));assert.ok(basename(resolved).startsWith('saq-backup-'));rmSync(resolved,{recursive:true,force:true});});
  return {root,source,db};
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('online WAL backup includes committed evidence, leaves source live and verifies independently',async t=>{
  const {db,source,root}=fixture(t);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  const bytes=Buffer.from([0,1,2,255,0,19]),ad=db.prepare('SELECT id FROM advertisements LIMIT 1').get().id;
  db.prepare('INSERT INTO evidence_files VALUES (?,?,?,?,?,?)').run('backup-evidence',ad,'image/png',hash(bytes),new Date().toISOString(),bytes);
  const signed=await login(db,{username:'backup.admin',password},'backup-test');
  const before=db.prepare('SELECT * FROM users').all(),signals=db.prepare('SELECT * FROM signals ORDER BY id').all();
  const created=await createBackup(source,join(root,'snapshot'));
  assert.equal(created.manifest.tables.evidence_files,1);assert.equal(created.manifest.tables.sessions,1);
  assert.equal(created.manifest.evidence.signals.rows,signals.length);
  const checked=await verifyBackup(created.directory);assert.equal(checked.manifest.sha256,hash(readFileSync(checked.payload)));
  const copy=new DatabaseSync(checked.payload,{readOnly:true});try {
    assert.deepEqual(Buffer.from(copy.prepare('SELECT bytes FROM evidence_files WHERE id=?').get('backup-evidence').bytes),bytes);
    assert.deepEqual(copy.prepare('SELECT * FROM signals ORDER BY id').all(),signals);
    assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  }finally{copy.close();}
  assert.deepEqual(db.prepare('SELECT * FROM users').all(),before);assert.equal(getSessionUser(db,{headers:{cookie:'saq_session='+signed.token}}).username,'backup.admin');
  db.prepare('INSERT INTO auth_attempts VALUES (?,?,?)').run('after-backup',1,Date.now()+10000);assert.equal(db.prepare('SELECT count(*) AS n FROM auth_attempts WHERE bucket=?').get('after-backup').n,1);
});

test('restore preserves signal export and raw archives while quarantining sessions, accounts, sources and jobs',async t=>{
  const {db,source,root}=fixture(t),signed=await login(db,{username:'backup.admin',password},'recovery');
  const sourceRow=saveSource(db,{name:'Backup feed',kind:'JSON_FEED',platform:'Fixture',url:'https://example.com/feed',enabled:true,intervalMinutes:1440});
  enqueueSource(db,sourceRow.id);
  await processNextJob(db,{fetcher:async()=>({mime:'application/json',finalUrl:sourceRow.url,bytes:Buffer.from(JSON.stringify({items:[{id:'one',text:'Учебная публикация о строительстве.'}]}))})});
  enqueueSource(db,sourceRow.id);
  const snapshots=db.prepare('SELECT * FROM signals ORDER BY id').all(),id=snapshots[0].id,html=renderSignalExport(getSignalDetails(db,id));
  const originalAudit=db.prepare('SELECT * FROM audit_logs ORDER BY rowid').all();
  const archive=db.prepare('SELECT * FROM source_archives').get();assert.ok(archive);
  const completed=db.prepare("SELECT count(*) AS n FROM background_jobs WHERE state='SUCCEEDED'").get().n;
  const created=await createBackup(source,join(root,'snapshot'));
  const restored=await restoreBackup(created.directory,join(root,'recovered.sqlite'));
  assert.equal(restored.requiresNewAdmin,true);assert.equal(restored.quarantine.users,1);assert.equal(restored.quarantine.sessions,1);assert.ok(restored.quarantine.jobs>=1);
  const copy=openDatabase(restored.path);try {
    assert.equal(copy.prepare('SELECT count(*) AS n FROM sessions').get().n,0);assert.equal(copy.prepare('SELECT count(*) AS n FROM users WHERE disabled_at IS NULL').get().n,0);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM collection_sources WHERE enabled=1').get().n,0);
    assert.equal(copy.prepare("SELECT count(*) AS n FROM background_jobs WHERE state IN ('PENDING','RUNNING')").get().n,0);
    assert.equal(copy.prepare("SELECT count(*) AS n FROM background_jobs WHERE state='SUCCEEDED'").get().n,completed);
    assert.equal(copy.prepare("SELECT count(*) AS n FROM background_jobs WHERE last_error_code='RESTORE_CANCELLED'").get().n,restored.quarantine.jobs);
    assert.deepEqual(copy.prepare('SELECT * FROM signals ORDER BY id').all(),snapshots);
    assert.equal(renderSignalExport(getSignalDetails(copy,id)),html);
    assert.deepEqual(copy.prepare('SELECT * FROM source_archives').get(),archive);
    assert.deepEqual(copy.prepare('SELECT * FROM audit_logs ORDER BY rowid LIMIT ?').all(originalAudit.length),originalAudit);
    assert.equal(getSessionUser(copy,{headers:{cookie:'saq_session='+signed.token}}),null);
    await assert.rejects(login(copy,{username:'backup.admin',password},'old-account'),{statusCode:401});
    const audit=copy.prepare("SELECT * FROM audit_logs WHERE action='DATABASE_RESTORED'").get();assert.equal(audit.actor,'Local recovery');assert.equal(JSON.parse(audit.metadata_json).backupSha256,created.manifest.sha256);
    assert.doesNotMatch(audit.metadata_json,/backup-test-password/u);
  }finally{copy.close();}
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);assert.equal(db.prepare('SELECT enabled FROM collection_sources').get().enabled,1);
});

test('working recovery requires fresh local ADMIN and then starts and authenticates without demo rows',async t=>{
  const {source,root}=fixture(t,{working:true}),saved=await createBackup(source,join(root,'working-backup')),restored=await restoreBackup(saved.directory,join(root,'working-recovered.sqlite'));
  const before=openDatabase(restored.path);assert.throws(()=>createHttpServer(before,{collectionWorker:false}),/администратора/u);before.close();
  const setup=spawnSync(process.execPath,['scripts/create-user.mjs','fresh.recovery.admin','ADMIN'],{cwd:project,encoding:'utf8',env:{...process.env,SAQ_DB_PATH:restored.path,SAQ_DATA_MODE:'working',SAQ_USER_PASSWORD:password}});
  assert.equal(setup.status,0,setup.stderr);assert.doesNotMatch(setup.stdout,/backup-test-password/u);
  const db=openDatabase(restored.path),server=createHttpServer(db,{collectionWorker:false});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'fresh.recovery.admin',password})});assert.equal(response.status,200);
    assert.equal(db.prepare('SELECT mode FROM dataset_config').get().mode,'working');assert.equal(db.prepare('SELECT count(*) AS n FROM complexes').get().n,0);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('destination collisions, SQLite sidecars and public-directory backups fail without replacing files',async t=>{
  const {source,root}=fixture(t),directory=join(root,'snapshot'),saved=await createBackup(source,directory),original=readFileSync(saved.directory+'/database.sqlite');
  await assert.rejects(createBackup(source,directory),{code:'EEXIST'});assert.deepEqual(readFileSync(saved.directory+'/database.sqlite'),original);
  const target=join(root,'existing.sqlite');writeFileSync(target,'preserve');await assert.rejects(restoreBackup(directory,target),/existing database/u);assert.equal(readFileSync(target,'utf8'),'preserve');
  const sidecar=join(root,'sidecar.sqlite');writeFileSync(sidecar+'-wal','preserve');await assert.rejects(restoreBackup(directory,sidecar),/sidecar/u);assert.equal(existsSync(sidecar),false);
  for(const name of ['backup-rejected','..backup-rejected'])await assert.rejects(createBackup(source,join(project,'public',name)),/outside public/u);
  await assert.rejects(restoreBackup(directory,join(project,'public','restore-rejected.sqlite')),/outside public/u);
  await assert.rejects(createBackup(':memory:',join(root,'bad')),/file-backed/u);
});

test('verification rejects corruption, incomplete directories, traversal and unchecksummed WAL',async t=>{
  const {source,root}=fixture(t),saved=await createBackup(source,join(root,'snapshot')),manifestPath=join(saved.directory,'manifest.json'),original=readFileSync(manifestPath,'utf8');
  const manifest=JSON.parse(original);manifest.databaseFile='../source.sqlite';writeFileSync(manifestPath,JSON.stringify(manifest));await assert.rejects(verifyBackup(saved.directory),/manifest/u);
  writeFileSync(manifestPath,original);writeFileSync(join(saved.directory,'database.sqlite-wal'),'unchecked');await assert.rejects(verifyBackup(saved.directory),/sidecars/u);
  rmSync(join(saved.directory,'database.sqlite-wal'));const payload=join(saved.directory,'database.sqlite'),bytes=readFileSync(payload);bytes[bytes.length-1]^=1;writeFileSync(payload,bytes);await assert.rejects(verifyBackup(saved.directory),/SHA-256/u);
  await assert.rejects(restoreBackup(saved.directory,join(root,'never.sqlite')),/SHA-256/u);assert.equal(existsSync(join(root,'never.sqlite')),false);
  mkdirSync(join(root,'incomplete'));await assert.rejects(verifyBackup(join(root,'incomplete')),{code:'ENOENT'});
});

test('backup CLI verifies and refuses unknown or incomplete commands without opening the source',async t=>{
  const {source,root}=fixture(t),saved=await createBackup(source,join(root,'snapshot'));
  const verify=spawnSync(process.execPath,['scripts/backup.mjs','verify',saved.directory],{cwd:project,encoding:'utf8'});assert.equal(verify.status,0,verify.stderr);assert.equal(JSON.parse(verify.stdout).status,'verified');
  for(const args of [['restore',saved.directory],['create',saved.directory,'extra'],['reset',saved.directory]]) {
    const invalid=spawnSync(process.execPath,['scripts/backup.mjs',...args],{cwd:project,encoding:'utf8',env:{...process.env,SAQ_DB_PATH:join(root,'must-not-exist.sqlite')}});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/u);assert.equal(existsSync(join(root,'must-not-exist.sqlite')),false);
  }
});

test('resolved junction destination cannot place backup or restored database in public',async t=>{
  const {source,root}=fixture(t),saved=await createBackup(source,join(root,'snapshot')),alias=join(root,'served-alias');
  symlinkSync(join(project,'public'),alias,process.platform==='win32'?'junction':'dir');
  try {
    await assert.rejects(createBackup(source,join(alias,'backup-rejected')),/outside public/u);
    await assert.rejects(restoreBackup(saved.directory,join(alias,'restore-rejected.sqlite')),/outside public/u);
  }finally{unlinkSync(alias);}
});

test('restore migrates an older job schema and checks protected bytes after migration',async t=>{
  const {source,db,root}=fixture(t);db.exec('ALTER TABLE background_jobs DROP COLUMN last_error_code');
  const saved=await createBackup(source,join(root,'older-snapshot')),restored=await restoreBackup(saved.directory,join(root,'migrated.sqlite'));
  const copy=new DatabaseSync(restored.path,{readOnly:true});try {
    assert.ok(copy.prepare('PRAGMA table_info(background_jobs)').all().some(column=>column.name==='last_error_code'));
    assert.deepEqual(copy.prepare('SELECT * FROM signals ORDER BY id').all(),db.prepare('SELECT * FROM signals ORDER BY id').all());
  }finally{copy.close();}
  assert.equal(db.prepare('PRAGMA table_info(background_jobs)').all().some(column=>column.name==='last_error_code'),false);
});

test('inventory mismatch, missing core tables and foreign-key corruption fail even with matching file hashes',async t=>{
  const {source,root}=fixture(t),saved=await createBackup(source,join(root,'snapshot')),manifestPath=join(saved.directory,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  manifest.evidence.signals.sha256='0'.repeat(64);writeFileSync(manifestPath,JSON.stringify(manifest));await assert.rejects(verifyBackup(saved.directory),/inventory mismatch/u);
  const invalidPath=join(root,'invalid.sqlite'),invalid=new DatabaseSync(invalidPath);invalid.exec('CREATE TABLE unrelated(id TEXT)');invalid.close();
  await assert.rejects(createBackup(invalidPath,join(root,'invalid-snapshot')),/supported SAQ/u);assert.equal(existsSync(join(root,'invalid-snapshot','manifest.json')),false);
  const corrupt=openDatabase(join(root,'broken.sqlite'));seedDemoData(corrupt);corrupt.exec('PRAGMA foreign_keys=OFF');corrupt.prepare('UPDATE advertisements SET complex_id=? WHERE id=(SELECT id FROM advertisements LIMIT 1)').run('missing-object');corrupt.close();
  await assert.rejects(createBackup(join(root,'broken.sqlite'),join(root,'broken-backup')),/foreign key/u);assert.equal(existsSync(join(root,'broken-backup','manifest.json')),false);
});

test('complaint body, immutable intake, review chain and linked factor survive verified restore',async t=>{
  const {db,source,root}=fixture(t),complexId='cx-aspan';
  const captured=captureComplaint(db,complexId,{type:'COLLECTIVE',receivedDate:todayInKazakhstan(),source:'QA журнал обращений',registrationNumber:'BACKUP-001',summary:'Учебное коллективное обращение для проверки резервного копирования.'});
  reviewComplaint(db,complexId,captured.complaint.id,{status:'CONFIRMED',checkedDate:todayInKazakhstan(),source:'QA источник сверки',evidenceText:'Учебное обращение проверено, коллективный характер подтверждён.',reason:'Проверка сохранности свидетельств.',expectedReviewId:null});
  const before=Object.fromEntries(['complaints','complaint_intakes','complaint_reviews'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const saved=await createBackup(source,join(root,'complaint-backup')),restored=await restoreBackup(saved.directory,join(root,'complaint-restored.sqlite'));const copy=new DatabaseSync(restored.path,{readOnly:true});try{for(const [table,rows] of Object.entries(before))assert.deepEqual(copy.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),rows);assert.equal(copy.prepare("SELECT status FROM risk_factors WHERE source_type='COMPLAINT' AND source_id=?").get(captured.complaint.id).status,'CONFIRMED');}finally{copy.close();}
});
