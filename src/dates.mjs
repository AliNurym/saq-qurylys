export function todayInKazakhstan(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function kazakhstanDayBounds(value) {
  const noon = new Date(value + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value < "2010-01-01" || value > "9998-12-31" || Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== value) {
    const error = new Error("Укажите существующую дату в формате ГГГГ-ММ-ДД.");
    error.statusCode = 400;
    throw error;
  }
  const start = (day) => {
    const offsetName = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Qyzylorda", timeZoneName: "shortOffset" })
      .formatToParts(new Date(day + "T12:00:00Z")).find((part) => part.type === "timeZoneName").value;
    const [, sign, hours, minutes = "0"] = offsetName.match(/^GMT([+-])(\d+)(?::(\d+))?$/u);
    const offset = (Number(hours) * 60 + Number(minutes)) * 60000 * (sign === "+" ? 1 : -1);
    return new Date(Date.parse(day + "T00:00:00Z") - offset).toISOString();
  };
  const nextDay = new Date(noon.getTime() + 86400000).toISOString().slice(0, 10);
  return { start: start(value), endExclusive: start(nextDay) };
}

export function validPublicationDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= "2010-01-01" && value <= todayInKazakhstan();
}
