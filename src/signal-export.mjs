const escape = (value) => String(value ?? "—").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const date = (value) => value ? new Intl.DateTimeFormat("ru-KZ", { timeZone: "Asia/Qyzylorda", dateStyle: "medium", ...(value.length === 10 ? {} : { timeStyle: "short" }) }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value)) : "—";
const labels = { DRAFT: "Черновик", NEEDS_REVIEW: "Требует подтверждения", CONFIRMED: "Подтверждён", RETURNED: "Возвращён на доработку", ARCHIVED: "Архивирован", AI_HYPOTHESIS: "Гипотеза", REJECTED: "Отклонён", UNKNOWN: "Не проверено", UNDER_REVIEW: "На проверке", CONFIRMED_VALID: "Основание подтверждено", CONFIRMED_ABSENT: "Отсутствие основания подтверждено", green: "Зелёная", yellow: "Жёлтая", red: "Красная" };
const label = (value) => labels[value] ?? value;
const auditLabel = (action) => action === "SIGNAL_CREATED" ? "Сигнал создан" : action === "SIGNAL_SEEDED" ? "Демо-сигнал добавлен" : action.startsWith("SIGNAL_STATUS_") ? "Статус изменён: " + label(action.slice(14)) : action;

function externalLink(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "—";
    return '<a href="' + escape(url.href) + '">' + escape(url.href) + '</a>';
  } catch { return "—"; }
}

function conditionSection(signal,row) {
  const state=signal.objectConditions,review=state?.review;
  const heading='<h2>Проверка условий зелёной зоны на момент сигнала</h2>';
  if(!state)return heading+'<p>Проверка условий в историческом снимке отсутствует. Текущие решения не подставляются.</p>';
  if(!review)return heading+'<p>Решение МИО по дополнительным условиям не зафиксировано. Подтверждение основания само по себе не означает зелёную зону.</p>';
  const names={documentsMatch:'Документы относятся к этому объекту',constructionActive:'Строительство ведётся',complaintsClear:'Существенные неурегулированные жалобы отсутствуют',delaysClear:'Существенная просрочка или остановка не выявлена'};
  const reasonLabel={ELIGIBLE:'Условия приняты по решению МИО',LEGAL_NOT_VERIFIED:'Применимое основание ещё не подтверждено',NOT_REVIEWED:'Проверка не зафиксирована',CONTEXT_CHANGED:'Исходные сведения изменились',EXPIRED:'Требуется повторная проверка по сроку актуальности',CHECKS_FAILED:'Не все условия подтверждены',POLICY_CHANGED:'Версия правил изменилась; требуется новая проверка'}[state.reason]??'Проверка требует уточнения';
  return heading+'<p>Состояние зафиксировано при создании сигнала. Это решение сотрудника по указанным источникам, не автоматическая проверка государственных реестров.</p><table>'+row('Проверил',review.createdBy)+row('Дата проверки',date(review.checkedDate))+row('Зарегистрировано',date(review.createdAt))+row('Проверка актуальна по',date(review.validThrough))+row('Источник',review.source)+row('Содержание проверки',review.evidenceText)+Object.entries(names).map(([key,name])=>row(name,review.checks[key]===true?'Подтверждено':'Не подтверждено')).join('')+row('Условия зелёной зоны приняты на момент сигнала',state.eligible?'Да':'Нет')+row('Состояние проверки',reasonLabel)+row('SHA-256 контекста проверки',review.contextSha256)+'</table>';
}

function constructionSection(signal,row) {
  const evidence=signal.constructionEvidence;
  if(!evidence)return '<h2>Фотофиксация и история готовности</h2><p>В историческом сигнале фотофиксация не сохранена. Текущие материалы не подставляются.</p>';
  const active=evidence.activeObservation;
  const photo=active?'<table>'+row('Измеренная готовность',active.completionPercentage+'%')+row('Дата наблюдения (указана оператором)',active.observedDate)+row('Загружено',date(active.createdAt))+row('Источник',active.source)+row('Метод измерения',active.method)+row('Проверил',active.reviewedBy)+row('Решение',active.reviewReason)+row('SHA-256',active.sha256)+'</table>'+
    (['image/png','image/jpeg'].includes(active.mime)&&/^[A-Za-z0-9+/]+={0,2}$/u.test(active.photoData??'')?'<img style="max-width:100%" alt="Сохранённая фотофиксация строительства" src="data:'+active.mime+';base64,'+active.photoData+'">':''):'<p>Для актуальной готовности проверенная фотофиксация не прикреплена.</p>';
  const trend=evidence.trend;
  const history=evidence.readinessHistory;
  return '<h2>Фотофиксация и история готовности</h2><p>Процент и метод внесены человеком. Изображение не устанавливает процент автоматически; дата наблюдения не подтверждена метаданными камеры.</p>'+photo+
    '<h3>Проверенные наблюдения</h3><p>Показано '+escape(trend.points.length)+' из '+escape(trend.totalPoints)+' наблюдений. Исправленные записи исключены из динамики.</p><table><tr><th>Дата</th><th>Готовность</th><th>Источник / метод</th></tr>'+trend.points.map(point=>'<tr><td>'+escape(point.date)+'</td><td>'+escape(point.percentage)+'%'+(point.sameDayConflict?' · разные оценки в один день':'')+'</td><td>'+escape(point.source+' / '+point.method)+'</td></tr>').join('')+'</table>'+
    '<h3>Изменения готовности</h3><p>Сохранено '+escape(history.items.length)+' из '+escape(history.total)+' записей истории; прежние несохранённые изменения не восстанавливаются.</p><table><tr><th>Версия / вид</th><th>Готовность</th><th>Основание</th></tr>'+history.items.map(item=>'<tr><td>'+escape(item.revision+' / '+(item.kind==='VERIFIED'?'проверенная':'заявленная'))+'</td><td>'+escape(item.percentage===null?'не указана':item.percentage+'%')+'</td><td>'+escape(item.reason)+'</td></tr>').join('')+'</table>';
}

function complaintSection(signal,row) {
  const heading='<h2>Сохранённые обращения граждан</h2>';
  if(!Array.isArray(signal.complaints))return heading+'<p>Снимок обращений в исторической карточке отсутствует. Текущие обращения не подставляются.</p>';
  if(!signal.complaints.length)return heading+'<p>На момент формирования обращения не зарегистрированы.</p>';
  const states={PENDING:'Требует проверки МИО',CONFIRMED:'Подтверждено МИО',REJECTED:'Не подтверждено / подтверждение отозвано',RESOLVED:'Результат разрешения зафиксирован',LEGACY_CONFIRMED:'Историческая подтверждённая запись',LEGACY_UNVERIFIED:'Историческая непроверенная запись'};
  return heading+signal.complaints.map(item=>'<article><h3>'+escape(item.registrationNumber||item.id)+'</h3><table>'+row('Вид',item.type==='COLLECTIVE'?'Коллективное':item.type==='INDIVIDUAL'?'Индивидуальное':item.type)+row('Состояние при формировании',states[item.status]??item.status)+row('Дата поступления (со слов оператора)',date(item.receivedDate))+row('Зарегистрировано',date(item.capturedAt))+row('Источник',item.source)+row('Содержание',item.summary)+'</table>'+
    (item.legacy?'<p>Историческая запись без журнала регистрации. Дата проверки и автор не восстановлены.</p>':'')+(item.reviews??[]).map(review=>'<p><strong>'+escape(states[review.status]??review.status)+'</strong> · '+escape(review.createdBy)+' · '+escape(date(review.createdAt))+'</p><table>'+row('Дата проверенных сведений',date(review.checkedDate))+row('Источник проверки',review.source)+row('Содержание проверки',review.evidenceText)+row('Основание решения',review.reason)+'</table>').join('')+'</article>').join('');
}

export function renderSignalExport(signal) {
  const complex = signal.complex;
  const address = complex.address?.startsWith(complex.city) ? complex.address : complex.city + ", " + complex.address;
  const row = (title, value) => '<tr><th>' + escape(title) + '</th><td>' + escape(value) + '</td></tr>';
  const factors = signal.factorSnapshot.map((factor) => '<article class="factor"><h3>' + escape(factor.code + " · " + factor.label) + '</h3>' +
    '<p><strong>' + escape(label(factor.status)) + '</strong> · вес ' + escape(factor.weight) + '</p>' +
    '<blockquote>' + escape(factor.evidenceText) + '</blockquote><p>Источник: ' + escape(factor.sourceLabel || factor.sourceType) + '</p>' +
    (factor.sourceId ? '<p>Идентификатор материала: ' + escape(factor.sourceId) + '</p>' : '') +
    (factor.confirmedBy ? '<p>Проверил: ' + escape(factor.confirmedBy) + ' · ' + escape(date(factor.confirmedAt)) + '</p>' : '') +
    (factor.notes ? '<p>' + escape(factor.notes) + '</p>' : '') + '</article>').join('');
  const sources = signal.advertisements.map((ad, index) => '<article class="source"><h3>Материал ' + (index + 1) + ' · ' + escape(ad.platform) + '</h3>' +
    '<p>' + escape(ad.account || "Аккаунт не указан") + (ad.collection && !ad.collection.publishedAt ? ' · дата публикации неизвестна; наблюдение ' : ' · опубликован ') + escape(date(ad.publicationDate)) + '</p>' +
    '<p>Зафиксирован: ' + escape(date(ad.capturedAt)) + ' · ID: ' + escape(ad.id) + '</p><p>Исходная ссылка: ' + externalLink(ad.url) + '</p>' +
    '<div class="source-text">' + escape(ad.text) + '</div>' + (ad.notes ? '<p>Примечание: ' + escape(ad.notes) + '</p>' : '') +
    (ad.collection ? '<p>Автоматический сбор: ' + escape(ad.collection.sourceName) + ' · ' + escape(ad.collection.sourceKind) +
      '<br>Дата публикации: ' + escape(ad.collection.publishedAt ? date(ad.collection.publishedAt) : 'неизвестна') +
      '<br>Наблюдение: ' + escape(date(ad.collection.observedAt)) + '<br>Архив HTML/JSON: ' + escape(ad.collection.archiveId) +
      '<br>SHA-256 архива: ' + escape(ad.collection.sha256) + '<br>Архив исходного ответа не является скриншотом страницы.</p>' : '') +
    (ad.collection?.pageCapture?'<p>Автоматический снимок: видимая область 1280 × 960, не полная страница. SHA-256: '+escape(ad.collection.pageCapture.sha256)+(ad.collection.pageCapture.provenance?.partial?' · Есть ограничения загрузки; требуется проверка снимка.':'')+'</p>':'')+
    (ad.evidenceFiles ?? []).map((file) => '<figure>' + (file.data && ["image/png", "image/jpeg"].includes(file.mime) && /^[A-Za-z0-9+/]+={0,2}$/u.test(file.data)
      ? '<img style="max-width:100%" src="data:' + file.mime + ';base64,' + file.data + '" alt="Сохранённый снимок публикации">' : '') +
      '<figcaption>Зафиксирован: ' + escape(date(file.capturedAt)) + ' · SHA-256: ' + escape(file.sha256) + '</figcaption></figure>').join('') + '</article>').join('');
  const passport = complex.passport?.fields ?? {};
  const registryNote = complex.passport?.verificationMode === "IMPORTED_UNVERIFIED"
    ? "Поля загружены из CSV и ещё не подтверждены ручной сверкой. Источник: " + complex.passport.registryImport?.source + "; дата источника: " + complex.passport.registryImport?.sourceDate
    : "Внесённые сведения на момент создания сигнала; автоматические подключения отсутствуют.";
  const passportRow = (title, key) => row(title, passport[key] || "Не внесено");
  const pilotSections = '<h2>Объект и приложение к паспорту</h2><table>' + row("Номер объекта", complex.objectNumber) + passportRow("Кадастровый участок", "cadastralNumber") +
    passportRow("Руководитель", "director") + passportRow("Учредители", "founders") + '</table><h2>Сведения о проверке реестров</h2><p>' + escape(registryNote) + '</p><table>' +
    passportRow("Казреестр", "kazreestr") + passportRow("Реестр разрешений МИО", "mioRegistry") + passportRow("Земельный кадастр", "landRegistry") + passportRow("Регистрация ДДУ", "dduRegistry") +
    '</table><h2>Схема привлечения и платежи</h2><p>' + escape(passport.paymentScheme || "Схема оплаты не внесена") + '</p><p>' + escape(passport.paymentEvidence || "Подтверждённые платежи не внесены") +
    '</p><h2>Предлагаемые мероприятия</h2><ul>' + (signal.contextSnapshot?.proposedActions ?? []).map((action) => '<li>' + escape(action) + '</li>').join('') + '</ul><h2>Маршрут и результат реагирования</h2>' +
    '<p>Внутренняя очередь; внешняя отправка не выполняется.</p><table>' + row("Получатель", signal.routing?.recipient) + row("Основание передачи", signal.routing?.reason) +
    row("Подтвердил", signal.routing?.approvedBy) + row("Назначено", date(signal.routing?.assignedAt)) + row("Срок ответа", date(signal.routing?.dueDate)) +
    row("Результат реагирования", signal.routing?.result) + row("Результат внесён", date(signal.routing?.respondedAt)) +
    row("Версия календаря",signal.routing?.calendarVersion) + row("Источник календаря",signal.routing?.calendarDefinition?.source) +
    row("Дата источника календаря",signal.routing?.calendarDefinition?.sourceDate) + '</table><p>Срок: 5 рабочих дней после дня назначения. ' +
    (signal.routing?.calendarDefinition?.configured ? 'Календарь опубликован оператором; учтены выходные, нерабочие даты и рабочие переносы. Версия сохранена при назначении.' : 'Применены выходные и заданные исключения. Официальный календарь переносов не настроен.') + '</p>';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + escape(signal.id + " — SAQ QURYLYS") + '</title><style>' +
    'body{max-width:920px;margin:32px auto;padding:0 28px;font:14px/1.6 "Plus Jakarta Sans","Segoe UI",Roboto,Arial,sans-serif;color:#1b1c1d;background:#fafbfc}header{padding:24px;background:#ffffff;border:1px solid #e1e6ee;border-radius:16px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}h1{font-size:26px;font-weight:700;line-height:1.2;margin:8px 0 12px;color:#001d35}h2{font-size:18px;font-weight:600;margin-top:28px;margin-bottom:12px;border-bottom:2px solid #e1e6ee;padding-bottom:8px;color:#1b1c1d}h3{font-size:15px;font-weight:600;margin:12px 0 6px;color:#2d3135}p{margin:8px 0}.caption{color:#51606f;font-size:13px;font-weight:500;letter-spacing:0.02em;text-transform:uppercase}table{border-collapse:collapse;width:100%;margin:16px 0;background:#ffffff;border:1px solid #e1e6ee;border-radius:12px;overflow:hidden}th,td{padding:10px 16px;border-bottom:1px solid #edf1f6;text-align:left;vertical-align:top}tr:last-child th,tr:last-child td{border-bottom:0}th{width:32%;font-weight:600;color:#44474e;background:#f8f9fa}td{color:#1b1c1d}blockquote{margin:12px 0;padding:12px 18px;border-left:4px solid #00639b;background:#f0f4f9;border-radius:0 8px 8px 0}.source-text,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}.factor,.source{padding:16px;margin:12px 0;background:#ffffff;border:1px solid #e1e6ee;border-radius:12px}a{color:#00639b;text-decoration:none;overflow-wrap:anywhere}a:hover{text-decoration:underline}.source-text{padding:14px;border:1px solid #e1e6ee;border-radius:10px;background:#f8f9fa}footer{margin-top:36px;padding:16px 0;border-top:1px solid #e1e6ee;color:#51606f;font-size:12px;line-height:1.5}@media print{@page{size:A4;margin:12mm}body{margin:0;padding:0;max-width:none;font-size:9.5pt;background:#fff}header{border:0;padding:0;box-shadow:none}table{border:1px solid #ddd}th,td{padding:6px 10px}h1{font-size:18pt}h2{break-after:avoid}h3,p{orphans:3;widows:3}.factor,.source{break-inside:avoid;border:1px solid #ddd;margin:8px 0;padding:10px}.source-text{border:0;padding:0}a{color:inherit}blockquote{background:#f8f9fa}}' +
    '</style></head><body><header><p class="caption">SAQ QURYLYS · ' + (complex.isDemo !== false ? 'Демонстрационные данные' : 'Рабочий реестр: сведения требуют проверки') + '</p><h1>Сигнальная карточка ' + escape(signal.id) + '</h1>' +
    '<p>Сформирована ' + escape(date(signal.createdAt)) + ' · ' + escape(label(signal.status)) + '</p></header>' +
    (complex.isDemo !== false ? '<p><strong>Демо-сценарий.</strong> Объект, организации, документы, источники и решения синтетические; официальные реестры и должностные лица их не подтверждали.</p>' : '') +
    (signal.legacySnapshot ? '<p><strong>Историческая карточка.</strong> Снимок реквизитов и исходных публикаций не был сохранён. Реквизиты ниже взяты из текущего реестра; исторические тексты не восстанавливаются.</p>' : '<p class="caption">Реквизиты, балл, факторы и исходные тексты сохранены на момент создания сигнала.</p>') +
    '<table>' + row("ЖК", complex.name) + row("Город и адрес", address) + row("Застройщик", complex.developerName) + row("БИН", complex.developerBin) +
    row("Баллы и зона", signal.scoreSnapshot + " / 100 · " + label(signal.zoneSnapshot)) + row("Правовое основание", label(signal.legalBasisSnapshot)) + row("Источник правовой проверки", complex.legalBasisSource) +
    row("Автор", signal.createdBy) + row("Проверил", signal.reviewedBy) + row("Время проверки", date(signal.reviewedAt)) + '</table>' +
    '<h2>Факторы и доказательства</h2><p>' + (signal.legacySnapshot ? 'Исходный исторический снимок сохранён без пересчёта.' : 'Гипотезы и неизвестные сведения не начисляют баллы. Каждый подтверждённый код учитывается один раз.') + '</p>' + (factors || '<p>Факторы не зафиксированы.</p>') +
    '<h2>Сохранённые публикации</h2>' + (sources || '<p>Исторические публикации в снимке отсутствуют.</p>') + constructionSection(signal,row) + conditionSection(signal,row) + complaintSection(signal,row) + pilotSections +
    '<h2>Решение и комментарий</h2><p>' + escape(signal.comment) + '</p><h2>Журнал проверки</h2>' + signal.audit.map((item) => '<p>' + escape(date(item.timestamp) + " · " + item.actor + " · " + auditLabel(item.action)) + (item.metadata?.comment ? '<br>' + escape(item.metadata.comment) : '') + '</p>').join('') +
    '<footer>' + (complex.isDemo !== false ? 'Все объекты, компании и документы вымышлены. ' : 'Материалы внесены пользователями; достоверность источников требует проверки. ') + 'Красная зона показывает приоритет проверки и не означает установленную виновность. ИИ не принимает правовых решений.</footer></body></html>';
}
