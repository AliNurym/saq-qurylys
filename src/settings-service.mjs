import { randomUUID } from "node:crypto";
import { FACTORS, SCORING_VERSION } from "./constants.mjs";
import { writeAudit } from "./audit-service.mjs";
import {inTransaction} from './db.mjs';

const dictionary = ["бронирование", "первоначальный взнос", "рассрочка от застройщика", "старт продаж", "предварительный договор", "внесите депозит", "цена до завершения", "инвестиционный договор", "договор резервирования"];
const caseWeights = () => Object.fromEntries([...['R1','R2','R3','R4','R5','R6'].map(code => [code, FACTORS[code].weight]), ['DELAY', 0]]);
export function initializeSettings(db) {
  db.exec("CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY,value_json TEXT NOT NULL)");
  const row = db.prepare("SELECT value_json FROM app_settings WHERE id='risk'").get();
  if (!row) return;
  const saved = JSON.parse(row.value_json);
  const weights = caseWeights();
  const caseWeightsMatch = Object.entries(weights).every(([code, weight]) => saved.weights?.[code] === weight);
  if (!String(saved.version).startsWith(SCORING_VERSION) || !caseWeightsMatch) {
    const migrated = { ...saved, version: SCORING_VERSION, weights };
    inTransaction(db,()=>{
      db.prepare("UPDATE app_settings SET value_json=? WHERE id='risk'").run(JSON.stringify(migrated));
      for (const [code, weight] of Object.entries(weights)) db.prepare("UPDATE risk_factors SET weight=? WHERE code=?").run(weight, code);
      writeAudit(db, "SYSTEM", "risk-settings", "RISK_SCORING_CASE_MIGRATED", { previousVersion: saved.version, previousWeights: saved.weights ?? {}, version: SCORING_VERSION, weights });
    });
  }
}
export function getSettings(db) {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE id='risk'").get();
  return row ? JSON.parse(row.value_json) : { version: SCORING_VERSION,
    weights: caseWeights(),
    dictionary: dictionary.map((phrase,index) => ({ phrase, weight: index === 5 ? 20 : 10 })) };
}
export function saveSettings(db, input) {
  const weights = {};
  const fail = (message) => { throw Object.assign(new Error(message), {statusCode:400}); };
  for(const code of ["R1","R2","R3","R4","R5","R6"]) {
    const value = Number(input.weights?.[code]);
    if (value !== FACTORS[code].weight) fail("Вес " + code + " зафиксирован формулой кейса Codemasters 8.0.");
    weights[code] = FACTORS[code].weight;
  }
  weights.DELAY = 0;
  if(!Array.isArray(input.dictionary) || input.dictionary.length > 60) fail("Словарь: не более 60 формулировок.");
  const entries = input.dictionary.map(item => ({ phrase: String(item.phrase ?? "").trim(), weight: Number(item.weight) }));
  if(entries.some(item => !item.phrase || item.phrase.length > 120 || !Number.isInteger(item.weight) || item.weight < 0 || item.weight > 100)) fail("Проверьте формулировки и их веса (0–100).");
  if(new Set(entries.map(item=>item.phrase.toLocaleLowerCase("ru"))).size !== entries.length) fail("В словаре есть повторяющиеся формулировки.");
  return inTransaction(db,()=>{
    const before = getSettings(db);
    if (input.expectedVersion !== before.version) throw Object.assign(new Error("Настройки уже изменены. Обновите страницу."),{statusCode:409});
    const next = { version: SCORING_VERSION + "-" + randomUUID(), weights, dictionary: entries };
    db.prepare("INSERT INTO app_settings VALUES ('risk',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify(next));
    for(const [code,weight] of Object.entries(weights)) db.prepare("UPDATE risk_factors SET weight=? WHERE code=?").run(weight,code);
    writeAudit(db,"SYSTEM","risk-settings","RISK_SETTINGS_UPDATED",{previousVersion:before.version,version:next.version,weights,phrases:entries.length});
    return next;
  });
}
export function matchRiskPhrases(db, text) {
  const lower=text.toLocaleLowerCase("ru");
  return getSettings(db).dictionary.flatMap(({phrase,weight})=>{
    const index=lower.indexOf(phrase.toLocaleLowerCase("ru"));
    return index<0 ? [] : [{phrase:text.slice(index,index+phrase.length),weight}];
  });
}
