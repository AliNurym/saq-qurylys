export async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw Object.assign(new Error(payload.error || "Не удалось выполнить запрос."),{statusCode:response.status});
  return payload;
}

export function queryString(values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== "" && value !== null && value !== undefined && value !== false) query.set(key, String(value));
  }
  const result = query.toString();
  return result ? "?" + result : "";
}
