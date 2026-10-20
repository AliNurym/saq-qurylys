import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(filePath = resolve(process.cwd(), ".env")) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export function getDatabasePath() {
  const configured = process.env.SAQ_DB_PATH || "./data/saq-qurylys.sqlite";
  return configured === ":memory:" ? configured : resolve(process.cwd(), configured);
}

export function getAiConfig() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY || "";
  const openaiKey = process.env.AI_API_KEY || "";
  const explicitProvider = process.env.AI_PROVIDER;
  const provider = explicitProvider || (deepseekKey ? "deepseek" : openaiKey ? "openai" : "local-ml");
  const apiKey = provider === "deepseek" ? deepseekKey : openaiKey;
  const model = process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || (provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini");
  return {
    provider,
    apiKey,
    model,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,
  };
}
