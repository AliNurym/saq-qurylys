import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSignalInbox,signalInboxRoute,signalResponseLabel} from '../public/signal-inbox-ui.js';
import {renderSignal} from '../public/pages-workflow.js';
import {setLocale} from '../public/i18n.js';
globalThis.document={documentElement:{lang:'ru'}};
const row={id:'SQ-2026-001',complexId:'complex-one',complexName:'ЖК тест',city:'Усть-Каменогорск',scoreSnapshot:75,zoneSnapshot:'red',status:'CONFIRMED',createdAt:'2026-10-10T03:00:00.000Z',routing:{recipient:'GASK',assignedAt:'2026-10-10T03:00:00.000Z',dueDate:'2026-10-19'},responseState:'AWAITING',hasResponse:false,overdue:false};
const page=(overrides={})=>({items:[row],total:1,limit:20,nextCursor:null,filters:{status:'',recipient:'',response:'',sort:'newest',search:'',complexId:''},summary:{total:9,needsReview:2,awaiting:3,overdue:1,responded:2},evaluationDate:'2026-10-19',...overrides});

test('inbox exposes recipients, exact deadlines, status, filters and counter scope',()=>{
  setLocale('ru');const html=renderSignalInbox(page());assert.match(html,/ГАСК/u);assert.match(html,/Срок сегодня/u);assert.match(html,/Ожидает ответа/u);assert.match(html,/не зависят от фильтров/u);assert.match(html,/включают просроченные/u);
  for(const name of ['search','status','recipient','response','sort'])assert.match(html,new RegExp('name="'+name+'"','u'));
  assert.match(html,/scope="col"/u);assert.doesNotMatch(html,/contextSnapshot|calendarDefinition|base64/u);
});

test('routes preserve filters across pages while counter links open complete visible slices',()=>{
  const filters={status:'CONFIRMED',recipient:'GASK',search:'тест & <tag>',sort:'deadline'},route=signalInboxRoute(filters,'cursor/one');
  const url=new URL(route,'https://qa.invalid');for(const [key,value] of Object.entries(filters))assert.equal(url.searchParams.get(key),value);assert.equal(url.searchParams.get('before'),'cursor/one');
  const html=renderSignalInbox(page({filters,before:'current',nextCursor:'next-token'}));assert.match(html,/К началу/u);assert.match(html,/Следующие материалы/u);assert.match(html,/before=next-token/u);assert.match(html,/response=OVERDUE&amp;sort=deadline/u);
});

test('all untrusted summary values and filter contents are escaped',()=>{
  const attack='<img src=x onerror=alert(1)>',html=renderSignalInbox(page({items:[{...row,complexName:attack,city:attack}],filters:{search:attack,sort:'newest'}}));
  assert.doesNotMatch(html,/<img/u);assert.match(html,/&lt;img/u);assert.match(html,/value="&lt;img/u);
});

test('empty filtered and genuinely empty queues explain recovery without fake result rows',()=>{
  setLocale('ru');const filtered=renderSignalInbox(page({items:[],total:0,filters:{recipient:'GASK'}}));assert.match(filtered,/Измените фильтры/u);assert.doesNotMatch(filtered,/<tbody>/u);
  assert.match(renderSignalInbox(page({items:[],total:0})),/после формирования или назначения/u);
});

test('archived-without-result, answered and overdue materials have explicit labels',()=>{
  setLocale('ru');assert.equal(signalResponseLabel({...row,responseState:'ARCHIVED'}),'Архив без результата');assert.equal(signalResponseLabel({...row,responseState:'ARCHIVED',hasResponse:true}),'Архив · результат внесён');
  const html=renderSignalInbox(page({items:[{...row,responseState:'OVERDUE',overdue:true}]}));assert.match(html,/is-overdue/u);assert.match(html,/Просрочен/u);assert.doesNotMatch(html,/Срок сегодня/u);
});

test('Kazakh inbox translates queue controls, deadline and result labels',()=>{
  setLocale('kz');const html=renderSignalInbox(page());assert.match(html,/Алушы орган/u);assert.match(html,/Жауап мерзімі бойынша/u);assert.match(html,/Мерзімі бүгін/u);assert.match(html,/МСҚБ/u);assert.equal(signalResponseLabel({...row,responseState:'ARCHIVED'}),'Нәтижесіз мұрағат');setLocale('ru');
});

test('detail omits archive action until assigned recipient records a result',()=>{
  setLocale('ru');const signal={...row,complex:{id:row.complexId,name:row.complexName,city:row.city,passport:{}},factorSnapshot:[],currentRisk:{score:75},contextSnapshot:{proposedActions:[]},advertisements:[],audit:[],legalBasisSnapshot:'CONFIRMED_ABSENT',createdBy:'qa.mio',routing:row.routing};
  const pending=renderSignal(signal);assert.doesNotMatch(pending,/data-status="ARCHIVED"/u);assert.match(pending,/До ответа карточка не архивируется/u);
  const answered=renderSignal({...signal,routing:{...row.routing,result:'Проверка проведена.',respondedAt:'2026-10-19T03:00:00.000Z'}});assert.match(answered,/data-status="ARCHIVED"/u);
});
