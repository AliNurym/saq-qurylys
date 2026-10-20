import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, openDatabase, inTransaction } from "./db.mjs";
import { getAiConfig, loadEnvFile } from "./config.mjs";
import { seedDemoData } from "./seed-data.mjs";
import { getOverview, getComplexDetails, listComplexes, listCities } from "./complex-service.mjs";
import {
  addManualFactor,
  confirmAdvertisementMatch,
  createAdvertisement,
  getAdvertisementDetails,
  listAdvertisements,
  listAdvertisementPlatforms,
  reanalyzeAdvertisement,
  reviewFactor,
  setLegalBasisStatus,
} from "./advertisement-service.mjs";
import { createSignal, getSignalDetails, transitionSignal, ensureRedSignals, routeSignal, recordResponse } from "./signal-service.mjs";
import { savePassport, createComplex } from "./passport-service.mjs";
import { addEvidence, markSourceRemoved } from "./evidence-service.mjs";
import { withUser, getSessionUser, accessEnabled, login, logout, authorize, currentActor, createUser, readScope,
  listUsers, updateUserAccess, resetUserPassword, revokeUserSessions, changeOwnPassword } from "./access-service.mjs";
import { getSettings, saveSettings } from "./settings-service.mjs";
import { runScheduledMonitoring } from "./monitoring-service.mjs";
import { getDataset, configureDataset, assertDatasetReady } from "./dataset-service.mjs";
import { previewRegistryImport, commitRegistryImport, REGISTRY_COLUMNS } from "./registry-import.mjs";
import { writeAudit } from "./audit-service.mjs";
import {listAuditPage} from './audit-page.mjs';
import { renderSignalExport } from "./signal-export.mjs";
import { listSources, getSource, saveSource, enqueueSource, listJobPage, getJob, retryJob, scheduleCollections, processNextJob } from "./collection-service.mjs";
import { getAdvertisementArchive,getJobArchive } from "./collection-evidence.mjs";
import { getBusinessCalendar, saveBusinessCalendar, previewBusinessCalendar, listBusinessCalendarPage, getBusinessCalendarVersion } from "./business-calendar.mjs";
import { addConstructionObservation, reviewConstructionObservation } from "./construction-service.mjs";
import { listConstructionObservations, getConstructionObservation, getConstructionPhoto } from "./construction-evidence.mjs";
import { getReadinessHistory } from "./readiness-service.mjs";
import {getHttpPolicy,getListenerConfig,inspectHttpRequest,applyHttpHeaders,sessionCookie,loopbackAddress} from './http-policy.mjs';
import {listSignalPage} from './signal-inbox.mjs';
import {getObjectConditions,listObjectConditionReviews,saveObjectConditions} from './object-conditions.mjs';
import {captureComplaint,reviewComplaint,listComplaints,getComplaintDetails} from './complaint-service.mjs';
import { consultAiAssistant } from "./ai-assistant.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_ROOT = resolve(PROJECT_ROOT, "public");
const MAX_BODY_BYTES = 1024 * 1024;
const REAUTHORIZE = Symbol('reauthorize-after-body');

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function sendError(response, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error("Request failed:", error?.message ?? "Unknown server error");
  if(status===429 && Number.isInteger(error.retryAfter))response.setHeader('Retry-After',String(error.retryAfter));
  sendJson(response, status, {
    error: status >= 500 ? "Не удалось выполнить действие. Попробуйте ещё раз." : error.message,
  });
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("Размер запроса превышает 1 МБ.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!bytes) {request[REAUTHORIZE]?.();return {};}
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected JSON object");
  } catch {
    const error = new Error("Проверьте формат запроса.");
    error.statusCode = 400;
    throw error;
  }
  // A slow request body must not retain privileges revoked while it was arriving.
  request[REAUTHORIZE]?.();
  return parsed;
}

function getString(url, name) {
  const value = url.searchParams.get(name);
  return value ? value.trim() : "";
}

function apiFilters(url) {
  return {
    query: getString(url, "query"),
    zone: getString(url, "zone"),
    legalStatus: getString(url, "legalStatus"),
    stage: getString(url, "stage"),
    city: getString(url, "city"),
    district: getString(url, "district"),
    hasNew: getString(url, "hasNew"),
    hasHypothesis: getString(url, "hasHypothesis"),
    needsReview: getString(url, "needsReview"),
    sort: getString(url, "sort"),
  };
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  let filePath = resolve(PUBLIC_ROOT, "." + requested);
  if (!filePath.startsWith(PUBLIC_ROOT + sep) && filePath !== PUBLIC_ROOT) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    if (extname(requested)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    filePath = resolve(PUBLIC_ROOT, "index.html");
  }
  try {
    const bytes = await readFile(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    response.writeHead(200, {
      "Content-Type": types[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

export function createHttpServer(db, { collectionWorker = true, collectionFetcher,httpPolicy=getHttpPolicy() } = {}) {
  assertDatasetReady(db);
  if(httpPolicy.publicOrigin&&!db.prepare("SELECT 1 FROM users WHERE role='ADMIN' AND disabled_at IS NULL LIMIT 1").get())throw new Error('Публичный запуск требует действующего ADMIN, созданного локально на сервере.');
  ensureRedSignals(db);
  runScheduledMonitoring(db);
  const server = createServer((request, response) => {
    applyHttpHeaders(response,httpPolicy);
    let context;
    try{
      context=inspectHttpRequest(request,httpPolicy);
      if(context.path==='/healthz'&&['GET','HEAD'].includes(request.method)) {
        try{db.prepare('SELECT mode FROM dataset_config WHERE id=1').get();return sendJson(response,200,{status:'ok'});}
        catch{return sendJson(response,503,{status:'unavailable'});}
      }
      return withUser(getSessionUser(db, request), async () => {
    try {
      const url = context.url;
      const method = request.method ?? "GET";
      const path = context.path;
      if (!["GET", "HEAD"].includes(method)) response.once("finish", () => {
        if (response.statusCode < 400) {
          try { ensureRedSignals(db); runScheduledMonitoring(db); } catch (error) { console.error("Automatic monitoring failed:", error.message); }
        }
      });

      if (path.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(method)) {
          if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return sendJson(response, 415, { error: "Требуется Content-Type: application/json." });
        }
        if (path === "/api/auth/session" && method === "GET") return sendJson(response,200,{ enabled: accessEnabled(db), user: getSessionUser(db,request) });
        if (path === "/api/auth/login" && method === "POST") {
          const result = await login(db, await readJson(request), context.clientAddress);
          response.setHeader("Set-Cookie",sessionCookie(result.token,context));
          return sendJson(response,200,{user:result.user});
        }
        if (path === "/api/auth/logout" && method === "POST") {
          logout(db,request); response.setHeader("Set-Cookie",sessionCookie('',context));
          return sendJson(response,200,{status:"ok"});
        }
        authorize(db,request,path);
        request[REAUTHORIZE]=()=>authorize(db,request,path);
        if(path==="/api/auth/password" && method==="POST") {
          const result=await changeOwnPassword(db,await readJson(request),context.clientAddress);
          response.setHeader('Set-Cookie',sessionCookie('',context));
          return sendJson(response,200,result);
        }
        const scope=readScope(db);
        if (/^\/api\/admin\/(?:sources|jobs|calendar)(?:\/|$)/u.test(path) && !accessEnabled(db)) return sendJson(response,403,{error:"Сначала создайте администратора и войдите в систему."});
        if(path==="/api/admin/calendar" && method==="GET")return sendJson(response,200,getBusinessCalendar(db));
        if(path==="/api/admin/calendar/versions" && method==="GET")return sendJson(response,200,listBusinessCalendarPage(db,{limit:Number(url.searchParams.get('limit')??20),before:url.searchParams.get('before')}));
        const calendarMatch=path.match(/^\/api\/admin\/calendar\/versions\/([^/]+)$/u);
        if(calendarMatch && method==="GET") {
          const calendar=getBusinessCalendarVersion(db,calendarMatch[1]);
          return calendar?sendJson(response,200,calendar):sendJson(response,404,{error:"Версия календаря не найдена."});
        }
        if(path==="/api/admin/calendar" && method==="PUT")return sendJson(response,200,saveBusinessCalendar(db,await readJson(request)));
        if(path==="/api/admin/calendar/preview" && method==="POST") {
          return sendJson(response,200,previewBusinessCalendar(db,await readJson(request)));
        }
        if (path === "/api/admin/sources" && method === "GET") return sendJson(response,200,{items:listSources(db)});
        if (path === "/api/admin/sources" && method === "POST") return sendJson(response,201,saveSource(db,await readJson(request)));
        let sourceMatch=path.match(/^\/api\/admin\/sources\/([^/]+)$/u);
        if(sourceMatch && method==='GET') {
          const source=getSource(db,sourceMatch[1]);
          return source?sendJson(response,200,source):sendJson(response,404,{error:'Источник не найден.'});
        }
        if(sourceMatch && method === "PUT") return sendJson(response,200,saveSource(db,await readJson(request),sourceMatch[1]));
        sourceMatch=path.match(/^\/api\/admin\/sources\/([^/]+)\/run$/u);
        if(sourceMatch && method === "POST") {
          const input=await readJson(request);return sendJson(response,202,enqueueSource(db,sourceMatch[1],new Date(),input.expectedUpdatedAt));
        }
        if(path === "/api/admin/jobs" && method === "GET") return sendJson(response,200,listJobPage(db,{limit:Number(url.searchParams.get('limit')??200),before:url.searchParams.get('before'),state:url.searchParams.get('state')??'',kind:url.searchParams.get('kind')??'',sourceId:url.searchParams.get('sourceId')??''}));
        sourceMatch=path.match(/^\/api\/admin\/jobs\/([^/]+)$/u);
        if(sourceMatch && method === "GET") {
          const job=getJob(db,sourceMatch[1]);
          return job?sendJson(response,200,job):sendJson(response,404,{error:"Задача не найдена."});
        }
        sourceMatch=path.match(/^\/api\/admin\/jobs\/([^/]+)\/retry$/u);
        if(sourceMatch && method === "POST") {await readJson(request);return sendJson(response,202,retryJob(db,sourceMatch[1]));}
        sourceMatch=path.match(/^\/api\/admin\/jobs\/([^/]+)\/archive$/u);
        if(sourceMatch&&method==='GET') {
          const archive=getJobArchive(db,sourceMatch[1]);if(!archive)return sendJson(response,404,{error:'Архив завершённого сбора не найден.'});
          response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="source-'+archive.id+(archive.mime==='application/json'?'.json':'.html')+'"',
            'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-SHA256':archive.sha256});
          return response.end(Buffer.from(archive.bytes));
        }
        if (path === "/api/admin/settings" && method === "GET") return sendJson(response,200,getSettings(db));
        if (path === "/api/admin/settings" && method === "PUT") return sendJson(response,200,saveSettings(db,await readJson(request)));
        if (path === "/api/admin/users" && method === "GET") return sendJson(response,200,{items:listUsers(db)});
        let userMatch=path.match(/^\/api\/admin\/users\/([^/]+)$/u);
        if(userMatch && method==="PATCH")return sendJson(response,200,updateUserAccess(db,userMatch[1],await readJson(request)));
        userMatch=path.match(/^\/api\/admin\/users\/([^/]+)\/password$/u);
        if(userMatch && method==="POST")return sendJson(response,200,await resetUserPassword(db,userMatch[1],await readJson(request)));
        userMatch=path.match(/^\/api\/admin\/users\/([^/]+)\/revoke-sessions$/u);
        if(userMatch && method==="POST")return sendJson(response,200,revokeUserSessions(db,userMatch[1],await readJson(request)));
        if (path === "/api/admin/users" && method === "POST") {
          const input = await readJson(request);
          if (!accessEnabled(db) && input.role !== "ADMIN") return sendJson(response,400,{error:"Первой создайте учётную запись администратора."});
          if(!accessEnabled(db) && (httpPolicy.publicOrigin||!loopbackAddress(context.clientAddress)))return sendJson(response,403,{error:"Первого администратора создайте локально на сервере."});
          const user=inTransaction(db,()=>{
            const created=createUser(db,input);
            writeAudit(db,"USER",created.id,"USER_CREATED",{username:created.username,role:created.role,mustChangePassword:created.mustChangePassword});
            return created;
          });
          return sendJson(response,201,user);
        }
        if (method === "GET" && path === "/api/health") {
          return sendJson(response, 200, {
            status: "ok",
            demo: getDataset(db).isDemo,
            dataset: getDataset(db),
            complexes: db.prepare("SELECT COUNT(*) AS count FROM complexes").get().count,
            advertisements: db.prepare("SELECT COUNT(*) AS count FROM advertisements").get().count,
          });
        }
        if (method === "GET" && path === "/api/bootstrap") {
          const ai = getAiConfig();
          return sendJson(response, 200, {
            overview: getOverview(db,scope),
            cities: scope ? [...new Set(listComplexes(db,{},scope).map(item=>item.city))].sort() : listCities(db),
            demo: getDataset(db).isDemo,
            dataset: getDataset(db),
            actor: currentActor(),
            access: { enabled: accessEnabled(db), user: getSessionUser(db,request) },
            ai: {
              provider: ai.provider,
              configured: (ai.provider === "openai" || ai.provider === "deepseek") && Boolean(ai.apiKey),
              mode: ai.provider === "deepseek" && ai.apiKey
                ? "DeepSeek API + local rules fallback"
                : "Local rules",
            },
          });
        }
        if (method === "POST" && path === "/api/assistant/consult") {
          const body = await readJson(request);
          const result = await consultAiAssistant({
            query: body.query,
            lang: body.lang || "ru",
            db,
          });
          return sendJson(response, 200, result);
        }
        if (method === "GET" && path === "/api/registry/template") return sendJson(response,200,{ content: "\uFEFF" + REGISTRY_COLUMNS.join(";") + "\r\n", columns: REGISTRY_COLUMNS });
        if (method === "POST" && path === "/api/registry/preview") return sendJson(response,200,previewRegistryImport(db,await readJson(request)));
        if (method === "POST" && path === "/api/registry/import") return sendJson(response,201,commitRegistryImport(db,await readJson(request)));
        if (method === "GET" && path === "/api/complexes") {
          return sendJson(response, 200, { items: listComplexes(db, apiFilters(url),scope) });
        }
        if (method === "POST" && path === "/api/complexes") return sendJson(response,201,createComplex(db,await readJson(request)));
        if (method === "GET" && path === "/api/ads") {
          return sendJson(response, 200, { items: listAdvertisements(db, {
            status: getString(url, "status"),
            query: getString(url, "query"),
            platform: getString(url, "platform"),
            complexId: getString(url, "complexId"),
            sort: getString(url, "sort") || "risk",
          },scope),platforms:listAdvertisementPlatforms(db,scope) });
        }
        if (method === "GET" && path === "/api/signals") {
          return sendJson(response, 200, listSignalPage(db,{status:url.searchParams.get('status')??'',recipient:url.searchParams.get('recipient')??'',response:url.searchParams.get('response')??'',sort:url.searchParams.get('sort')??'newest',search:url.searchParams.get('search')??'',complexId:url.searchParams.get('complexId')??'',limit:Number(url.searchParams.get('limit')??20),before:url.searchParams.get('before')},scope));
        }
        const conditionsMatch=path.match(/^\/api\/complexes\/([^/]+)\/conditions$/u);
        const complaintsMatch=path.match(/^\/api\/complexes\/([^/]+)\/complaints(?:\/([^/]+)(?:\/(review))?)?$/u);
        if(complaintsMatch) {
          const [,complexId,complaintId,reviewAction]=complaintsMatch;
          if(method==='GET'&&!reviewAction){if(!complaintId)return sendJson(response,200,listComplaints(db,complexId,{status:url.searchParams.get('status')??'',type:url.searchParams.get('type')??'',limit:Number(url.searchParams.get('limit')??10),before:url.searchParams.get('before')}));const detail=getComplaintDetails(db,complexId,complaintId);return detail?sendJson(response,200,detail):sendJson(response,404,{error:'Обращение не найдено.'});}
          if(method==='POST'&&!complaintId){const result=captureComplaint(db,complexId,await readJson(request));return sendJson(response,result.created?201:200,result);}
          if(method==='POST'&&reviewAction)return sendJson(response,200,reviewComplaint(db,complexId,complaintId,await readJson(request)));
        }
        if(conditionsMatch&&method==='GET')return sendJson(response,200,{state:getObjectConditions(db,conditionsMatch[1]),page:listObjectConditionReviews(db,conditionsMatch[1],{limit:Number(url.searchParams.get('limit')??10),before:url.searchParams.get('before')})});
        if(conditionsMatch&&method==='POST')return sendJson(response,201,saveObjectConditions(db,conditionsMatch[1],await readJson(request)));
        if (method === "GET" && path === "/api/history") {
          return sendJson(response, 200, listAuditPage(db, {
            entityType: getString(url, "entity"),
            action: getString(url, "action"),
            from: getString(url, "from"),
            to: getString(url, "to"),
            complexId:getString(url,'complexId'),limit:url.searchParams.get('limit')??30,before:getString(url,'before'),
          }));
        }

        let match = path.match(/^\/api\/complexes\/([^/]+)$/u);
        if (method === "GET" && match) {
          const result = getComplexDetails(db, match[1]);
          return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "Жилой комплекс не найден." });
        }
        match = path.match(/^\/api\/complexes\/([^/]+)\/passport$/u);
        if (method === "PUT" && match) return sendJson(response, 200, savePassport(db, match[1], await readJson(request)));
        match = path.match(/^\/api\/complexes\/([^/]+)\/readiness-history$/u);
        if (method === "GET" && match) {
          if (!db.prepare('SELECT 1 FROM complexes WHERE id=?').get(match[1])) return sendJson(response,404,{error:'ЖК не найден.'});
          return sendJson(response,200,getReadinessHistory(db,match[1],{limit:Number(url.searchParams.get('limit')??50),afterRevision:Number(url.searchParams.get('afterRevision')??0)}));
        }
        match = path.match(/^\/api\/complexes\/([^/]+)\/observations$/u);
        if (match && method === 'POST') {
          const result=addConstructionObservation(db,match[1],await readJson(request));
          return sendJson(response,result.created?201:200,result);
        }
        if (match && method === 'GET') {
          if (!db.prepare('SELECT 1 FROM complexes WHERE id=?').get(match[1])) return sendJson(response,404,{error:'ЖК не найден.'});
          return sendJson(response,200,listConstructionObservations(db,match[1],{limit:Number(url.searchParams.get('limit')??50),before:url.searchParams.get('before')}));
        }
        match = path.match(/^\/api\/complexes\/([^/]+)\/observations\/([^/]+)\/review$/u);
        if (match && method === 'POST') return sendJson(response,200,reviewConstructionObservation(db,match[1],match[2],await readJson(request)));
        match = path.match(/^\/api\/complexes\/([^/]+)\/observations\/([^/]+)(\/photo)?$/u);
        if (match && method === 'GET') {
          if (match[3]) {
            const photo=getConstructionPhoto(db,match[1],match[2]);
            if(!photo) return sendJson(response,404,{error:'Фотоотчёт не найден.'});
            response.writeHead(200,{'Content-Type':photo.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-SHA256':photo.sha256});
            return response.end(Buffer.from(photo.bytes));
          }
          const observation=getConstructionObservation(db,match[1],match[2]);
          return observation?sendJson(response,200,observation):sendJson(response,404,{error:'Фотоотчёт не найден.'});
        }
        match = path.match(/^\/api\/ads\/([^/]+)\/evidence$/u);
        if (method === "POST" && match) return sendJson(response, 201, addEvidence(db, match[1], await readJson(request)));
        match = path.match(/^\/api\/ads\/([^/]+)\/source-removed$/u);
        if (method === "POST" && match) return sendJson(response, 200, markSourceRemoved(db, match[1]));
        match = path.match(/^\/api\/ads\/([^/]+)\/archive$/u);
        if(method === "GET" && match) {
          const archive=getAdvertisementArchive(db,match[1]);
          if(!archive)return sendJson(response,404,{error:"Архив источника не найден."});
          response.writeHead(200,{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="source-'+archive.id+(archive.mime==='application/json'?'.json':'.html')+'"',
            "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","X-Content-SHA256":archive.sha256});
          return response.end(Buffer.from(archive.bytes));
        }
        match = path.match(/^\/api\/evidence\/([^/]+)$/u);
        if (method === "GET" && match) {
          const file = db.prepare("SELECT mime,bytes FROM evidence_files WHERE id=?").get(match[1]);
          if (!file) return sendJson(response, 404, { error: "Снимок не найден." });
          response.writeHead(200, { "Content-Type": file.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox" });
          return response.end(Buffer.from(file.bytes));
        }
        match = path.match(/^\/api\/signals\/([^/]+)\/route$/u);
        if (method === "POST" && match) return sendJson(response, 200, routeSignal(db, match[1], await readJson(request)));
        match = path.match(/^\/api\/signals\/([^/]+)\/response$/u);
        if (method === "POST" && match) return sendJson(response, 200, recordResponse(db, match[1], await readJson(request)));
        match = path.match(/^\/api\/complexes\/([^/]+)\/factors$/u);
        if (method === "POST" && match) {
          return sendJson(response, 201, addManualFactor(db, match[1], await readJson(request)));
        }
        match = path.match(/^\/api\/complexes\/([^/]+)\/legal-basis$/u);
        if (method === "POST" && match) {
          return sendJson(response, 200, setLegalBasisStatus(db, match[1], await readJson(request)));
        }
        match = path.match(/^\/api\/ads\/([^/]+)$/u);
        if (method === "GET" && match) {
          const result = getAdvertisementDetails(db, match[1]);
          return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "Публикация не найдена." });
        }
        match = path.match(/^\/api\/ads\/([^/]+)\/analyze$/u);
        if (method === "POST" && match) {
          return sendJson(response, 200, await reanalyzeAdvertisement(db, match[1]));
        }
        match = path.match(/^\/api\/ads\/([^/]+)\/match$/u);
        if (method === "POST" && match) {
          const body = await readJson(request);
          if (!body.complexId) {
            const error = new Error("Выберите жилой комплекс.");
            error.statusCode = 400;
            throw error;
          }
          return sendJson(response, 200, confirmAdvertisementMatch(db, match[1], String(body.complexId)));
        }
        match = path.match(/^\/api\/factors\/([^/]+)\/review$/u);
        if (method === "POST" && match) {
          return sendJson(response, 200, reviewFactor(db, match[1], await readJson(request)));
        }
        match = path.match(/^\/api\/signals\/([^/]+)\/export$/u);
        if (method === "GET" && match) {
          const signal = getSignalDetails(db, match[1]);
          if (!signal) return sendJson(response, 404, { error: "Сигнал не найден." });
          const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": disposition + '; filename="' + signal.id.replace(/[^A-Za-z0-9_-]/gu, "_") + '.html"' });
          return response.end(renderSignalExport(signal));
        }
        match = path.match(/^\/api\/signals\/([^/]+)$/u);
        if (method === "GET" && match) {
          const result = getSignalDetails(db, match[1]);
          return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "Сигнал не найден." });
        }
        match = path.match(/^\/api\/signals\/([^/]+)\/status$/u);
        if (method === "PATCH" && match) {
          return sendJson(response, 200, transitionSignal(db, match[1], await readJson(request)));
        }
        if (method === "POST" && path === "/api/ads") {
          return sendJson(response, 201, await createAdvertisement(db, await readJson(request)));
        }
        if (method === "POST" && path === "/api/signals") {
          const body = await readJson(request);
          if (!body.complexId) {
            const error = new Error("Выберите жилой комплекс.");
            error.statusCode = 400;
            throw error;
          }
          return sendJson(response, 201, createSignal(db, String(body.complexId)));
        }
        return sendJson(response, 404, { error: "API-маршрут не найден." });
      }

      if (method !== "GET" && method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end("Method not allowed");
        return;
      }
      if (path === "/") {
        response.writeHead(302, { Location: "/dashboard" });
        response.end();
        return;
      }
      return await serveStatic(response, path);
    } catch (error) {
      return sendError(response, error);
    }
      });
    }catch(error){return sendError(response,error);}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;
  const timer = setInterval(() => {
    try { ensureRedSignals(db); runScheduledMonitoring(db); } catch(error) { console.error("Scheduled monitoring failed:",error.message); }
  },60000);
  timer.unref();
  let stopped=false,activeCollection=null;
  const collectionTick=()=>{
    if(stopped || activeCollection)return;
    let moreWork=false;
    activeCollection=(async()=>{
      scheduleCollections(db);
      const job=await processNextJob(db,{fetcher:collectionFetcher});
      moreWork=Boolean(job);
      if(job) {ensureRedSignals(db);runScheduledMonitoring(db);}
    })().catch(()=>console.error("Background collection could not complete; inspect the job queue."))
      .finally(()=>{activeCollection=null;if(moreWork && !stopped)setImmediate(collectionTick);});
  };
  const collectionTimer=collectionWorker?setInterval(collectionTick,1000):null;
  collectionTimer?.unref();
  if(collectionWorker)server.once("listening",collectionTick);
  server.stopCollection=async()=>{stopped=true;if(collectionTimer)clearInterval(collectionTimer);await activeCollection;};
  server.once("close",()=>{clearInterval(timer);stopped=true;if(collectionTimer)clearInterval(collectionTimer);});
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvFile();
  const httpPolicy=getHttpPolicy(),listener=getListenerConfig();
  const db = openDatabase();
  const dataset=configureDataset(db,process.env.SAQ_DATA_MODE);
  if(dataset.isDemo) seedDemoData(db);
  const server = createHttpServer(db,{httpPolicy});
  const {port,host}=listener;
  server.listen(port, host, () => {
    console.log("SAQ QURYLYS is ready at http://" + host + ":" + port);
    console.log("Dataset: " + dataset.mode + "; AI mode: " + getAiConfig().provider);
  });
  let stopping=false;
  const stop = async () => {
    if(stopping)return;stopping=true;
    await server.stopCollection();
    server.close(() => {closeDatabase(db);process.exit(0);});
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
