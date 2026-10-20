function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[ё]/gu, "е")
    .replace(/[^\p{L}\p{N}+]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokens(value) {
  return new Set(normalize(value).split(" ").filter((part) => part.length > 1));
}

function tokenSimilarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return (2 * intersection) / (a.size + b.size);
}

function exactOrFuzzy(source, target) {
  const a = normalize(source);
  const b = normalize(target);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  return tokenSimilarity(a, b);
}

function digits(value) {
  return String(value ?? "").replace(/\D/gu, "").replace(/^8/u, "7");
}

function matchesContact(advertisement, complex, contacts = []) {
  const known = contacts.filter((item) => item.complexId === complex.id);
  const phone = advertisement.phone
    && known.some((item) => item.type === "PHONE" && digits(item.value) === digits(advertisement.phone));
  const account = advertisement.account
    && known.some((item) => item.type === "ACCOUNT" && normalize(item.value) === normalize(advertisement.account));
  return { matched: Boolean(phone || account), phone: Boolean(phone), account: Boolean(account) };
}

export function matchAdvertisement(advertisement, complexes, contacts = []) {
  const text = advertisement.text ?? "";
  const detectedName = advertisement.detectedComplexName ?? "";
  const detectedAddress = advertisement.detectedAddress ?? "";
  const detectedDeveloper = advertisement.detectedDeveloper ?? "";

  return complexes.map((complex) => {
    const nameSimilarity = exactOrFuzzy(detectedName || text, complex.name);
    const addressSimilarity = exactOrFuzzy(detectedAddress || text, complex.address);
    const developerSimilarity = exactOrFuzzy(detectedDeveloper || text, complex.developerName);
    const contact = matchesContact(advertisement, complex, contacts);
    const score = Math.min(1,
      nameSimilarity * 0.5
      + addressSimilarity * 0.25
      + developerSimilarity * 0.15
      + (contact.matched ? 0.1 : 0),
    );
    const reasons = [];
    if (nameSimilarity >= 0.5) reasons.push("совпало название");
    if (addressSimilarity >= 0.5) reasons.push("совпал адрес");
    if (developerSimilarity >= 0.5) reasons.push("совпал застройщик");
    if (contact.phone) reasons.push("совпал телефон");
    if (contact.account) reasons.push("совпал аккаунт");

    return {
      complexId: complex.id,
      complexName: complex.name,
      city: complex.city,
      address: complex.address,
      score: Number(score.toFixed(2)),
      confidenceLabel: score >= 0.85 ? "recommended" : score >= 0.5 ? "possible" : "weak",
      reasons,
    };
  })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function normalizeEntityText(value) {
  return normalize(value);
}
