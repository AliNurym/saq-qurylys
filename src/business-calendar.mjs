import { randomUUID, createHash } from 'node:crypto';
import { inTransaction } from './db.mjs';
import { writeAudit } from './audit-service.mjs';
import { currentActor } from './access-service.mjs';
import { validPublicationDate } from './dates.mjs';

const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validCalendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value)||value<'2010-01-01'||value>'9998-12-31')return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
function dateList(value,label) {
  if(!Array.isArray(value)||value.length>1000||value.some(day=>!validCalendarDate(day)))fail(400,label+': укажите массив не более 1000 существующих дат ГГГГ-ММ-ДД.');
  if(new Set(value).size!==value.length)fail(400,label+': даты не должны повторяться.');
  return [...value].sort();
}

export function initializeBusinessCalendar(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS business_calendar_versions (
    version TEXT PRIMARY KEY, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS calendar_versions_no_update BEFORE UPDATE ON business_calendar_versions
      BEGIN SELECT RAISE(ABORT,'Calendar versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS calendar_versions_no_delete BEFORE DELETE ON business_calendar_versions
      BEGIN SELECT RAISE(ABORT,'Calendar versions are immutable'); END;`);
  const fields=['recipient','reason','assignedAt','approvedBy','dueDate','mode','calendar','calendarVersion','calendarDefinition'];
  db.exec(`CREATE TRIGGER IF NOT EXISTS signal_routing_assignment_immutable BEFORE UPDATE OF routing_json ON signals
    WHEN json_extract(OLD.routing_json,'$.assignedAt') IS NOT NULL AND
    (${fields.map(key=>`json_extract(NEW.routing_json,'$.${key}') IS NOT json_extract(OLD.routing_json,'$.${key}')`).join(' OR ')})
    BEGIN SELECT RAISE(ABORT,'Signal assignment is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS signal_routing_response_immutable BEFORE UPDATE OF routing_json ON signals
    WHEN json_extract(OLD.routing_json,'$.result') IS NOT NULL AND
    (${['result','respondedAt','recordedBy'].map(key=>`json_extract(NEW.routing_json,'$.${key}') IS NOT json_extract(OLD.routing_json,'$.${key}')`).join(' OR ')})
    BEGIN SELECT RAISE(ABORT,'Signal response is immutable'); END;`);
}

export function getBusinessCalendar(db) {
  const row=db.prepare("SELECT v.definition_json FROM app_settings s JOIN business_calendar_versions v ON v.version=json_extract(s.value_json,'$.version') WHERE s.id='business-calendar'").get();
  if(row)return JSON.parse(row.definition_json);
  if(db.prepare("SELECT 1 FROM app_settings WHERE id='business-calendar'").get())throw new Error('Configured calendar version is missing.');
  const dates=(process.env.SAQ_NON_WORKING_DATES||'').split(',').map(day=>day.trim()).filter(Boolean);
  const definition={schemaVersion:1,configured:false,weekendDays:[0,6],nonWorkingDates:dateList([...new Set(dates)],'SAQ_NON_WORKING_DATES'),workingDates:[],
    coverage:null,source:dates.length?'SAQ_NON_WORKING_DATES':null,sourceDate:null};
  const snapshot={...definition,version:'weekdays-'+hash(definition).slice(0,16)};
  return {...snapshot,sha256:hash(snapshot)};
}

export function listBusinessCalendars(db) {
  return listBusinessCalendarPage(db,{limit:100}).items;
}
export function listBusinessCalendarPage(db,{limit=20,before=null}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'История календаря: limit от 1 до 100.');
  const cursor=before?db.prepare('SELECT created_at,rowid FROM business_calendar_versions WHERE version=?').get(before):null;
  if(before&&!cursor)fail(400,'Версия курсора календаря не найдена.');
  const rows=db.prepare("SELECT version,created_at AS createdAt,created_by AS createdBy,json_extract(definition_json,'$.source') AS source,json_extract(definition_json,'$.sourceDate') AS sourceDate,json_extract(definition_json,'$.sha256') AS sha256 FROM business_calendar_versions"+
    (cursor?' WHERE (created_at,rowid)<(?,?)':'')+' ORDER BY created_at DESC,rowid DESC LIMIT ?').all(...(cursor?[cursor.created_at,cursor.rowid]:[]),limit+1);
  const items=rows.slice(0,limit);
  return {items,total:db.prepare('SELECT count(*) AS n FROM business_calendar_versions').get().n,nextCursor:rows.length>limit?items.at(-1).version:null};
}
export function getBusinessCalendarVersion(db,version) {
  const row=db.prepare('SELECT definition_json FROM business_calendar_versions WHERE version=?').get(version);
  return row?JSON.parse(row.definition_json):null;
}

export function validateCalendarDefinition(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Укажите объект определения календаря.');
  const nonWorkingDates=dateList(input.nonWorkingDates,'Нерабочие дни'),workingDates=dateList(input.workingDates,'Рабочие переносы');
  if(nonWorkingDates.some(day=>workingDates.includes(day)))fail(400,'Одна дата не может быть одновременно рабочей и нерабочей.');
  const coverage=input.coverage;
  if(!coverage || !validCalendarDate(coverage.from) || !validCalendarDate(coverage.to) || coverage.from>coverage.to
    || Date.parse(coverage.to)-Date.parse(coverage.from)>5*366*86400000)fail(400,'Укажите период календаря продолжительностью не более пяти лет.');
  if([...nonWorkingDates,...workingDates].some(day=>day<coverage.from||day>coverage.to))fail(400,'Все исключения должны входить в период календаря.');
  const source=typeof input.source==='string'?input.source.trim():'';
  if(!source || source.length>1000 || !validPublicationDate(input.sourceDate))fail(400,'Укажите источник календаря и существующую дату источника не позднее сегодняшней.');
  return {schemaVersion:1,configured:true,weekendDays:[0,6],nonWorkingDates,workingDates,coverage:{from:coverage.from,to:coverage.to},source,sourceDate:input.sourceDate};
}

export function previewBusinessCalendar(db,input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Укажите параметры проверки календаря.');
  const active=getBusinessCalendar(db),days=input.days??5;
  if(!Object.hasOwn(input,'draft'))return {dueDate:calculateBusinessDeadline(input.startDate,days,active),calendarVersion:active.version,configured:active.configured,mode:'ACTIVE',startDate:input.startDate,days};
  const draft=validateCalendarDefinition(input.draft);
  if(input.expectedVersion!==active.version)fail(409,'Календарь уже изменён. Обновите настройки.');
  const dueDate=calculateBusinessDeadline(input.startDate,days,draft);
  let comparison;
  try{comparison={dueDate:calculateBusinessDeadline(input.startDate,days,active),configured:active.configured,calendarVersion:active.version};}
  catch(error){if(error.statusCode!==409)throw error;comparison={error:error.message,configured:active.configured,calendarVersion:active.version};}
  return {dueDate,calendarVersion:active.version,configured:true,mode:'DRAFT',draftSha256:hash(draft),startDate:input.startDate,days,active:comparison};
}

export function saveBusinessCalendar(db,input={}) {
  const validated=validateCalendarDefinition(input);
  const {nonWorkingDates,workingDates,coverage,source,sourceDate}=validated;
  if(input.expectedDraftSha256!==undefined&&input.expectedDraftSha256!==hash(validated))fail(409,'Черновик календаря изменён. Повторите проверку расчёта.');
  return inTransaction(db,()=>{
    const before=getBusinessCalendar(db);
    if(input.expectedVersion!==before.version)fail(409,'Календарь уже изменён. Обновите настройки.');
    const now=new Date().toISOString(),definition={schemaVersion:1,configured:true,version:'calendar-'+randomUUID(),weekendDays:[0,6],
      nonWorkingDates,workingDates,coverage:{from:coverage.from,to:coverage.to},source,sourceDate,createdAt:now,createdBy:currentActor()};
    const next={...definition,sha256:hash(definition)};
    db.prepare('INSERT INTO business_calendar_versions VALUES (?,?,?,?)').run(next.version,JSON.stringify(next),now,currentActor());
    db.prepare("INSERT INTO app_settings VALUES ('business-calendar',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify({version:next.version}));
    writeAudit(db,'SYSTEM','business-calendar','BUSINESS_CALENDAR_UPDATED',{previousVersion:before.version,version:next.version,source,sourceDate:input.sourceDate,coverage:next.coverage,sha256:next.sha256});
    return next;
  });
}

export function calculateBusinessDeadline(start,count=5,calendar={}) {
  if(!validCalendarDate(start)||!Number.isInteger(count)||count<1||count>60)fail(400,'Укажите существующую начальную дату и срок 1–60 рабочих дней.');
  const nonWorking=new Set(dateList(calendar.nonWorkingDates??[],'Нерабочие дни'));
  const working=new Set(dateList(calendar.workingDates??[],'Рабочие переносы'));
  if([...working].some(day=>nonWorking.has(day)))fail(400,'В календаре есть противоречивые исключения.');
  const requireCovered=day=>{
    if(calendar.configured && (!calendar.coverage || day<calendar.coverage.from || day>calendar.coverage.to))fail(409,'Календарь не покрывает период рассмотрения. Опубликуйте календарь для нужных дат.');
  };
  requireCovered(start);
  const date=new Date(start+'T12:00:00Z');let remaining=count;
  for(let checked=0;remaining>0;checked++) {
    if(checked>=3660)fail(400,'В календаре не найден допустимый срок рассмотрения.');
    date.setUTCDate(date.getUTCDate()+1);const day=date.toISOString().slice(0,10);
    if(!validCalendarDate(day))fail(400,'Срок выходит за допустимый диапазон дат.');
    requireCovered(day);
    if(working.has(day)||(![0,6].includes(date.getUTCDay())&&!nonWorking.has(day)))remaining--;
  }
  return date.toISOString().slice(0,10);
}
