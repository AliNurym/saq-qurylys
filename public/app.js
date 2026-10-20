import { api, queryString } from "./api.js";
import { escapeHtml, icon } from "./components.js";
import { getLocale, setLocale, setDataMode, t } from "./i18n.js";
import { renderRegistryImport, renderImportPreview } from "./registry-ui.js";
import { renderLogin, renderNewComplex } from "./pilot-ui.js";
import { renderSettings } from "./admin-ui.js";
import { constructionRoute } from './construction-ui.js';
import {renderPasswordChange,syncAccessOperation,userRoute} from './access-ui.js';
import {calendarDraftFromValues,calendarDraftKey,calendarPreviewMatches,updateCalendarPreview,fillCalendarDraft,calendarRoute} from './calendar-ui.js';
import {sourceInputFromValues,updateSourceRunButton,sourceRoute,jobRoute} from './collection-ui.js';
import {conditionRoute} from './object-conditions-ui.js';
import {complaintRoute} from './complaints-ui.js';
import { renderMap, mountMap } from "./map-ui.js";
import { renderDashboard, renderRegistry, renderComplex } from "./pages-portfolio.js";
import {
  renderAdvertisements, renderHistory, renderNewAdvertisement, renderAdvertisementDetail,
  renderSignals, renderSignal,
} from "./pages-workflow.js";
import { renderAssistantPage } from "./assistant-ui.js";

const appRoot = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
let currentMeta = null;
let registryPreview = null;
let calendarPreview = null;
let renderVersion = 0;
let renderController = null;
let searchTimer = 0;
let sidebarCloseTimer = 0;
let activeViewTransition = null;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const pendingActions = new Set();
const analystInitials = "DA";
const initialTheme = localStorage.getItem("saq-theme") || "light";
document.documentElement.dataset.theme = initialTheme;

function localeText(ru, kz) {
  return getLocale() === "kz" ? kz : ru;
}

function errorText(error) {
  const detail = String(error?.message || localeText("Ошибка сервера.", "Сервер қатесі."));
  return getLocale() === "kz"
    ? "Әрекет орындалмады. Сервер хабарламасы: " + detail
    : detail;
}

function routeActive(path, href) {
  if (href === "/map") return path === "/map" || path === "/";
  if (href === "/dashboard") return path === "/dashboard";
  if (href === "/complexes") return path.startsWith("/complexes");
  if (href === "/advertisements") return path.startsWith("/advertisements");
  if (href === "/signals") return path.startsWith("/signals");
  return path.startsWith(href);
}

function sidebar(path) {
  const overview = currentMeta?.overview;
  const metrics = overview?.metrics ?? {};
  const adsCount = metrics.newAdvertisements ?? overview?.recentAdvertisements?.length ?? 0;
  const signalCount = metrics.activeSignals ?? overview?.recentSignals?.length ?? 0;

  const links = [
    ["/map", "mapPin", "cityMap", null, null],
    ["/complexes", "registry", "objectsTab", null, null],
    ["/advertisements", "ads", "adsTab", null, '<span class="m3-nav-badge">' + adsCount + '</span>'],
    ["/signals", "signal", "signalsTab", null, '<span class="m3-nav-badge m3-nav-badge--red">' + signalCount + '</span>'],
    ["/assistant", "bot", null, localeText("ИИ-Помощник", "ЖИ-Көмекші"), null],
    ["/dashboard", "overview", "overview", null, null],
    ["/history", "history", "history", null, null],
  ];
  if (!currentMeta?.access?.enabled || currentMeta.access.user?.role === "ADMIN") links.push(["/settings", "shield", "settings", null, null]);
  if(currentMeta?.access?.user)links.push(['/account','shield',null,localeText('Учётная запись','Тіркелгі'), null]);
  const mark = '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M7 28V13l10-5v20M21 28V5l8 4v19M5 28h26M11 17h2m-2 5h2m12-8h1m-1 5h1m-1 5h1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<aside class="sidebar" id="sidebar"><div class="brand"><span class="brand-mark">' + mark +
    '</span><span><span class="brand-name">SAQ <span>QURYLYS</span></span><span class="brand-caption">' + escapeHtml(t("brandCaption")) + '</span></span><button class="sidebar-close" data-action="close-sidebar" aria-label="' + escapeHtml(t("closeMenu")) + '">' + icon("close") + '</button></div>' +
    '<nav class="side-nav" aria-label="' + escapeHtml(t("mainNavigation")) + '">' +
    links.map(([href, iconName, key,label, badge]) => '<a class="nav-link ' + (routeActive(path, href) ? "active" : "") +
      '" data-route href="' + href + '"' + (routeActive(path, href) ? ' aria-current="page"' : "") + ">" +
      icon(iconName) + "<span>" + escapeHtml(label??t(key)) + "</span>" + (badge || "") + "</a>").join("") + "</nav>" +
    '<div class="sidebar-bottom"><div class="demo-side-note">' + escapeHtml(t("demoDisclaimer")) +
    '</div><div class="analyst-mini"><span class="avatar">' + analystInitials + '</span><span><strong>' + escapeHtml(currentMeta?.access?.user?.username || t("analyst")) + '</strong><span class="brand-caption">' + escapeHtml(t("regionAnalyst")) + '</span></span></div></div></aside>';
}

function shell(path, pageHtml, meta) {
  const searchValue = path === "/complexes" ? new URLSearchParams(location.search).get("query") || "" : "";
  const aiMode = meta?.ai?.configured
    ? (meta.ai.provider === "deepseek" ? "DeepSeek API + local fallback" : "OpenAI API")
    : meta?.ai?.provider === "local-ml" ? t("localModel") : t("localRules");
  const dataLabel = t("demo");

  return '<div class="app-shell">' + sidebar(path) + '<button class="sidebar-backdrop" data-action="close-sidebar" aria-label="' + escapeHtml(t("closeMenu")) + '" hidden></button>' +
    '<div class="main-column"><header class="topbar">' +
    '<button class="mobile-menu" data-action="toggle-sidebar" aria-controls="sidebar" aria-expanded="false" aria-label="' + escapeHtml(t("openMenu")) + '">' + icon("menu") + "</button>" +
    '<label class="global-search"><span class="screen-reader-only">' + escapeHtml(t("search")) + "</span>" + icon("search") +
    '<input id="global-search" type="search" value="' + escapeHtml(searchValue) + '" placeholder="' + escapeHtml(t("searchCompact")) +
    '" autocomplete="off"><kbd class="m3-search-kbd">Ctrl K</kbd></label><span class="topbar-spacer"></span>' +
    '<div class="m3-top-pilot-badge" title="' + escapeHtml(dataLabel) + '"><span class="m3-demo-dot" aria-hidden="true"></span><span>' + escapeHtml(dataLabel) + '</span></div>' +
    '<div class="language-switch" role="group" aria-label="' + escapeHtml(t("interfaceLanguage")) + '">' +
    '<button id="locale-ru" data-action="set-locale" data-locale="ru" class="' + (getLocale() === "ru" ? "active" : "") + '" aria-pressed="' + (getLocale() === "ru") + '">RU</button>' +
    '<button id="locale-kz" data-action="set-locale" data-locale="kz" class="' + (getLocale() === "kz" ? "active" : "") + '" aria-pressed="' + (getLocale() === "kz") + '">KZ</button></div>' +
    '<div class="m3-theme-switch-wrap">' +
    '<button id="theme-toggle" data-action="toggle-theme" class="m3-theme-toggle-btn" title="' + escapeHtml(localeText("Тема интерфейса: Светлая / Тёмная", "Интерфейс тақырыбы: Ашық / Қараңғы")) + '" aria-label="' + escapeHtml(localeText("Переключить тему", "Тақырыпты ауыстыру")) + '">' +
    icon((document.documentElement.dataset.theme === "dark") ? "sun" : "moon") +
    '<span>' + ((document.documentElement.dataset.theme === "dark") ? localeText("День", "Ашық") : localeText("Ночь", "Түн")) + '</span></button></div>' +
    '<span class="topbar-divider" aria-hidden="true"></span><div class="top-analyst"><span class="avatar">' + analystInitials + '</span><span>' +
    escapeHtml(currentMeta?.access?.user?.username || t("analyst")) + '</span></div>' + (meta?.access?.user ? '<button type="button" class="button button-secondary button-small" data-action="logout">' + escapeHtml(localeText('Выйти', 'Шығу')) + '</button>' : '') + '</header><main id="main-content" class="page-content">' +
    (pageHtml || '<div class="loading-indicator">' + escapeHtml(t("loading")) + "</div>") +
    '<footer class="screen-reader-only" aria-label="' + escapeHtml(t("analysisMethod")) + '">' + escapeHtml(aiMode) +
    "</footer></main></div></div>";
}

function pageError(error) {
  return '<div class="page-error"><strong>' + escapeHtml(localeText("Не удалось загрузить страницу.", "Бетті жүктеу мүмкін болмады.")) + '</strong><p>' +
    escapeHtml(errorText(error)) + '</p><button class="button button-secondary" data-action="reload">' +
    escapeHtml(t("refresh")) + "</button></div>";
}

function toast(message, isError = false) {
  const item = document.createElement("div");
  item.className = "toast" + (isError ? " error" : "");
  item.textContent = message;
  toastRegion.replaceChildren(item);
  window.setTimeout(() => item.remove(), 3800);
}

async function navigate(target, replace = false) {
  window.clearTimeout(searchTimer);
  setSidebar(false);
  const url = target instanceof URL ? target : new URL(target, location.origin);
  const selectingPublication = ["/", "/dashboard"].includes(location.pathname) && url.pathname === "/dashboard" && url.searchParams.has("publication");
  if (replace) history.replaceState({}, "", url.pathname + url.search + url.hash);
  else history.pushState({}, "", url.pathname + url.search + url.hash);
  await render({ transition: selectingPublication ? "source" : "page", resetScroll: !selectingPublication });
  if (selectingPublication) {
    const preview = document.querySelector(".evidence-folio");
    preview?.setAttribute("tabindex", "-1");
    preview?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 850px)").matches) preview?.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "instant" : "smooth" });
  } else {
    const heading = document.querySelector("#main-content h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }
}

async function displayPage(markup, transition, version, resetScroll = false) {
  const update = () => {
    if (version !== renderVersion) return;
    appRoot.innerHTML = markup;
    if (resetScroll) window.scrollTo({ top: 0, behavior: "instant" });
  };
  const sourceOnMobile = transition === "source" && window.matchMedia("(max-width: 850px)").matches;
  if (!transition || reducedMotion.matches || sourceOnMobile) {
    update();
    return;
  }
  if (!document.startViewTransition) {
    update();
    if (version === renderVersion) document.querySelector(transition === "source" ? ".evidence-folio" : ".page-content")?.classList.add(transition === "source" ? "source-enter" : "page-enter");
    return;
  }
  activeViewTransition?.skipTransition();
  document.documentElement.dataset.transition = transition;
  const viewTransition = document.startViewTransition(update);
  activeViewTransition = viewTransition;
  // Resizing or navigating again can cancel the animation after the DOM commits.
  viewTransition.ready.catch(() => {});
  viewTransition.finished.catch(() => {}).finally(() => {
    if (activeViewTransition === viewTransition) activeViewTransition = null;
  });
  try { await viewTransition.updateCallbackDone; } catch { update(); }
}

async function loadPage(path, params, meta, signal) {
  const request = (url) => api(url, { signal });
  if (path === "/complexes/import") { registryPreview=null; return renderRegistryImport(meta); }
  if(path==='/account')return renderPasswordChange(meta.access?.user);
  if (path === "/settings") {
    const [settings, users] = await Promise.all([request("/api/admin/settings"),request("/api/admin/users")]);
    let calendar=null;
    if(params.get('section')==='calendar'&&meta.access?.enabled) {
      const before=params.get('before'),version=params.get('version');
      const [active,page]=await Promise.all([request('/api/admin/calendar'),request('/api/admin/calendar/versions'+queryString({limit:10,before}))]);
      const selected=version?await request('/api/admin/calendar/versions/'+encodeURIComponent(version)):(active.configured?active:null);
      calendar={active,page,selected,before};
    }
    let sources=null,jobs=null;
    if(['sources','jobs'].includes(params.get('section'))&&meta.access?.enabled) {
      const allSources=(await request('/api/admin/sources')).items;
      if(params.get('section')==='sources') {
        const id=params.has('new')?null:params.get('source')||allSources[0]?.id;
        sources={sources:allSources,selected:id?await request('/api/admin/sources/'+encodeURIComponent(id)):null};
      } else {
        const filters={state:params.get('state')??'',kind:params.get('kind')??'',sourceId:params.get('sourceId')??''},before=params.get('before');
        const page=await request('/api/admin/jobs'+queryString({...filters,limit:20,before})),id=params.get('job')||page.items[0]?.id;
        jobs={sources:allSources,page,filters,before,selected:id?await request('/api/admin/jobs/'+encodeURIComponent(id)):null};
      }
    }
    return renderSettings(settings,users.items,{section:params.get('section'),selectedId:params.get('user'),currentUser:meta.access?.user,calendar,sources,jobs});
  }
  if (path === "/map" || path === "/") return renderMap(meta, params);
  if (path === "/dashboard") {
    const queue = meta.overview.recentAdvertisements;
    const selected = queue.find((ad) => ad.id === params.get("publication")) || queue.find((ad) => ad.proposedComplexId) || queue[0];
    const selectedPublication = selected ? await request("/api/ads/" + encodeURIComponent(selected.id)) : null;
    return renderDashboard({ ...meta, overview: { ...meta.overview, selectedPublication } }, params);
  }
  if (path === "/complexes") {
    const payload = await request("/api/complexes?" + params.toString());
    return renderRegistry(payload.items, params, meta.overview.complexes);
  }
  if (path === "/complexes/new") return renderNewComplex();
  const complexMatch = path.match(/^\/complexes\/([^/]+)$/u);
  if (complexMatch) {
    const complex = await request("/api/complexes/" + encodeURIComponent(complexMatch[1]));
    if(params.get('tab')==='complaints') {
      const before=params.get('complaintBefore'),filters={status:params.get('complaintStatus')??'',type:params.get('complaintType')??''},base='/api/complexes/'+encodeURIComponent(complex.id)+'/complaints';
      const page=await request(base+queryString({...filters,limit:5,before})),add=params.has('new'),selectedId=add?null:params.get('complaint')||page.items[0]?.id;
      const selected=selectedId?await request(base+'/'+encodeURIComponent(selectedId)):null;
      complex.complaintView={page,selected,before,add,today:meta.overview.asOf,canReview:!meta.access?.enabled||meta.access.user.role==='MIO'};
    }
    if(params.get('tab')==='legal') {
      const before=params.get('conditionBefore'),conditions=await request('/api/complexes/'+encodeURIComponent(complex.id)+'/conditions'+queryString({limit:5,before}));
      complex.conditionView={...conditions,before,canReview:!meta.access?.enabled||meta.access.user.role==='MIO'};
    }
    if(params.get('tab')==='construction') {
      const base='/api/complexes/'+encodeURIComponent(complex.id);
      const before=params.get('before'),historyAfter=params.get('historyAfter')??0;
      const [page,history]=await Promise.all([
        request(base+'/observations'+queryString({limit:10,before})),
        request(base+'/readiness-history'+queryString({limit:10,afterRevision:historyAfter}))
      ]);
      const selectedId=params.get('observation')||page.items[0]?.id;
      const selected=selectedId?(page.items.find(item=>item.id===selectedId)??await request(base+'/observations/'+encodeURIComponent(selectedId))):null;
      complex.constructionView={page,history,selected,before,historyAfter:Number(historyAfter),supersedes:params.get('supersedes'),add:params.has('add'),canManage:!meta.access?.enabled||meta.access.user.role==='MIO'};
    }
    return renderComplex(complex, params);
  }
  if (path === "/advertisements") {
    const filters = Object.fromEntries(params.entries());
    const payload = await request("/api/ads" + queryString(filters));
    return renderAdvertisements(payload.items, params.get("status") || "", filters, meta.overview.complexes,payload.platforms);
  }
  if (path === "/advertisements/new") {
    return renderNewAdvertisement(meta);
  }
  const adMatch = path.match(/^\/advertisements\/([^/]+)$/u);
  if (adMatch) return renderAdvertisementDetail(await request("/api/ads/" + encodeURIComponent(adMatch[1])), meta.overview.complexes);
  if (path === "/signals") {
    const filters=Object.fromEntries(['status','recipient','response','sort','search','complexId','before'].map(key=>[key,params.get(key)]));
    const payload = await request('/api/signals'+queryString({...filters,limit:20}));
    return renderSignals({...payload,before:params.get('before')});
  }
  const signalMatch = path.match(/^\/signals\/([^/]+)$/u);
  if (signalMatch) return renderSignal(await request("/api/signals/" + encodeURIComponent(signalMatch[1])));
  if (path === "/assistant") {
    return renderAssistantPage(meta);
  }
  if (path === "/history") {
    const payload = await request("/api/history?" + params.toString());
    return renderHistory(payload.items, params, payload.actions,payload);
  }
  return '<div class="page-error"><h1>' + escapeHtml(localeText("Страница не найдена", "Бет табылмады")) +
    '</h1><a class="button button-primary" data-route href="/dashboard">' + escapeHtml(localeText("Открыть обзор", "Шолуды ашу")) + "</a></div>";
}

async function render({ preserveForms = false, preserveFocus = false, transition = "page", resetScroll = false } = {}) {
  if(!preserveForms)calendarPreview=null;
  const version = ++renderVersion;
  renderController?.abort();
  renderController = new AbortController();
  const { signal } = renderController;
  const path = location.pathname;
  const params = new URLSearchParams(location.search);
  const formState = preserveForms ? [...appRoot.querySelectorAll('input[id],textarea[id],select[id]')].map((field) => ({ id: field.id, value: field.value, checked: field.checked,files:field.type==='file'?field.files:null })) : [];
  const disclosureState=preserveForms?[...appRoot.querySelectorAll('details[id]')].map(element=>({id:element.id,open:element.open})):[];
  const focusedId = preserveFocus || preserveForms ? document.activeElement?.id : null;
  const searchValue = focusedId === "global-search" ? document.activeElement.value : null;
  const hadPage = Boolean(currentMeta);
  document.body.classList.remove("page-loading");
  appRoot.setAttribute("aria-busy", "true");
  const loadingTimer = window.setTimeout(() => {
    if (version === renderVersion) document.body.classList.add("page-loading");
  }, 160);
  if (!hadPage) appRoot.innerHTML = shell(path, '<div class="loading-indicator" role="status">' + escapeHtml(t("loading")) + "</div>", currentMeta);
  try {
    const session = await api("/api/auth/session", { signal });
    if(version!==renderVersion)return;
    if (session.enabled && !session.user) {
      currentMeta = null;
      await displayPage(renderLogin(), null, version);
      document.title = localeText("Вход — SAQ QURYLYS", "Кіру — SAQ QURYLYS");
      return;
    }
    if(session.user?.mustChangePassword) {
      currentMeta=null;
      await displayPage(renderPasswordChange(session.user,{forced:true}),null,version);
      if(version!==renderVersion)return;
      restoreFormState(formState,disclosureState,focusedId);
      document.title=localeText('Смена временного пароля — SAQ QURYLYS','Уақытша құпиясөзді өзгерту — SAQ QURYLYS');
      return;
    }
    const meta = await api("/api/bootstrap", { signal });
    if (version !== renderVersion) return;
    currentMeta = meta;
    setDataMode(meta.dataset?.mode);
    const html = await loadPage(path, params, meta, signal);
    if (version !== renderVersion) return;
    const latestSearch = focusedId === "global-search" ? document.querySelector("#global-search")?.value ?? searchValue : null;
    currentMeta = meta;
    await displayPage(shell(path, html, meta), hadPage && !preserveForms && !preserveFocus ? transition : null, version, resetScroll);
    if (version !== renderVersion) return;
    mountMap();
    if (meta.access?.enabled) {
      const role = meta.access.user.role;
      if (role !== "MIO") {
        appRoot.querySelectorAll('[data-action="create-signal"],[data-action="signal-status"],[data-action^="review-factor"],[data-action="confirm-ad-match"],[data-action="source-removed"],[data-action="reanalyze-ad"]').forEach((element) => { element.hidden = true; });
        appRoot.querySelectorAll('#passport-form input,#passport-form textarea,#passport-form button,#manual-factor-form input,#manual-factor-form select,#manual-factor-form textarea,#manual-factor-form button,#new-ad-form input,#new-ad-form textarea,#new-ad-form select,#new-ad-form button,#new-complex-form input,#new-complex-form button').forEach((element) => { element.disabled = true; });
        appRoot.querySelectorAll('#signal-route-form,#evidence-form,#legal-review-form,#manual-match-form').forEach((element) => { element.hidden = true; });
        appRoot.querySelectorAll('#registry-import-form,[data-action="registry-commit"]').forEach(element=>{element.hidden=true;});
      }
      const responseForm = appRoot.querySelector('#signal-response-form');
      if (responseForm && responseForm.dataset.recipient !== role) responseForm.hidden = true;
    }

    restoreFormState(formState,disclosureState,focusedId,latestSearch);
    const accessForm=appRoot.querySelector('#access-user-form');if(accessForm)syncAccessOperation(accessForm);
    const calendarForm=appRoot.querySelector('#calendar-form');if(calendarForm)updateCalendarPreview(calendarForm,calendarPreview);
    const sourceForm=appRoot.querySelector('#collection-source-form');if(sourceForm)updateSourceRunButton(sourceForm);
    document.title = documentTitle(path);
  } catch (error) {
    if (signal.aborted || version !== renderVersion) return;
    await displayPage(shell(path, pageError(error), currentMeta), null, version);
    document.title = documentTitle(path);
  } finally {
    window.clearTimeout(loadingTimer);
    if (version === renderVersion) {
      document.body.classList.remove("page-loading");
      appRoot.removeAttribute("aria-busy");
    }
  }
}

function restoreFormState(formState,disclosureState,focusedId,latestSearch=null) {
  for(const field of formState) {
    const element=document.getElementById(field.id);
    if(element){if(field.files)element.files=field.files;else element.value=field.value;element.checked=field.checked;}
  }
  for(const entry of disclosureState){const element=document.getElementById(entry.id);if(element)element.open=entry.open;}
  const focused=focusedId?document.getElementById(focusedId):null;
  if(focused){if(latestSearch!==null)focused.value=latestSearch;focused.focus({preventScroll:true});}
}

function documentTitle(path) {
  if(path==='/account')return localeText('Учётная запись — SAQ QURYLYS','Тіркелгі — SAQ QURYLYS');
  if (path === "/complexes/import") return localeText("Импорт реестра — SAQ QURYLYS","Тізілімді импорттау — SAQ QURYLYS");
  if (path === "/map") return "Карта — SAQ QURYLYS";
  if (path === "/settings") return t("settings") + " — SAQ QURYLYS";
  const key = path === "/dashboard" || path === "/" ? "overview" : path.startsWith("/complexes") ? "registry" : path.startsWith("/advertisements") ? "advertisements" : path.startsWith("/signals") ? "signals" : "history";
  return t(key) + " — SAQ QURYLYS";
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function queryFromForm(form) {
  const values = formValues(form);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== "") query.set(key, value);
  }
  return query.toString();
}

async function performAction(button) {
  const action = button.dataset.action;
  if(action==='legal-review-refresh') {
    const existing=document.querySelector('#legal-review-form');if(existing?.dataset.busy)return;
    await render({preserveForms:true});
    const form=document.querySelector('#legal-review-form');if(!form||currentMeta?.access?.enabled&&currentMeta.access.user?.role!=='MIO')return;
    form.hidden=false;form.querySelector('[name="expectedUpdatedAt"]').value=form.dataset.currentVersion;
    form.querySelector('#legal-review-status').textContent=localeText('Карточка обновлена, черновик сохранён. Сверьте изменившиеся сведения перед решением.','Карточка жаңартылды, жоба сақталды. Шешім алдында өзгерген мәліметтерді салыстырыңыз.');return;
  }
  if(action==='complaint-refresh'||action==='complaint-page') {
    const existing=document.querySelector('#complaint-review-form')??document.querySelector('#complaint-intake-form');if(existing?.dataset.busy)return;
    if(action==='complaint-page')history.pushState({},'',button.dataset.target);
    await render({preserveForms:true});
    if(action==='complaint-refresh') {const form=document.querySelector('#complaint-review-form');if(!form)return;form.querySelector('[name="expectedReviewId"]').value=form.dataset.currentReview;const status=form.querySelector('.complaint-form-status');status.classList.remove('is-error');status.textContent=localeText('Карточка обновлена, черновик сохранён. Проверьте новое состояние обращения перед решением.','Карточка жаңартылды, жоба сақталды. Шешім алдында өтініштің жаңа күйін тексеріңіз.');}return;
  }
  if(action==='condition-refresh'||action==='condition-history') {
    const existing=document.querySelector('#object-conditions-form');if(existing?.dataset.busy)return;
    if(action==='condition-history')history.pushState({},'',conditionRoute(button.dataset.complexId,button.dataset.before||null));
    await render({preserveForms:true});
    if(action==='condition-refresh') {
      const form=document.querySelector('#object-conditions-form');if(!form)return;
      form.querySelector('[name="expectedContextSha256"]').value=form.dataset.currentContext;
      form.querySelector('[name="expectedReviewId"]').value=form.dataset.currentReview;
      const status=form.querySelector('#condition-form-status');status.classList.remove('is-error');status.textContent=localeText('Карточка обновлена, черновик сохранён. Сверьте изменившиеся сведения перед новым решением.','Карточка жаңартылды, жоба сақталды. Жаңа шешім алдында өзгерген мәліметтерді салыстырыңыз.');
    }return;
  }
  if(action==='sources-refresh'||action==='jobs-refresh'){toastRegion.replaceChildren();return render();}
  if(action==='source-run') {
    const form=document.querySelector('#collection-source-form');
    if(form){if(form.dataset.collectionBusy||form.dataset.busy)return;updateSourceRunButton(form);}
    if(button.disabled)return;
    button.disabled=true;
    try{const result=await api('/api/admin/sources/'+encodeURIComponent(button.dataset.sourceId)+'/run',{method:'POST',body:{expectedUpdatedAt:button.dataset.sourceVersion}});
      toast(result.created?localeText('Сбор поставлен в очередь.','Жинау кезекке қойылды.'):localeText('Активная задача уже существует. Открыто её состояние.','Белсенді тапсырма бар. Оның күйі ашылды.'));
      await navigate(jobRoute({sourceId:button.dataset.sourceId,job:result.id}));
    }finally{button.disabled=false;}return;
  }
  if(action==='job-retry') {
    button.disabled=true;
    try{await api('/api/admin/jobs/'+encodeURIComponent(button.dataset.jobId)+'/retry',{method:'POST',body:{}});toast(localeText('Повтор задачи поставлен в очередь.','Тапсырманы қайталау кезекке қойылды.'));await navigate(jobRoute({job:button.dataset.jobId,sourceId:new URLSearchParams(location.search).get('sourceId')}));}finally{button.disabled=false;}return;
  }
  if(action==='calendar-refresh')return render();
  if(action==='calendar-preview') {
    const form=document.querySelector('#calendar-form');
    if(!form||form.dataset.calendarBusy||form.dataset.busy||!form.reportValidity())return;
    const values=formValues(form);
    await submitCalendar(form,async()=>{
      const draft=calendarDraftFromValues(values),formKey=calendarDraftKey(values);
      const result=await api('/api/admin/calendar/preview',{method:'POST',body:{draft,expectedVersion:values.expectedVersion,startDate:values.previewStartDate,days:5}});
      if(!form.isConnected)return;
      if(result.mode!=='DRAFT')throw new Error(localeText('Сервер не подтвердил проверку черновика.','Сервер жобаны тексеруді растамады.'));
      calendarPreview={...result,formKey};
      const status=form.querySelector('[data-calendar-status]');if(status)status.textContent=localeText('Расчёт выполнен. Проверьте результат перед публикацией.','Есеп орындалды. Жариялау алдында нәтижені тексеріңіз.');
    },localeText('Проверка расчёта…','Есеп тексерілуде…'));return;
  }
  if(action==='calendar-copy') {
    const form=document.querySelector('#calendar-form');if(!form||form.dataset.calendarBusy||form.dataset.busy)return;
    button.disabled=true;
    try{await submitCalendar(form,async()=>{
      const definition=await api('/api/admin/calendar/versions/'+encodeURIComponent(button.dataset.calendarVersion));
      if(!form.isConnected)return;
      calendarPreview=null;fillCalendarDraft(form,definition);
      const status=form.querySelector('[data-calendar-status]');if(status)status.textContent=localeText('Версия скопирована в черновик. Проверьте источник, даты и расчёт; действующий календарь не изменён.','Нұсқа жобаға көшірілді. Дереккөзді, күндерді және есепті тексеріңіз; қолданыстағы күнтізбе өзгерген жоқ.');
      form.scrollIntoView({block:'start',behavior:reducedMotion.matches?'instant':'smooth'});
    },localeText('Загрузка сохранённой версии…','Сақталған нұсқа жүктелуде…'));}finally{button.disabled=false;}return;
  }
  if(action === "registry-template") {
    const template=await api("/api/registry/template");
    const url=URL.createObjectURL(new Blob([template.content],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement('a');link.href=url;link.download='saq-registry-template.csv';link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  if(action === "registry-commit") {
    if(!registryPreview) throw new Error(localeText("Сначала проверьте файл.","Алдымен файлды тексеріңіз."));
    const values=formValues(document.querySelector('#registry-import-form'));
    if(["source","sourceDate","content"].some(key=>values[key]!==registryPreview[key])) throw new Error(localeText("Данные изменились. Проверьте файл заново.","Деректер өзгерді. Файлды қайта тексеріңіз."));
    button.disabled=true;
    try {
      const result=await api("/api/registry/import",{method:"POST",body:registryPreview});
      registryPreview=null;toast(localeText("Добавлено объектов: ","Қосылған нысандар: ")+result.count);
      await navigate('/complexes');
    } finally {button.disabled=false;}
    return;
  }
  if (action === "toggle-sidebar") {
    setSidebar(!document.querySelector("#sidebar")?.classList.contains("open"));
    return;
  }
  if (action === "close-sidebar") return setSidebar(false);
  if (action === "set-locale") {
    setLocale(button.dataset.locale);
    document.querySelector(".skip-link").textContent = localeText("Перейти к содержимому", "Мазмұнға өту");
    await render({ preserveForms: true });
    return;
  }
  if (action === "toggle-theme") {
    const isDark = document.documentElement.dataset.theme === "dark";
    const nextTheme = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("saq-theme", nextTheme);
    toast(localeText(
      nextTheme === "dark" ? "Тёмная тема включена." : "Светлая тема включена.",
      nextTheme === "dark" ? "Қараңғы тақырып қосылды." : "Ашық тақырып қосылды."
    ));
    await render({ preserveForms: true });
    return;
  }
  if (action === "reload") return render();
  if(action==='access-refresh')return render();
  if (action === 'construction-refresh') return render({preserveForms:true});
  if (action === "use-example") {
    const examples = [
      "Старт продаж в ЖК Altai Residence. Для бронирования квартиры внесите депозит 500 000 ₸.",
      "Открываем шоурум ЖК Orda Park. Приходите посмотреть планировки.",
      "Первоначальный взнос от 20%. Оформление квартиры уже сегодня.",
    ];
    const textArea = document.querySelector("#ad-text");
    if (textArea) {
      textArea.value = examples[Number(button.dataset.exampleIndex)] || examples[0];
      textArea.focus();
      toast(localeText("Демо-текст добавлен в форму.", "Демо-мәтін формаға қосылды."));
    }
    return;
  }
  if (action === "show-legal-form") {
    const form = document.querySelector("#legal-review-form");
    if (form) {
      form.hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }
  if (action === "hide-legal-form") {
    const form = document.querySelector("#legal-review-form");
    if (form) form.hidden = true;
    return;
  }
  if (action === "print-signal") {
    window.print();
    return;
  }
  if (action === "toggle-registry-view") {
    const view = button.dataset.view;
    const panel = document.querySelector(".registry-results");
    if (panel && view) {
      panel.classList.toggle("view-table", view === "table");
      panel.classList.toggle("view-cards", view === "cards");
      document.querySelectorAll("[data-action='toggle-registry-view']").forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.view === view);
      });
    }
    return;
  }
  if (action === "logout") {
    await api("/api/auth/logout", { method: "POST", body: {} });
    await render(); return;
  }
  if (action === "source-removed") {
    await api("/api/ads/" + encodeURIComponent(button.dataset.adId) + "/source-removed", { method: "POST", body: {} });
    await render(); return;
  }
  if (action === "create-signal") {
    button.disabled = true;
    try {
      const result = await api("/api/signals", {
        method: "POST",
        body: { complexId: button.dataset.complexId },
      });
      toast(localeText("Сигнальная карточка создана.", "Сигнал карточкасы жасалды."));
      await navigate("/signals/" + encodeURIComponent(result.id));
    } catch (error) {
      button.disabled = false;
      toast(errorText(error), true);
    }
    return;
  }
  if (action === "confirm-ad-match") {
    button.disabled = true;
    try {
      const result = await api("/api/ads/" + encodeURIComponent(button.dataset.adId) + "/match", {
        method: "POST",
        body: { complexId: button.dataset.complexId },
      });
      toast(localeText("Связь подтверждена аналитиком. Гипотезы готовы к проверке.", "Байланысты талдаушы растады. Болжамдар тексеруге дайын."));
      await render();
      if (result.createdFactors.length) toast(localeText(
        "Добавлено гипотез: " + result.createdFactors.length + ". Баллы пока не начислены.",
        "Тексеруге болжам қосылды: " + result.createdFactors.length + ". Әзірге ұпай берілген жоқ.",
      ));
    } catch (error) {
      button.disabled = false;
      toast(errorText(error), true);
    }
    return;
  }
  if (action === "review-factor-confirm" || action === "review-factor-reject") {
    button.disabled = true;
    const status = action === "review-factor-confirm" ? "CONFIRMED" : "REJECTED";
    try {
      const result = await api("/api/factors/" + encodeURIComponent(button.dataset.factorId) + "/review", {
        method: "POST", body: { status, expectedStatus: button.dataset.expectedStatus },
      });
      toast(status === "CONFIRMED"
        ? localeText("Фактор подтверждён; балл пересчитан программно.", "Фактор расталды; ұпай қайта есептелді.")
        : localeText("Гипотеза отклонена; баллы не начислены.", "Болжам қабылданбады; ұпай берілген жоқ."));
      if (button.dataset.adId) {
        await render();
      } else if (button.dataset.complexId) {
        await navigate("/complexes/" + encodeURIComponent(button.dataset.complexId) + "?tab=risk");
      } else if (result.factor.complexId) {
        await navigate("/complexes/" + encodeURIComponent(result.factor.complexId) + "?tab=risk");
      } else {
        await render();
      }
    } catch (error) {
      button.disabled = false;
      toast(errorText(error), true);
    }
    return;
  }
  if (action === "reanalyze-ad") {
    button.disabled = true;
    const original = button.innerHTML;
    button.textContent = localeText("Анализ публикации…", "Жарияланым талданып жатыр…");
    try {
      await api("/api/ads/" + encodeURIComponent(button.dataset.adId) + "/analyze", { method: "POST", body: {} });
      toast(localeText("Анализ завершён.", "Талдау аяқталды."));
      await render();
    } catch (error) {
      button.innerHTML = original;
      button.disabled = false;
      toast(errorText(error), true);
    }
    return;
  }
  if (action === "signal-status") {
    const commentField = document.querySelector("#signal-comment");
    const comment = commentField?.value ?? "";
    if (button.dataset.status === "RETURNED" && !comment.trim()) {
      commentField?.setCustomValidity(getLocale() === "kz" ? "Қайтару себебін жазыңыз." : "Укажите причину возврата.");
      commentField?.reportValidity();
      commentField?.focus();
      return;
    }
    if (commentField && !commentField.reportValidity()) return;
    button.disabled = true;
    try {
      await api("/api/signals/" + encodeURIComponent(button.dataset.signalId) + "/status", {
        method: "PATCH",
        body: { status: button.dataset.status, comment },
      });
      toast(localeText("Статус сигнала обновлён; действие записано в журнал.", "Сигнал күйі жаңартылды; әрекет журналға жазылды."));
      await render();
    } catch (error) {
      button.disabled = false;
      toast(errorText(error), true);
    }
  }
}

async function readImageFile(file) {
  if(!file||!file.size||file.size>700*1024||!['image/png','image/jpeg'].includes(file.type))throw new Error(localeText('Выберите PNG или JPEG до 700 КБ.','700 КБ дейінгі PNG немесе JPEG таңдаңыз.'));
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(new Error(localeText('Не удалось прочитать файл. Выберите фото повторно.','Файл оқылмады. Фотосуретті қайта таңдаңыз.')));
    reader.readAsDataURL(file);
  });
}

async function submitConstruction(form,operation) {
  const controls=[...form.querySelectorAll('button,input,select,textarea')].map(element=>({element,disabled:element.disabled}));
  const status=form.querySelector('[data-form-status]');
  controls.forEach(({element})=>{element.disabled=true;});
  form.setAttribute('aria-busy','true');
  if(status){status.classList.remove('construction-inline-error');status.textContent=localeText('Сохранение…','Сақталуда…');}
  try {await operation();}
  catch(error){
    if(status){status.textContent=errorText(error);status.classList.add('construction-inline-error');}
    if(error.statusCode===409&&form.id==='construction-review-form') {
      const refresh=form.querySelector('[data-action="construction-refresh"]');
      if(refresh)refresh.hidden=false;
    }
    throw error;
  }
  finally {form.removeAttribute('aria-busy');controls.forEach(({element,disabled})=>{element.disabled=disabled;});}
}

async function submitAccess(form,operation) {
  const controls=[...form.querySelectorAll('button,input,select,textarea,fieldset')].map(element=>({element,disabled:element.disabled}));
  const status=form.querySelector('[data-access-status]');
  controls.forEach(({element})=>{element.disabled=true;});form.setAttribute('aria-busy','true');
  if(status){status.classList.remove('is-error');status.textContent=localeText('Сохранение…','Сақталуда…');}
  try {await operation();}
  catch(error){
    if(status){status.classList.add('is-error');status.textContent=errorText(error);}
    const refresh=form.querySelector('[data-action="access-refresh"]');if(refresh&&error.statusCode===409)refresh.hidden=false;
    throw error;
  }
  finally{form.removeAttribute('aria-busy');controls.forEach(({element,disabled})=>{element.disabled=disabled;});}
}

async function submitCalendar(form,operation,pendingText=localeText('Публикация версии…','Нұсқа жариялануда…')) {
  if(form.dataset.calendarBusy)return;
  form.dataset.calendarBusy='true';form.setAttribute('aria-busy','true');
  const controls=[...form.querySelectorAll('input,textarea,button,fieldset')].map(element=>({element,disabled:element.disabled}));
  controls.forEach(({element})=>{element.disabled=true;});
  const status=form.querySelector('[data-calendar-status]');if(status){status.classList.remove('is-error');status.textContent=pendingText;}
  try{await operation();}
  catch(error){
    calendarPreview=null;
    if(status){status.classList.add('is-error');status.textContent=errorText(error);}
    const refresh=form.querySelector('[data-action="calendar-refresh"]');if(refresh&&error.statusCode===409)refresh.hidden=false;
    throw error;
  }
  finally{
    delete form.dataset.calendarBusy;form.removeAttribute('aria-busy');controls.forEach(({element,disabled})=>{element.disabled=disabled;});
    if(form.isConnected)updateCalendarPreview(form,calendarPreview);
  }
}

async function handleForm(form) {
  if(form.id==='collection-job-filters')return navigate(jobRoute(formValues(form)));
  if(form.id==='collection-source-form') {
    const values=formValues(form),controls=[...form.querySelectorAll('input,select,button')].map(element=>({element,disabled:element.disabled}));
    form.dataset.collectionBusy='true';form.setAttribute('aria-busy','true');controls.forEach(({element})=>{element.disabled=true;});
    const status=form.querySelector('[data-collection-status]');if(status){status.classList.remove('is-error');status.textContent=localeText('Сохранение источника…','Дереккөз сақталуда…');}
    try {
      const id=form.dataset.sourceId,source=await api('/api/admin/sources'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body:sourceInputFromValues(values)});
      toast(localeText('Настройки источника сохранены.','Дереккөз баптаулары сақталды.'));if(form.isConnected)await navigate(sourceRoute(source.id));
    }catch(error){
      if(status){status.classList.add('is-error');status.textContent=errorText(error);}
      const refresh=form.querySelector('[data-action="sources-refresh"]');if(refresh&&error.statusCode===409)refresh.hidden=false;throw error;
    }finally{delete form.dataset.collectionBusy;form.removeAttribute('aria-busy');controls.forEach(({element,disabled})=>{element.disabled=disabled;});if(form.isConnected)updateSourceRunButton(form);}
    return;
  }
  if(form.id==='complaint-intake-form'||form.id==='complaint-review-form') {
    const values=formValues(form),review=form.id==='complaint-review-form',status=form.querySelector('.complaint-form-status'),controls=[...form.querySelectorAll('input,textarea,select,button')].map(element=>({element,disabled:element.disabled}));
    form.setAttribute('aria-busy','true');controls.forEach(({element})=>{element.disabled=true;});status.classList.remove('is-error');status.textContent=localeText('Сохраняем материал…','Материал сақталуда…');
    try {
      const base='/api/complexes/'+encodeURIComponent(form.dataset.complexId)+'/complaints',result=await api(base+(review?'/'+encodeURIComponent(form.dataset.complaintId)+'/review':''),{method:'POST',body:review?{...values,expectedReviewId:values.expectedReviewId||null}:values});
      toast(review?localeText('Решение сохранено; связанный фактор R4 пересчитан.','Шешім сақталды; байланысты R4 факторы қайта есептелді.'):result.created?localeText('Обращение зарегистрировано без баллов, до проверки МИО.','Өтініш ЖАО тексергенге дейін баллсыз тіркелді.'):localeText('Этот материал уже зарегистрирован. Открыта сохранённая карточка.','Бұл материал тіркелген. Сақталған карточка ашылды.'));
      if(form.isConnected)await navigate(complaintRoute(form.dataset.complexId,{complaint:result.complaint.id}));
    }catch(error){if(form.isConnected){status.textContent=errorText(error);status.classList.add('is-error');const refresh=form.querySelector('[data-action="complaint-refresh"]');if(error.statusCode===409&&refresh)refresh.hidden=false;}}
    finally{form.removeAttribute('aria-busy');controls.forEach(({element,disabled})=>{element.disabled=disabled;});}return;
  }
  if(form.id==='object-conditions-form') {
    const values=formValues(form),status=form.querySelector('#condition-form-status'),controls=[...form.querySelectorAll('input,textarea,button')].map(element=>({element,disabled:element.disabled}));
    const checks=Object.fromEntries(['documentsMatch','constructionActive','complaintsClear','delaysClear'].map(key=>[key,form.querySelector('[name="'+key+'"]').checked]));
    form.setAttribute('aria-busy','true');controls.forEach(({element})=>{element.disabled=true;});status.textContent=localeText('Сохраняем решение…','Шешім сақталуда…');status.classList.remove('is-error');
    try {
      const result=await api('/api/complexes/'+encodeURIComponent(form.dataset.complexId)+'/conditions',{method:'POST',body:{...values,checks,expectedReviewId:values.expectedReviewId||null}});
      toast(result.risk.zone==='green'?localeText('Проверка сохранена. Условия зелёной зоны подтверждены МИО.','Тексеру сақталды. Жасыл аймақ шарттарын ЖАО растады.'):localeText('Решение сохранено. Зона учитывает остальные риски и актуальность проверки.','Шешім сақталды. Аймақ өзге тәуекелдер мен тексеру өзектілігін ескереді.'));
      if(form.isConnected)await navigate(conditionRoute(form.dataset.complexId));
    }catch(error){if(form.isConnected){status.textContent=errorText(error);status.classList.add('is-error');if(error.statusCode===409)form.querySelector('[data-action="condition-refresh"]').hidden=false;}}
    finally{form.removeAttribute('aria-busy');controls.forEach(({element,disabled})=>{element.disabled=disabled;});}return;
  }
  if(form.id==='calendar-form') {
    const values=formValues(form);
    await submitCalendar(form,async()=>{
      if(!calendarPreviewMatches(values,calendarPreview))throw new Error(localeText('Сначала проверьте расчёт текущего черновика.','Алдымен ағымдағы жобаның есебін тексеріңіз.'));
      const definition=await api('/api/admin/calendar',{method:'PUT',body:{...calendarDraftFromValues(values),expectedVersion:values.expectedVersion,expectedDraftSha256:calendarPreview.draftSha256}});
      calendarPreview=null;toast(localeText('Новая версия календаря опубликована. Прежние назначения сохранены.','Күнтізбенің жаңа нұсқасы жарияланды. Бұрынғы тағайындаулар сақталды.'));
      if(form.isConnected)await navigate(calendarRoute({version:definition.version}));
    });return;
  }
  if(form.id==='own-password-form') {
    const values=formValues(form);
    await submitAccess(form,async()=>{
      if(values.newPassword!==values.confirmPassword)throw new Error(localeText('Новый пароль и повтор не совпадают.','Жаңа құпиясөз бен қайталауы сәйкес емес.'));
      await api('/api/auth/password',{method:'POST',body:{currentPassword:values.currentPassword,newPassword:values.newPassword}});
      form.reset();currentMeta=null;toast(localeText('Пароль изменён. Войдите с новым паролем.','Құпиясөз өзгертілді. Жаңа құпиясөзбен кіріңіз.'));
      await render();
    });return;
  }
  if(form.id==='access-user-form') {
    const values=formValues(form),operation=values.operation,base='/api/admin/users/'+encodeURIComponent(form.dataset.userId);
    await submitAccess(form,async()=>{
      const common={reason:values.reason,expectedUpdatedAt:values.expectedUpdatedAt};
      if(operation==='UPDATE')await api(base,{method:'PATCH',body:{...common,role:values.role,enabled:values.enabled==='true'}});
      else if(operation==='REVOKE')await api(base+'/revoke-sessions',{method:'POST',body:common});
      else if(operation==='RESET')await api(base+'/password',{method:'POST',body:{...common,newPassword:values.newPassword}});
      else throw new Error(localeText('Выберите действие с учётной записью.','Тіркелгімен әрекетті таңдаңыз.'));
      form.reset();toast(localeText('Изменение доступа сохранено в журнале.','Қолжетімділік өзгерісі журналда сақталды.'));
      if(form.isConnected)await render();
    });return;
  }
  if(form.id==='construction-upload-form') {
    const values=formValues(form),file=form.querySelector('input[type="file"]').files[0];
    await submitConstruction(form,async()=>{
      const data=await readImageFile(file);
      const {photo:ignored,...metadata}=values;
      const result=await api('/api/complexes/'+encodeURIComponent(form.dataset.complexId)+'/observations',{method:'POST',body:{...metadata,data}});
      toast(result.created?localeText('Фотоотчёт сохранён и ожидает проверки.','Фотоесеп сақталды және тексеруді күтуде.'):localeText('Такой фотоотчёт уже сохранён. Открыта существующая запись.','Мұндай фотоесеп сақталған. Қолданыстағы жазба ашылды.'));
      if(form.isConnected)await navigate(constructionRoute(form.dataset.complexId,{observation:result.observation.id}));
    });return;
  }
  if(form.id==='construction-review-form') {
    const values=formValues(form),decision=values.decision;
    if(!['CONFIRM_ONLY','CONFIRM_APPLY','REJECT'].includes(decision))throw new Error(localeText('Выберите решение.','Шешімді таңдаңыз.'));
    await submitConstruction(form,async()=>{
      await api('/api/complexes/'+encodeURIComponent(form.dataset.complexId)+'/observations/'+encodeURIComponent(form.dataset.observationId)+'/review',{method:'POST',body:{status:decision==='REJECT'?'REJECTED':'CONFIRMED',applyToReadiness:decision==='CONFIRM_APPLY',expectedStatus:'PENDING',reason:values.reason,expectedUpdatedAt:values.expectedUpdatedAt}});
      toast(localeText('Решение записано в журнал.','Шешім журналға жазылды.'));
      if(form.isConnected)await render();
    });return;
  }
  if(form.id === "registry-import-form") {
    registryPreview=null;
    document.querySelector('[data-action="registry-commit"]').hidden=true;
    const input=formValues(form);
    const preview=await api("/api/registry/preview",{method:"POST",body:input});
    if(!form.isConnected || ["source","sourceDate","content"].some(key=>formValues(form)[key]!==input[key])) return;
    document.querySelector('#registry-preview').innerHTML=renderImportPreview(preview);
    if(preview.valid) registryPreview={...input,digest:preview.digest};
    document.querySelector('[data-action="registry-commit"]').hidden=!preview.valid;
    return;
  }
  if (form.id === "new-complex-form") {
    const complex=await api("/api/complexes",{method:"POST",body:formValues(form)});
    await navigate("/complexes/"+encodeURIComponent(complex.id)+"?tab=passport");return;
  }
  if (form.id === "map-filters") return navigate("/map?"+queryFromForm(form));
  if (form.id === 'signal-inbox-filters') return navigate('/signals?'+queryFromForm(form));
  if(form.id==='complaint-filters')return navigate(complaintRoute(form.dataset.complexId,formValues(form)));
  if (form.id === "settings-form") {
    const values = formValues(form);
    const dictionary = values.dictionary.split(/\r?\n/u).filter(line=>line.trim()).map(line=>{
      const parts=line.split("|");
      if(parts.length !== 2) throw new Error(localeText("Строка словаря: формулировка | вес", "Сөздік жолы: тіркес | салмақ"));
      return {phrase:parts[0].trim(),weight:Number(parts[1].trim())};
    });
    const weights=Object.fromEntries(["R1","R2","R3","R4","R5","R6"].map(code=>[code,Number(values[code])]));
    await api("/api/admin/settings",{method:"PUT",body:{weights,dictionary,expectedVersion:form.dataset.version}});
    toast(localeText("Новая версия правил сохранена.", "Ережелердің жаңа нұсқасы сақталды.")); await render(); return;
  }
  if (form.id === "create-user-form") {
    const values=formValues(form);
    await submitAccess(form,async()=>{
      const created=await api("/api/admin/users",{method:"POST",body:{...values,mustChangePassword:form.dataset.requirePasswordChange==='true'}});
      form.reset();toast(localeText("Учётная запись создана.", "Тіркелгі жасалды."));if(form.isConnected)await navigate(userRoute(created.id));
    });return;
  }
  if (form.id === "login-form") {
    try {
      await api("/api/auth/login", { method: "POST", body: formValues(form) });
      await render();
    } catch (error) { document.querySelector("#login-error").textContent = errorText(error); }
    return;
  }
  if (form.id === "passport-form") {
    await api("/api/complexes/" + encodeURIComponent(form.dataset.complexId) + "/passport", { method: "PUT", body: formValues(form) });
    toast(localeText("Паспорт сохранён; источник записан в журнал.", "Паспорт сақталды; дереккөз журналға жазылды."));
    await render(); return;
  }
  if (["signal-route-form", "signal-response-form"].includes(form.id)) {
    await api("/api/signals/" + encodeURIComponent(form.dataset.signalId) + (form.id === "signal-route-form" ? "/route" : "/response"), { method: "POST", body: formValues(form) });
    toast(localeText("Сведения сохранены в журнале.", "Мәліметтер журналда сақталды."));
    await render(); return;
  }
  if (form.id === "evidence-form") {
    const file = form.querySelector('input[type="file"]').files[0];
    const data = await readImageFile(file);
    await api("/api/ads/" + encodeURIComponent(form.dataset.adId) + "/evidence", { method: "POST", body: { data } });
    toast(localeText("Снимок сохранён.", "Сурет сақталды.")); await render(); return;
  }
  if (form.id === "ad-filters") return navigate("/advertisements?" + queryFromForm(form));
  if (form.id === "manual-match-form") {
    const values = formValues(form);
    await api("/api/ads/" + encodeURIComponent(values.adId) + "/match", { method: "POST", body: { complexId: values.complexId } });
    toast(t("matchSaved"));
    await render();
    return;
  }
  if (form.id === "assistant-form") {
    const input = form.querySelector("#assistant-input");
    const query = input?.value.trim();
    if (!query) return;
    input.value = "";
    await sendAssistantQuery(query);
    return;
  }
  if (form.id === "registry-filters") {
    const query = queryFromForm(form);
    await navigate("/complexes" + (query ? "?" + query : ""));
    return;
  }
  if (form.id === "history-filters") {
    const query = queryFromForm(form);
    await navigate("/history" + (query ? "?" + query : ""));
    return;
  }
  if (form.id === "new-ad-form") {
    const submit = form.querySelector("#ad-submit");
    const errorBox = form.querySelector("#ad-form-error");
    submit.disabled = true;
    submit.innerHTML = '<span>' + escapeHtml(localeText("Анализ публикации…", "Жарияланым талданып жатыр…")) + "</span>";
    errorBox.hidden = true;
    try {
      const data = formValues(form);
      const result = await api("/api/ads", { method: "POST", body: data });
      toast(localeText("Публикация сохранена; анализ источника завершён.", "Жарияланым сақталды; дереккөзді талдау аяқталды."));
      await navigate("/advertisements/" + encodeURIComponent(result.id));
    } catch (error) {
      submit.disabled = false;
      submit.innerHTML = icon("search") + "<span>" + escapeHtml(t("analyze")) + "</span>";
      errorBox.textContent = errorText(error);
      errorBox.hidden = false;
      toast(errorText(error), true);
    }
    return;
  }
  if (form.id === "legal-review-form") {
    const values = formValues(form);
    const complexId = values.complexId;
    const body = { status: values.status, sourceLabel: values.sourceLabel, evidenceText: values.evidenceText, notes: values.notes,expectedUpdatedAt:values.expectedUpdatedAt };
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api("/api/complexes/" + encodeURIComponent(complexId) + "/legal-basis", { method: "POST", body });
      toast(localeText("Результат правовой проверки сохранён; балл пересчитан.", "Құқықтық тексеру нәтижесі сақталды; ұпай қайта есептелді."));
      await navigate("/complexes/" + encodeURIComponent(result.complex.id) + "?tab=legal");
    } catch (error) {
      submit.disabled = false;
      const message=form.querySelector('#legal-review-status');if(message)message.textContent=errorText(error);
      const refresh=form.querySelector('[data-action="legal-review-refresh"]');if(refresh&&error.statusCode===409)refresh.hidden=false;
      toast(errorText(error), true);
    }
    return;
  }
  if (form.id === "manual-factor-form") {
    const values = formValues(form);
    const complexId = location.pathname.split("/").at(-1);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api("/api/complexes/" + encodeURIComponent(complexId) + "/factors", { method: "POST", body: values });
      toast(localeText("Подтверждённый фактор добавлен; риск пересчитан.", "Расталған фактор қосылды; тәуекел қайта есептелді."));
      await navigate("/complexes/" + encodeURIComponent(complexId) + "?tab=risk");
    } catch (error) {
      submit.disabled = false;
      toast(errorText(error), true);
    }
  }
}

async function sendAssistantQuery(query) {
  const windowEl = document.querySelector("#assistant-chat-window");
  if (!windowEl) return;

  const userMsg = document.createElement("div");
  userMsg.className = "m3-chat-msg m3-chat-msg--user";
  userMsg.innerHTML = '<div class="m3-msg-content"><div class="m3-msg-text">' + escapeHtml(query) + '</div></div>';
  windowEl.appendChild(userMsg);

  const typingMsg = document.createElement("div");
  typingMsg.className = "m3-chat-msg m3-chat-msg--bot";
  typingMsg.id = "assistant-typing";
  typingMsg.innerHTML = '<div class="m3-msg-avatar">' + icon("bot") + '</div><div class="m3-msg-content"><div class="m3-msg-sender">' + escapeHtml(localeText("SAQ QURYLYS · Помощник", "SAQ QURYLYS · Көмекші")) + '</div><div class="m3-msg-text m3-typing-dots"><span></span><span></span><span></span></div></div>';
  windowEl.appendChild(typingMsg);
  windowEl.scrollTop = windowEl.scrollHeight;

  try {
    const res = await api("/api/assistant/consult", {
      method: "POST",
      body: { query, lang: getLocale() },
    });
    typingMsg.remove();

    const botMsg = document.createElement("div");
    botMsg.className = "m3-chat-msg m3-chat-msg--bot";

    let complexCardHtml = "";
    if (res.complex) {
      const c = res.complex;
      const score = c.risk?.score ?? c.score ?? 0;
      const category = c.displayCategory || (score >= 51 ? "red" : score <= 25 ? "green" : "yellow");
      const zoneBadge = '<span class="risk-badge risk-' + escapeHtml(category) + '"><span class="risk-dot"></span><span>' +
        escapeHtml(category === "red" ? localeText("Красная зона", "Қызыл аймақ") : category === "yellow" ? localeText("Жёлтая зона", "Сары аймақ") : localeText("Зелёная зона", "Жасыл аймақ")) +
        '</span><span class="risk-badge-score">' + score + '</span></span>';

      complexCardHtml = '<div class="m3-chat-complex-card">' +
        '<div class="m3-chat-card-head">' +
          '<strong>' + escapeHtml(c.name) + '</strong>' +
          zoneBadge +
        '</div>' +
        '<div class="m3-chat-card-sub">' + escapeHtml(c.developerName || c.developer_name || "") + ' · ' + escapeHtml(c.address || "") + '</div>' +
        '<a href="/complexes/' + encodeURIComponent(c.id) + '" data-route class="m3-btn m3-btn-small m3-btn-tonal">' +
          escapeHtml(localeText("Открыть паспорт ЖК", "ТК паспортын ашу")) + ' →' +
        '</a>' +
      '</div>';
    }

    let formatted = escapeHtml(res.answer || "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
      .replace(/^# (.+)$/gm, "<h2>$1</h2>")
      .replace(/^[•\-] (.+)$/gm, "<li>$1</li>")
      .replace(/\n\n/g, "<br><br>");

    botMsg.innerHTML = '<div class="m3-msg-avatar">' + icon("bot") + '</div>' +
      '<div class="m3-msg-content">' +
        '<div class="m3-msg-sender">' + escapeHtml(res.source || localeText("Локальный помощник", "Жергілікті көмекші")) + '</div>' +
        complexCardHtml +
        '<div class="m3-msg-text">' + formatted + '</div>' +
      '</div>';

    windowEl.appendChild(botMsg);
    windowEl.scrollTop = windowEl.scrollHeight;
  } catch (err) {
    typingMsg.remove();
    const errMsg = document.createElement("div");
    errMsg.className = "m3-chat-msg m3-chat-msg--bot";
    errMsg.innerHTML = '<div class="m3-msg-avatar">' + icon("bot") + '</div>' +
      '<div class="m3-msg-content"><div class="m3-msg-text red-text">' +
        escapeHtml(localeText("Ошибка обращения к ИИ-консультанту: ", "ЖИ-кеңесшіге жүгіну қатесі: ") + errorText(err)) +
      '</div></div>';
    windowEl.appendChild(errMsg);
    windowEl.scrollTop = windowEl.scrollHeight;
  }
}

function updateSimulatorState() {
  const container = document.querySelector(".m3-simulator-sandbox");
  if (!container) return;
  const factorButtons = [...container.querySelectorAll(".m3-sim-factor-btn")];
  let score = 0;
  const activeCodes = new Set();
  factorButtons.forEach(btn => {
    if (btn.dataset.active === "true") {
      score += Number(btn.dataset.weight || 0);
      activeCodes.add(btn.dataset.factor);
    }
  });
  score = Math.max(0, Math.min(100, score));

  let zone = "green";
  let zoneText = localeText("ЗЕЛЁНАЯ ЗОНА · 0–24", "ЖАСЫЛ АЙМАҚ · 0–24");
  let actionText = localeText("Плановое наблюдение. Неизвестные сведения требуют отдельной проверки.", "Жоспарлы бақылау. Белгісіз деректер бөлек тексерілуі керек.");
  let colorVar = "var(--green)";

  if (score >= 60 && activeCodes.has("R1") && activeCodes.has("R2")) {
    zone = "red";
    zoneText = localeText("КРАСНАЯ ЗОНА · 60+ И R1 + R2", "ҚЫЗЫЛ АЙМАҚ · 60+ ЖӘНЕ R1 + R2");
    actionText = localeText(
      "Приоритетная сигнальная карточка для проверки аналитиком. Балл не устанавливает нарушение и не отправляет материал автоматически.",
      "Талдаушы тексеретін басым сигналдық карточка. Балл заң бұзушылықты анықтамайды және материалды автоматты түрде жібермейді."
    );
    colorVar = "var(--red)";
  } else if (score >= 25) {
    zone = "amber";
    zoneText = localeText("ЖЁЛТАЯ ЗОНА (НА ПРОВЕРКЕ)", "САРЫ АЙМАҚ (ТЕКСЕРІСТЕ)");
    actionText = localeText(
      "Углублённая ручная проверка источников и подтверждённых факторов.",
      "Дереккөздер мен расталған факторларды тереңдетіп қолмен тексеру."
    );
    colorVar = "var(--amber)";
  }

  const scoreEl = container.querySelector("#m3-sim-score");
  const barEl = container.querySelector("#m3-sim-bar");
  const zoneEl = container.querySelector("#m3-sim-zone");
  const actionEl = container.querySelector("#m3-sim-action");

  if (scoreEl) scoreEl.textContent = score;
  if (barEl) {
    barEl.style.width = score + "%";
    barEl.style.background = colorVar;
  }
  if (zoneEl) {
    zoneEl.textContent = zoneText;
    zoneEl.className = "m3-result-zone-badge m3-result-zone-badge--" + (zone === "red" ? "red" : zone === "amber" ? "amber" : "green");
  }
  if (actionEl) actionEl.textContent = actionText;
}

function applySimulatorPreset(preset) {
  const container = document.querySelector(".m3-simulator-sandbox");
  if (!container) return;
  const btns = container.querySelectorAll(".m3-sim-factor-btn");
  btns.forEach(btn => {
    let shouldBeActive = false;
    const factor = btn.dataset.factor;
    if (preset === "scenario-a") shouldBeActive = ["R2", "R3"].includes(factor);
    else if (preset === "scenario-b") shouldBeActive = ["R1", "R2", "R3"].includes(factor);
    else if (preset === "scenario-c") shouldBeActive = ["R3"].includes(factor);
    else if (preset === "reset") shouldBeActive = false;

    btn.dataset.active = shouldBeActive.toString();
    btn.classList.toggle("is-active", shouldBeActive);
  });
  updateSimulatorState();
}

document.addEventListener("click", async (event) => {
  const simFactorBtn = event.target.closest(".m3-sim-factor-btn");
  if (simFactorBtn) {
    const isActive = simFactorBtn.dataset.active === "true";
    simFactorBtn.dataset.active = (!isActive).toString();
    simFactorBtn.classList.toggle("is-active", !isActive);
    updateSimulatorState();
    return;
  }
  const presetBtn = event.target.closest(".m3-preset-btn");
  if (presetBtn) {
    const preset = presetBtn.dataset.preset;
    applySimulatorPreset(preset);
    return;
  }
  const suggChip = event.target.closest(".m3-sugg-chip");
  if (suggChip && suggChip.dataset.query) {
    await sendAssistantQuery(suggChip.dataset.query);
    return;
  }
  const routeLink = event.target.closest("a[data-route]");
  if (routeLink) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    await navigate(routeLink.href);
    return;
  }
  const actionButton = event.target.closest("button[data-action]");
  if (actionButton) {
    const key = actionButton.dataset.factorId || actionButton.dataset.adId || actionButton.dataset.signalId || actionButton.dataset.action;
    if (pendingActions.has(key)) return;
    pendingActions.add(key);
    try { await performAction(actionButton); } catch (error) { toast(errorText(error), true); }
    finally { pendingActions.delete(key); }
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.dataset.busy) return;
  form.dataset.busy = "true";
  try { await handleForm(form); } catch (error) { toast(errorText(error), true); }
  finally { delete form.dataset.busy; }
});

document.addEventListener("keydown", async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    const searchInput = document.querySelector("#global-search") || document.querySelector("#map-quick-search");
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }
  if (event.key === "Escape") setSidebar(false);
  if (event.key === "Tab" && document.querySelector("#sidebar.open")) {
    const links = [...document.querySelectorAll("#sidebar a, #sidebar button")];
    const first = links[0], last = links.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === "Enter" && event.target.id === "global-search") {
    event.preventDefault();
    await navigate("/complexes" + queryString({ query: event.target.value.trim() }));
  }
});

document.addEventListener("input", (event) => {
  const sourceForm=event.target.closest('#collection-source-form');
  if(sourceForm){updateSourceRunButton(sourceForm);const status=sourceForm.querySelector('[data-collection-status]');if(status){status.classList.remove('is-error');status.textContent='';}}
  const calendarForm=event.target.closest('#calendar-form');
  if(calendarForm) {
    const hadPreview=Boolean(calendarPreview);calendarPreview=null;updateCalendarPreview(calendarForm,null);
    const status=calendarForm.querySelector('[data-calendar-status]');if(status){status.classList.remove('is-error');status.textContent=hadPreview?localeText('Черновик изменён. Повторите проверку расчёта.','Жоба өзгерді. Есепті қайта тексеріңіз.'):'';}
  }
  if(event.target.closest('#registry-import-form')) {
    registryPreview=null;
    document.querySelector('[data-action="registry-commit"]').hidden=true;
    document.querySelector('#registry-preview').textContent=localeText("После изменения данных проверьте файл заново.","Деректерді өзгерткен соң файлды қайта тексеріңіз.");
  }
  if (event.target.id === "signal-comment") event.target.setCustomValidity("");
  if (event.target.id !== "global-search") return;
  window.clearTimeout(searchTimer);
  const updateSearch = () => {
    const value = document.querySelector("#global-search")?.value.trim() ?? "";
    if (location.pathname === "/complexes") {
      const params = new URLSearchParams(location.search);
      if (value) params.set("query", value); else params.delete("query");
      history.replaceState({}, "", "/complexes?" + params.toString());
      render({ preserveFocus: true }).catch(() => {});
    }
  };
  if (!event.target.value.trim()) updateSearch();
  else searchTimer = window.setTimeout(updateSearch, 450);
});

document.addEventListener("change",async(event)=>{
  if(event.target.id==='access-operation'){syncAccessOperation(event.target.form,{clearPassword:true});return;}
  if(event.target.id !== "registry-file") return;
  const file=event.target.files?.[0];if(!file)return;
  try {
    if(file.size>700*1024) throw new Error(localeText("Файл больше 700 КБ.","Файл 700 КБ-тан үлкен."));
    const bytes=await file.arrayBuffer();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const field=document.querySelector('#registry-content');
    if(!field)return;
    field.value=text;field.dispatchEvent(new Event('input',{bubbles:true}));
  } catch { toast(localeText("Не удалось прочитать CSV. Проверьте UTF-8 и размер до 700 КБ.","CSV оқылмады. UTF-8 пішімін және 700 КБ шегін тексеріңіз."),true); }
});

function setSidebar(open) {
  window.clearTimeout(sidebarCloseTimer);
  document.body.classList.toggle("menu-open", open);
  const sidebar = document.querySelector("#sidebar");
  sidebar?.classList.toggle("open", open);
  if (open) {
    sidebar?.setAttribute("role", "dialog");
    sidebar?.setAttribute("aria-modal", "true");
    sidebar?.setAttribute("aria-label", t("mainNavigation"));
  } else {
    sidebar?.removeAttribute("role");
    sidebar?.removeAttribute("aria-modal");
    sidebar?.removeAttribute("aria-label");
  }
  const mainColumn = document.querySelector(".main-column");
  if (mainColumn) mainColumn.inert = open;
  const backdrop = document.querySelector(".sidebar-backdrop");
  if (backdrop && open) {
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      if (document.body.classList.contains("menu-open")) backdrop.classList.add("visible");
    });
  } else if (backdrop) {
    backdrop.classList.remove("visible");
    sidebarCloseTimer = window.setTimeout(() => { backdrop.hidden = true; }, reducedMotion.matches ? 0 : 180);
  }
  const menu = document.querySelector(".mobile-menu");
  menu?.setAttribute("aria-expanded", String(open));
  if (open) document.querySelector("#sidebar a")?.focus();
  else if (document.activeElement?.closest("#sidebar,.sidebar-backdrop")) menu?.focus();
}

window.matchMedia("(max-width: 850px)").addEventListener("change", (event) => { if (!event.matches) setSidebar(false); });
window.addEventListener("popstate", () => { window.clearTimeout(searchTimer); render(); });
setLocale(getLocale());
document.querySelector(".skip-link").textContent = localeText("Перейти к содержимому", "Мазмұнға өту");
render();
