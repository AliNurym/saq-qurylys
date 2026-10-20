import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase,createSchema } from '../src/db.mjs';
import { seedDemoData } from '../src/seed-data.mjs';
import { calculateBusinessDeadline,getBusinessCalendar,saveBusinessCalendar,previewBusinessCalendar,listBusinessCalendarPage,listBusinessCalendars } from '../src/business-calendar.mjs';
import { createSignal,routeSignal,recordResponse,getSignalDetails } from '../src/signal-service.mjs';
import { renderSignalExport } from '../src/signal-export.mjs';
import { createUser,login } from '../src/access-service.mjs';
import { createHttpServer } from '../src/server.mjs';
import { todayInKazakhstan } from '../src/dates.mjs';

const fixture=t=>{const db=openDatabase(':memory:');t.after(()=>db.close());return db;};
const definition={source:'Контрольный календарь оператора, не официальный набор',sourceDate:'2020-01-01',coverage:{from:'2026-01-01',to:'2027-12-31'},nonWorkingDates:['2026-10-19'],workingDates:['2026-10-17']};
const save=(db,changes={})=>saveBusinessCalendar(db,{...definition,...changes,expectedVersion:getBusinessCalendar(db).version});

test('draft preview compares dates without changing the active calendar, versions or audit',t=>{
 const db=fixture(t),before=getBusinessCalendar(db),count=db.prepare('SELECT count(*) AS n FROM audit_logs').get().n;
 const draft={...definition,workingDates:[]};
 const result=previewBusinessCalendar(db,{draft,startDate:'2026-10-16',expectedVersion:before.version});
 assert.equal(result.mode,'DRAFT');assert.equal(result.dueDate,'2026-10-26');assert.equal(result.active.dueDate,'2026-10-23');assert.equal(result.active.configured,false);assert.match(result.draftSha256,/^[a-f0-9]{64}$/u);
 assert.deepEqual(getBusinessCalendar(db),before);assert.equal(listBusinessCalendars(db).length,0);assert.equal(db.prepare('SELECT count(*) AS n FROM audit_logs').get().n,count);
 const active=previewBusinessCalendar(db,{startDate:'2026-10-16'});assert.equal(active.mode,'ACTIVE');assert.equal(active.dueDate,'2026-10-23');
 for(const input of [null,[],{draft:null},{draft,startDate:'2026-02-30',expectedVersion:before.version},{draft,startDate:'2026-10-16',expectedVersion:'stale'}])assert.throws(()=>previewBusinessCalendar(db,input));
});

test('publishing may bind its exact validated draft and refuses changed or stale content',t=>{
 const db=fixture(t),version=getBusinessCalendar(db).version,draft={...definition,source:'  Контрольный источник  ',nonWorkingDates:['2026-10-20','2026-10-19']};
 const checked=previewBusinessCalendar(db,{draft,startDate:'2026-10-16',expectedVersion:version});
 assert.throws(()=>saveBusinessCalendar(db,{...draft,source:'Другой источник',expectedVersion:version,expectedDraftSha256:checked.draftSha256}),{statusCode:409});assert.equal(listBusinessCalendars(db).length,0);
 const saved=saveBusinessCalendar(db,{...draft,nonWorkingDates:[...draft.nonWorkingDates].reverse(),expectedVersion:version,expectedDraftSha256:checked.draftSha256});assert.equal(saved.source,'Контрольный источник');
 assert.throws(()=>previewBusinessCalendar(db,{draft,startDate:'2026-10-16',expectedVersion:version}),{statusCode:409});
});

test('a valid draft can preview beyond active coverage while clearly reporting the active-calendar error',t=>{
 const db=fixture(t),active=save(db,{coverage:{from:'2026-10-01',to:'2026-10-22'}});
 const result=previewBusinessCalendar(db,{draft:definition,startDate:'2026-10-16',expectedVersion:active.version});assert.equal(result.dueDate,'2026-10-23');assert.match(result.active.error,/не покрывает/u);assert.equal(getBusinessCalendar(db).version,active.version);
});

test('version pagination retains every same-time version and validates cursors',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T10:00:00Z')});
 const db=fixture(t);for(let i=0;i<7;i++)save(db,{source:'Контрольная версия '+i});
 let before=null;const items=[];
 do {const page=listBusinessCalendarPage(db,{limit:2,before});assert.equal(page.total,7);items.push(...page.items);before=page.nextCursor;}while(before);
 assert.equal(items.length,7);assert.equal(new Set(items.map(item=>item.version)).size,7);assert.equal(new Set(items.map(item=>item.createdAt)).size,1);assert.equal(listBusinessCalendars(db).length,7);
 assert.throws(()=>listBusinessCalendarPage(db,{before:'missing'}),{statusCode:400});assert.throws(()=>listBusinessCalendarPage(db,{limit:101}),{statusCode:400});
});

test('HTTP supports authenticated draft preview, digest-bound publication and paginated version reads',async t=>{
 const db=fixture(t),password='calendar-http-password';createUser(db,{username:'calendar.admin',role:'ADMIN',password});
 const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const root='http://127.0.0.1:'+server.address().port,token=(await login(db,{username:'calendar.admin',password},'calendar-http')).token;
 const api=(path,method='GET',body)=>fetch(root+path,{method,headers:{cookie:'saq_session='+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const current=await (await api('/api/admin/calendar')).json();const preview=await api('/api/admin/calendar/preview','POST',{draft:definition,startDate:'2026-10-16',expectedVersion:current.version});assert.equal(preview.status,200);const checked=await preview.json();assert.equal(checked.mode,'DRAFT');
 assert.equal((await api('/api/admin/calendar','PUT',{...definition,expectedVersion:current.version,expectedDraftSha256:checked.draftSha256})).status,200);
 const versions=await (await api('/api/admin/calendar/versions?limit=1')).json();assert.equal(versions.items.length,1);assert.equal(versions.total,1);assert.equal(versions.nextCursor,null);
 assert.equal((await api('/api/admin/calendar/versions?limit=0')).status,400);
});

test('business deadlines count after assignment, handle holidays, working weekends, leap days and year changes',()=>{
  assert.equal(calculateBusinessDeadline('2026-10-16'), '2026-10-23');
  assert.equal(calculateBusinessDeadline('2026-10-16',5,{nonWorkingDates:['2026-10-19']}),'2026-10-26');
  assert.equal(calculateBusinessDeadline('2026-10-16',5,definition),'2026-10-23');
  assert.equal(calculateBusinessDeadline('2026-10-16',5,{workingDates:['2026-10-17']}),'2026-10-22');
  assert.equal(calculateBusinessDeadline('2026-12-29',5,{nonWorkingDates:['2027-01-01']}),'2027-01-06');
  assert.equal(calculateBusinessDeadline('2028-02-28',1),'2028-02-29');
  for(const [start,count] of [['2026-02-30',5],['2026-10-16',0],['2026-10-16',61],['2026-10-16',1.5]])assert.throws(()=>calculateBusinessDeadline(start,count),{statusCode:400});
});

test('official-source Q4 template excludes the Republic Day transfer and Independence Day within declared coverage',()=>{
  const template=JSON.parse(readFileSync(new URL('../docs/examples/business-calendar-kz-2026-q4.json',import.meta.url),'utf8'));
  const calendar={...template,configured:true};
  assert.equal(calculateBusinessDeadline('2026-10-19',5,calendar),'2026-10-27');
  assert.equal(calculateBusinessDeadline('2026-12-15',5,calendar),'2026-12-23');
  assert.throws(()=>calculateBusinessDeadline('2026-12-25',5,calendar),{statusCode:409});
});

test('published calendars require complete coverage and refuse unsupported fallback at a period boundary',()=>{
  const calendar={...definition,configured:true,coverage:{from:'2026-10-01',to:'2026-10-22'}};
  assert.throws(()=>calculateBusinessDeadline('2026-10-16',5,calendar),{statusCode:409});
  assert.throws(()=>calculateBusinessDeadline('2026-09-30',5,calendar),{statusCode:409});
  assert.equal(calculateBusinessDeadline('2026-10-16',4,calendar),'2026-10-22');
});

test('calendar publication has immutable versions, checksums, conflict detection and source attribution',t=>{
  const db=fixture(t),previous=getBusinessCalendar(db),saved=save(db);
  assert.equal(previous.configured,false);assert.equal(saved.configured,true);
  const {sha256,...data}=saved;assert.equal(sha256,createHash('sha256').update(JSON.stringify(data)).digest('hex'));
  const {sha256:fallbackHash,...fallbackData}=previous;assert.equal(fallbackHash,createHash('sha256').update(JSON.stringify(fallbackData)).digest('hex'));
  assert.deepEqual(getBusinessCalendar(db),saved);assert.equal(saved.source,definition.source);
  assert.throws(()=>saveBusinessCalendar(db,{...definition,expectedVersion:previous.version}),{statusCode:409});
  assert.throws(()=>db.exec('UPDATE business_calendar_versions SET definition_json=definition_json'),/immutable/u);
  assert.throws(()=>db.exec('DELETE FROM business_calendar_versions'),/immutable/u);
  createSchema(db);assert.deepEqual(getBusinessCalendar(db),saved);
});

test('invalid calendar inputs leave the active version and history untouched',t=>{
  const db=fixture(t),before=getBusinessCalendar(db).version;
  for(const change of [
    {nonWorkingDates:['2026-02-30']},{workingDates:['2026-10-19']},{nonWorkingDates:['2026-10-19','2026-10-19']},
    {nonWorkingDates:['2025-01-01']},{coverage:{from:'2026-12-31',to:'2026-01-01'}},
    {coverage:{from:'2020-01-01',to:'2030-01-01'}},{source:''},{sourceDate:'2999-01-01'},
  ])assert.throws(()=>saveBusinessCalendar(db,{...definition,...change,expectedVersion:before}),{statusCode:400});
  assert.equal(getBusinessCalendar(db).version,before);assert.equal(db.prepare('SELECT count(*) AS n FROM business_calendar_versions').get().n,0);
  db.exec("CREATE TRIGGER reject_calendar_audit BEFORE INSERT ON audit_logs WHEN NEW.action='BUSINESS_CALENDAR_UPDATED' BEGIN SELECT RAISE(ABORT,'calendar audit unavailable'); END");
  assert.throws(()=>save(db),/calendar audit unavailable/u);assert.equal(getBusinessCalendar(db).version,before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_calendar_versions').get().n,0);
});

test('assignment freezes its calendar and deadline; response never alters the original assignment',t=>{
  const db=fixture(t);seedDemoData(db);const year=Number(todayInKazakhstan().slice(0,4));
  const initial=save(db,{coverage:{from:year+'-01-01',to:(year+1)+'-12-31'},nonWorkingDates:[],workingDates:[]});
  const signal=createSignal(db,'cx-aspan'),assigned=routeSignal(db,signal.id,{recipient:'GASK',reason:'Контроль срока рассмотрения'});
  assert.equal(assigned.routing.calendarVersion,initial.version);assert.deepEqual(assigned.routing.calendarDefinition,initial);
  save(db,{coverage:initial.coverage,source:'Новая версия календаря',nonWorkingDates:[],workingDates:[]});
  assert.equal(getSignalDetails(db,signal.id).routing.calendarVersion,initial.version);
  assert.equal(getSignalDetails(db,signal.id).routing.dueDate,assigned.routing.dueDate);
  assert.throws(()=>db.prepare("UPDATE signals SET routing_json=json_set(routing_json,'$.dueDate','2099-01-01') WHERE id=?").run(signal.id),/immutable/u);
  assert.throws(()=>routeSignal(db,signal.id,{recipient:'MIO',reason:'Повторное назначение'}),{statusCode:409});
  const responded=recordResponse(db,signal.id,{result:'Сведения проверены, осмотр назначен'});
  assert.equal(responded.routing.calendarVersion,initial.version);assert.equal(responded.routing.dueDate,assigned.routing.dueDate);
  assert.throws(()=>db.prepare("UPDATE signals SET routing_json=json_set(routing_json,'$.result','Другой результат') WHERE id=?").run(signal.id),/immutable/u);
  assert.throws(()=>recordResponse(db,signal.id,{result:'Повторный результат'}),{statusCode:409});
  const html=renderSignalExport(responded);assert.match(html,new RegExp(initial.version));assert.match(html,/Календарь опубликован оператором/u);
});

test('missing calendar coverage prevents routing without a partial approval or audit event',t=>{
  const db=fixture(t);seedDemoData(db);const today=todayInKazakhstan();
  save(db,{coverage:{from:today,to:today},nonWorkingDates:[],workingDates:[]});const signal=createSignal(db,'cx-aspan');
  assert.throws(()=>routeSignal(db,signal.id,{recipient:'GASK',reason:'Проверка срока'}),{statusCode:409});
  assert.equal(getSignalDetails(db,signal.id).status,'NEEDS_REVIEW');assert.equal(getSignalDetails(db,signal.id).routing.assignedAt,undefined);
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='SIGNAL_ROUTE_APPROVED'").get().n,0);
});

test('legacy assignment remains readable and accepts a response without inventing a historical calendar',t=>{
  const db=fixture(t);seedDemoData(db);const signal=createSignal(db,'cx-aspan');
  const legacy={recipient:'GASK',reason:'Историческое назначение',assignedAt:'2020-01-01T00:00:00Z',approvedBy:'Legacy Officer',dueDate:'2020-01-08',mode:'INTERNAL_ONLY',calendar:'WEEKDAYS_AND_CONFIGURED_EXCEPTIONS'};
  db.prepare("UPDATE signals SET status='CONFIRMED',routing_json=? WHERE id=?").run(JSON.stringify(legacy),signal.id);
  createSchema(db);assert.deepEqual(getSignalDetails(db,signal.id).routing,legacy);
  const responded=recordResponse(db,signal.id,{result:'Получатель внёс исторический результат'});
  assert.equal(responded.routing.calendarDefinition,undefined);assert.equal(responded.routing.dueDate,legacy.dueDate);
});

test('calendar administration and preview require an authenticated administrator',async t=>{
  const db=fixture(t);
  for(const [username,role] of [['calendar.admin','ADMIN'],['calendar.mio','MIO']])createUser(db,{username,role,password:'calendar-test-password'});
  const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root='http://127.0.0.1:'+server.address().port;
  const req=(path,method='GET',body,token)=>fetch(root+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{cookie:'saq_session='+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await req('/api/admin/calendar')).status,401);
  const admin=(await login(db,{username:'calendar.admin',password:'calendar-test-password'},'admin')).token;
  const mio=(await login(db,{username:'calendar.mio',password:'calendar-test-password'},'mio')).token;
  assert.equal((await req('/api/admin/calendar','GET',undefined,mio)).status,403);
  const before=await (await req('/api/admin/calendar','GET',undefined,admin)).json();
  assert.equal((await req('/api/admin/calendar','PUT',{...definition,expectedVersion:before.version},admin)).status,200);
  const versions=await (await req('/api/admin/calendar/versions','GET',undefined,admin)).json();assert.equal(versions.items.length,1);
  const historical=await req('/api/admin/calendar/versions/'+versions.items[0].version,'GET',undefined,admin);assert.equal(historical.status,200);assert.equal((await historical.json()).source,definition.source);
  const preview=await req('/api/admin/calendar/preview','POST',{startDate:'2026-10-16'},admin);
  assert.equal(preview.status,200);assert.equal((await preview.json()).dueDate,'2026-10-23');
});
