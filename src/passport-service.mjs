import { getComplexDetails, calculateComplexRisk, recordRiskIfChanged } from "./complex-service.mjs";
import { inTransaction } from "./db.mjs";
import { writeAudit } from "./audit-service.mjs";
import { randomUUID } from "node:crypto";
import { validPublicationDate } from "./dates.mjs";
import { getDataset } from "./dataset-service.mjs";
import { persistReadinessChange } from "./readiness-service.mjs";
import {currentActor} from './access-service.mjs';

// Applicability must be reviewed again when the identified parcel, company or documents change.
export const LEGAL_PASSPORT_FIELDS=Object.freeze(['cadastralNumber','landPurpose','authorizedCompany','constructionNotice','designDocumentation','expertConclusion','permitDetails','guaranteeDetails','kazreestr','mioRegistry','landRegistry','dduRegistry']);

export const PASSPORT_FIELDS = Object.freeze({
  district: "Район", cadastralNumber: "Кадастровый номер", landPurpose: "Назначение участка",
  authorizedCompany: "Уполномоченная компания", constructionNotice: "Уведомление о начале СМР",
  designDocumentation: "ПСД", expertConclusion: "Заключение экспертизы", permitDetails: "Разрешение на привлечение денег",
  guaranteeDetails: "Гарантия", plannedCommissioning: "Проектный срок ввода", forecastCommissioning: "Прогноз ввода",
  director: "Руководитель", founders: "Учредители", salesOffices: "Отделы продаж", websites: "Сайты",
  bankDetails: "Банковские реквизиты", previousViolations: "Ранее выявленные нарушения",
  paymentEvidence: "Подтверждённые платежи граждан и источники", paymentScheme: "Схема оплаты и вид договора",
  kazreestr: "Казреестр: результат и источник", mioRegistry: "Реестр МИО: результат и источник",
  landRegistry: "Земельный кадастр: результат и источник", dduRegistry: "Регистрация ДДУ: результат и источник",
});

export function savePassport(db, complexId, input) {
  inTransaction(db, () => {
    const current = db.prepare("SELECT * FROM complexes WHERE id=?").get(complexId);
    if (!current) throw Object.assign(new Error("ЖК не найден."), { statusCode: 404 });
    if (input.expectedUpdatedAt && current.updated_at !== input.expectedUpdatedAt) {
      throw Object.assign(new Error("Карточка уже изменена. Обновите страницу."), { statusCode: 409 });
    }
    const source = typeof input.source === 'string' ? input.source.trim() : '';
    if (!source || source.length > 500) throw Object.assign(new Error("Укажите источник сведений (до 500 символов)."), { statusCode: 400 });
    const existing = JSON.parse(current.passport_json || "{}");
    const beforeRisk = calculateComplexRisk(db, complexId);
    const fields = { ...existing.fields };
    for (const key of Object.keys(PASSPORT_FIELDS)) {
      if (!Object.hasOwn(input, key)) continue;
      if (typeof input[key] !== "string" || input[key].length > 2000) throw Object.assign(new Error("Некорректное поле: " + PASSPORT_FIELDS[key]), { statusCode: 400 });
      fields[key] = input[key].trim();
    }
    const now = new Date().toISOString();
    const passport = { ...existing, fields, source, checkedAt: now, verificationMode: "MANUAL" };
    const legalChanges=LEGAL_PASSPORT_FIELDS.filter(key=>String(fields[key]??'').trim()!==String(existing.fields?.[key]??'').trim()).map(key=>({field:key,before:existing.fields?.[key]??null,after:fields[key]??null}));
    const invalidateLegal=legalChanges.length>0&&['CONFIRMED_VALID','CONFIRMED_ABSENT'].includes(current.legal_basis_status);
    if(invalidateLegal)passport.legalRecheck={required:true,reason:'PASSPORT_LEGAL_FIELDS_CHANGED',invalidatedAt:now,changedFields:legalChanges.map(item=>item.field),previousStatus:current.legal_basis_status,previousSource:current.legal_basis_source,previousCheckedAt:current.legal_basis_checked_at};
    const readiness = {};
    for (const [prefix, column] of [["declared", "declared"], ["verified", "verified"]]) {
      const valueKey = prefix + "CompletionPercentage";
      if (!Object.hasOwn(input, valueKey)) continue;
      if (input[valueKey] !== null && !["number", "string"].includes(typeof input[valueKey])) throw Object.assign(new Error("Некорректный процент готовности."), {statusCode:400});
      const value = input[valueKey] === null || String(input[valueKey]).trim() === "" ? null : Number(input[valueKey]);
      const label = String(input[prefix + "CompletionSource"] ?? "").trim();
      const date = String(input[prefix + "CompletionCapturedAt"] ?? "");
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100 || !label || !validPublicationDate(date))) {
        throw Object.assign(new Error("Готовность: укажите процент 0–100, источник и существующую дату не позднее сегодняшней."), {statusCode:400});
      }
      if (label.length > 500) throw Object.assign(new Error("Источник готовности слишком длинный."),{statusCode:400});
      readiness[column] = {value,source:value === null ? null : label || null,date:value === null ? null : current[column + "_completion_at"]?.slice(0,10) === date ? current[column + "_completion_at"] : date + "T12:00:00.000Z"};
    }
    for(const [column, entry] of Object.entries(readiness)) {
      persistReadinessChange(db,complexId,column.toUpperCase(),entry,"Ручное обновление паспорта: " + source);
    }
    db.prepare("UPDATE complexes SET passport_json=? WHERE id=?").run(JSON.stringify(passport), complexId);
    if(invalidateLegal) {
      const affectedFactors=db.prepare("SELECT id,confirmed_by,confirmed_at FROM risk_factors WHERE complex_id=? AND code='R1' AND status='CONFIRMED'").all(complexId);
      db.prepare("UPDATE complexes SET legal_basis_status='UNDER_REVIEW' WHERE id=?").run(complexId);
      db.prepare("UPDATE risk_factors SET status='UNKNOWN',confirmed_by=NULL,confirmed_at=NULL,notes=? WHERE complex_id=? AND code='R1' AND status='CONFIRMED'").run('Нужна повторная правовая проверка после изменения реквизитов паспорта. Прежнее подтверждение не применяется к новым сведениям.',complexId);
      writeAudit(db,'COMPLEX',complexId,'LEGAL_BASIS_INVALIDATED',{source,previousStatus:current.legal_basis_status,previousSource:current.legal_basis_source,previousCheckedAt:current.legal_basis_checked_at,changes:legalChanges,affectedFactors,reason:'PASSPORT_LEGAL_FIELDS_CHANGED',actor:currentActor()});
    }
    writeAudit(db, "COMPLEX", complexId, "PASSPORT_UPDATED", { source, changedFields: Object.keys(PASSPORT_FIELDS).filter((key) => fields[key] !== existing.fields?.[key]) });
    recordRiskIfChanged(db,complexId,beforeRisk,"Обновлены сведения паспорта и готовности");
  });
  return getComplexDetails(db, complexId);
}

export function validateComplexInput(input) {
  const fail = message => {throw Object.assign(new Error(message),{statusCode:400});};
  for(const key of ["name","city","address","developerName"]) if(typeof input[key] !== "string" || input[key].trim().length < 2 || input[key].length>300) fail("Заполните название, город, адрес и застройщика.");
  if(!/^\d{12}$/u.test(input.developerBin ?? "")) fail("БИН должен содержать 12 цифр.");
  const latitude=Number(input.latitude),longitude=Number(input.longitude);
  if(!["string","number"].includes(typeof input.latitude) || !["string","number"].includes(typeof input.longitude) || String(input.latitude).trim() === "" || String(input.longitude).trim() === "" || !Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180) fail("Укажите корректные координаты объекта.");
  return { ...input, latitude, longitude };
}

export function createComplex(db,input,{ withinTransaction = false } = {}) {
  input=validateComplexInput(input);
  const {latitude,longitude}=input;
  const id="cx-"+randomUUID(),now=new Date().toISOString();
  const insert=()=>{
    const last=Number(db.prepare("SELECT MAX(CAST(substr(object_number,8) AS INTEGER)) AS n FROM complexes").get().n ?? 0);
    const objectNumber="SQ-OBJ-"+String(last+1).padStart(4,"0");
    db.prepare("INSERT INTO complexes (id,name,city,address,latitude,longitude,developer_name,developer_bin,construction_stage,commissioning_status,legal_basis_status,created_at,updated_at,is_demo,object_number) VALUES (?,?,?,?,?,?,?,?,?,'UNDER_CONSTRUCTION','UNKNOWN',?,?,?,?)")
      .run(id,input.name.trim(),input.city.trim(),input.address.trim(),latitude,longitude,input.developerName.trim(),input.developerBin,"Не внесено",now,now,Number(getDataset(db).isDemo),objectNumber);
    writeAudit(db,"COMPLEX",id,"COMPLEX_CREATED",{complexId:id,objectNumber,name:input.name});
  };
  if(withinTransaction) insert(); else inTransaction(db,insert);
  return getComplexDetails(db,id);
}
