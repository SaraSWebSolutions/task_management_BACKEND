const { MONTHS, ist, istYear, istMonth, istDay, monthStart, startOfToday, round2 } = require("./finance");

const DAY = 86400000;
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const between = (d, from, to) => !!d && new Date(d) >= from && new Date(d) < to;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const change = (now, before) =>
  before ? Math.round(((now - before) / before) * 1000) / 10 : now ? 100 : 0;

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (Indian dates, both included).
// Default: the last `defaultDays` days up to and including today.
const parseRange = (q = {}, defaultDays = 30) => {
  const end = q.to
    ? new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + DAY)
    : new Date(startOfToday().getTime() + DAY);
  const start = q.from
    ? new Date(`${q.from}T00:00:00+05:30`)
    : new Date(end.getTime() - defaultDays * DAY);

  if (isNaN(start) || isNaN(end) || end <= start) throw new Error("Choose a valid date range");
  const days = Math.round((end - start) / DAY);
  if (days > 1100) throw new Error("Date range can be at most 3 years");

  return { start, end, days, prevStart: new Date(start.getTime() - days * DAY), prevEnd: start };
};

// "2026-10-17" for an Indian calendar day
const ymd = (d) => (d ? ist(d).toISOString().slice(0, 10) : "");

const label = (d) => `${istDay(d)} ${MONTHS[istMonth(d)]}`;

// Daily buckets for ranges up to 92 days, otherwise calendar months.
const buckets = (start, end, days) => {
  const list = [];
  if (days <= 92) {
    for (let t = start.getTime(); t < end.getTime(); t += DAY) {
      list.push({ label: label(new Date(t)), from: new Date(t), to: new Date(t + DAY) });
    }
    return list;
  }
  return monthBuckets(start, end);
};

const monthBuckets = (start, end) => {
  const list = [];
  const multiYear = istYear(start) !== istYear(new Date(end.getTime() - 1));
  let y = istYear(start);
  let m = istMonth(start);
  for (;;) {
    const from = monthStart(y, m);
    if (from >= end) break;
    const to = monthStart(y, m + 1);
    list.push({
      label: multiYear ? `${MONTHS[((m % 12) + 12) % 12]} ${String(y + Math.floor(m / 12)).slice(2)}` : MONTHS[((m % 12) + 12) % 12],
      from: from < start ? start : from,
      to: to > end ? end : to,
    });
    m += 1;
  }
  return list;
};

const bucketOf = (list, d) => list.find((b) => new Date(d) >= b.from && new Date(d) < b.to);

const SERVICE_LABEL = {
  WEBSITE: "Website",
  BILLING: "Billing Software",
  SOFTWARE: "Software",
  "E-COMMERCE": "E-Commerce",
  AMC: "AMC",
  OTHER: "Other",
};
const SOURCE_LABEL = { BNI: "BNI", EVENT: "Event", META: "Meta Ads", INDIAMART: "IndiaMART", OTHER: "Other" };

// { name: amount } -> [{ name, amount, percent }] biggest first
const rank = (map, limit = 8) => {
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount: round2(amount), percent: total ? Math.round((amount / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
};

const add = (map, key, v) => {
  map[key] = (map[key] || 0) + v;
};

const failJson = (res, error, code = 500) =>
  res.status(error.message?.startsWith("Choose") || error.message?.startsWith("Date range") ? 400 : code).json({ success: false, message: error.message });

module.exports = {
  DAY,
  MONTHS,
  sum,
  between,
  pct,
  change,
  parseRange,
  ymd,
  buckets,
  monthBuckets,
  bucketOf,
  SERVICE_LABEL,
  SOURCE_LABEL,
  rank,
  add,
  failJson,
  istYear,
  istMonth,
  monthStart,
  startOfToday,
  round2,
};
