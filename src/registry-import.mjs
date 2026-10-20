import { createHash, randomUUID } from "node:crypto";
import { inTransaction } from "./db.mjs";
import { createComplex, validateComplexInput, PASSPORT_FIELDS } from "./passport-service.mjs";
import { getDataset } from "./dataset-service.mjs";
import { writeAudit } from "./audit-service.mjs";
import { validPublicationDate } from "./dates.mjs";

export const REGISTRY_COLUMNS = ["name", "city", "address", "developerName", "developerBin", "latitude", "longitude", ...Object.keys(PASSPORT_FIELDS)];
const required = REGISTRY_COLUMNS.slice(0, 7);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const normalize = value => String(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
const identity = row => [row.developerBin, row.city, row.address, row.name].map(normalize).join("\u0000");

// Quoted cells can contain delimiters, CR/LF and escaped double quotes.
export function parseRegistryCsv(content) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 700 * 1024) fail(400, "CSV должен быть текстом размером до 700 КБ.");
  content = content.replace(/^\uFEFF/u, "");
  const firstLine = content.split(/\r?\n/u, 1)[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  const push = () => { row.push(cell); cell = ""; closed = false; };
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === delimiter) push();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[i + 1] === "\n") i++;
      push(); if (row.some(value => value.trim())) rows.push(row); row = [];
      if (rows.length > 501) fail(400, "Один импорт: не более 500 объектов.");
    } else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"') fail(400, "Нарушены кавычки в CSV.");
      cell += char;
    }
  }
  if (quoted) fail(400, "Не закрыты кавычки в CSV.");
  push(); if (row.some(value => value.trim())) rows.push(row);
  const headers = (rows.shift() ?? []).map(value => value.trim());
  if (new Set(headers).size !== headers.length || headers.some(key => !REGISTRY_COLUMNS.includes(key)) || required.some(key => !headers.includes(key))) fail(400, "Проверьте заголовки CSV: используйте шаблон и все семь обязательных столбцов.");
  if (!rows.length || rows.length > 500) fail(400, "Один импорт: от 1 до 500 объектов.");
  return rows.map((values, index) => {
    if (values.length !== headers.length) fail(400, "Запись " + (index + 1) + ": количество столбцов не совпадает с заголовком.");
    return Object.fromEntries(headers.map((key, i) => [key, values[i].trim()]));
  });
}

export function previewRegistryImport(db, input) {
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (!source || source.length > 500) fail(400, "Укажите источник реестра (до 500 символов).");
  if (!validPublicationDate(input.sourceDate)) fail(400, "Укажите существующую дату источника не позднее сегодняшней.");
  const rows = parseRegistryCsv(input.content);
  const existing = new Set(db.prepare("SELECT name,city,address,developer_bin AS developerBin FROM complexes").all().map(identity));
  const seen = new Set(), errors = [], items = [];
  rows.forEach((row, index) => {
    const number = index + 1;
    try {
      validateComplexInput(row);
      for (const key of Object.keys(PASSPORT_FIELDS)) if ((row[key]?.length ?? 0) > 2000) fail(400, "Поле слишком длинное: " + key);
      const key = identity(row);
      if (seen.has(key)) fail(400, "Объект повторяется в файле.");
      if (existing.has(key)) fail(400, "Объект уже есть в реестре.");
      seen.add(key);
    } catch (error) { errors.push({ row: number, message: error.message }); }
    items.push({ row: number, name: row.name, city: row.city, address: row.address, developerBin: row.developerBin });
  });
  // Bind approval to the file, source, dataset mode and current identities.
  const digest = createHash("sha256").update(JSON.stringify({ rows, source, sourceDate: input.sourceDate, dataset: getDataset(db), existing: [...existing].sort() })).digest("hex");
  return { valid: !errors.length, count: rows.length, items, errors, digest, dataset: getDataset(db) };
}

export function commitRegistryImport(db, input) {
  return inTransaction(db, () => {
    const preview = previewRegistryImport(db, input);
    if (!input.digest || input.digest !== preview.digest) fail(409, "Файл, источник или реестр изменились. Выполните предварительную проверку заново.");
    if (!preview.valid) fail(400, "Исправьте все ошибки импорта. Записи не добавлены.");
    const rows = parseRegistryCsv(input.content), batchId = randomUUID(), now = new Date().toISOString();
    const items = rows.map(row => {
      const complex = createComplex(db, row, { withinTransaction: true });
      const fields = Object.fromEntries(Object.keys(PASSPORT_FIELDS).filter(key => row[key]).map(key => [key, row[key]]));
      const passport = { fields, source: input.source.trim(), verificationMode: "IMPORTED_UNVERIFIED",
        registryImport: { batchId, source: input.source.trim(), sourceDate: input.sourceDate, importedAt: now } };
      db.prepare("UPDATE complexes SET passport_json=? WHERE id=?").run(JSON.stringify(passport), complex.id);
      return { id: complex.id, objectNumber: complex.objectNumber, name: complex.name };
    });
    writeAudit(db, "SYSTEM", batchId, "REGISTRY_IMPORTED", { count: items.length, source: input.source.trim(), sourceDate: input.sourceDate, digest: preview.digest, objectIds: items.map(item => item.id), mode: preview.dataset.mode });
    return { batchId, count: items.length, items };
  });
}
