const FinanceSettings = require("../models/FinanceSettings");

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A Date shifted so getUTC* returns the Indian calendar values.
const ist = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS);
const istYear = (d) => ist(d).getUTCFullYear();
const istMonth = (d) => ist(d).getUTCMonth(); // 0-11
const istDay = (d) => ist(d).getUTCDate();

// Start of an Indian month / year as a real Date. month is 0-11 and may overflow.
const monthStart = (y, m) => new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);
const yearStart = (y) => monthStart(y, 0);
const startOfToday = () => {
  const t = ist(new Date());
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST_OFFSET_MS);
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pctChange = (now, before) =>
  before ? Math.round(((now - before) / before) * 1000) / 10 : now ? 100 : 0;

const getSettings = () =>
  FinanceSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { upsert: true, returnDocument: "after" },
  );

// Atomic counter -> "INV-0007"
const nextNumber = async (field, prefix) => {
  await getSettings();
  const s = await FinanceSettings.findOneAndUpdate(
    { key: "default" },
    { $inc: { [field]: 1 } },
    { returnDocument: "after" },
  );
  return `${prefix}-${String(s[field]).padStart(4, "0")}`;
};

// Works out subtotal / tax / total from the line items.
// Exclusive: tax is added on top. Inclusive: item prices already contain tax.
const calcInvoice = ({ items = [], discount = 0, taxRate = 0, taxInclusive = false }) => {
  const gross = items.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0),
    0,
  );
  const after = Math.max(0, gross - (Number(discount) || 0));
  const r = Number(taxRate) || 0;

  if (taxInclusive) {
    const subtotal = r ? after / (1 + r / 100) : after;
    return { subtotal: round2(subtotal), taxAmount: round2(after - subtotal), total: round2(after) };
  }
  const taxAmount = (after * r) / 100;
  return { subtotal: round2(after), taxAmount: round2(taxAmount), total: round2(after + taxAmount) };
};

// DRAFT / CANCELLED come from `status`; the rest from money and due date.
const displayStatus = (inv) => {
  if (inv.status === "CANCELLED") return "CANCELLED";
  if (inv.status === "DRAFT") return "DRAFT";
  const balance = inv.total - inv.paidAmount;
  if (inv.total > 0 && balance <= 0.005) return "PAID";
  if (new Date(inv.dueDate) < startOfToday()) return "OVERDUE";
  return inv.paidAmount > 0 ? "PARTIAL" : "PENDING";
};

const presentInvoice = (inv) => {
  const o = inv.toObject ? inv.toObject() : inv;
  return {
    ...o,
    balance: round2(Math.max(0, o.total - o.paidAmount)),
    displayStatus: displayStatus(o),
  };
};

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const pick = (body, fields) =>
  Object.fromEntries(fields.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

module.exports = {
  MONTHS,
  ist,
  istYear,
  istMonth,
  istDay,
  monthStart,
  yearStart,
  startOfToday,
  round2,
  pctChange,
  getSettings,
  nextNumber,
  calcInvoice,
  displayStatus,
  presentInvoice,
  fail,
  pick,
};
