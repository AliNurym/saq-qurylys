import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConstruction,renderConstructionSnapshot,constructionRoute } from '../public/construction-ui.js';
import { setLocale } from '../public/i18n.js';

globalThis.document={documentElement:{lang:'ru'}};
const observation={id:'photo-one',status:'PENDING',observedDate:'2026-10-15',completionPercentage:40,source:'Выездной осмотр',method:'Оценка по выполненным объёмам',description:'Исходное описание',createdBy:'qa.mio',createdAt:'2026-10-16T10:00:00Z',width:2,height:2,photoUrl:'/api/complexes/example/observations/photo-one/photo',sha256:'a'.repeat(64)};
function fixture(overrides={}) {
  return {id:'example',updatedAt:'version-one',declaredCompletionPercentage:85,declaredCompletionSource:'Реклама',declaredCompletionCapturedAt:'2026-10-14',verifiedCompletionPercentage:40,verifiedCompletionSource:'Осмотр',verifiedCompletionCapturedAt:'2026-10-15',verifiedObservationId:null,readinessComparison:{sameObservationDate:false},readinessTrend:{points:[],totalPoints:0},constructionView:{canManage:true,page:{items:[observation],total:1,nextCursor:null},history:{items:[],total:0,nextRevision:null},selected:observation},...overrides};
}
test('construction navigation preserves and escapes IDs, pagination and explicit correction context',()=>{
  const route=constructionRoute('complex / one',{observation:'photo?one',before:'cursor&two'});
  assert.equal(route,'/complexes/complex%20%2F%20one?tab=construction&observation=photo%3Fone&before=cursor%26two');
});
test('readiness comparisons show dates and do not imply equivalent measurement periods',()=>{
  setLocale('ru');const html=renderConstruction(fixture());assert.match(html,/разным датам/u);assert.match(html,/85%/u);assert.match(html,/40%/u);
  assert.match(renderConstruction(fixture({readinessComparison:{sameObservationDate:true}})),/Разница: 45/u);
  assert.match(renderConstruction(fixture({verifiedCompletionPercentage:null})),/Для сравнения внесите обе оценки/u);
});
test('only an authorized operator sees upload and review forms; applying readiness needs an explicit decision',()=>{
  setLocale('ru');const complex=fixture(),html=renderConstruction(complex);assert.match(html,/id="construction-upload-form"/u);assert.match(html,/name="decision" required/u);assert.match(html,/<option value="">Выберите действие/u);assert.match(html,/name="expectedUpdatedAt" value="version-one"/u);
  complex.constructionView.canManage=false;const reader=renderConstruction(complex);assert.doesNotMatch(reader,/id="construction-(upload|review)-form"/u);assert.match(reader,/Фотоотчёты/u);
});
test('photo metadata, decisions and history escape user-controlled markup',()=>{
  setLocale('ru');const complex=fixture(),attack='<script>alert(1)</script>';
  complex.constructionView.selected={...observation,source:attack,method:attack,description:attack,status:'CONFIRMED',reviewReason:attack,reviewedBy:attack,reviewedAt:'2026-10-16T10:00:00Z'};
  complex.constructionView.history={items:[{revision:1,kind:'VERIFIED',percentage:40,reason:attack,createdBy:attack,createdAt:'2026-10-16T10:00:00Z'}],total:1,nextRevision:null};
  const html=renderConstruction(complex);assert.doesNotMatch(html,/<script>/u);assert.match(html,/&lt;script&gt;/u);assert.doesNotMatch(html,/id="construction-review-form"/u);
});
test('empty, correction and paginated states have truthful controls',()=>{
  setLocale('ru');const complex=fixture();complex.constructionView={...complex.constructionView,selected:null,page:{items:[],total:0,nextCursor:null}};assert.match(renderConstruction(complex),/Фотоотчётов пока нет/u);
  complex.constructionView={...complex.constructionView,selected:observation,page:{items:[observation],total:12,nextCursor:'next-photo'},before:'previous',supersedes:observation.id,historyAfter:10,history:{items:[],total:12,nextRevision:20}};
  const html=renderConstruction(complex);assert.match(html,/name="supersedesId" value="photo-one"/u);assert.match(html,/before=next-photo/u);assert.match(html,/historyAfter=20/u);assert.match(html,/id="construction-upload" class="construction-upload" open/u);
});
test('snapshot display only embeds frozen approved image types and labels missing historical evidence',()=>{
  setLocale('ru');assert.match(renderConstructionSnapshot({}),/Текущие фото не подставляются/u);
  const signal={constructionEvidence:{activeObservation:{...observation,mime:'image/png',photoData:'YWJj',reviewedBy:'qa.mio'},trend:{points:[],totalPoints:0},readinessHistory:{items:[],total:0}}};
  assert.match(renderConstructionSnapshot(signal),/src="data:image\/png;base64,YWJj"/u);
  signal.constructionEvidence.activeObservation.mime='image/svg+xml';assert.doesNotMatch(renderConstructionSnapshot(signal),/<img/u);
});
test('construction controls and history are translated into Kazakh without translating source records',()=>{
  setLocale('kz');try {const html=renderConstruction(fixture());assert.match(html,/Құрылыс барысы/u);assert.match(html,/Әрекетті таңдаңыз/u);assert.match(html,/Выездной осмотр/u);assert.doesNotMatch(html,/>Ход строительства</u);}finally {setLocale('ru');}
});
