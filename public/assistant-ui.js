import { escapeHtml, icon, riskBadge, localeText } from "./components.js";
import { getLocale } from "./i18n.js";

export function renderAssistantPage(meta) {
  const isKz = getLocale() === "kz";
  const modelName = meta?.ai?.mode || localeText("Режим работы не определён", "Жұмыс режимі анықталмады");

  return '<div class="m3-assistant-workspace">' +
    '<header class="page-heading">' +
      '<div>' +
        '<div class="m3-eyebrow"><span class="m3-pulse-dot"></span>' + escapeHtml(localeText("ТЗ Раздел 3.3 · ИИ-Помощник SAQ", "ТТ 3.3-бөлім · SAQ ЖИ-Көмекшісі")) + '</div>' +
        '<h1>' + escapeHtml(localeText("ИИ-Консультант SAQ QURYLYS", "SAQ QURYLYS ЖИ-Кеңесшісі")) + '</h1>' +
        '<p>' + escapeHtml(localeText("Демо-помощник по локальным данным и факторам риска. Госреестры не подключены.", "Жергілікті демо-деректер мен тәуекел факторлары бойынша көмекші. Мемлекеттік тізілімдер қосылмаған.")) + '</p>' +
      '</div>' +
      '<div class="heading-actions">' +
        '<span class="m3-model-badge"><span class="m3-status-dot online"></span>' + escapeHtml(modelName) + '</span>' +
      '</div>' +
    '</header>' +
    '<div class="m3-assistant-card panel">' +
      '<div class="m3-chat-suggestions">' +
        '<span class="m3-sugg-title">' + escapeHtml(localeText("Рекомендуемые запросы:", "Ұсынылатын сұрақтар:")) + '</span>' +
        '<div class="m3-sugg-chips-wrap">' +
          '<button type="button" class="m3-sugg-chip" data-query="Законен ли ЖК Altai Grand Park?">' + escapeHtml(localeText("Законен ли ЖК Altai Grand Park?", "Altai Grand Park ТК заңды ма?")) + '</button>' +
          '<button type="button" class="m3-sugg-chip" data-query="Можно ли покупать квартиру по договору бронирования?">' + escapeHtml(localeText("Можно ли покупать по договору бронирования?", "Брондау шартымен пәтер алуға бола ма?")) + '</button>' +
          '<button type="button" class="m3-sugg-chip" data-query="Каков статус ЖК Oskemen Deluxe?">' + escapeHtml(localeText("Каков статус ЖК Oskemen Deluxe?", "Oskemen Deluxe ТК мәртебесі қандай?")) + '</button>' +
          '<button type="button" class="m3-sugg-chip" data-query="Какие 3 законных способа привлечения дольщиков в РК?">' + escapeHtml(localeText("3 законных способа привлечения дольщиков", "Үлескер тартудың 3 заңды тәсілі")) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="m3-chat-window" id="assistant-chat-window" aria-live="polite">' +
        '<div class="m3-chat-msg m3-chat-msg--bot">' +
          '<div class="m3-msg-avatar">' + icon("bot") + '</div>' +
          '<div class="m3-msg-content">' +
            '<div class="m3-msg-sender">' + escapeHtml(localeText("SAQ QURYLYS · Демо-помощник", "SAQ QURYLYS · Демо-көмекші")) + '</div>' +
            '<div class="m3-msg-text">' +
              (isKz
                ? 'Сәлеметсіз бе! Мен SAQ QURYLYS жергілікті прототипінің демо-көмекшісімін. Қосымшаға енгізілген деректер мен тәуекел факторларын түсіндіруге көмектесемін. Демо-жазбалар синтетикалық; мемлекеттік тізілімдерге қосылу және нақты нысандарды нақты уақытта тексеру жоқ. Жауап ресми қорытынды емес.'
                : 'Здравствуйте! Я демонстрационный помощник локального прототипа SAQ QURYLYS. Помогаю разобрать сохранённые данные и факторы риска. Демо-записи синтетические; подключения к госреестрам и проверки реальных объектов в реальном времени нет. Ответ не является официальным заключением.') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<form class="m3-chat-input-bar" id="assistant-form">' +
        '<input type="text" id="assistant-input" placeholder="' + escapeHtml(localeText("Спросите об объекте или факторе в данных приложения...", "Қосымшадағы нысан немесе тәуекел факторы туралы сұраңыз...")) + '" autocomplete="off" required>' +
        '<button type="submit" class="button button-primary" id="assistant-submit">' +
          icon("arrow") + '<span>' + escapeHtml(localeText("Спросить ИИ", "ЖИ-ден сұрау")) + '</span>' +
        '</button>' +
      '</form>' +
    '</div>' +
  '</div>';
}
