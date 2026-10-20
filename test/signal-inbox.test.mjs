import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createComplex} from '../src/passport-service.mjs';
import {listSignalPage,listSignalSummaries} from '../src/signal-inbox.mjs';
import {getSignalDetails,transitionSignal,recordResponse} from '../src/signal-service.mjs';
import {getOverview,getComplexDetails} from '../src/complex-service.mjs';
import {withUser,createUser,login} from '../src/access-service.mjs';
import {serializeSignal} from '../src/serializers.mjs';
import {createHttpServer} from '../src/server.mjs';

const now=new Date('2026-10-19T03:00:00.000Z'),sentinel='PRIVATE_SNAPSHOT_BYTES_QA_';
function fixture(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const values={city:'Усть-Каменогорск',address:'Учебный адрес',developerName:'QA компания',developerBin:'000000000099',latitude:49.95,longitude:82.61};
  const first=createComplex(db,{...values,name:'ЖК Альфа QA'}),second=createComplex(db,{...values,name:'ЖК Бета QA'});
  const rows=[];
  const add=(options={})=>{
    const object=options.second?second:first,id='SQ-2026-'+String(9000+rows.length),status=options.status??'CONFIRMED';
    const routing=options.recipient?{recipient:options.recipient,assignedAt:'2026-10-01T03:00:00.000Z',dueDate:options.dueDate??'2026-10-08',reason:'Изолированная QA-фикстура',...(options.result?{result:'Учебный результат',respondedAt:'2026-10-09T03:00:00.000Z',recordedBy:'qa.recipient'}:{})}:{};
    const context={version:2,complex:{...object,name:object.name,city:object.city},advertisements:[{text:sentinel+'x'.repeat(8192)}]};
    db.prepare("INSERT INTO signals (id,complex_id,score_snapshot,zone_snapshot,legal_basis_snapshot,factor_snapshot_json,context_snapshot_json,status,created_by,created_at,routing_json) VALUES (?,?,0,'yellow','UNKNOWN','[]',?,?,?, ?,?)").run(id,object.id,JSON.stringify(context),status,'qa.mio',options.createdAt??'2026-10-10T03:00:00.000Z',JSON.stringify(routing));
    rows.push({id,status,routing,complexId:object.id});return id;
  };
  add({status:'NEEDS_REVIEW'});add({recipient:'GASK'});add({recipient:'GASK',dueDate:'2026-10-19'});add({recipient:'GASK',dueDate:'2026-10-21'});add({recipient:'GASK',result:true});add({recipient:'LAW_ENFORCEMENT'});add({recipient:'MIO'});
  add({status:'ARCHIVED',recipient:'GASK'});add({status:'ARCHIVED',recipient:'GASK',result:true});add({status:'RETURNED'});add({status:'DRAFT'});add({status:'CONFIRMED'});
  for(let i=0;i<21;i++)add({status:'NEEDS_REVIEW',second:i%2===0});
  return {db,first,second,rows,add};
}

test('response summary distinguishes overdue, due today, answered, unassigned and archived records',t=>{
  const {db,rows}=fixture(t),page=listSignalPage(db,{now,limit:100});
  assert.equal(page.total,rows.length);assert.equal(page.evaluationDate,'2026-10-19');assert.equal(page.summary.awaiting,5);assert.equal(page.summary.overdue,3);assert.equal(page.summary.responded,2);
  assert.equal(page.items.find(item=>item.id===rows[2].id).responseState,'AWAITING');assert.equal(page.items.find(item=>item.id===rows[7].id).responseState,'ARCHIVED');assert.equal(page.items.find(item=>item.id===rows[7].id).overdue,false);
  assert.equal(listSignalPage(db,{now,response:'AWAITING'}).total,5);assert.equal(listSignalPage(db,{now,response:'OVERDUE'}).total,3);assert.equal(listSignalPage(db,{now,response:'RESPONDED'}).total,2);
  assert.equal(listSignalPage(db,{now,status:'ARCHIVED'}).total,2);
});

test('deadline and newest cursors deliver every equal-timestamp row exactly once',t=>{
  const {db}=fixture(t);
  for(const sort of ['newest','deadline']) {
    const expected=listSignalPage(db,{now,sort,limit:100}).items.map(item=>item.id),actual=[];let before;
    do{const page=listSignalPage(db,{now,sort,limit:3,before});actual.push(...page.items.map(item=>item.id));before=page.nextCursor;}while(before);
    assert.deepEqual(actual,expected);assert.equal(new Set(actual).size,actual.length);
  }
  const ordered=listSignalPage(db,{now,sort:'deadline',limit:100}).items;
  assert.ok(ordered.slice(0,3).every(item=>item.overdue));assert.equal(ordered[3].routing.dueDate,'2026-10-19');assert.equal(ordered[4].routing.dueDate,'2026-10-21');
});

test('filters, Unicode search and frozen object names remain independent from live passport edits',t=>{
  const {db,first}=fixture(t);
  db.prepare('UPDATE complexes SET name=? WHERE id=?').run('Новая подпись',first.id);
  assert.ok(listSignalPage(db,{now,search:'альфа qa'}).total>0);assert.equal(listSignalPage(db,{now,search:'новая подпись'}).total,0);
  const selected=listSignalPage(db,{now,recipient:'GASK',response:'OVERDUE',search:'АЛЬФА',complexId:first.id});assert.equal(selected.total,1);assert.equal(selected.items[0].complexName,'ЖК Альфа QA');
  assert.equal(listSignalPage(db,{now,search:'%_'}).total,0,'search metacharacters are literal');assert.equal(listSignalPage(db,{now,search:"' OR 1=1 --"}).total,0);
  assert.ok(listSignalSummaries(db,{complexId:first.id}).every(item=>item.complexId===first.id));
});

test('recipient visibility applies before counters, filters, pagination and cursors',t=>{
  const {db,first}=fixture(t);
  const gask=withUser({role:'GASK'},()=>listSignalPage(db,{now,limit:2}));assert.equal(gask.summary.total,6);assert.equal(gask.summary.overdue,1);assert.ok(gask.items.every(item=>item.routing.recipient==='GASK'));
  const hidden=withUser({role:'GASK'},()=>listSignalPage(db,{now,recipient:'LAW_ENFORCEMENT'}));assert.equal(hidden.total,0);assert.equal(hidden.summary.total,6);
  const none=withUser({role:'GASK'},()=>listSignalPage(db,{now},new Set()));assert.equal(none.summary.total,0);assert.equal(none.total,0);
  assert.throws(()=>withUser({role:'LAW_ENFORCEMENT'},()=>listSignalPage(db,{now,limit:2,before:gask.nextCursor})),{statusCode:400});
  const scoped=listSignalPage(db,{now,limit:2},new Set([first.id]));assert.ok(scoped.items.every(item=>item.complexId===first.id));assert.throws(()=>listSignalPage(db,{now,limit:2,before:scoped.nextCursor}),{statusCode:400});
});

test('bad filters/cursors and midnight rollover fail explicitly rather than silently skipping records',t=>{
  const {db}=fixture(t),page=listSignalPage(db,{now,limit:2});
  for(const options of [{status:'WRONG'},{recipient:'ADMIN'},{response:'WRONG'},{sort:'WRONG'},{limit:0},{limit:101},{limit:1.5},{search:'x'.repeat(201)},{before:'!not-base64'},{before:'e30'},{before:page.nextCursor,status:'CONFIRMED'}])assert.throws(()=>listSignalPage(db,{now,...options}),{statusCode:400});
  assert.throws(()=>listSignalPage(db,{now:new Date('2026-10-19T20:00:00.000Z'),limit:2,before:page.nextCursor}),{statusCode:409});
});

test('list, overview and object summaries omit complete evidence while the detail endpoint retains it',t=>{
  const {db,first,rows}=fixture(t),page=listSignalPage(db,{now,limit:100});
  const packed=JSON.stringify(page);assert.doesNotMatch(packed,new RegExp(sentinel,'u'));assert.doesNotMatch(packed,/contextSnapshot|factorSnapshot|calendarDefinition/u);
  assert.ok(packed.length<rows.length*8192/4);assert.match(JSON.stringify(getSignalDetails(db,rows[0].id)),new RegExp(sentinel,'u'));
  assert.doesNotMatch(JSON.stringify(getOverview(db).recentSignals),new RegExp(sentinel,'u'));assert.doesNotMatch(JSON.stringify(getComplexDetails(db,first.id).signals),new RegExp(sentinel,'u'));
});

test('assigned material cannot be archived without a recipient result; existing archived history is preserved',t=>{
  const {db,rows}=fixture(t),signalId=rows[1].id;
  const before=db.prepare('SELECT * FROM signals WHERE id=?').get(signalId);assert.throws(()=>transitionSignal(db,signalId,{status:'ARCHIVED'}),{statusCode:409});assert.deepEqual(db.prepare('SELECT * FROM signals WHERE id=?').get(signalId),before);
  withUser({username:'qa.gask',role:'GASK'},()=>recordResponse(db,signalId,{result:'Результат внесён получателем.'}));transitionSignal(db,signalId,{status:'ARCHIVED'});
  assert.equal(getSignalDetails(db,signalId).overdue,false);
  const legacy=db.prepare('SELECT * FROM signals WHERE id=?').get(rows[7].id);assert.equal(serializeSignal(legacy).overdue,false);assert.equal(getSignalDetails(db,rows[7].id).status,'ARCHIVED');
});

test('HTTP inbox enforces roles, returns bounded pages and blocks archive until the actual recipient responds',async t=>{
  const {db,rows}=fixture(t);createUser(db,{username:'inbox.admin',password:'inbox-password-2026',role:'ADMIN'});createUser(db,{username:'inbox.mio',password:'inbox-password-2026',role:'MIO'});createUser(db,{username:'inbox.gask',password:'inbox-password-2026',role:'GASK'});
  const mio=(await login(db,{username:'inbox.mio',password:'inbox-password-2026'},'mio')).token,gask=(await login(db,{username:'inbox.gask',password:'inbox-password-2026'},'gask')).token;
  const server=createHttpServer(db,{collectionWorker:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const root='http://127.0.0.1:'+server.address().port,request=(path,token,body,method='POST')=>fetch(root+path,{method:body?method:'GET',headers:{...(token?{Cookie:'saq_session='+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal((await request('/api/signals')).status,401);
    const page=await (await request('/api/signals?limit=2&sort=deadline',gask)).json();assert.equal(page.items.length,2);assert.equal(page.summary.total,6);assert.doesNotMatch(JSON.stringify(page),new RegExp(sentinel,'u'));
    const second=await request('/api/signals?limit=2&sort=deadline&before='+encodeURIComponent(page.nextCursor),gask);assert.equal(second.status,200);
    assert.equal((await request('/api/signals/'+rows[1].id+'/status',mio,{status:'ARCHIVED'},'PATCH')).status,409);
    assert.equal((await request('/api/signals/'+rows[1].id+'/response',mio,{result:'Чужая попытка внести результат.'})).status,403);
    assert.equal((await request('/api/signals/'+rows[1].id+'/response',gask,{result:'Учебный ответ назначенного органа.'})).status,200);
    assert.equal((await request('/api/signals/'+rows[1].id+'/status',mio,{status:'ARCHIVED'},'PATCH')).status,200);
    const detail=await request('/api/signals/'+rows[1].id,gask);assert.equal(detail.status,200);assert.match(await detail.text(),new RegExp(sentinel,'u'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
