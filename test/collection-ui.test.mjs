import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInputFromValues,sourceFormChanged,sourceRoute,jobRoute,renderSources,renderJobs,renderCollectedArchive} from '../public/collection-ui.js';
import {setLocale} from '../public/i18n.js';
import {renderAdvertisements} from '../public/pages-workflow.js';
globalThis.document={documentElement:{lang:'ru'}};
const source={id:'source-one',name:'Тестовый источник',kind:'JSON_FEED',platform:'Учебная лента',url:'https://example.org/feed',enabled:true,intervalMinutes:1440,tokenEnv:null,tokenStatus:'NOT_REQUIRED',nextRunAt:'2026-10-20T10:00:00Z',updatedAt:'version-one',publicationCount:1,archiveCount:1,lastCollection:null};
const job={id:'job-one',kind:'COLLECT_SOURCE',subjectId:source.id,state:'SUCCEEDED',attempts:1,maxAttempts:4,runAfter:'2026-10-19T10:00:00Z',createdAt:'2026-10-19T10:00:00Z',finishedAt:'2026-10-19T10:00:01Z',leaseUntil:null,lastError:null,errorCode:null,result:{inserted:1,observed:1,duplicates:0,archiveId:'archive-one'},publications:[{advertisementId:'ad-one',excerpt:'Тестовая публикация',publishedAt:null,observedAt:'2026-10-19T10:00:01Z'}],events:[]};
const jobView=(overrides={})=>({page:{items:[job],total:1,nextCursor:null,checkedAt:'2026-10-19T10:00:02Z'},sources:[source],selected:job,filters:{state:'',kind:'',sourceId:''},before:null,...overrides});
test('source forms convert booleans explicitly and preserve server environment names without token values',()=>{
 const input=sourceInputFromValues({...source,enabled:'false',intervalMinutes:'90',tokenEnv:' SAQ_SOURCE_TEST_TOKEN ',expectedUpdatedAt:'one'});assert.equal(input.enabled,false);assert.equal(input.intervalMinutes,90);assert.equal(input.tokenEnv,'SAQ_SOURCE_TEST_TOKEN');assert.equal(input.expectedUpdatedAt,'one');assert.throws(()=>sourceInputFromValues({...source,enabled:'yes'}));
});
test('unsaved source edits and stale versions invalidate manual runs',()=>{
 const values={...source,enabled:'true',expectedUpdatedAt:source.updatedAt},saved=JSON.stringify(sourceInputFromValues(values));assert.equal(sourceFormChanged(values,saved),false);
 for(const patch of [{url:'https://example.org/other'},{expectedUpdatedAt:'new-version'},{enabled:'false'},{intervalMinutes:'60'}])assert.equal(sourceFormChanged({...values,...patch},saved),true);
});
test('source setup and new-source state do not imply active collection or native social integration',()=>{
 setLocale('ru');assert.doesNotMatch(renderSources(null),/id="collection-source-form"/u);const html=renderSources({sources:[],selected:null});assert.match(html,/Новый источник/u);assert.match(html,/value="false" selected/u);assert.match(html,/не подключает её нативный API/u);assert.doesNotMatch(html,/data-action="source-run"/u);
});
test('source details distinguish missing credentials from unverified configured credentials',()=>{
 setLocale('ru');let html=renderSources({sources:[source],selected:{...source,tokenStatus:'MISSING',tokenEnv:'SAQ_SOURCE_TEST_TOKEN'}});assert.match(html,/переменная доступа на сервере отсутствует/iu);html=renderSources({sources:[source],selected:{...source,tokenStatus:'CONFIGURED'}});assert.match(html,/корректность токена не проверена/u);
});
test('source names and URLs are escaped throughout configuration and selection links',()=>{
 setLocale('ru');const malicious={...source,name:'<script>attack</script>'};const html=renderSources({sources:[malicious],selected:malicious});assert.match(html,/&lt;script&gt;attack/u);assert.doesNotMatch(html,/<script>/u);assert.equal(sourceRoute('one?two'),'/settings?section=sources&source=one%3Ftwo');
});
test('queue filters and pagination preserve exact filter state with encoded identifiers',()=>{
 setLocale('ru');const html=renderJobs(jobView({filters:{state:'SUCCEEDED',kind:'COLLECT_SOURCE',sourceId:'source-one'},page:{items:[job],total:30,nextCursor:'cursor-one',checkedAt:'2026-10-19T10:00:02Z'}}));assert.match(html,/value="SUCCEEDED" selected/u);assert.match(html,/sourceId=source-one/u);assert.match(html,/before=cursor-one/u);assert.equal(jobRoute({job:'one?two'}),'/settings?section=jobs&job=one%3Ftwo');
});
test('successful collection links to its new publications and raw archive without fabricating publication dates',()=>{
 setLocale('ru');const html=renderJobs(jobView());assert.match(html,/Дата публикации неизвестна/u);assert.match(html,/\/advertisements\/ad-one/u);assert.match(html,/\/api\/admin\/jobs\/job-one\/archive/u);assert.match(html,/Архив ответа не является скриншотом/u);assert.doesNotMatch(html,/data-action="job-retry"/u);
});
test('retry controls respect terminal state and disabled sources while pending retries explain their schedule',()=>{
 setLocale('ru');const failed={...job,state:'FAILED',result:null,lastError:'Тестовая ошибка',errorCode:'SOURCE_PROCESSING_ERROR'};assert.match(renderJobs(jobView({selected:failed})),/data-action="job-retry"/u);assert.match(renderJobs(jobView({selected:failed,sources:[{...source,enabled:false}]})),/data-job-id="job-one" disabled/u);
 const pending={...failed,state:'PENDING',attempts:2};const html=renderJobs(jobView({selected:pending}));assert.match(html,/Повтор выполнится автоматически/u);assert.doesNotMatch(html,/data-action="job-retry"/u);
});
test('publication archive metadata is optional, escaped and explicit about unknown dates',()=>{
 setLocale('ru');assert.equal(renderCollectedArchive({id:'manual'}),'');const html=renderCollectedArchive({id:'ad-one',collection:{sourceName:'<script>attack</script>',observedAt:'2026-10-19T10:00:00Z',publishedAt:null,sha256:'a'.repeat(64)}});assert.match(html,/Дата неизвестна/u);assert.match(html,/&lt;script&gt;attack/u);assert.doesNotMatch(html,/<script>/u);assert.match(html,/\/api\/ads\/ad-one\/archive/u);
 const listed=renderAdvertisements([{id:'ad-one',platform:'QA',text:'Тестовая публикация',publicationDate:'2026-10-19',publicationDateBasis:'OBSERVED',observedAt:'2026-10-19T10:00:00Z',linkStatus:'NEW'}],'',{},[]);assert.match(listed,/Дата публикации неизвестна/u);assert.match(listed,/Наблюдение:/u);
});
test('source and queue labels are localized while saved source records remain unchanged',()=>{
 setLocale('kz');try{assert.match(renderSources({sources:[source],selected:source}),/Жарияланым дереккөздері/u);const html=renderJobs(jobView());assert.match(html,/Жинау және талдау кезегі/u);assert.match(html,/Тестовый источник/u);assert.match(html,/Жарияланым күні белгісіз/u);}finally{setLocale('ru');}
});
