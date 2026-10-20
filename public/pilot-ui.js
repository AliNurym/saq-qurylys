import { escapeHtml as e, formatDate,localeText } from "./components.js";
import {renderRoutingCalendar} from './calendar-ui.js';
import {renderCollectedArchive} from './collection-ui.js';

export const L = localeText;
export function renderLogin() {
  return '<main class="login-page"><h1>SAQ QURYLYS</h1><p>' + e(L("Вход сотрудника", "Қызметкердің кіруі")) + '</p><form id="login-form"><div class="field"><label for="login-username">' + e(L("Имя пользователя", "Пайдаланушы аты")) + '</label><input id="login-username" name="username" autocomplete="username" required></div><div class="field"><label for="login-password">' + e(L("Пароль", "Құпиясөз")) + '</label><input id="login-password" name="password" type="password" autocomplete="current-password" required maxlength="200"></div><button class="button button-primary" type="submit">' + e(L("Войти", "Кіру")) + '</button><p id="login-error" role="alert"></p></form></main>';
}
const groups = [
  ["Участок и организация", "Учаске және ұйым", [
    ["district", "Район", "Аудан"], ["cadastralNumber", "Кадастровый номер", "Кадастр нөмірі"],
    ["landPurpose", "Назначение участка", "Учаскенің мақсаты"], ["authorizedCompany", "Уполномоченная компания", "Уәкілетті компания"],
    ["director", "Руководитель", "Басшы"], ["founders", "Учредители", "Құрылтайшылар"]]],
  ["Документы и сроки", "Құжаттар мен мерзімдер", [
    ["constructionNotice", "Уведомление о начале СМР", "ҚМЖ бастау хабарламасы"], ["designDocumentation", "ПСД", "ЖСҚ"],
    ["expertConclusion", "Заключение экспертизы", "Сараптама қорытындысы"], ["permitDetails", "Разрешение на привлечение денег", "Ақша тартуға рұқсат"],
    ["guaranteeDetails", "Гарантия", "Кепілдік"], ["plannedCommissioning", "Проектный срок ввода", "Жобалық іске қосу мерзімі"],
    ["forecastCommissioning", "Прогноз ввода", "Іске қосу болжамы"]]],
  ["Связанные сведения", "Байланысты мәліметтер", [
    ["salesOffices", "Отделы продаж", "Сату бөлімдері"], ["websites", "Сайты", "Сайттар"], ["bankDetails", "Банковские реквизиты", "Банк деректемелері"],
    ["previousViolations", "Ранее выявленные нарушения", "Бұрын анықталған бұзушылықтар"], ["paymentScheme", "Схема оплаты и вид договора", "Төлем сызбасы және шарт түрі"],
    ["paymentEvidence", "Подтверждённые платежи и источники", "Расталған төлемдер мен дереккөздер"]]],
  ["Ручная сверка реестров", "Тізілімдерді қолмен тексеру", [
    ["kazreestr", "Казреестр: результат и источник", "Қазтізілім: нәтиже және дереккөз"],
    ["mioRegistry", "Реестр МИО: результат и источник", "ЖАО тізілімі: нәтиже және дереккөз"],
    ["landRegistry", "Земельный кадастр: результат и источник", "Жер кадастры: нәтиже және дереккөз"],
    ["dduRegistry", "Регистрация ДДУ: результат и источник", "ҮҚШ тіркеуі: нәтиже және дереккөз"]]],
];

export function renderPassport(complex) {
  const passport = complex.passport ?? {};
  return '<form id="passport-form" data-complex-id="' + e(complex.id) + '"><input type="hidden" name="expectedUpdatedAt" value="' + e(complex.updatedAt) + '">' +
    (complex.isDemo ? '<p class="callout warning" role="note">' + e(L("Демо-сценарий: паспорт, источники, даты и статусы вымышлены. Госреестры не проверялись; эти сведения нельзя использовать как факты о реальном ЖК.", "Демо-сценарий: паспорт, дереккөздер, күндер және мәртебелер ойдан шығарылған. Мемлекеттік тізілімдер тексерілмеген; бұл мәліметтерді нақты ТК туралы факт ретінде қолдануға болмайды.")) + '</p>' : '') +
    '<p class="form-help">' + e(L("Сведения вносятся вручную. Незаполненное поле означает, что данные не внесены. Автоматические подключения к реестрам отсутствуют.", "Мәліметтер қолмен енгізіледі. Бос өріс — деректер енгізілмеген. Тізілімдерге автоматты қосылу жоқ.")) + '</p>' +
    '<p>' + e(complex.objectNumber) + ' · ' + e(L("Публикаций за 7 дней: ", "7 күндегі жарияланымдар: ")) + complex.advertisementsLast7Days + '</p>' +
    (passport.registryImport ? '<p class="form-help">' + e(L("Импортировано из: ","Импорт дереккөзі: ") + passport.registryImport.source + ' · ' + passport.registryImport.sourceDate + ' · ' + L("Загружено: ","Жүктелді: ") + formatDate(passport.registryImport.importedAt,{withTime:true})) + '. ' + e(L("Импорт сам по себе не подтверждает сведения.","Импорт мәліметтердің расталуын білдірмейді.")) + '</p>' : '') +
    (complex.monitoring ? '<p class="form-help">' + e(L("Пересчёт сохранённых сведений: ","Сақталған мәліметтерді қайта есептеу: ")+formatDate(complex.monitoring.lastRunAt,{withTime:true})) + ' · ' + e(complex.monitoring.nextRunAt ? L("Следующий: ","Келесі: ")+formatDate(complex.monitoring.nextRunAt) : L("Красная зона: немедленная внутренняя очередь","Қызыл аймақ: дереу ішкі кезек")) + '</p>' : '') +
    '<section class="passport-section"><h2>' + e(L("Проверка готовности","Дайындықты тексеру")) + '</h2><div class="form-grid">' + ["declared","verified"].map(prefix=>'<fieldset class="readiness-fields"><legend>'+e(prefix === "declared" ? L("Заявлено в рекламе","Жарнамада көрсетілген") : L("Подтверждено источником","Дереккөзбен расталған"))+'</legend><div class="field"><label for="'+prefix+'-pct">'+e(L("Готовность, %","Дайындық, %"))+'</label><input id="'+prefix+'-pct" name="'+prefix+'CompletionPercentage" type="number" min="0" max="100" step="0.1" value="'+e(complex[prefix+'CompletionPercentage'] ?? '')+'"></div><div class="field"><label for="'+prefix+'-source">'+e(L("Источник","Дереккөз"))+'</label><input id="'+prefix+'-source" name="'+prefix+'CompletionSource" maxlength="500" value="'+e(complex[prefix+'CompletionSource'] || '')+'"></div><div class="field"><label for="'+prefix+'-date">'+e(L("Дата фиксации","Тіркеу күні"))+'</label><input id="'+prefix+'-date" name="'+prefix+'CompletionCapturedAt" type="date" value="'+e((complex[prefix+'CompletionCapturedAt'] || '').slice(0,10))+'"></div></fieldset>').join('')+'</div><p class="form-help">'+e(L("Изменение значений снимает подтверждение R5 и требует новой проверки источников.","Мәндер өзгергенде R5 растауы алынып, дереккөздерді қайта тексеру қажет."))+'</p></section>' +
    groups.map(([ru,kz,fields]) => '<section class="passport-section"><h2>' + e(L(ru,kz)) + '</h2><div class="form-grid">' + fields.map(([key,r,k]) =>
      '<div class="field"><label for="passport-' + key + '">' + e(L(r,k)) + '</label><textarea id="passport-' + key + '" name="' + key + '" maxlength="2000" rows="2">' + e(passport.fields?.[key] || '') + '</textarea></div>').join('') + '</div></section>').join('') +
    '<section class="passport-section"><div class="field"><label for="passport-source">' + e(L("Источник сведений", "Мәліметтер дереккөзі")) + '</label><input id="passport-source" name="source" maxlength="500" required value="' + e(passport.source || '') + '"></div>' +
    (passport.checkedAt ? '<p class="form-help">' + e(L("Последняя ручная сверка: ", "Соңғы қолмен тексеру: ") + formatDate(passport.checkedAt,{withTime:true})) + '</p>' : '') +
    '<button type="submit" class="button button-primary">' + e(L("Сохранить паспорт", "Паспортты сақтау")) + '</button><p class="form-help" role="status" id="passport-save-status"></p></section></form>';
}

export function renderNewComplex() {
  const fields=[["name","Название ЖК","ТК атауы"],["city","Город","Қала"],["address","Адрес","Мекенжай"],["developerName","Застройщик","Құрылыс салушы"],["developerBin","БИН, 12 цифр","БСН, 12 сан"],["latitude","Широта","Ендік"],["longitude","Долгота","Бойлық"]];
  return '<header class="page-heading"><div><h1>'+e(L("Добавить объект","Нысан қосу"))+'</h1><p>'+e(L("Новый объект реестра. Правовое основание останется непроверенным до отдельной верификации.","Тізілімнің жаңа нысаны. Құқықтық негіз жеке тексеруге дейін расталмаған болып қалады."))+'</p></div></header><section class="panel"><div class="panel-body"><form id="new-complex-form" class="form-grid">'+fields.map(([key,ru,kz])=>'<div class="field"><label for="new-'+key+'">'+e(L(ru,kz))+'</label><input id="new-'+key+'" name="'+key+'" required maxlength="300"'+(["latitude","longitude"].includes(key)?' type="number" step="any"':'')+(key==='developerBin'?' pattern="[0-9]{12}" minlength="12"':'')+'></div>').join('')+'<div class="form-actions span-2"><button type="submit" class="button button-primary">'+e(L("Создать и заполнить паспорт","Жасап, паспортты толтыру"))+'</button></div></form></div></section>';
}

export function renderEvidence(ad) {
  return '<section class="panel evidence-archive"><header class="panel-header"><h2 class="panel-title">' + e(L("Сохранённые снимки", "Сақталған суреттер")) + '</h2></header><div class="panel-body">' +
    renderCollectedArchive(ad) + ((ad.riskPhrases ?? []).length ? '<p>' + e(L("Формулировки словаря для проверки: ","Тексеруге арналған сөздік тіркестері: ")) + ad.riskPhrases.map(item=>'<mark>'+e(item.phrase)+'</mark>').join(' · ') + '</p>' : '') +
    (ad.sourceStatus === "REMOVED" ? '<p class="callout warning">' + e(L("Удаление в источнике отмечено вручную. Текст и снимки сохранены.", "Дереккөзден жою қолмен белгіленді. Мәтін мен суреттер сақталған.")) + '</p>' :
      '<button type="button" class="button button-secondary" data-action="source-removed" data-ad-id="' + e(ad.id) + '">' + e(L("Отметить удаление в источнике", "Дереккөзден жоюды белгілеу")) + '</button>') +
    (ad.evidenceFiles ?? []).map((file) => '<figure><a href="/api/evidence/' + e(file.id) + '" target="_blank" rel="noopener"><img class="evidence-image" src="/api/evidence/' + e(file.id) + '" alt="' + e(L("Сохранённый снимок публикации", "Жарияланымның сақталған суреті")) + '"></a><figcaption>' + e(formatDate(file.capturedAt,{withTime:true})) + '<br><span class="evidence-hash">SHA-256: ' + e(file.sha256) + '</span></figcaption></figure>').join('') +
    '<form id="evidence-form" data-ad-id="' + e(ad.id) + '"><div class="field"><label for="evidence-file">' + e(L("Добавить снимок PNG или JPEG, до 700 КБ", "PNG немесе JPEG суреті, 700 КБ дейін")) + '</label><input type="file" id="evidence-file" accept="image/png,image/jpeg" required></div><p class="form-help">' + e(L("Сохраняется копия загруженного файла с временем фиксации и контрольной суммой. Содержимое после сохранения не изменяется.", "Файл көшірмесі уақыт белгісі және бақылау сомасымен сақталады. Сақталған мазмұн өзгертілмейді.")) + '</p><button class="button button-primary" type="submit">' + e(L("Сохранить снимок", "Суретті сақтау")) + '</button></form></div></section>';
}

export function renderSignalWorkflow(signal) {
  const fields = signal.complex.passport?.fields ?? {};
  const imported = signal.complex.passport?.verificationMode === "IMPORTED_UNVERIFIED";
  const verificationMode = signal.complex.passport?.verificationMode;
  const passportSource = signal.complex.passport?.source;
  const passportCheckedAt = signal.complex.passport?.checkedAt;
  const routing = signal.routing ?? {};
  const show = (key) => e(fields[key] || L("Не внесено", "Енгізілмеген"));
  const section = (title, body) => '<section class="report-section"><h2>' + e(title) + '</h2>' + body + '</section>';
  const registryNote = verificationMode === "DEMO_SCENARIO"
    ? L("Это синтетические значения; государственной сверки не было.", "Бұл синтетикалық мәндер; мемлекеттік тексеру жүргізілген жоқ.")
    : imported
      ? L("Поля загружены из CSV и ещё не подтверждены ручной сверкой.", "Өрістер CSV файлынан жүктелді және қолмен тексеру әлі расталмады.")
      : verificationMode === "MANUAL"
        ? L("Сведения внесены вручную. Государственные реестры не подключены; текст в поле не является автоматическим ответом реестра.", "Мәліметтер қолмен енгізілді. Мемлекеттік тізілімдер қосылмаған; өрістегі мәтін тізілімнің автоматты жауабы емес.")
        : L("Проверка реестров не зафиксирована.", "Тізілім тексеруі тіркелмеген.");
  const recipients = { MIO: L("МИО", "ЖАО"), GASK: L("ГАСК", "МСҚБ"), LAW_ENFORCEMENT: L("Правоохранительный орган", "Құқық қорғау органы") };
  return (signal.complex.isDemo ? '<p class="callout warning" role="note">' + e(L("Демо-сценарий: паспорт, правовые статусы, публикации и решения синтетические; официальные источники не подключены.", "Демо-сценарий: паспорт, құқықтық мәртебелер, жарияланымдар мен шешімдер синтетикалық; ресми дереккөздер қосылмаған.")) + '</p>' : '') +
    section(L("Паспорт объекта", "Нысан паспорты"), '<p>' + e(signal.complex.objectNumber) + '</p><dl class="info-list">' +
    [["cadastralNumber","Участок","Учаске"],["director","Руководитель","Басшы"],["founders","Учредители","Құрылтайшылар"]].map(([key,ru,kz]) => '<div class="info-row"><dt>' + e(L(ru,kz)) + '</dt><dd>' + show(key) + '</dd></div>').join('') + '</dl>') +
    section(L("Сведения о проверке реестров", "Тізілім тексеруі туралы мәліметтер"), '<p class="form-help">' + e(registryNote) + '</p>' + (passportSource || passportCheckedAt ? '<p class="form-help">' + e(L("Общий источник паспорта: ","Паспорттың жалпы дереккөзі: ")) + e(passportSource || L("не указан","көрсетілмеген")) + (passportCheckedAt ? ' · ' + e(L("Записано: ","Жазылған күні: ")) + e(formatDate(passportCheckedAt,{withTime:true})) : '') + '</p>' : '') + '<dl class="info-list">' +
      [["kazreestr","Казреестр"],["mioRegistry",L("Реестр МИО","ЖАО тізілімі")],["landRegistry",L("Земельный кадастр","Жер кадастры")],["dduRegistry",L("Регистрация ДДУ","ҮҚШ тіркеуі")]].map(([key,name]) => '<div class="info-row"><dt>' + e(name) + '</dt><dd>' + show(key) + '</dd></div>').join('') + '</dl>') +
    section(L("Схема привлечения и платежи", "Ақша тарту сызбасы және төлемдер"), '<p>' + show("paymentScheme") + '</p><p>' + show("paymentEvidence") + '</p>') +
    section(L("Предлагаемые мероприятия", "Ұсынылатын шаралар"), '<ul>' + (signal.contextSnapshot?.proposedActions ?? []).map((item) => '<li>' + e(item) + '</li>').join('') + '</ul>') +
    section(L("Маршрут и результат реагирования", "Бағыт және әрекет нәтижесі"), '<p class="form-help">' + e(L("Внутренняя очередь приложения. Внешняя отправка не выполняется.", "Қолданбаның ішкі кезегі. Сыртқа жіберілмейді.")) + '</p>' +
      (routing.assignedAt ? '<dl class="info-list"><div class="info-row"><dt>' + e(L("Получатель","Алушы")) + '</dt><dd>' + e(recipients[routing.recipient]) + '</dd></div><div class="info-row"><dt>' + e(L("Срок ответа","Жауап мерзімі")) + '</dt><dd>' + e(formatDate(routing.dueDate)) + '</dd></div></dl><p>' + e(routing.reason) + '</p>' + renderRoutingCalendar(routing) +
        (signal.overdue ? '<p class="callout danger">' + e(L("Срок реагирования истёк", "Жауап мерзімі өтіп кетті")) + '</p>' : '') +
        (routing.result ? '<p>' + e(routing.result) + '</p><p>' + e(formatDate(routing.respondedAt,{withTime:true})) + '</p>' : signal.status === "CONFIRMED" ?
          '<p class="form-help">'+e(L('Результат вносит назначенный орган-получатель. До ответа карточка не архивируется.','Нәтижені тағайындалған алушы орган енгізеді. Жауап келгенше карточка мұрағатталмайды.'))+'</p><form id="signal-response-form" data-recipient="' + e(routing.recipient) + '" data-signal-id="' + e(signal.id) + '"><label class="field" for="response-result">' + e(L("Результат реагирования","Әрекет нәтижесі")) + '<textarea id="response-result" name="result" minlength="5" maxlength="4000" required></textarea></label><button class="button button-primary" type="submit">' + e(L("Зафиксировать результат","Нәтижені тіркеу")) + '</button></form>' : '') :
        ["NEEDS_REVIEW","CONFIRMED"].includes(signal.status) ? '<form id="signal-route-form" data-signal-id="' + e(signal.id) + '"><div class="field"><label for="route-recipient">' + e(L("Орган-получатель","Алушы орган")) + '</label><select id="route-recipient" name="recipient">' + Object.entries(recipients).map(([key,name]) => '<option value="' + key + '">' + e(name) + '</option>').join('') + '</select></div><div class="field"><label for="route-reason">' + e(L("Основание передачи","Жіберу негізі")) + '</label><textarea id="route-reason" name="reason" minlength="5" maxlength="2000" required></textarea></div><button class="button button-primary" type="submit">' + e(L("Подтвердить и передать во внутреннюю очередь","Растап, ішкі кезекке жіберу")) + '</button></form>' : ''));
}
