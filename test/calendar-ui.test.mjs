import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCalendarDateLines,calendarDraftFromValues,calendarDraftKey,calendarPreviewMatches,renderCalendar,renderCalendarPreview,calendarRoute,renderRoutingCalendar} from '../public/calendar-ui.js';
import {renderSignalWorkflow} from '../public/pilot-ui.js';
import {renderSettings} from '../public/admin-ui.js';
import {setLocale} from '../public/i18n.js';
globalThis.document={documentElement:{lang:'ru'}};
const active={configured:false,version:'weekdays-one',source:null,sourceDate:null,coverage:null,nonWorkingDates:[],workingDates:[]};
const saved={...active,configured:true,version:'calendar-one',source:'Тестовый источник оператора',sourceDate:'2026-10-19',coverage:{from:'2026-10-01',to:'2026-12-31'},nonWorkingDates:['2026-10-26'],workingDates:['2026-10-24'],createdBy:'operator',createdAt:'2026-10-19T09:00:00Z',sha256:'a'.repeat(64)};
const values={source:saved.source,sourceDate:saved.sourceDate,coverageFrom:saved.coverage.from,coverageTo:saved.coverage.to,nonWorkingDates:'2026-10-26',workingDates:'2026-10-24',expectedVersion:active.version,previewStartDate:'2026-10-19'};
const view=(overrides={})=>({active,page:{items:[],total:0,nextCursor:null},selected:null,...overrides});

test('calendar date inputs preserve dates and reject duplicate, invalid and excessive lists',()=>{
 setLocale('ru');assert.deepEqual(parseCalendarDateLines(' 2026-10-26\r\n\n2026-12-16 '),['2026-10-26','2026-12-16']);assert.deepEqual(parseCalendarDateLines(''),[]);
 for(const input of ['2026-02-30','2026-10-26,2026-12-16','2009-12-31','2026-10-26\n2026-10-26',Array(1001).fill('2026-10-26').join('\n'),null])assert.throws(()=>parseCalendarDateLines(input));
 assert.deepEqual(parseCalendarDateLines('2028-02-29'),['2028-02-29']);
});
test('preview binding includes definition, measurement date and active version',()=>{
 const draft=calendarDraftFromValues(values);assert.deepEqual(draft.nonWorkingDates,['2026-10-26']);assert.equal(draft.coverage.to,'2026-12-31');
 const preview={mode:'DRAFT',draftSha256:'a'.repeat(64),formKey:calendarDraftKey(values)};assert.equal(calendarPreviewMatches(values,preview),true);
 for(const change of [{source:'Другой источник'},{previewStartDate:'2026-10-20'},{expectedVersion:'changed'},{nonWorkingDates:'2026-10-27'},{coverageTo:'2026-11-30'}])assert.equal(calendarPreviewMatches({...values,...change},preview),false);
 assert.equal(calendarPreviewMatches(values,{...preview,mode:'ACTIVE'}),false);assert.equal(calendarPreviewMatches(values,null),false);
});
test('unconfigured and demo calendars explain missing setup without pretending an official holiday feed',()=>{
 setLocale('ru');const html=renderCalendar(view());assert.match(html,/Используется резервный режим/u);assert.match(html,/Официальный календарь праздников не настроен/u);assert.match(html,/id="calendar-publish" class="button button-primary" disabled/u);assert.match(html,/После первой публикации/u);
 const demo=renderCalendar(null);assert.match(demo,/Сначала создайте администратора/u);assert.doesNotMatch(demo,/id="calendar-form"/u);
});
test('calendar preview distinguishes the draft from active rules and coverage failures',()=>{
 setLocale('ru');const result={startDate:'2026-10-19',dueDate:'2026-10-27',active:{dueDate:'2026-10-26',configured:false}};const html=renderCalendarPreview(result);assert.match(html,/Черновик ещё не опубликован/u);assert.match(html,/резервный режим/u);assert.match(html,/Достоверность источника подтверждает администратор/u);
 result.active={error:'Календарь не покрывает период'};assert.match(renderCalendarPreview(result),/не покрывает период/u);
});
test('immutable history shows the selected source, active marker and cursor links without HTML injection',()=>{
 setLocale('ru');const malicious={...saved,source:'<script>attack</script>'},html=renderCalendar(view({active:saved,selected:malicious,before:'cursor',page:{items:[malicious],total:12,nextCursor:'next-version'}}));
 assert.match(html,/Действующая/u);assert.match(html,/Скопировать в новый черновик/u);assert.match(html,/before=next-version/u);assert.match(html,/&lt;script&gt;attack/u);assert.doesNotMatch(html,/<script>/u);assert.equal(calendarRoute({version:'one?two'}),'/settings?section=calendar&version=one%3Ftwo');
});
test('routing uses the frozen calendar and differentiates configured, fallback and absent snapshots',()=>{
 setLocale('ru');const configured=renderRoutingCalendar({calendarDefinition:saved,calendarVersion:saved.version});assert.match(configured,/Версия календаря сохранена/u);assert.match(configured,/calendar-one/u);assert.match(configured,/Тестовый источник/u);
 assert.match(renderRoutingCalendar({calendarDefinition:active,calendarVersion:active.version}),/применён резервный режим/u);assert.match(renderRoutingCalendar({}),/Текущие настройки не подставляются/u);
 const signal={complex:{passport:{}},routing:{assignedAt:'2026-10-19T09:00:00Z',recipient:'GASK',dueDate:'2026-10-27',reason:'Проверка',calendarDefinition:saved,calendarVersion:saved.version},status:'CONFIRMED',id:'signal',contextSnapshot:{proposedActions:[]}};
 assert.match(renderSignalWorkflow(signal),/calendar-one/u);assert.doesNotMatch(renderSignalWorkflow(signal),/Праздничный календарь требует настройки/u);
});
test('calendar settings render a separate section without altering rule or employee forms',()=>{
 setLocale('ru');const settings={weights:{},dictionary:[]};const html=renderSettings(settings,[],{section:'calendar',calendar:view()});assert.match(html,/Рабочие дни/u);assert.match(html,/id="calendar-form"/u);assert.doesNotMatch(html,/id="settings-form"|id="create-user-form"/u);
});
test('calendar editor, preview and frozen assignment explanations are localized',()=>{
 setLocale('kz');try {const html=renderCalendar(view());assert.match(html,/Жұмыс күндерінің күнтізбесі/u);assert.match(html,/Есепті тексеру/u);assert.match(html,/Нұсқаны жариялау/u);assert.match(renderRoutingCalendar({}),/Ағымдағы баптаулар қосылмайды/u);}finally{setLocale('ru');}
});
