export function paymentFeatures(text) {
  const tokens = String(text).normalize("NFKC").toLowerCase().replaceAll("ё", "е")
    .match(/[\p{L}]+|\d+(?:[.,]\d+)?|₸/gu) ?? [];
  const normalized = tokens.map((token) => /^\d/u.test(token) ? "NUMBER" : token.length > 7 ? token.slice(0, 7) : token);
  return [...new Set([...normalized.map((token) => "w:" + token), ...normalized.slice(1).map((token, index) => "b:" + normalized[index] + " " + token)])];
}
