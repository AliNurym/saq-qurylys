import { escapeHtml as e, riskBadge, formatDate, icon } from "./components.js";
import { L } from "./pilot-ui.js";

function getComplexStatusTag(complex) {
  const factors = complex.risk?.confirmedFactors || [];
  const has = (code) => factors.some(f => f.code === code);

  if (complex.legalBasisStatus === "CONFIRMED_ABSENT" && has("R2")) {
    return { text: "нет разрешения · сбор брони", class: "status-tag--red" };
  }
  if (complex.legalBasisStatus === "CONFIRMED_ABSENT") {
    return { text: "нет разрешения", class: "status-tag--red" };
  }
  if (has("R6") || has("DELAY")) {
    return { text: "подтверждённая просрочка", class: "status-tag--amber" };
  }
  if (has("R5")) {
    return { text: "расхождение готовности >20%", class: "status-tag--amber" };
  }
  if (has("R4")) {
    return { text: "коллективное обращение", class: "status-tag--amber" };
  }
  if (has("R2")) {
    return { text: "приём брони", class: "status-tag--amber" };
  }
  if (complex.legalBasisStatus === "UNDER_REVIEW") {
    return { text: "документы на проверке", class: "status-tag--neutral" };
  }
  if (complex.legalBasisStatus === "UNKNOWN") {
    return { text: "статус не проверен", class: "status-tag--neutral" };
  }
  if (complex.legalBasisStatus === "CONFIRMED_VALID") {
    return { text: complex.legalBasisType?.includes("Гарантия") ? "гарантия КЖК" : "разрешение МИО", class: "status-tag--green" };
  }
  return { text: "на мониторинге", class: "status-tag--neutral" };
}

export function renderMap(meta, params) {
  const cities = meta.cities;
  const defaultCity = cities.includes("Усть-Каменогорск") ? "Усть-Каменогорск" : cities[0];
  const city = cities.includes(params.get("city")) ? params.get("city") : defaultCity;
  const all = meta.overview.complexes.filter(item => item.city === city);
  const districts = [...new Set(all.map(item => item.passport.fields?.district).filter(Boolean))].sort();
  const district = params.get("district") || "";
  const zone = params.get("zone") || "";
  const items = all.filter(item => (!district || item.passport.fields?.district === district) && (!zone || item.displayCategory === zone))
    .sort((a, b) => b.risk.score - a.risk.score || a.name.localeCompare(b.name, "ru"));
  const points = items.filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));

  // Count zones for current city
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const item of all) {
    if (counts[item.displayCategory] !== undefined) counts[item.displayCategory]++;
  }

  const redCount = counts.red || 0;
  const yellowCount = counts.yellow || 0;
  const greenCount = counts.green || 0;
  const totalCount = all.length;

  const demo = meta.dataset?.isDemo ?? meta.demo;
  const provenance = demo === true ? L('Объекты демонстрационные.', 'Нысандар демо деректері.') :
    demo === false ? L('Сведения внесены пользователями. Источники требуют проверки.', 'Пайдаланушылар енгізген мәліметтер. Дереккөздерді тексеру қажет.') :
      L('Режим данных не указан. Проверьте происхождение сведений.', 'Деректер режимі көрсетілмеген. Мәліметтердің шығу тегін тексеріңіз.');
  const offlineNote = L("Подложка OpenStreetMap требует интернета.", "OpenStreetMap негізі интернетті қажет етеді.");

  const zoneUrl = (targetZone) => {
    const p = new URLSearchParams();
    if (city) p.set("city", city);
    if (district) p.set("district", district);
    if (targetZone && targetZone !== zone) p.set("zone", targetZone);
    return "/map" + (p.toString() ? "?" + p.toString() : "");
  };

  return '<div class="m3-dashboard-page">' +
    '<header class="m3-page-header">' +
      '<div class="m3-page-header-content">' +
        '<div class="m3-eyebrow"><span class="m3-pulse-dot"></span>' + e(L("Пилотный проект · Цифровой мониторинг", "Пилоттық жоба · Цифрлық мониторинг")) + '</div>' +
        '<h1>' + e(L("Дашборд города — " + city, "Қалалық дашборд — " + city)) + '</h1>' +
        '<p class="m3-header-subtitle">' + e(L("Интеллектуальная карта строящихся ЖК и оперативный мониторинг зон риска", "ТК картасы және тәуекел аймақтарының жедел мониторингі")) + '</p>' +
      '</div>' +
      '<div class="m3-header-actions">' +
        '<a href="/signals" data-route class="m3-btn m3-btn-tonal">' + icon("signal") + '<span>' + e(L("Открыть сигнальные карточки", "Сигналдық карталарды ашу")) + '</span><span class="m3-badge-pill m3-badge-pill--red">' + redCount + '</span></a>' +
        '<a href="/advertisements" data-route class="m3-btn m3-btn-outlined">' + icon("ads") + '<span>' + e(L("Лента рекламы", "Жарнама таспасы")) + '</span></a>' +
      '</div>' +
    '</header>' +

    // Material 3 Zone KPI Metric Cards (Interactive click-to-filter)
    '<div class="m3-kpi-row">' +
      '<a href="' + e(zoneUrl("red")) + '" data-route class="m3-kpi-card m3-kpi-card--red' + (zone === "red" ? " is-active" : "") + '" title="' + e(L("Фильтр: только красная зона", "Сүзгі: тек қызыл аймақ")) + '">' +
        '<div class="m3-kpi-header">' +
          '<span class="m3-kpi-label">' + e(L("Красная зона", "Қызыл аймақ")) + '</span>' +
          '<span class="m3-kpi-icon-wrap m3-kpi-icon-wrap--red">' + icon("signal") + '</span>' +
        '</div>' +
        '<div class="m3-kpi-value red-text">' + redCount + '</div>' +
        '<div class="m3-kpi-desc">' + e(L("Высокий риск: нет разрешения + сбор денег", "Жоғары тәуекел: рұқсат жоқ + қаржы тарту")) + '</div>' +
        '<div class="m3-kpi-sub">' + (zone === "red" ? '<strong>' + e(L("✓ Активный фильтр", "✓ Белсенді сүзгі")) + '</strong>' : e(L("Сформированы сигнальные карточки", "Сигналдық карталар қалыптастырылды"))) + '</div>' +
      '</a>' +

      '<a href="' + e(zoneUrl("yellow")) + '" data-route class="m3-kpi-card m3-kpi-card--amber' + (zone === "yellow" ? " is-active" : "") + '" title="' + e(L("Фильтр: только жёлтая зона", "Сүзгі: тек сары аймақ")) + '">' +
        '<div class="m3-kpi-header">' +
          '<span class="m3-kpi-label">' + e(L("Жёлтая зона", "Сары аймақ")) + '</span>' +
          '<span class="m3-kpi-icon-wrap m3-kpi-icon-wrap--amber">' + icon("filter") + '</span>' +
        '</div>' +
        '<div class="m3-kpi-value amber-text">' + yellowCount + '</div>' +
        '<div class="m3-kpi-desc">' + e(L("Углублённая проверка документов МИО", "Құжаттарды тереңдетілген тексеру")) + '</div>' +
        '<div class="m3-kpi-sub">' + (zone === "yellow" ? '<strong>' + e(L("✓ Активный фильтр", "✓ Белсенді сүзгі")) + '</strong>' : e(L("Мониторинг раз в 7 дней", "Әр 7 күн сайын мониторинг"))) + '</div>' +
      '</a>' +

      '<a href="' + e(zoneUrl("green")) + '" data-route class="m3-kpi-card m3-kpi-card--green' + (zone === "green" ? " is-active" : "") + '" title="' + e(L("Фильтр: только зелёная зона", "Сүзгі: тек жасыл аймақ")) + '">' +
        '<div class="m3-kpi-header">' +
          '<span class="m3-kpi-label">' + e(L("Зелёная зона", "Жасыл аймақ")) + '</span>' +
          '<span class="m3-kpi-icon-wrap m3-kpi-icon-wrap--green">' + icon("check") + '</span>' +
        '</div>' +
        '<div class="m3-kpi-value green-text">' + greenCount + '</div>' +
        '<div class="m3-kpi-desc">' + e(L("Разрешение / гарантия КЖК подтверждены", "Рұқсат / ТКҚ кепілдігі расталған")) + '</div>' +
        '<div class="m3-kpi-sub">' + (zone === "green" ? '<strong>' + e(L("✓ Активный фильтр", "✓ Белсенді сүзгі")) + '</strong>' : e(L("Плановый мониторинг раз в 30 дней", "Әр 30 күн сайын жоспарлы мониторинг"))) + '</div>' +
      '</a>' +

      '<a href="' + e(zoneUrl("")) + '" data-route class="m3-kpi-card m3-kpi-card--neutral' + (!zone ? " is-active" : "") + '" title="' + e(L("Показать все объекты", "Барлық нысандарды көрсету")) + '">' +
        '<div class="m3-kpi-header">' +
          '<span class="m3-kpi-label">' + e(L("Всего строящихся ЖК", "Барлық салынып жатқан ТК")) + '</span>' +
          '<span class="m3-kpi-icon-wrap m3-kpi-icon-wrap--blue">' + icon("registry") + '</span>' +
        '</div>' +
        '<div class="m3-kpi-value">' + totalCount + '</div>' +
        '<div class="m3-kpi-desc">' + e(L("100% охват пилотной территории", "Пилоттық аумақты 100% қамту")) + '</div>' +
        '<div class="m3-kpi-sub">' + e(L("Обновлено: ", "Жаңартылды: ") + formatDate(meta.overview.updatedAt, { withTime: true })) + '</div>' +
      '</a>' +
    '</div>' +

    // Filter bar & actions
    '<div class="m3-card m3-filter-card">' +
      '<form id="map-filters" class="m3-filter-form">' +
        (cities.length > 1 ? '<div class="m3-field"><label for="map-city">' + e(L("Город", "Қала")) + '</label><select id="map-city" name="city" class="m3-select">' + cities.map(value => '<option' + (value === city ? ' selected' : '') + '>' + e(value) + '</option>').join('') + '</select></div>' : '<input type="hidden" name="city" value="' + e(city) + '">') +
        (districts.length ? '<div class="m3-field"><label for="map-district">' + e(L("Район города", "Қала ауданы")) + '</label><select id="map-district" name="district" class="m3-select"><option value="">' + e(L("Все районы города (" + all.length + " ЖК)", "Барлық аудандар (" + all.length + " ТК)")) + '</option>' + districts.map(value => '<option' + (district === value ? ' selected' : '') + '>' + e(value) + '</option>').join('') + '</select></div>' : '') +
        (zone ? '<input type="hidden" name="zone" value="' + e(zone) + '">' : '') +
        '<button type="submit" class="m3-btn m3-btn-primary">' + icon("filter") + '<span>' + e(L("Применить фильтр", "Қолдану")) + '</span></button>' +
        (district || zone ? '<a href="/map?city=' + encodeURIComponent(city) + '" data-route class="m3-btn m3-btn-text">' + e(L("Сбросить фильтры", "Тазарту")) + '</a>' : '') +
      '</form>' +
      '<div class="m3-filter-meta"><span class="m3-live-chip">' + icon("clock") + '<span>' + e(provenance + ' ' + offlineNote + ' ' + L("Обновлено: ", "Жаңартылды: ") + formatDate(meta.overview.updatedAt, { withTime: true })) + '</span></span></div>' +
    '</div>' +

    // Interactive Map and Sidebar List Layout
    '<div class="m3-map-workspace">' +
      // Map view with floating legend & overlay
      '<div class="m3-map-container">' +
        (points.length ?
          '<div class="object-map m3-map-frame" data-map-points="' + e(JSON.stringify(points.map(item => ({ id: item.id, name: item.name, latitude: item.latitude, longitude: item.longitude, zone: item.risk.zone, score: item.risk.score, developer: item.developerName })))) + '" role="region" aria-label="' + e(L("Карта ЖК по зонам риска", "ТК тәуекел аймақтары картасы")) + '">' +
            '<div class="map-layer"></div>' +
            '<div class="map-points"></div>' +
            '<div class="m3-map-floating-overlay">' +
              '<strong>' + e(city) + (zone ? ' · ' + (zone === 'red' ? L('Красная зона', 'Қызыл') : zone === 'yellow' ? L('Жёлтая зона', 'Сары') : L('Зелёная зона', 'Жасыл')) : '') + '</strong>' +
              '<span>' + e(points.length + " " + L("ЖК на карте", "ТК картада")) + '</span>' +
            '</div>' +
            '<div class="m3-map-legend-dock">' +
              '<span class="m3-legend-item"><span class="m3-dot m3-dot--red"></span>' + e(L("Красная (" + redCount + ")", "Қызыл")) + '</span>' +
              '<span class="m3-legend-item"><span class="m3-dot m3-dot--amber"></span>' + e(L("Жёлтая (" + yellowCount + ")", "Сары")) + '</span>' +
              '<span class="m3-legend-item"><span class="m3-dot m3-dot--green"></span>' + e(L("Зелёная (" + greenCount + ")", "Жасыл")) + '</span>' +
            '</div>' +
            '<span class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</span>' +
            '<p class="map-status" role="status" hidden>' + e(L("Подложка OpenStreetMap недоступна. Точки и список объектов сохранены.", "Карта қолжетімсіз. Нүктелер сақталған.")) + '</p>' +
          '</div>'
          : '<div class="m3-empty-card"><p>' + e(L("Для выбранного фильтра нет объектов с координатами.", "Таңдалған сүзгі үшін координаттары бар нысандар жоқ.")) + '</p></div>') +
      '</div>' +

      // Sorted List of Complexes by Risk Score Descending (Section 4.1.3 of ТЗ)
      '<div class="m3-map-list-panel">' +
        '<div class="m3-panel-header">' +
          '<div>' +
            '<h2 class="m3-panel-title">' + e(L("Рейтинг объектов по риску", "Тәуекел бойынша нысандар рейтингі")) + '</h2>' +
            '<p class="m3-panel-sub">' + e(L("По убыванию балла риска (0–100)", "Тәуекел баллының кемуі бойынша (0–100)")) + ' (' + items.length + ' ' + e(L("ЖК", "ТК")) + ')</p>' +
          '</div>' +
          '<a href="/complexes" data-route class="m3-btn m3-btn-small m3-btn-text">' + e(L("Все 48 ЖК", "Барлық 48 ТК")) + icon("arrow") + '</a>' +
        '</div>' +
        '<div class="m3-map-search-bar">' +
          '<div class="m3-map-search-wrap">' +
            icon("search") +
            '<input id="map-quick-search" type="search" class="m3-map-search-input" placeholder="' + e(L("Быстрый поиск ЖК по названию или застройщику...", "ТК атауы немесе құрылыс салушы бойынша іздеу...")) + '" autocomplete="off">' +
          '</div>' +
        '</div>' +
        '<div class="m3-ranked-list">' +
          items.map((item, idx) => {
            const tag = getComplexStatusTag(item);
            const badgeClass = item.risk.zone === "red" ? "m3-score-pill--red" : item.risk.zone === "yellow" ? "m3-score-pill--amber" : "m3-score-pill--green";
            return '<a class="m3-ranked-item m3-ranked-item--' + e(item.risk.zone) + '" data-route href="/complexes/' + encodeURIComponent(item.id) + '" data-complex-id="' + e(item.id) + '">' +
              '<div class="m3-ranked-rank">' + String(idx + 1).padStart(2, "0") + '</div>' +
              '<div class="m3-ranked-content">' +
                '<div class="m3-ranked-title-row">' +
                  '<strong class="m3-ranked-name">' + e(item.name) + '</strong>' +
                  '<span class="m3-score-pill ' + badgeClass + '">' + e(item.risk.score) + '</span>' +
                '</div>' +
                '<div class="m3-ranked-details">' +
                  '<span class="m3-ranked-dev">' + e(item.developerName) + '</span>' +
                  '<span class="m3-bullet">•</span>' +
                  '<span class="m3-ranked-addr">' + e(item.address) + '</span>' +
                '</div>' +
                '<div class="m3-ranked-footer">' +
                  '<span class="m3-status-tag ' + tag.class + '">' + e(tag.text) + '</span>' +
                  '<span class="m3-district-chip">' + e(item.passport.fields?.district || "Усть-Каменогорск") + '</span>' +
                '</div>' +
              '</div>' +
            '</a>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

const world = (latitude, longitude) => {
  const sin = Math.sin(Math.max(-85, Math.min(85, latitude)) * Math.PI / 180);
  return { x: (longitude + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
};

export function mountMap() {
  const container = document.querySelector('[data-map-points]');
  if (!container) return;
  const points = JSON.parse(container.dataset.mapPoints), width = container.clientWidth, height = container.clientHeight;
  if (!points.length) return;
  const projected = points.map(item => ({ ...item, ...world(item.latitude, item.longitude) }));
  const xs = projected.map(item => item.x), ys = projected.map(item => item.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const zoom = Math.max(3, Math.min(16, Math.floor(Math.log2(Math.min((width - 80) / (256 * Math.max(maxX - minX, 0.00001)), (height - 80) / (256 * Math.max(maxY - minY, 0.00001)))))));
  const scale = 256 * 2 ** zoom, left = (minX + maxX) * scale / 2 - width / 2, top = (minY + maxY) * scale / 2 - height / 2;
  const layer = container.querySelector('.map-layer');
  layer.replaceChildren();

  for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
    for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
      const image = document.createElement('img');
      image.alt = '';
      image.width = 256;
      image.height = 256;
      image.draggable = false;
      image.style.left = (x * 256 - left) + 'px';
      image.style.top = (y * 256 - top) + 'px';
      image.src = 'https://tile.openstreetmap.org/' + zoom + '/' + x + '/' + y + '.png';
      image.addEventListener('error', () => { container.querySelector('.map-status').hidden = false; }, { once: true });
      layer.append(image);
    }
  }

  const marks = container.querySelector('.map-points');
  marks.replaceChildren();
  for (const item of projected) {
    const link = document.createElement('a');
    link.href = '/complexes/' + encodeURIComponent(item.id);
    link.dataset.route = '';
    link.dataset.markerId = item.id;
    link.className = 'm3-map-marker m3-map-marker--' + item.zone;
    link.innerHTML = '<span class="m3-marker-dot"></span><span class="m3-marker-score">' + item.score + '</span>' +
      '<div class="m3-marker-tooltip">' +
        '<strong class="m3-marker-tooltip-title">' + e(item.name) + '</strong>' +
        '<span class="m3-marker-tooltip-dev">' + e(item.developer) + '</span>' +
        '<span class="m3-marker-tooltip-score ' + (item.zone === 'red' ? 'red-text' : item.zone === 'yellow' ? 'amber-text' : 'green-text') + '">' +
          e(L('Балл риска: ', 'Тәуекел балы: ')) + '<strong>' + item.score + '</strong>/100</span>' +
      '</div>';
    link.setAttribute('aria-label', item.name + ' · ' + item.score + '/100');
    link.title = item.name + ' (' + item.developer + ') · Балл: ' + item.score;
    link.style.left = ((item.x * scale - left) / width * 100) + '%';
    link.style.top = ((item.y * scale - top) / height * 100) + '%';
    marks.append(link);
  }

  // Live quick search in map list
  const searchInput = document.getElementById('map-quick-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = (e.target.value || '').toLowerCase().trim();
      const listItems = document.querySelectorAll('.m3-ranked-item');
      listItems.forEach(item => {
        const text = (item.textContent || '').toLowerCase();
        item.style.display = !query || text.includes(query) ? '' : 'none';
      });

      // Synchronize markers opacity with search
      marks.querySelectorAll('.m3-map-marker').forEach(marker => {
        const title = (marker.title || '').toLowerCase();
        marker.style.opacity = !query || title.includes(query) ? '1' : '0.2';
      });
    });
  }

  // Hover sync between list items and map markers
  document.querySelectorAll('.m3-ranked-item').forEach(item => {
    const id = item.dataset.complexId;
    if (!id) return;
    item.addEventListener('mouseenter', () => {
      const marker = marks.querySelector(`[data-marker-id="${id}"]`);
      if (marker) marker.classList.add('is-highlighted');
    });
    item.addEventListener('mouseleave', () => {
      const marker = marks.querySelector(`[data-marker-id="${id}"]`);
      if (marker) marker.classList.remove('is-highlighted');
    });
  });
}

