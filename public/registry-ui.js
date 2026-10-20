import { escapeHtml as e } from "./components.js";
import { L } from "./pilot-ui.js";

export function renderRegistryImport(meta) {
  return '<header class="page-heading"><div><h1>' + e(L("Импорт реестра", "Тізілімді импорттау")) + '</h1><p>' + e(L("CSV → проверка всех строк → загрузка в реестр", "CSV → барлық жолдарды тексеру → тізілімге жүктеу")) + '</p></div></header>' +
    '<section class="panel"><div class="panel-body"><p>' + e(meta.demo ? L("Учебная база: все загруженные объекты получат отметку демо. Для настоящего реестра используйте отдельную рабочую базу.", "Оқу базасы: жүктелген нысандар демо деп белгіленеді. Нақты тізілімге бөлек жұмыс базасын пайдаланыңыз.") : L("Рабочая база. Будут добавлены новые объекты; существующие карточки не перезаписываются.", "Жұмыс базасы. Жаңа нысандар қосылады; бар карточкалар қайта жазылмайды.")) + '</p>' +
    '<p class="form-help">' + e(L("Импорт не подтверждает правовое основание или риск. Все объекты начнут с непроверенного основания. При любой ошибке файл целиком отклоняется.", "Импорт құқықтық негізді немесе тәуекелді растамайды. Нысандардың негізі тексерілмеген болып қалады. Кез келген қате бүкіл файлды қабылдамауға әкеледі.")) + '</p>' +
    '<button class="button button-secondary" type="button" data-action="registry-template">' + e(L("Скачать пустой CSV-шаблон", "Бос CSV үлгісін жүктеу")) + '</button>' +
    '<form id="registry-import-form"><div class="form-grid"><div class="field"><label for="registry-source">' + e(L("Источник реестра", "Тізілім дереккөзі")) + '</label><input id="registry-source" name="source" required maxlength="500"></div>' +
    '<div class="field"><label for="registry-date">' + e(L("Дата источника", "Дереккөз күні")) + '</label><input id="registry-date" name="sourceDate" required type="date"></div></div>' +
    '<div class="field"><label for="registry-file">' + e(L("Файл CSV в UTF-8 (до 700 КБ)", "UTF-8 CSV файлы (700 КБ дейін)")) + '</label><input id="registry-file" type="file" accept=".csv,text/csv"></div>' +
    '<div class="field"><label for="registry-content">' + e(L("Содержимое CSV", "CSV мазмұны")) + '</label><textarea id="registry-content" name="content" required rows="9" maxlength="716800" spellcheck="false" aria-describedby="registry-format"></textarea><p id="registry-format" class="form-help">' + e(L("Обязательные столбцы: name, city, address, developerName, developerBin, latitude, longitude. БИН — ровно 12 цифр, координаты — с точкой. Разделитель ; или ,; до 500 объектов. Необязательные поля паспорта есть в шаблоне.", "Міндетті бағандар: name, city, address, developerName, developerBin, latitude, longitude. БСН — 12 сан, координаттар нүктемен жазылады. Бөлгіш ; немесе ,; 500 нысанға дейін. Паспорттың қосымша өрістері үлгіде бар.")) + '</p></div>' +
    '<button class="button button-primary" type="submit">' + e(L("Проверить файл", "Файлды тексеру")) + '</button></form><div id="registry-preview" role="status" aria-live="polite"></div>' +
    '<button class="button button-primary" type="button" data-action="registry-commit" hidden>' + e(L("Добавить проверенные объекты", "Тексерілген нысандарды қосу")) + '</button></div></section>';
}

export function renderImportPreview(preview) {
  return '<h2>' + e(L("Результат проверки", "Тексеру нәтижесі")) + '</h2><p>' + e(preview.valid ? L("Готово к загрузке: ", "Жүктеуге дайын: ") + preview.count : L("Обнаружены ошибки. Ничего не добавлено.", "Қателер анықталды. Ештеңе қосылған жоқ.")) + '</p>' +
    (preview.errors.length ? '<ul>' + preview.errors.map(error => '<li>' + e(L("Запись ", "Жазба ") + error.row + ': ' + error.message) + '</li>').join('') + '</ul>' : '') +
    '<div class="table-wrap"><table class="data-table registry-preview-table"><thead><tr><th>#</th><th>' + e(L("ЖК", "ТК")) + '</th><th>' + e(L("Город / адрес", "Қала / мекенжай")) + '</th><th>' + e(L("БИН", "БСН")) + '</th></tr></thead><tbody>' + preview.items.slice(0,20).map(item => '<tr><td>' + item.row + '</td><td>' + e(item.name) + '</td><td>' + e(item.city + ' / ' + item.address) + '</td><td>' + e(item.developerBin) + '</td></tr>').join('') + '</tbody></table></div>' +
    (preview.count > 20 ? '<p>' + e(L("Показаны первые 20 записей. Проверены все: ", "Алғашқы 20 жазба көрсетілді. Барлығы тексерілді: ") + preview.count) + '</p>' : '');
}
