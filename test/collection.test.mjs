import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { openDatabase,createSchema } from '../src/db.mjs';
import {DatabaseSync} from 'node:sqlite';
import { seedDemoData,clearDatabase } from '../src/seed-data.mjs';
import { configureDataset } from '../src/dataset-service.mjs';
import { saveSource,listSources,getSource,enqueueSource,scheduleCollections,processNextJob,claimJob,getJob,listJobs,listJobPage,retryJob } from '../src/collection-service.mjs';
import { getCollectionProvenance,getAdvertisementArchive } from '../src/collection-evidence.mjs';
import { parseSourceResponse,htmlToText } from '../src/source-adapters.mjs';
import { isPublicAddress,validateSourceUrl,resolvePublicHost,fetchPublicResource } from '../src/public-http.mjs';
import { createUser } from '../src/access-service.mjs';
import { createHttpServer } from '../src/server.mjs';
import { confirmAdvertisementMatch,listAdvertisements,listAdvertisementPlatforms } from '../src/advertisement-service.mjs';
import { createSignal,getSignalDetails } from '../src/signal-service.mjs';
import { renderSignalExport } from '../src/signal-export.mjs';

const fixture=t=>{const db=openDatabase(':memory:');t.after(()=>db.close());return db;};
const definition={name:'Контрольный источник',kind:'JSON_FEED',platform:'Telegram',url:'https://example.com/feed',enabled:true,intervalMinutes:1440};
const item={id:'post-001',text:'В новом жилом комплексе предлагается бронь квартиры за 250 000 тенге.',url:'https://example.com/post/1'};
const resource=(items=[item])=>({mime:'application/json',finalUrl:definition.url,bytes:Buffer.from(JSON.stringify({items}))});
const count=(db,table)=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
const collect=async(db,source,items=[item])=>{enqueueSource(db,source.id);return processNextJob(db,{fetcher:async()=>resource(items)});};

test('advertisement lists distinguish observed dates from source-declared and manually entered dates',async t=>{
 const db=fixture(t);seedDemoData(db);const source=saveSource(db,{...definition,platform:'Коллектор QA'});await collect(db,source,[item,{...item,id:'known-date',publishedAt:'2026-10-16'}]);
 const ads=listAdvertisements(db),unknown=ads.find(ad=>ad.notes?.includes('Дата публикации неизвестна'));
 assert.ok(unknown);assert.equal(unknown.publicationDateBasis,'OBSERVED');assert.ok(unknown.observedAt);assert.equal(ads.find(ad=>ad.id==='ad-001').publicationDateBasis,'MANUAL_DECLARED');assert.ok(ads.some(ad=>ad.publicationDateBasis==='SOURCE_DECLARED'));
 assert.equal(new Set(ads.map(ad=>ad.id)).size,ads.length);
 assert.ok(listAdvertisementPlatforms(db).includes('Коллектор QA'));assert.equal(listAdvertisementPlatforms(db,new Set(['cx-aspan'])).includes('Коллектор QA'),false);
});

test('legacy job rows survive diagnostic-column migration without changing attempts or state',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE background_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 4,run_after TEXT NOT NULL,lease_until TEXT,lease_token TEXT,last_error TEXT,result_json TEXT,created_at TEXT NOT NULL,finished_at TEXT)");
 db.prepare("INSERT INTO background_jobs(id,kind,subject_id,state,attempts,run_after,created_at,last_error) VALUES ('legacy','COLLECT_SOURCE','old-source','PENDING',2,?,?,?)").run('2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','Прежняя безопасная ошибка');
 createSchema(db);createSchema(db);const job=getJob(db,'legacy');assert.equal(job.state,'PENDING');assert.equal(job.attempts,2);assert.equal(job.errorCode,null);assert.equal(job.lastError,'Прежняя безопасная ошибка');
});

test('source details expose credential presence only and actionable missing-token errors',async t=>{
 const db=fixture(t),name='SAQ_SOURCE_DIAGNOSTIC_TEST_TOKEN',previous=process.env[name];t.after(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});delete process.env[name];
 const source=saveSource(db,{...definition,tokenEnv:name});assert.equal(source.tokenStatus,'MISSING');enqueueSource(db,source.id);const failedAttempt=await processNextJob(db,{fetcher:async()=>{throw new Error('Must not fetch without a token');}});assert.equal(failedAttempt.errorCode,'SOURCE_TOKEN_MISSING');assert.match(failedAttempt.lastError,/не задана переменная/u);
 process.env[name]='PRIVATE_CREDENTIAL_VALUE';const details=getSource(db,source.id);assert.equal(details.tokenStatus,'CONFIGURED');assert.equal(details.lastCollection.id,failedAttempt.id);assert.equal(JSON.stringify(details).includes('PRIVATE_CREDENTIAL_VALUE'),false);
 const revised=saveSource(db,{...definition,tokenEnv:name,name:'Изменённая конфигурация',expectedUpdatedAt:source.updatedAt},source.id);
 assert.throws(()=>enqueueSource(db,source.id,new Date(),source.updatedAt),{statusCode:409});assert.equal(enqueueSource(db,source.id,new Date(),revised.updatedAt).created,false);
});

test('untrusted provider HTTP-400 messages cannot leak credentials into job diagnostics or audit',async t=>{
 const db=fixture(t),source=saveSource(db,definition);enqueueSource(db,source.id);
 const job=await processNextJob(db,{fetcher:async()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_CREDENTIAL'),{statusCode:400});}});
 assert.equal(job.errorCode,'SOURCE_PROCESSING_ERROR');assert.equal(JSON.stringify(job).includes('PRIVATE_PROVIDER_CREDENTIAL'),false);assert.equal(JSON.stringify(db.prepare('SELECT metadata_json FROM audit_logs').all()).includes('PRIVATE_PROVIDER_CREDENTIAL'),false);
 const changed=saveSource(db,{...definition,enabled:false,expectedUpdatedAt:source.updatedAt},source.id);assert.equal(changed.enabled,false);const cancelled=getJob(db,job.id);assert.equal(cancelled.errorCode,'SOURCE_DISABLED');assert.equal(cancelled.state,'CANCELLED');assert.ok(cancelled.events.some(event=>event.action==='JOB_CANCELLED'));
});

test('filtered queue pagination reaches all source analyses and excludes unrelated work',async t=>{
 const db=fixture(t),source=saveSource(db,definition);await collect(db,source,Array.from({length:7},(_,index)=>({...item,id:'page-'+index,text:item.text+' '+index})));
 const other=saveSource(db,{...definition,name:'Другой источник',url:'https://example.org/feed'});enqueueSource(db,other.id);
 const ids=[];let before=null;do{const page=listJobPage(db,{limit:2,sourceId:source.id,before});assert.equal(page.total,8);ids.push(...page.items.map(job=>job.id));before=page.nextCursor;}while(before);
 assert.equal(ids.length,8);assert.equal(new Set(ids).size,8);assert.equal(listJobPage(db,{kind:'ANALYZE_AD',state:'PENDING',sourceId:source.id}).total,7);assert.equal(listJobPage(db,{kind:'COLLECT_SOURCE',state:'SUCCEEDED',sourceId:source.id}).total,1);
 assert.throws(()=>listJobPage(db,{state:'BROKEN'}),{statusCode:400});assert.throws(()=>listJobPage(db,{before:'missing'}),{statusCode:400});assert.throws(()=>listJobPage(db,{sourceId:'missing'}),{statusCode:404});
 const details=getSource(db,source.id);assert.equal(details.publicationCount,7);assert.equal(details.archiveCount,1);assert.equal(details.lastCollection.publications.length,7);assert.equal(details.lastCollection.publications[0].publishedAt,null);
});

test('HTTP source/job details and archives remain administrator-only and preserve exact bytes',async t=>{
 const db=fixture(t),password='collection-admin-password';createUser(db,{username:'details.admin',role:'ADMIN',password});createUser(db,{username:'details.mio',role:'MIO',password});
 const source=saveSource(db,definition),job=await collect(db,source);
 const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const root='http://127.0.0.1:'+server.address().port;
 const tokens={};for(const role of ['admin','mio']){const response=await fetch(root+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'details.'+role,password})});tokens[role]=response.headers.get('set-cookie').split(';')[0];}
 const api=(path,role='admin')=>fetch(root+path,{headers:{cookie:tokens[role]}});
 assert.equal((await api('/api/admin/sources/'+source.id)).status,200);assert.equal((await api('/api/admin/sources/'+source.id,'mio')).status,403);
 const archived=await api('/api/admin/jobs/'+job.id+'/archive');assert.equal(archived.status,200);assert.deepEqual(Buffer.from(await archived.arrayBuffer()),resource().bytes);assert.equal(archived.headers.get('x-content-sha256'),createHash('sha256').update(resource().bytes).digest('hex'));assert.match(archived.headers.get('content-disposition'),/attachment/u);assert.equal((await api('/api/admin/jobs/'+job.id+'/archive','mio')).status,403);
 const page=await (await api('/api/admin/jobs?limit=1&sourceId='+source.id)).json();assert.equal(page.total,2);assert.equal(page.items.length,1);assert.ok(page.nextCursor);assert.equal((await api('/api/admin/sources/missing')).status,404);
});

test('collector rejects private, mapped, credentialled and non-HTTPS addresses; validates every DNS answer',async()=>{
  for(const url of ['http://example.com','https://localhost','https://127.1','https://2130706433','https://10.1.2.3','https://[::1]','https://[::ffff:127.0.0.1]','https://example.com:8443','https://u:p@example.com','https://example.com/?token=secret','https://example.com/?auth_token=secret','https://example.com/?stkn=secret','https://example.com/?signature=secret','https://example.com/?firebase_key=secret','https://example.com/#x'])assert.throws(()=>validateSourceUrl(url));
  for(const ip of ['0.0.0.0','10.1.2.3','100.100.100.100','169.254.169.254','192.168.0.1','198.18.0.1','224.1.1.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1'])assert.equal(isPublicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip);
  await assert.rejects(resolvePublicHost('example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
  assert.equal((await resolvePublicHost('example.com',async()=>[{address:'8.8.8.8',family:4}])).address,'8.8.8.8');
});

function transportFixture(responses,calls) {
  return (url,options,callback)=>{
    const req=new EventEmitter();
    req.end=()=>queueMicrotask(()=>{
      calls.push({url:url.href,options});
      options.lookup(url.hostname,{all:true},(error,records)=>{assert.equal(error,null);assert.deepEqual(records,[{address:'8.8.8.8',family:4}]);});
      const spec=responses.shift(),res=new PassThrough();
      res.statusCode=spec.status??200;res.headers=spec.headers??{'content-type':'application/json'};
      callback(res);if(!res.destroyed)res.end(spec.body??'{"items":[]}');
    });
    return req;
  };
}
test('public transport pins DNS, validates redirects and strips bearer credentials across origins',async()=>{
  const calls=[],resolver=async()=>[{address:'8.8.8.8',family:4}];
  const transport=transportFixture([{status:302,headers:{location:'https://other.example.org/feed'}},{body:'{"items":[]}'}],calls);
  const result=await fetchPublicResource(definition.url,{resolver,transport,token:'secret'});
  assert.equal(result.finalUrl,'https://other.example.org/feed');assert.equal(calls[0].options.headers.Authorization,'Bearer secret');assert.equal(calls[1].options.headers.Authorization,undefined);
  await assert.rejects(fetchPublicResource(definition.url,{resolver,transport:transportFixture([{status:302,headers:{location:'https://127.0.0.1/internal'}}],[])}));
  await assert.rejects(fetchPublicResource(definition.url,{resolver,transport:transportFixture([{body:'x'.repeat(100)}],[]),maxBytes:20}),/превышает/u);
  await assert.rejects(fetchPublicResource(definition.url,{resolver,transport:transportFixture([{headers:{'content-type':'application/octet-stream'}}],[])}),/формат/u);
});

test('adapters preserve observed versus published dates and reject malformed batches before persistence',()=>{
  assert.equal(htmlToText('<main><script>Внесите деньги</script><style>x</style><h1>ЖК &quot;Алтай&quot;</h1><p>Стройка &#x41; &#65;</p></main>'),'ЖК "Алтай" Стройка A A');
  const html={kind:'HTML_PAGE',url:'https://example.com/page'};
  const parsed=parseSourceResponse(html,{mime:'text/html',finalUrl:html.url,bytes:Buffer.from('<main>Информация о новом жилом комплексе</main>')});
  assert.equal(parsed[0].publishedAt,null);assert.match(parsed[0].notes,/Дата публикации неизвестна/u);assert.equal(parsed[0].url,'https://example.com/');
  assert.equal(parseSourceResponse(definition,resource([{...item,url:'https://example.com/post/1?stkn=private&auth_token=private&api_secret=private&firebase_key=private&view=full#section'}]))[0].url,'https://example.com/post/1?view=full');
  assert.equal(parseSourceResponse(definition,resource([{...item,publishedAt:'2020-01-01T09:00:00Z'}]))[0].publishedAt,'2020-01-01T09:00:00Z');
  for(const rows of [[item,item],[{...item,text:'bad'}],[{...item,publishedAt:'2020-02-30'}],[{...item,publishedAt:'2999-01-01'}],[{...item,url:'https://user:secret@example.com'}]])assert.throws(()=>parseSourceResponse(definition,resource(rows)));
  assert.throws(()=>parseSourceResponse(definition,{mime:'application/json',finalUrl:definition.url,bytes:Buffer.from([0xff])}));
  assert.throws(()=>parseSourceResponse(definition,resource(Array.from({length:101},(_,i)=>({...item,id:String(i)})))));
});

test('repeated collection is idempotent; changed external publications become separate immutable versions',async t=>{
  const db=fixture(t),source=saveSource(db,definition);
  const first=await collect(db,source);assert.equal(first.state,'SUCCEEDED');assert.equal(first.result.inserted,1);
  assert.equal(count(db,'advertisements'),1);assert.equal(count(db,'source_archives'),1);
  const analysis=await processNextJob(db);assert.equal(analysis.kind,'ANALYZE_AD');assert.equal(analysis.state,'SUCCEEDED');
  const second=await collect(db,source);assert.equal(second.result.duplicates,1);assert.equal(count(db,'advertisements'),1);
  const third=await collect(db,source,[{...item,text:item.text+' Стоимость изменилась.'}]);assert.equal(third.result.inserted,1);
  assert.equal(count(db,'advertisements'),2);assert.equal(count(db,'source_archives'),3);assert.equal(count(db,'collected_publications'),2);
  assert.equal(count(db,'risk_factors'),0); // A collection never confirms a legal fact or matches an object itself.
});

test('archives and origin survive deletion marks, source edits and signal creation without fabricated publication dates',async t=>{
  const db=fixture(t);seedDemoData(db);const source=saveSource(db,definition);
  await collect(db,source);await processNextJob(db);
  const adId=db.prepare('SELECT advertisement_id FROM collected_publications').get().advertisement_id;
  const provenance=getCollectionProvenance(db,adId),archive=getAdvertisementArchive(db,adId);
  assert.equal(provenance.publishedAt,null);assert.equal(provenance.sha256,createHash('sha256').update(archive.bytes).digest('hex'));
  assert.equal(provenance.sourceOrigin,'https://example.com');assert.equal(Object.hasOwn(provenance,'finalUrl'),false);
  const cx=db.prepare('SELECT id FROM complexes LIMIT 1').get().id;
  confirmAdvertisementMatch(db,adId,cx);const signal=createSignal(db,cx);
  saveSource(db,{...definition,name:'Переименован',expectedUpdatedAt:source.updatedAt},source.id);
  assert.equal(getCollectionProvenance(db,adId).sourceName,definition.name);
  assert.equal(getSignalDetails(db,signal.id).advertisements.find(ad=>ad.id===adId).collection.sourceName,definition.name);
  assert.match(renderSignalExport(getSignalDetails(db,signal.id)),/дата публикации неизвестна/u);
  assert.match(renderSignalExport(signal),new RegExp(provenance.sha256));
  for(const table of ['source_archives','collected_publications']) {
    assert.throws(()=>db.exec('DELETE FROM '+table),/immutable/u);
    assert.throws(()=>db.exec('UPDATE '+table+' SET id=id'),/immutable/u);
  }
});

test('collection persistence and audit roll back together on a database failure',async t=>{
  const db=fixture(t),source=saveSource(db,definition);
  db.exec("CREATE TRIGGER reject_collection BEFORE INSERT ON collected_publications BEGIN SELECT RAISE(ABORT,'injected storage failure'); END");
  const job=await collect(db,source);assert.equal(job.state,'PENDING');
  for(const table of ['advertisements','collected_publications','source_archives'])assert.equal(count(db,table),0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='ADVERTISEMENT_CREATED'").get().n,0);
});

test('analysis retries independently of already archived collection and never refetches its source',async t=>{
  const db=fixture(t),source=saveSource(db,definition);await collect(db,source);
  db.exec("CREATE TRIGGER reject_analysis BEFORE INSERT ON ai_analyses BEGIN SELECT RAISE(ABORT,'injected model storage failure'); END");
  const failed=await processNextJob(db);assert.equal(failed.kind,'ANALYZE_AD');assert.equal(failed.state,'PENDING');
  db.exec('DROP TRIGGER reject_analysis');db.prepare('UPDATE background_jobs SET run_after=? WHERE id=?').run(new Date().toISOString(),failed.id);
  assert.equal((await processNextJob(db)).state,'SUCCEEDED');assert.equal(count(db,'advertisements'),1);assert.equal(count(db,'source_archives'),1);
});

test('queue has bounded retry backoff, sanitized errors, explicit retries and no active duplicates',async t=>{
  const db=fixture(t),source=saveSource(db,definition),queued=enqueueSource(db,source.id);
  assert.equal(enqueueSource(db,source.id).id,queued.id);
  for(let attempt=1;attempt<=4;attempt++) {
    const before=Date.now();const job=await processNextJob(db,{fetcher:async()=>{throw new Error('Bearer PRIVATE_TOKEN should never leak');}});
    assert.equal(job.attempts,attempt);assert.equal(job.state,attempt===4?'FAILED':'PENDING');assert.doesNotMatch(job.lastError,/PRIVATE_TOKEN/u);
    assert.ok(Date.parse(job.runAfter)>=before+29000);
    if(attempt<4)db.prepare('UPDATE background_jobs SET run_after=? WHERE id=?').run(new Date().toISOString(),job.id);
  }
  assert.equal(retryJob(db,queued.id).state,'PENDING');assert.equal(getJob(db,queued.id).attempts,0);assert.throws(()=>retryJob(db,queued.id));
});

test('leases survive a database reopen and expired work is reclaimed with a new owner',t=>{
  const dir=mkdtempSync(join(tmpdir(),'saq-collection-')),path=join(dir,'queue.sqlite');let db=openDatabase(path);
  t.after(()=>{db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('saq-collection-'));rmSync(dir,{recursive:true,force:true});});
  const source=saveSource(db,definition);enqueueSource(db,source.id);const first=claimJob(db);assert.ok(first);
  db.close();db=openDatabase(path);assert.equal(claimJob(db),null);
  const second=claimJob(db,new Date(Date.now()+121000));assert.equal(second.id,first.id);assert.equal(second.attempts,2);assert.notEqual(second.lease_token,first.lease_token);
});

test('scheduler is persistent, missed runs catch up once, and two workers cannot fetch the same active job',async t=>{
  const db=fixture(t),source=saveSource(db,definition),now=new Date();
  assert.equal(scheduleCollections(db,now).length,1);assert.equal(scheduleCollections(db,now).length,0);
  let release,fetches=0;const wait=new Promise(resolve=>{release=resolve;});
  const first=processNextJob(db,{fetcher:async()=>{fetches++;await wait;return resource();}});
  assert.equal(await processNextJob(db),null);release();await first;assert.equal(fetches,1);
  assert.equal(scheduleCollections(db,new Date(now.getTime()+3*86400000)).length,1);
  assert.equal(scheduleCollections(db,new Date(now.getTime()+3*86400000)).length,0);
  assert.ok(listSources(db).find(item=>item.id===source.id).nextRunAt);
});

test('disabled or edited sources cancel queued/inflight work without persisting stale material',async t=>{
  const db=fixture(t),source=saveSource(db,definition),job=enqueueSource(db,source.id);
  let disabled=saveSource(db,{...definition,enabled:false,expectedUpdatedAt:source.updatedAt},source.id);
  assert.equal(getJob(db,job.id).state,'CANCELLED');assert.throws(()=>enqueueSource(db,source.id));
  const enabled=saveSource(db,{...definition,expectedUpdatedAt:disabled.updatedAt},source.id);enqueueSource(db,source.id);
  const cancelled=await processNextJob(db,{fetcher:async()=>{saveSource(db,{...definition,name:'Изменён',expectedUpdatedAt:enabled.updatedAt},source.id);return resource();}});
  assert.equal(cancelled.state,'CANCELLED');assert.equal(count(db,'advertisements'),0);assert.equal(count(db,'source_archives'),0);
});

test('HTTP source management requires an administrator and archive downloads respect recipient scope',async t=>{
  const db=fixture(t);seedDemoData(db);
  for(const [username,role] of [['admin','ADMIN'],['officer','MIO'],['inspector','GASK']])createUser(db,{username,role,password:'isolated-collection-password'});
  const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const api=(path,method='GET',body,cookie)=>fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const login=async username=>(await api('/api/auth/login','POST',{username,password:'isolated-collection-password'})).headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/admin/sources')).status,401);
  const admin=await login('admin'),mio=await login('officer'),gask=await login('inspector');
  assert.equal((await api('/api/admin/sources','POST',definition,mio)).status,403);
  const response=await api('/api/admin/sources','POST',definition,admin);assert.equal(response.status,201);const source=await response.json();
  assert.equal((await api('/api/admin/sources/'+source.id+'/run','POST',{},admin)).status,202);
  await processNextJob(db,{fetcher:async()=>resource()});await processNextJob(db);
  const adId=db.prepare('SELECT advertisement_id FROM collected_publications').get().advertisement_id;
  assert.equal((await api('/api/ads/'+adId+'/archive')).status,401);
  assert.equal((await api('/api/ads/'+adId+'/archive','GET',undefined,gask)).status,403);
  const complexId=db.prepare('SELECT id FROM complexes LIMIT 1').get().id;
  assert.equal((await api('/api/ads/'+adId+'/match','POST',{complexId},mio)).status,200);
  const signal=await (await api('/api/signals','POST',{complexId},mio)).json();
  assert.equal((await api('/api/signals/'+signal.id+'/route','POST',{recipient:'GASK',reason:'Проверка материала по компетенции'},mio)).status,200);
  const archive=await api('/api/ads/'+adId+'/archive','GET',undefined,gask);assert.equal(archive.status,200);
  assert.equal(archive.headers.get('content-type'),'application/octet-stream');assert.match(archive.headers.get('content-disposition'),/^attachment/u);
  const bytes=Buffer.from(await archive.arrayBuffer());assert.equal(archive.headers.get('x-content-sha256'),createHash('sha256').update(bytes).digest('hex'));
  assert.equal((await (await api('/api/ads/'+adId,'GET',undefined,mio)).json()).collection.publishedAt,null);
});

test('configured server automatically collects a due source and processes its analysis queue',async t=>{
  const db=fixture(t),source=saveSource(db,definition);
  const batch=Array.from({length:100},(_,i)=>({...item,id:'batch-'+i}));
  let fetches=0;const server=createHttpServer(db,{collectionFetcher:async()=>{fetches++;return resource(batch);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.stopCollection();await new Promise(resolve=>server.close(resolve));});
  const finished=()=>listJobs(db).filter(job=>job.kind==='ANALYZE_AD'&&job.state==='SUCCEEDED').length;
  const deadline=Date.now()+10000;
  while(Date.now()<deadline && finished()<100)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(fetches,1);assert.equal(count(db,'advertisements'),100);assert.equal(finished(),100);
  assert.ok(listSources(db).find(item=>item.id===source.id).nextRunAt);
});

test('a database with source collection cannot be relabelled or reset; working collection retains non-demo flags',async t=>{
  const demo=fixture(t);saveSource(demo,definition);
  assert.throws(()=>configureDataset(demo,'working'),/пустая/u);assert.throws(()=>clearDatabase(demo),/сбором источников/u);
  const working=fixture(t);configureDataset(working,'working');
  assert.throws(()=>clearDatabase(working),/рабочей/u);
  const source=saveSource(working,definition);await collect(working,source);
  assert.equal(working.prepare('SELECT is_demo FROM advertisements').get().is_demo,0);
  assert.equal(count(working,'source_archives'),1);
});

test('expired worker is fenced out of persistence after another owner reclaims its job',async t=>{
  const db=fixture(t),source=saveSource(db,definition),queued=enqueueSource(db,source.id);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const stale=processNextJob(db,{fetcher:async()=>{await gate;return resource();}});
  db.prepare('UPDATE background_jobs SET lease_until=? WHERE id=?').run('2000-01-01T00:00:00Z',queued.id);
  const owner=claimJob(db);assert.equal(owner.attempts,2);release();await stale;
  assert.equal(getJob(db,queued.id).state,'RUNNING');assert.equal(count(db,'source_archives'),0);assert.equal(count(db,'advertisements'),0);
  db.prepare('UPDATE background_jobs SET lease_until=? WHERE id=?').run('2000-01-01T00:00:00Z',queued.id);
  assert.equal((await processNextJob(db,{fetcher:async()=>resource()})).state,'SUCCEEDED');assert.equal(count(db,'advertisements'),1);
});

test('malformed later records reject the whole feed and exhausted leases terminate with audit',async t=>{
  const db=fixture(t),source=saveSource(db,definition);
  const job=await collect(db,source,[item,{id:'bad',text:'x'}]);assert.equal(job.state,'PENDING');
  assert.equal(count(db,'advertisements'),0);assert.equal(count(db,'source_archives'),0);
  db.prepare("UPDATE background_jobs SET state='RUNNING',attempts=max_attempts,lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(job.id);
  assert.equal(claimJob(db),null);assert.equal(getJob(db,job.id).state,'FAILED');
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='JOB_FAILED' AND entity_id=?").get(job.id).n,1);
});

test('demo HTTP access cannot configure a collector before administrator setup',async t=>{
  const db=fixture(t),server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/admin/sources';
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(definition)})).status,403);
  assert.equal(count(db,'collection_sources'),0);
});

test('an unused demo database still resets cleanly with the additive collection schema',t=>{
  const db=fixture(t);seedDemoData(db);clearDatabase(db);seedDemoData(db);
  assert.equal(count(db,'complexes'),10);assert.equal(count(db,'advertisements'),16);
  assert.equal(count(db,'source_archives'),0);assert.equal(count(db,'collection_sources'),0);
});
