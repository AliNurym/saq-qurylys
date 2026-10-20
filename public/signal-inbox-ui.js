import {escapeHtml as e,formatDate,localeText as L,riskBadge,signalStatusBadge} from './components.js';
import {queryString} from './api.js';
import {t} from './i18n.js';

export const signalInboxRoute=(filters={},before=null)=>'/signals'+queryString({...filters,before});
const recipientNames=()=>({MIO:L('МИО','ЖАО'),GASK:L('ГАСК','МСҚБ'),LAW_ENFORCEMENT:L('Правоохранительный орган','Құқық қорғау органы')});
const options=(values,selected)=>values.map(([value,label])=>'<option value="'+e(value)+'"'+(value===selected?' selected':'')+'>'+e(label)+'</option>').join('');
export function signalResponseLabel(item) {
  if(item.responseState==='ARCHIVED')return item.hasResponse?L('Архив · результат внесён','Мұрағат · нәтиже тіркелді'):L('Архив без результата','Нәтижесіз мұрағат');
  return {UNASSIGNED:L('Не назначен','Тағайындалмаған'),AWAITING:L('Ожидает ответа','Жауап күтілуде'),OVERDUE:L('Просрочен','Мерзімі өтті'),RESPONDED:L('Результат внесён','Нәтиже тіркелді')}[item.responseState]??L('Требует проверки','Тексеруді қажет етеді');
}
export function renderSignalInbox(page) {
  const f=page.filters??{},counts=page.summary??{},names=recipientNames(),items=page.items??[];
  const statuses=[['',L('Все статусы','Барлық мәртебе')],['DRAFT',t('draft')],['NEEDS_REVIEW',t('needsReviewSignal')],['CONFIRMED',t('confirmed')],['RETURNED',t('returned')],['ARCHIVED',t('archived')]];
  const responses=[['',L('Все материалы','Барлық материал')],['UNASSIGNED',L('Получатель не назначен','Алушы тағайындалмаған')],['AWAITING',L('Ожидают ответа','Жауап күтілуде')],['OVERDUE',L('Просрочены','Мерзімі өтті')],['RESPONDED',L('Результат внесён','Нәтиже тіркелді')],['ARCHIVED',t('archived')]];
  const field=(id,label,body)=>'<div class="field"><label for="'+id+'">'+e(label)+'</label>'+body+'</div>';
  const summaryLinks=[
    [counts.total??0,L('Все доступные','Барлық қолжетімді'),{}],
    [counts.needsReview??0,L('На подтверждении','Растау күтілуде'),{status:'NEEDS_REVIEW'}],
    [counts.awaiting??0,L('Ожидают ответа','Жауап күтілуде'),{response:'AWAITING',sort:'deadline'}],
    [counts.overdue??0,L('Просрочены','Мерзімі өтті'),{response:'OVERDUE',sort:'deadline'}],
    [counts.responded??0,L('Результат внесён','Нәтиже тіркелді'),{response:'RESPONDED'}],
  ];
  const filtered=Object.entries(f).some(([key,value])=>key!=='sort'&&Boolean(value));
  const row=item=>'<tr data-signal-id="'+e(item.id)+'"><td class="inbox-record"><a class="complex-link" data-route href="/signals/'+encodeURIComponent(item.id)+'">'+e(item.id)+'</a><span class="table-secondary">'+e(formatDate(item.createdAt,{withTime:true}))+'</span></td>'+
    '<td class="inbox-object"><a class="complex-link" data-route href="/complexes/'+encodeURIComponent(item.complexId)+'">'+e(item.complexName)+'</a><span class="table-secondary">'+e(item.city)+'</span></td>'+
    '<td class="inbox-risk" data-label="'+e(t('score'))+'">'+riskBadge(item.zoneSnapshot,item.scoreSnapshot)+'</td>'+
    '<td class="inbox-status" data-label="'+e(t('signalStatus'))+'">'+signalStatusBadge(item.status)+'</td>'+
    '<td class="inbox-recipient" data-label="'+e(L('Получатель и срок','Алушы және мерзім'))+'"><span>'+e(names[item.routing?.recipient]??L('Не назначен','Тағайындалмаған'))+'</span><span class="table-secondary">'+e(item.routing?.dueDate?L('Срок: ','Мерзім: ')+formatDate(item.routing.dueDate):L('Срок не назначен','Мерзім тағайындалмаған'))+'</span></td>'+
    '<td class="inbox-response" data-label="'+e(L('Реагирование','Әрекет нәтижесі'))+'"><span class="inbox-response-state'+(item.overdue?' is-overdue':'')+'">'+e(signalResponseLabel(item))+'</span>'+
    (item.routing?.respondedAt?'<span class="table-secondary">'+e(formatDate(item.routing.respondedAt,{withTime:true}))+'</span>':item.responseState==='AWAITING'&&item.routing?.dueDate===page.evaluationDate?'<span class="inbox-due-today">'+e(L('Срок сегодня','Мерзімі бүгін'))+'</span>':'')+'</td></tr>';
  return '<header class="page-heading"><div><h1>'+e(t('signalRegistry'))+'</h1><p>'+e(L('Внутренняя очередь проверки и реагирования. Внешняя отправка не выполняется.','Тексеру мен әрекет етудің ішкі кезегі. Сыртқа жіберілмейді.'))+'</p></div></header>'+
    '<nav class="signal-inbox-summary" aria-label="'+e(L('Все доступные материалы','Барлық қолжетімді материал'))+'">'+summaryLinks.map(([count,label,filters])=>'<a data-route href="'+e(signalInboxRoute(filters))+'"><strong>'+e(count)+'</strong><span>'+e(label)+'</span></a>').join('')+'</nav>'+
    '<p class="signal-inbox-note">'+e(L('Счётчики относятся ко всем доступным вам материалам и не зависят от фильтров ниже. Ожидающие ответа включают просроченные.','Санауыштар төмендегі сүзгілерге қарамастан барлық қолжетімді материалдарды қамтиды. Жауап күтілетіндерге мерзімі өткендер де кіреді.'))+'</p>'+
    '<section class="panel signal-inbox-panel"><form id="signal-inbox-filters" class="signal-inbox-filters">'+
    field('inbox-search',L('Номер, объект или город','Нөмір, нысан немесе қала'),'<input id="inbox-search" name="search" maxlength="200" value="'+e(f.search??'')+'">')+
    field('inbox-status',t('signalStatus'),'<select id="inbox-status" name="status">'+options(statuses,f.status??'')+'</select>')+
    field('inbox-recipient',L('Орган-получатель','Алушы орган'),'<select id="inbox-recipient" name="recipient">'+options([['',L('Все получатели','Барлық алушы')],...Object.entries(names)],f.recipient??'')+'</select>')+
    field('inbox-response',L('Реагирование','Әрекет нәтижесі'),'<select id="inbox-response" name="response">'+options(responses,f.response??'')+'</select>')+
    field('inbox-sort',L('Порядок','Реті'),'<select id="inbox-sort" name="sort">'+options([['newest',L('Сначала новые','Алдымен жаңалары')],['deadline',L('По сроку ответа','Жауап мерзімі бойынша')]],f.sort??'newest')+'</select>')+
    (f.complexId?'<input type="hidden" name="complexId" value="'+e(f.complexId)+'">':'')+
    '<div class="signal-inbox-actions"><button type="submit" class="button button-primary">'+e(L('Применить','Қолдану'))+'</button><a class="button button-secondary" data-route href="/signals">'+e(L('Сбросить','Тазарту'))+'</a></div></form>'+
    '<div class="signal-inbox-result" role="status">'+e(L('Найдено: ','Табылды: ')+page.total+L(' · на странице: ',' · бетте: ')+items.length)+'<span>'+e(L('Сроки на ','Мерзімдер күні: ')+formatDate(page.evaluationDate))+'</span></div>'+
    (items.length?'<div class="table-wrap"><table class="data-table signal-inbox-table"><caption class="visually-hidden">'+e(L('Сигналы, получатели и сроки ответа','Сигналдар, алушылар және жауап мерзімдері'))+'</caption><thead><tr>'+[t('signalId'),t('wfComplexShort'),t('score'),t('signalStatus'),L('Получатель и срок','Алушы және мерзім'),L('Реагирование','Әрекет нәтижесі')].map(label=>'<th scope="col">'+e(label)+'</th>').join('')+'</tr></thead><tbody>'+items.map(row).join('')+'</tbody></table></div>':
      '<div class="signal-inbox-empty"><h2>'+e(L('Материалы не найдены','Материалдар табылмады'))+'</h2><p>'+e(filtered?L('Измените фильтры или откройте все доступные материалы.','Сүзгілерді өзгертіңіз немесе барлық қолжетімді материалдарды ашыңыз.'):L('Новые материалы появятся после формирования или назначения карточек.','Жаңа материалдар карточкалар құрылғаннан немесе тағайындалғаннан кейін пайда болады.'))+'</p></div>')+
    '<nav class="signal-inbox-pagination" aria-label="'+e(L('Страницы сигналов','Сигналдар беттері'))+'">'+(page.before?'<a class="button button-secondary" data-route href="'+e(signalInboxRoute(f))+'">'+e(L('К началу','Басына'))+'</a>':'')+
    (page.nextCursor?'<a class="button button-secondary" data-route href="'+e(signalInboxRoute(f,page.nextCursor))+'">'+e(L('Следующие материалы','Келесі материалдар'))+'</a>':'')+'</nav></section>';
}
