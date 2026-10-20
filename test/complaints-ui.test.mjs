import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComplaints,renderComplaintSnapshot,complaintRoute,complaintStatus} from '../public/complaints-ui.js';
import {setLocale} from '../public/i18n.js';
globalThis.document={documentElement:{lang:'ru'}};
const item={id:'case-one',type:'COLLECTIVE',status:'PENDING',summary:'Учебное содержание обращения по строительству',source:'Учебный журнал приёма',receivedDate:'2026-10-19',capturedAt:'2026-10-19T03:00:00.000Z',registrationNumber:'QA-001',createdBy:'qa.mio',legacy:false,latestReviewId:null,reviews:[]};
const fixture=(overrides={})=>({id:'complex-one',complaintView:{page:{items:[item],total:1,filters:{status:'',type:''},nextCursor:null},selected:item,canReview:true,today:'2026-10-19',add:false,...overrides}});

test('manual intake requires explicit type/source/date and explains unverified zero-point status',()=>{
  setLocale('ru');const html=renderComplaints(fixture({add:true,selected:null}));assert.match(html,/id="complaint-intake-form"/u);assert.match(html,/непроверенный материал без баллов/u);assert.match(html,/name="type" required/u);assert.match(html,/value="" selected/u);assert.match(html,/name="receivedDate"[^>]*required/u);assert.match(html,/name="source"[^>]*required/u);assert.match(html,/name="summary"[^>]*required/u);
});
test('review choices follow lifecycle and bind form inputs to the selected complaint identity',()=>{
  const form=html=>html.split('<form id="complaint-review-form"')[1].split('</form>')[0];
  setLocale('ru');const pending=renderComplaints(fixture());assert.match(pending,/name="expectedReviewId" value=""/u);assert.doesNotMatch(form(pending),/value="RESOLVED"/u);assert.match(pending,/id="complaint-review-case-one-source"/u);
  const confirmed=renderComplaints(fixture({selected:{...item,status:'CONFIRMED',latestReviewId:'review-one'}}));assert.match(form(confirmed),/value="RESOLVED"/u);assert.match(form(confirmed),/value="review-one"/u);
  const other=renderComplaints(fixture({selected:{...item,id:'case-two'}}));assert.doesNotMatch(other,/id="complaint-review-case-one-source"/u);assert.match(other,/id="complaint-review-case-two-source"/u);
});
test('read-only and legacy materials offer no MIO decision or invented receipt metadata',()=>{
  setLocale('ru');const reader=renderComplaints(fixture({canReview:false}));assert.doesNotMatch(reader,/id="complaint-(intake|review)-form"/u);assert.doesNotMatch(reader,/Зарегистрировать обращение<\/a>/u);
  const old={...item,status:'LEGACY_CONFIRMED',legacy:true,receivedDate:null,createdBy:null},legacy=renderComplaints(fixture({selected:old,page:{items:[old],total:1,filters:{}}}));assert.doesNotMatch(legacy,/id="complaint-review-form"/u);assert.match(legacy,/Дата проверки и автор не восстановлены/u);assert.match(legacy,/Не сохранена/u);
});
test('routes and cursor page controls preserve filters, selected record and new intake draft',()=>{
  const route=complaintRoute('complex / one',{complaint:'case?one',before:'cursor+one',status:'CONFIRMED',type:'COLLECTIVE'}),url=new URL(route,'https://qa.invalid');assert.equal(url.searchParams.get('complaint'),'case?one');assert.equal(url.searchParams.get('complaintBefore'),'cursor+one');assert.equal(url.searchParams.get('complaintStatus'),'CONFIRMED');
  const html=renderComplaints(fixture({add:true,selected:null,page:{items:[item],total:8,nextCursor:'next',filters:{status:'PENDING',type:'COLLECTIVE'}}}));assert.match(html,/data-action="complaint-page"/u);assert.match(html,/new=1/u);assert.match(html,/complaintBefore=next/u);
});
test('source, summary, reviewer, decision and registration number escape markup',()=>{
  const attack='<img src=x onerror=alert(1)>',unsafe={...item,summary:attack,source:attack,registrationNumber:attack,reviews:[{id:'review',status:'CONFIRMED',createdBy:attack,createdAt:'2026-10-19T03:00:00Z',checkedDate:'2026-10-19',source:attack,evidenceText:attack,reason:attack}]};
  const html=renderComplaints(fixture({selected:unsafe,page:{items:[unsafe],total:1,filters:{}}}));assert.doesNotMatch(html,/<img/u);assert.match(html,/&lt;img/u);assert.match(renderComplaintSnapshot({complaints:[unsafe]}),/&lt;img/u);
});
test('signal complaints are frozen evidence without live review forms; missing legacy snapshots remain explicit',()=>{
  setLocale('ru');const frozen=renderComplaintSnapshot({complaints:[item]});assert.match(frozen,/QA-001/u);assert.match(frozen,/Требует проверки/u);assert.doesNotMatch(frozen,/<form/u);assert.match(renderComplaintSnapshot({complaints:null}),/Текущие записи не подставляются/u);assert.match(renderComplaintSnapshot({complaints:[]}),/На момент формирования обращения не зарегистрированы/u);
});
test('Kazakh forms, state labels and snapshot caveat are translated',()=>{
  setLocale('kz');const html=renderComplaints(fixture());assert.match(html,/Нысан бойынша өтініштер/u);assert.match(html,/ЖАО шешімі/u);assert.equal(complaintStatus('PENDING'),'Тексеруді қажет етеді');assert.match(renderComplaintSnapshot({complaints:null}),/Ағымдағы жазбалар қосылмайды/u);setLocale('ru');
});
