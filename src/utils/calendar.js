// Turns a stored event (possibly repeating) into the occurrences that fall in a window.
const DAY = 86400000;
const MAX_OCCURRENCES = 400;

const addStep = (date, freq, interval, n) => {
  const d = new Date(date);
  if (freq === "DAILY") return new Date(d.getTime() + n * interval * DAY);
  if (freq === "WEEKLY") return new Date(d.getTime() + n * interval * 7 * DAY);
  if (freq === "MONTHLY") { d.setUTCMonth(d.getUTCMonth() + n * interval); return d; }
  if (freq === "YEARLY") { d.setUTCFullYear(d.getUTCFullYear() + n * interval); return d; }
  return d;
};

// -> [{ start, end }] overlapping [from, to)
const occurrences = (event, from, to) => {
  const start = new Date(event.start);
  const length = new Date(event.end) - start;
  const freq = event.recurrence?.freq || "NONE";
  const overlaps = (s) => s < to && new Date(s.getTime() + length) > from;

  if (freq === "NONE") return overlaps(start) ? [{ start, end: new Date(event.end) }] : [];

  const interval = event.recurrence.interval || 1;
  const until = event.recurrence.until ? new Date(new Date(event.recurrence.until).getTime() + DAY) : null;
  const out = [];
  for (let n = 0; n < MAX_OCCURRENCES * 4 && out.length < MAX_OCCURRENCES; n++) {
    const s = addStep(start, freq, interval, n);
    if (s >= to || (until && s >= until)) break;
    if (overlaps(s)) out.push({ start: s, end: new Date(s.getTime() + length) });
  }
  return out;
};

module.exports = { occurrences };
