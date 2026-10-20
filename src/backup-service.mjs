import { DatabaseSync,backup } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { createReadStream,constants } from 'node:fs';
import { mkdir,lstat,realpath,readFile,writeFile,chmod,open,copyFile,link,unlink } from 'node:fs/promises';
import { resolve,dirname,basename,relative,isAbsolute,join,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase,inTransaction } from './db.mjs';
import { writeAudit } from './audit-service.mjs';

const publicRoot=fileURLToPath(new URL('../public',import.meta.url));
const protectedTables=new Set(['signals','evidence_files','source_archives','collected_publications','construction_observations','construction_reviews','readiness_history','business_calendar_versions','object_condition_reviews','complaints','complaint_intakes','complaint_reviews']);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const error=message=>{throw new Error(message);};
async function exists(path){try{await lstat(path);return true;}catch(reason){if(reason.code==='ENOENT')return false;throw reason;}}
async function canonical(path) {
  let current=resolve(path),tail=[];
  while(!await exists(current)){tail.unshift(basename(current));const parent=dirname(current);if(parent===current)error('Cannot resolve destination.');current=parent;}
  return resolve(await realpath(current),...tail);
}
async function privateDestination(path) {
  const target=await canonical(path),served=await canonical(publicRoot),rel=relative(served,target);
  if(rel===''||(!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel)))error('Backups and restored databases must be outside public/.');
  return target;
}
async function regularFile(path) {
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())error('Expected an ordinary file: '+basename(path));return info;
}
async function hashFile(path) {
  const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');
}
async function syncFile(path){const handle=await open(path,'r+');try{await handle.sync();}finally{await handle.close();}}

// Hash one row at a time. Frame every typed cell to avoid delimiter ambiguity and preserve BLOB bytes.
function tableDigest(db,table,columns) {
  const statement=db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(table)+' ORDER BY rowid');statement.setReadBigInts(true);
  const hash=createHash('sha256');let rows=0;
  for(const row of statement.iterate()) {
    hash.update('row:');rows++;
    for(const column of columns) {
      const value=row[column];let tag,bytes;
      if(value===null){tag='null';bytes=Buffer.alloc(0);}
      else if(value instanceof Uint8Array){tag='blob';bytes=value;}
      else {tag=typeof value;bytes=Buffer.from(String(value));}
      hash.update(tag+':'+bytes.length+':');hash.update(bytes);
    }
  }
  return {columns,rows,sha256:hash.digest('hex')};
}
function inspectDatabase(db) {
  const checks=db.prepare('PRAGMA integrity_check').all();if(checks.length!==1||checks[0].integrity_check!=='ok')error('SQLite integrity check failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)error('SQLite foreign key check failed.');
  const names=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
  for(const core of ['complexes','advertisements','signals','dataset_config'])if(!names.includes(core))error('Not a supported SAQ database: missing '+core);
  const tables={},evidence={};
  for(const name of names) {
    tables[name]=db.prepare('SELECT count(*) AS n FROM '+quote(name)).get().n;
    if(protectedTables.has(name))evidence[name]=tableDigest(db,name,db.prepare('PRAGMA table_info('+quote(name)+')').all().map(column=>column.name));
  }
  const datasetMode=db.prepare('SELECT mode FROM dataset_config WHERE id=1').get()?.mode;
  if(!['working','demo'].includes(datasetMode))error('Invalid dataset mode.');
  return {datasetMode,tables,evidence};
}
function standalone(db) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  if(db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode!=='delete')error('Could not produce standalone database.');
}

export async function createBackup(sourcePath,destinationDirectory) {
  if(!sourcePath||sourcePath===':memory:')error('Backup requires an existing file-backed database.');
  const source=resolve(sourcePath);await regularFile(source);
  const destination=await privateDestination(destinationDirectory);
  await mkdir(dirname(destination),{recursive:true});
  // mkdir is exclusive: never replace a previously named directory or its contents.
  await mkdir(destination,{mode:0o700});
  const partial=join(destination,'database.partial.sqlite'),payload=join(destination,'database.sqlite'),startedAt=new Date().toISOString();
  let original,snapshot;
  try {
    original=new DatabaseSync(source,{readOnly:true});
    await backup(original,partial);original.close();original=null;
    await chmod(partial,0o600);snapshot=new DatabaseSync(partial);standalone(snapshot);
    const inventory=inspectDatabase(snapshot);snapshot.close();snapshot=null;
    await syncFile(partial);await link(partial,payload);await unlink(partial);
    const info=await regularFile(payload),manifest={format:'saq-sqlite-backup',version:1,databaseFile:'database.sqlite',startedAt,completedAt:new Date().toISOString(),nodeVersion:process.version,bytes:info.size,sha256:await hashFile(payload),...inventory};
    // Completion marker last; an interrupted directory has no valid manifest.
    const manifestPath=join(destination,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});await syncFile(manifestPath);
    return {directory:destination,manifest};
  } finally {if(original?.isOpen)original.close();if(snapshot?.isOpen)snapshot.close();}
}

export async function verifyBackup(directory) {
  const root=resolve(directory),manifestPath=join(root,'manifest.json');
  if((await regularFile(manifestPath)).size>1024*1024)error('Backup manifest is too large.');
  let manifest;try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{error('Invalid backup manifest.');}
  if(manifest.format!=='saq-sqlite-backup'||manifest.version!==1||manifest.databaseFile!=='database.sqlite'||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||!/^[a-f0-9]{64}$/u.test(manifest.sha256??''))error('Unsupported or incomplete backup manifest.');
  const payload=join(root,'database.sqlite'),info=await regularFile(payload);
  for(const suffix of ['-wal','-shm','-journal'])if(await exists(payload+suffix))error('Backup must be standalone, without SQLite sidecars.');
  if(info.size!==manifest.bytes||await hashFile(payload)!==manifest.sha256)error('Backup size or SHA-256 does not match its manifest.');
  let db;
  try {
    db=new DatabaseSync(payload,{readOnly:true});const actual=inspectDatabase(db);
    for(const key of ['datasetMode','tables','evidence'])if(JSON.stringify(actual[key])!==JSON.stringify(manifest[key]))error('Backup inventory mismatch: '+key);
    return {directory:root,payload,manifest};
  }finally{if(db?.isOpen)db.close();}
}

async function unusedTarget(path) {
  for(const suffix of ['','-wal','-shm','-journal'])if(await exists(path+suffix))error('Restore refuses existing database or sidecar: '+basename(path+suffix));
}

export async function restoreBackup(directory,targetPath) {
  if(!targetPath||targetPath===':memory:')error('Restore requires a new database file path.');
  const verified=await verifyBackup(directory),target=await privateDestination(targetPath);
  await unusedTarget(target);await mkdir(dirname(target),{recursive:true});
  const partial=join(dirname(target),'.saq-restore-'+randomUUID()+'.sqlite');let db,published=false;
  try {
    await copyFile(verified.payload,partial,constants.COPYFILE_EXCL);await chmod(partial,0o600);
    if(await hashFile(partial)!==verified.manifest.sha256)error('Backup changed while it was being copied.');
    db=openDatabase(partial);
    const now=new Date().toISOString();
    const quarantine=inTransaction(db,()=>{
      const sessions=db.prepare('DELETE FROM sessions').run().changes;
      const users=db.prepare("UPDATE users SET disabled_at=?,must_change_password=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ',MAX(julianday(?),julianday(COALESCE(updated_at,created_at)) + 1.0/86400000))").run(now,now).changes;
      const sources=db.prepare("UPDATE collection_sources SET enabled=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ',MAX(julianday(?),julianday(updated_at) + 1.0/86400000))").run(now).changes;
      const jobs=db.prepare("UPDATE background_jobs SET state='CANCELLED',lease_until=NULL,lease_token=NULL,finished_at=?,last_error_code='RESTORE_CANCELLED',last_error='Task cancelled during database recovery; review source configuration before enabling.' WHERE state IN ('PENDING','RUNNING')").run(now).changes;
      db.prepare('DELETE FROM auth_attempts').run();
      const counts={sessions,users,sources,jobs};writeAudit(db,'SYSTEM','database','DATABASE_RESTORED',{backupSha256:verified.manifest.sha256,backupCompletedAt:verified.manifest.completedAt,quarantine:counts},'Local recovery');return counts;
    });
    inspectDatabase(db);
    for(const [table,before] of Object.entries(verified.manifest.evidence)) {
      const after=tableDigest(db,table,before.columns);
      if(after.rows!==before.rows||after.sha256!==before.sha256)error('Recovery altered protected evidence: '+table);
    }
    standalone(db);db.close();db=null;await syncFile(partial);
    await unusedTarget(target);
    // Same-filesystem hard link publishes without replacing an existing file, even on a race.
    await link(partial,target);published=true;await unlink(partial);
    return {path:target,backupSha256:verified.manifest.sha256,datasetMode:verified.manifest.datasetMode,quarantine,requiresNewAdmin:true};
  } catch(reason) {
    if(db?.isOpen)db.close();
    // Only our uniquely named partial files are eligible for cleanup, never the target.
    if(!published)for(const suffix of ['','-wal','-shm','-journal'])try{await unlink(partial+suffix);}catch(cleanup){if(cleanup.code!=='ENOENT')reason.cleanupError=cleanup.message;}
    throw reason;
  }
}
