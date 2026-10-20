import {escapeHtml as e,formatDate,localeText as L} from './components.js';
import {queryString} from './api.js';

export const calendarRoute=values=>'/settings'+queryString({section:'calendar',...values});
const validDate=value=>typeof value==='string'&&value>='2010-01-01'&&value<='9998-12-31'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const row=(label,value)=>'<div><dt>'+e(label)+'</dt><dd>'+e(value??'—')+'</dd></div>';

export function parseCalendarDateLines(value) {
  if(typeof value!=='string')throw new Error(L('Укажите даты по одной в строке.','Әр күнді жеке жолға енгізіңіз.'));
  const dates=value.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
  if(dates.length>1000)throw new Error(L('Допустимо до 1000 дат в каждом списке.','Әр тізімде 1000 күнге дейін рұқсат етілген.'));
  const invalid=dates.find(day=>!validDate(day));
  if(invalid)throw new Error(L('Некорректная дата: ','Қате күн: ')+invalid+L('. Используйте ГГГГ-ММ-ДД.','. ЖЖЖЖ-АА-КК пішімін қолданыңыз.'));
  if(new Set(dates).size!==dates.length)throw new Error(L('Даты в списке не должны повторяться.','Тізімдегі күндер қайталанбауы керек.'));
  return dates;
}

export function calendarDraftFromValues(values) {
  return {source:String(values.source??'').trim(),sourceDate:values.sourceDate,coverage:{from:values.coverageFrom,to:values.coverageTo},nonWorkingDates:parseCalendarDateLines(values.nonWorkingDates??''),workingDates:parseCalendarDateLines(values.workingDates??'')};
}
export const calendarDraftKey=values=>JSON.stringify({draft:calendarDraftFromValues(values),expectedVersion:values.expectedVersion,startDate:values.previewStartDate});
export function calendarPreviewMatches(values,preview) {
  if(!preview||preview.mode!=='DRAFT'||! /^[a-f0-9]{64}$/u.test(preview.draftSha256??''))return false;
  try{return preview.formKey===calendarDraftKey(values);}catch{return false;}
}

export function renderCalendarPreview(result) {
  return '<h3>'+e(L('Расчёт по черновику','Жоба бойынша есеп'))+'</h3><p>'+e(L('Назначение: ','Тағайындау: ')+formatDate(result.startDate)+L(' → срок ответа: ',' → жауап мерзімі: ')+formatDate(result.dueDate))+'</p><p class="calendar-note">'+e(L('Пять рабочих дней после дня назначения. Черновик ещё не опубликован.','Тағайындалған күннен кейінгі бес жұмыс күні. Жоба әлі жарияланбаған.'))+'</p>'+
    (result.active?'<p class="calendar-note">'+e(result.active.error?L('Действующий календарь: ','Қолданыстағы күнтізбе: ')+result.active.error:L('По действующим настройкам: ','Қолданыстағы баптаулар бойынша: ')+formatDate(result.active.dueDate)+(result.active.configured?'':L(' (резервный режим)',' (резервтік режим)')))+'</p>':'')+
    '<p class="calendar-note">'+e(L('Расчёт проверяет правила и покрытие дат. Достоверность источника подтверждает администратор.','Есеп ережелер мен күндердің қамтылуын тексереді. Дереккөздің дұрыстығын әкімші растайды.'))+'</p>';
}

export function updateCalendarPreview(form,preview) {
  const values=Object.fromEntries(new FormData(form)),matches=calendarPreviewMatches(values,preview)&&values.expectedVersion===form.dataset.activeVersion;
  const output=form.querySelector('#calendar-preview-result'),publish=form.querySelector('#calendar-publish');
  if(output){output.hidden=!matches;output.innerHTML=matches?renderCalendarPreview(preview):'';}
  if(publish)publish.disabled=!matches;
  return matches;
}

export function fillCalendarDraft(form,definition) {
  const values={source:definition.source??'',sourceDate:definition.sourceDate??'',coverageFrom:definition.coverage?.from??'',coverageTo:definition.coverage?.to??'',nonWorkingDates:(definition.nonWorkingDates??[]).join('\n'),workingDates:(definition.workingDates??[]).join('\n')};
  for(const [name,value] of Object.entries(values)){const field=form.elements.namedItem(name);if(field)field.value=value;}
}

function definitionDetails(definition) {
  return '<dl class="calendar-facts">'+row(L('Источник','Дереккөз'),definition.source)+row(L('Дата источника','Дереккөз күні'),formatDate(definition.sourceDate))+row(L('Период действия','Қолданылу кезеңі'),definition.coverage?formatDate(definition.coverage.from)+' — '+formatDate(definition.coverage.to):L('Не задан','Белгіленбеген'))+row(L('Обычные выходные','Әдеттегі демалыс'),L('Суббота и воскресенье','Сенбі және жексенбі'))+row(L('Нерабочие даты','Жұмыс істемейтін күндер'),definition.nonWorkingDates.length?definition.nonWorkingDates.join('\n'):L('Нет исключений','Ерекшеліктер жоқ'))+row(L('Рабочие переносы','Жұмыс күндері'),definition.workingDates.length?definition.workingDates.join('\n'):L('Нет исключений','Ерекшеліктер жоқ'))+'</dl>';
}

function editor(active) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return '<section id="calendar-editor" class="calendar-section"><h2>'+e(L('Подготовить новую версию','Жаңа нұсқаны дайындау'))+'</h2><p class="calendar-note">'+e(L('Введите проверенный источник, период и исключения. Пустой список означает отсутствие исключений, а не автоматическую загрузку праздников. Старые назначения сохранят прежний календарь.','Тексерілген дереккөзді, кезеңді және ерекшеліктерді енгізіңіз. Бос тізім мерекелердің автоматты жүктелуін емес, ерекшеліктердің жоқтығын білдіреді. Бұрынғы тағайындаулар бұрынғы күнтізбені сақтайды.'))+'</p>'+
    '<form id="calendar-form" class="access-form calendar-form" data-active-version="'+e(active.version)+'"><input type="hidden" id="calendar-expected-version" name="expectedVersion" value="'+e(active.version)+'"><div class="field"><label for="calendar-source">'+e(L('Источник календаря','Күнтізбе дереккөзі'))+'</label><textarea id="calendar-source" name="source" maxlength="1000" rows="2" required>'+e(active.source??'')+'</textarea></div><div class="form-grid">'+
    '<div class="field"><label for="calendar-source-date">'+e(L('Дата источника или сверки','Дереккөздің не тексерудің күні'))+'</label><input id="calendar-source-date" name="sourceDate" type="date" max="'+today+'" value="'+e(active.sourceDate??'')+'" required></div><div></div>'+
    '<div class="field"><label for="calendar-from">'+e(L('Период: с','Кезең: бастап'))+'</label><input id="calendar-from" name="coverageFrom" type="date" min="2010-01-01" max="9998-12-31" value="'+e(active.coverage?.from??'')+'" required></div>'+
    '<div class="field"><label for="calendar-to">'+e(L('Период: по','Кезең: дейін'))+'</label><input id="calendar-to" name="coverageTo" type="date" min="2010-01-01" max="9998-12-31" value="'+e(active.coverage?.to??'')+'" required></div>'+
    '<div class="field"><label for="calendar-non-working">'+e(L('Дополнительные нерабочие даты','Қосымша жұмыс істемейтін күндер'))+'</label><textarea id="calendar-non-working" name="nonWorkingDates" rows="6" maxlength="12000" aria-describedby="calendar-dates-help">'+e(active.nonWorkingDates.join('\n'))+'</textarea></div>'+
    '<div class="field"><label for="calendar-working">'+e(L('Рабочие переносы, включая выходные','Демалысты қоса алғанда жұмыс күндері'))+'</label><textarea id="calendar-working" name="workingDates" rows="6" maxlength="12000" aria-describedby="calendar-dates-help">'+e(active.workingDates.join('\n'))+'</textarea></div></div><p id="calendar-dates-help" class="form-help">'+e(L('По одной дате ГГГГ-ММ-ДД в строке, до 1000 дат в каждом списке. Одна дата не может быть рабочей и нерабочей одновременно.','Әр жолға ЖЖЖЖ-АА-КК пішіміндегі бір күн, әр тізімде 1000 күнге дейін. Бір күн бір мезгілде жұмыс және демалыс күні бола алмайды.'))+'</p>'+
    '<fieldset><legend>'+e(L('Проверка пятидневного срока','Бес күндік мерзімді тексеру'))+'</legend><div class="field"><label for="calendar-preview-start">'+e(L('Дата назначения для проверки','Тексеруге арналған тағайындау күні'))+'</label><input id="calendar-preview-start" name="previewStartDate" type="date" min="2010-01-01" max="9998-12-31" value="'+today+'" required></div><p class="form-help">'+e(L('День назначения не входит в пять рабочих дней. Покрытие должно включать все дни до результата.','Тағайындалған күн бес жұмыс күніне кірмейді. Қамту нәтижеге дейінгі барлық күндерді қамтуы керек.'))+'</p></fieldset>'+
    '<div class="calendar-preview-result" id="calendar-preview-result" role="status" hidden></div><p data-calendar-status class="calendar-form-status" role="status"></p><div class="access-form-actions"><button type="button" id="calendar-preview-button" class="button button-secondary" data-action="calendar-preview">'+e(L('Проверить расчёт','Есепті тексеру'))+'</button><button type="submit" id="calendar-publish" class="button button-primary" disabled>'+e(L('Опубликовать версию','Нұсқаны жариялау'))+'</button><button type="button" class="button button-secondary" data-action="calendar-refresh" hidden>'+e(L('Обновить настройки','Баптауларды жаңарту'))+'</button></div><p class="form-help">'+e(L('Публикация станет действующей для новых назначений. Перед публикацией обязателен успешный расчёт текущего черновика.','Жарияланған нұсқа жаңа тағайындауларға қолданылады. Жариялауға дейін ағымдағы жоба есебі сәтті аяқталуы тиіс.'))+'</p></form></section>';
}

function history(view) {
  const {page,active,selected,before}=view;
  return '<section id="calendar-history" class="calendar-section"><h2>'+e(L('Сохранённые версии','Сақталған нұсқалар'))+' <span class="panel-meta">'+e(page.total)+'</span></h2><p class="calendar-note">'+e(L('Версии не редактируются. Просмотр прежней версии не меняет действующий календарь.','Нұсқалар өңделмейді. Бұрынғы нұсқаны қарау қолданыстағы күнтізбені өзгертпейді.'))+'</p>'+
    (page.items.length?'<nav class="calendar-version-list" aria-label="'+e(L('Версии календаря','Күнтізбе нұсқалары'))+'">'+page.items.map(item=>'<a data-route href="'+e(calendarRoute({version:item.version,before}))+'"'+(selected?.version===item.version?' aria-current="true"':'')+'><strong>'+e(formatDate(item.createdAt,{withTime:true}))+(item.version===active.version?' · '+e(L('Действующая','Қолданыстағы')):'')+'</strong><span>'+e(item.source)+'</span><span>'+e(item.createdBy)+'</span></a>').join('')+'</nav>':'<p>'+e(L('После первой публикации здесь появится история.','Бірінші жариялаудан кейін тарих осында пайда болады.'))+'</p>')+
    '<div class="calendar-pagination">'+(before?'<a class="text-link" data-route href="'+e(calendarRoute({}))+'">'+e(L('К новым версиям','Жаңа нұсқаларға'))+'</a>':'')+(page.nextCursor?'<a class="text-link" data-route href="'+e(calendarRoute({before:page.nextCursor}))+'">'+e(L('Предыдущие версии','Бұрынғы нұсқалар'))+'</a>':'')+'</div>'+
    (selected?'<article class="calendar-version-detail"><h3>'+e(selected.version===active.version?L('Содержание действующей версии','Қолданыстағы нұсқаның мазмұны'):L('Содержание выбранной версии','Таңдалған нұсқаның мазмұны'))+'</h3>'+definitionDetails(selected)+'<p class="calendar-note">'+e(selected.createdBy+' · '+formatDate(selected.createdAt,{withTime:true}))+'</p><details><summary>'+e(L('Версия и контрольная сумма','Нұсқа және бақылау сомасы'))+'</summary><dl class="calendar-facts">'+row(L('Версия','Нұсқа'),selected.version)+row('SHA-256',selected.sha256)+'</dl></details><button type="button" class="button button-secondary" data-action="calendar-copy" data-calendar-version="'+e(selected.version)+'">'+e(L('Скопировать в новый черновик','Жаңа жобаға көшіру'))+'</button></article>':'')+'</section>';
}

export function renderCalendar(view) {
  if(!view)return '<section class="panel"><div class="panel-body"><h2>'+e(L('Календарь рабочих дней','Жұмыс күндерінің күнтізбесі'))+'</h2><p>'+e(L('Сначала создайте администратора и войдите в систему.','Алдымен әкімшіні жасап, жүйеге кіріңіз.'))+'</p><a class="text-link" data-route href="/settings?section=users">'+e(L('Открыть учётные записи','Тіркелгілерді ашу'))+'</a></div></section>';
  const {active}=view;
  return '<div class="calendar-workspace"><header class="calendar-heading"><h2>'+e(L('Календарь рабочих дней','Жұмыс күндерінің күнтізбесі'))+'</h2><p class="calendar-note">'+e(L('Для сроков реагирования: пятидневная неделя, праздники и рабочие переносы.','Әрекет ету мерзімдеріне арналған: бес күндік апта, мерекелер және жұмыс күндерінің ауысуы.'))+'</p><div class="calendar-section-links"><a href="#calendar-editor">'+e(L('Новая версия','Жаңа нұсқа'))+'</a><a href="#calendar-history">'+e(L('История версий','Нұсқалар тарихы'))+'</a></div></header>'+
    '<section class="calendar-current"><h3>'+e(active.configured?L('Календарь опубликован','Күнтізбе жарияланған'):L('Используется резервный режим','Резервтік режим қолданылады'))+'</h3>'+(active.configured?'<p class="calendar-note">'+e(L('Источник: ','Дереккөз: ')+active.source)+'</p><p>'+e(formatDate(active.coverage.from)+' — '+formatDate(active.coverage.to))+'</p><p class="calendar-note">'+e(L('Нерабочих исключений: ','Жұмыс істемейтін ерекшеліктер: ')+active.nonWorkingDates.length+L(' · рабочих переносов: ',' · жұмыс күндерінің ауысуы: ')+active.workingDates.length)+'</p>':'<p class="calendar-note">'+e(L('Учитываются суббота, воскресенье и заданные сервером исключения. Официальный календарь праздников не настроен.','Сенбі, жексенбі және сервердегі ерекшеліктер ескеріледі. Ресми мерекелер күнтізбесі бапталмаған.'))+'</p>')+'</section>'+editor(active)+history(view)+'</div>';
}

export function renderRoutingCalendar(routing) {
  const definition=routing.calendarDefinition;
  return '<div class="calendar-routing"><p class="form-help">'+e(definition?.configured?L('Пять рабочих дней после дня назначения. Версия календаря сохранена при назначении.','Тағайындалған күннен кейінгі бес жұмыс күні. Күнтізбе нұсқасы тағайындау кезінде сақталды.'):definition?L('При назначении применён резервный режим: выходные и заданные исключения. Официальный календарь не был настроен.','Тағайындау кезінде резервтік режим қолданылды: демалыстар мен берілген ерекшеліктер. Ресми күнтізбе бапталмаған еді.'):L('Историческая версия календаря при назначении не была сохранена. Текущие настройки не подставляются.','Тағайындау кезіндегі күнтізбе нұсқасы сақталмаған. Ағымдағы баптаулар қосылмайды.'))+'</p>'+(definition?'<details><summary>'+e(L('Календарь назначения','Тағайындау күнтізбесі'))+'</summary><dl class="calendar-facts">'+row(L('Версия','Нұсқа'),routing.calendarVersion)+row(L('Источник','Дереккөз'),definition.source)+row(L('Дата источника','Дереккөз күні'),formatDate(definition.sourceDate))+'</dl></details>':'')+'</div>';
}
