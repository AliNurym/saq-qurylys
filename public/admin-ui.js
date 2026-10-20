import { escapeHtml as e } from "./components.js";
import { L } from "./pilot-ui.js";
import { renderUserManagement } from './access-ui.js';
import {renderCalendar} from './calendar-ui.js';
import {renderSources,renderJobs} from './collection-ui.js';

export function renderSettings(settings, users, view={}) {
  const section=view.section || (users.length?'rules':'users');
  const heading='<header class="page-heading"><div><h1>'+e(L('Настройки','Баптаулар'))+'</h1><p>'+e(L('Правила, сотрудники, сроки и сбор публикаций','Ережелер, қызметкерлер, мерзімдер және жарияланымдарды жинау'))+'</p></div></header>';
  const tabs='<nav class="settings-tabs" aria-label="'+e(L('Разделы настроек','Баптаулар бөлімдері'))+'">'+[['rules',L('Правила риска','Тәуекел ережелері')],['users',L('Сотрудники','Қызметкерлер')],['calendar',L('Рабочие дни','Жұмыс күндері')],['sources',L('Источники','Дереккөздер')],['jobs',L('Очередь','Кезек')]].map(([value,label])=>'<a data-route href="/settings?section='+value+'"'+(section===value?' aria-current="page"':'')+'>'+e(label)+'</a>').join('')+'</nav>';
  if(section==='sources')return heading+tabs+renderSources(view.sources);
  if(section==='jobs')return heading+tabs+renderJobs(view.jobs);
  if(section==='calendar')return heading+tabs+renderCalendar(view.calendar);
  if(section==='users')return heading+tabs+renderUserManagement(users,{selectedId:view.selectedId,currentUser:view.currentUser});
  return heading+tabs+'<form id="settings-form" data-version="' + e(settings.version) + '"><div class="detail-grid"><section class="panel"><header class="panel-header"><h2 class="panel-title">' + e(L("Веса факторов","Фактор салмақтары")) + '</h2></header><div class="panel-body form-grid">' +
    ["R1","R2","R3","R4","R5","R6"].map(code => '<div class="field"><label for="weight-' + code + '">' + code + '</label><strong>+' + e(settings.weights[code]) + '</strong><input type="hidden" id="weight-' + code + '" name="' + code + '" value="' + e(settings.weights[code]) + '"></div>').join('') +
    '<p class="form-help span-2">' + e(L("Формула зафиксирована кейсом: R1 +35 — подтверждённое отсутствие основания; R2 +25 — прямое предложение денег; R3 +10 — реклама строящегося жилья; R4 +15 — коллективное обращение; R5 +10 — расхождение готовности от 20 п.п.; R6 +5 — подтверждённый простой или значимая просрочка. Неизвестные и гипотезы не начисляют баллы.","Формула кейспен бекітілген: R1 +35 — негіздің жоқтығы расталған; R2 +25 — ақша енгізу туралы тікелей ұсыныс; R3 +10 — салынып жатқан тұрғын үй жарнамасы; R4 +15 — ұжымдық өтініш; R5 +10 — дайындық айырмасы 20 пайыздық тармақтан бастап; R6 +5 — расталған тоқтап қалу немесе елеулі кешігу. Белгісіз дерек пен болжам балл қоспайды.")) + '</p></div></section>' +
    '<section class="panel"><header class="panel-header"><h2 class="panel-title">' + e(L("Словарь формулировок","Тіркестер сөздігі")) + '</h2></header><div class="panel-body"><div class="field"><label for="risk-dictionary">' + e(L("Одна строка: формулировка | приоритет 0–100","Бір жол: тіркес | басымдық 0–100")) + '</label><textarea rows="12" id="risk-dictionary" name="dictionary">' + e(settings.dictionary.map(item=>item.phrase+' | '+item.weight).join('\n')) + '</textarea></div><p class="form-help">' + e(L("Приоритет сортирует рекламу и не начисляет балл риска. Изменения правил сохраняются новой версией; старые сигналы не пересчитываются.","Басымдық жарнаманы сұрыптайды, тәуекел баллын қоспайды. Ережелер жаңа нұсқамен сақталады; ескі сигналдар қайта есептелмейді.")) + '</p></div></section></div><div class="form-actions"><button type="submit" class="button button-primary">' + e(L("Сохранить правила","Ережелерді сақтау")) + '</button></div></form>';
}
