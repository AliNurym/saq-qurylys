import test from 'node:test';
import assert from 'node:assert/strict';
import {renderObjectConditions,renderConditionSnapshot,conditionReason,conditionRoute} from '../public/object-conditions-ui.js';
import {setLocale} from '../public/i18n.js';
globalThis.document={documentElement:{lang:'ru'}};
const checks={documentsMatch:true,constructionActive:true,complaintsClear:true,delaysClear:true};
const review={id:'review-one',checkedDate:'2026-10-19',validThrough:'2026-11-18',createdAt:'2026-10-19T03:00:00.000Z',createdBy:'qa.mio',source:'QA источник проверки',evidenceText:'Документы и обстоятельства проверены',checks,contextSha256:'a'.repeat(64)};
const state={eligible:false,reason:'NOT_REVIEWED',review:null,latestReviewId:null,currentContextSha256:'b'.repeat(64),evaluationDate:'2026-10-19'};
const fixture=(overrides={})=>({id:'complex-one',legalBasisStatus:'CONFIRMED_VALID',objectConditions:state,conditionView:{state,page:{items:[],total:0},canReview:true},...overrides});

test('MIO review defaults every condition unchecked and requires dated source evidence',()=>{
  setLocale('ru');const html=renderObjectConditions(fixture());assert.match(html,/id="object-conditions-form"/u);assert.doesNotMatch(html,/<input[^>]* checked/u);assert.match(html,/name="source"[^>]*required/u);assert.match(html,/name="evidenceText"[^>]*required/u);assert.match(html,/name="checkedDate"[^>]*required/u);
  for(const key of Object.keys(checks))assert.match(html,new RegExp('name="'+key+'"','u'));
  assert.match(html,/не срок действия разрешения/u);assert.match(html,/name="expectedContextSha256"/u);assert.match(html,/name="expectedReviewId" value=""/u);
});
test('readers see provenance and immutable review while first legal verification keeps draft save disabled',()=>{
  setLocale('ru');const reader=renderObjectConditions(fixture({conditionView:{state:{...state,reason:'ELIGIBLE',eligible:true,review},page:{items:[review],total:1},canReview:false}}));assert.doesNotMatch(reader,/id="object-conditions-form"/u);assert.match(reader,/QA источник проверки/u);assert.match(reader,/только сотрудник МИО/u);
  const unknown=renderObjectConditions(fixture({legalBasisStatus:'UNKNOWN',conditionView:{state:{...state,reason:'LEGAL_NOT_VERIFIED'},page:{items:[],total:0},canReview:true}}));assert.match(unknown,/type="submit" disabled/u);assert.match(unknown,/Черновик можно заполнить заранее/u);
});
test('history navigation uses an encoded per-object route and retains explicit page controls',()=>{
  const url=new URL(conditionRoute('complex / one','cursor+one'),'https://qa.invalid');assert.equal(decodeURIComponent(url.pathname),'/complexes/complex / one');assert.equal(url.searchParams.get('tab'),'legal');assert.equal(url.searchParams.get('conditionBefore'),'cursor+one');
  const html=renderObjectConditions(fixture({conditionView:{state:{...state,review},page:{items:[review],total:7,nextCursor:'next'},before:'old',canReview:true}}));assert.match(html,/data-action="condition-history"/u);assert.match(html,/Предыдущие решения/u);assert.match(html,/К началу истории/u);
});
test('review source, author, evidence and fingerprint escape markup',()=>{
  const attack='<script>alert(1)</script>',malicious={...review,source:attack,createdBy:attack,evidenceText:attack,contextSha256:attack};
  const html=renderObjectConditions(fixture({conditionView:{state:{...state,review:malicious},page:{items:[malicious],total:1},canReview:false}}));assert.doesNotMatch(html,/<script>/u);assert.match(html,/&lt;script&gt;/u);
});
test('signal condition proof uses frozen review and explains its absence for old snapshots',()=>{
  setLocale('ru');assert.match(renderConditionSnapshot({objectConditions:null}),/Текущие решения не подставляются/u);
  const proof=renderConditionSnapshot({objectConditions:{...state,eligible:true,reason:'ELIGIBLE',review}});assert.match(proof,/QA источник проверки/u);assert.match(proof,/Сохранено при создании сигнала/u);assert.doesNotMatch(proof,/<form/u);
});
test('Kazakh conditions translate review states, checkboxes and historical notice',()=>{
  setLocale('kz');const html=renderObjectConditions(fixture());assert.match(html,/Жасыл аймақ шарттары/u);assert.match(html,/Құрылыс іс жүзінде жүргізілуде/u);assert.match(conditionReason('CONTEXT_CHANGED'),/жаңа тексеру/u);assert.match(renderConditionSnapshot({objectConditions:null}),/Ағымдағы шешімдер қосылмайды/u);setLocale('ru');
});
