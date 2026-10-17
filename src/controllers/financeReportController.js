const Payment = require("../models/Payment");
const Invoice = require("../models/Invoice");
const FinanceExpense = require("../models/FinanceExpense");
const TimeEntry = require("../models/TimeEntry");
const {
  MONTHS,
  istYear,
  istMonth,
  istDay,
  monthStart,
  yearStart,
  round2,
  pctChange,
  presentInvoice,
  fail,
} = require("../utils/finance");

const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
const between = (d, from, to) => new Date(d) >= from && new Date(d) < to;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

const topN = (map, n = 6) =>
  Object.entries(map)
    .map(([name, amount]) => ({ name, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);

const SERVICE_LABEL = {
  WEBSITE: "Website",
  BILLING: "Billing Software",
  SOFTWARE: "Software",
  "E-COMMERCE": "E-Commerce",
  AMC: "AMC",
  OTHER: "Other",
};
const SOURCE_LABEL = { BNI: "BNI", EVENT: "Event", META: "Meta Ads", INDIAMART: "IndiaMART", OTHER: "Other" };

// ----------------------------------------------------------------- revenue
// Revenue = money actually received (SUCCESSFUL payments), by payment date.
exports.getRevenue = async (req, res) => {
  try {
    const now = new Date();
    const thisYear = istYear(now);
    const year = Number(req.query.year) || thisYear;
    const curMonth = istMonth(now);

    const [payments, expenses] = await Promise.all([
      Payment.find({ status: "SUCCESSFUL" }).populate({
        path: "invoice",
        select: "serviceType project",
        populate: { path: "project", select: "lead", populate: { path: "lead", select: "source" } },
      }),
      FinanceExpense.find({ status: { $ne: "REJECTED" } }, "date amount"),
    ]);

    const range = (y) => payments.filter((p) => between(p.date, yearStart(y), yearStart(y + 1)));
    const cur = range(year);
    const prev = range(year - 1);

    const monthSum = (list, y, m) =>
      sum(list.filter((p) => between(p.date, monthStart(y, m), monthStart(y, m + 1))), (p) => p.amount);

    const monthly = MONTHS.map((month, m) => ({
      month,
      thisYear: round2(monthSum(cur, year, m)),
      lastYear: round2(monthSum(prev, year - 1, m)),
    }));

    // Last 5 calendar years for the "Yearly" toggle
    const yearly = Array.from({ length: 5 }, (_, i) => {
      const y = thisYear - 4 + i;
      return { month: String(y), thisYear: round2(sum(range(y), (p) => p.amount)), lastYear: 0 };
    });

    // Growth: year-to-date against the same stretch of the previous year
    const asOf = year === thisYear ? curMonth : 11;
    const curYtd = sum(monthly.slice(0, asOf + 1), (x) => x.thisYear);
    const prevYtd = sum(monthly.slice(0, asOf + 1), (x) => x.lastYear);

    const monthRevenue = year === thisYear ? monthSum(payments, thisYear, curMonth) : 0;
    const monthRevenuePrev = year === thisYear ? monthSum(payments, thisYear, curMonth - 1) : 0;
    const elapsedDays = Math.max(1, istDay(now));
    const dailyAvg = year === thisYear ? monthRevenue / elapsedDays : 0;
    const prevMonthDaily = monthRevenuePrev / daysInMonth(thisYear, curMonth - 1 < 0 ? 11 : curMonth - 1);

    // Breakdowns for the chosen year
    const byService = {};
    const bySource = {};
    const byClient = {};
    cur.forEach((p) => {
      const service = SERVICE_LABEL[p.invoice?.serviceType] || "Other";
      const source = SOURCE_LABEL[p.invoice?.project?.lead?.source] || "Direct / Not linked";
      byService[service] = (byService[service] || 0) + p.amount;
      bySource[source] = (bySource[source] || 0) + p.amount;
      byClient[p.customerName] = (byClient[p.customerName] || 0) + p.amount;
    });

    const total = sum(cur, (p) => p.amount);
    const topClients = topN(byClient).map((c) => {
      const before = sum(prev.filter((p) => p.customerName === c.name), (p) => p.amount);
      return { ...c, change: before ? pctChange(c.amount, before) : null };
    });

    const quarters = [0, 1, 2, 3].map((q) => {
      const a = sum(monthly.slice(q * 3, q * 3 + 3), (x) => x.thisYear);
      const b = sum(monthly.slice(q * 3, q * 3 + 3), (x) => x.lastYear);
      return { quarter: `Q${q + 1}`, amount: round2(a), lastYear: round2(b), change: b ? pctChange(a, b) : null };
    });

    const monthlyBreakdown = MONTHS.map((month, m) => {
      const revenue = monthly[m].thisYear;
      const spent = sum(
        expenses.filter((e) => between(e.date, monthStart(year, m), monthStart(year, m + 1))),
        (e) => e.amount,
      );
      const before = m === 0 ? monthSum(prev, year - 1, 11) : monthly[m - 1].thisYear;
      return {
        month: `${month} ${year}`,
        revenue,
        expenses: round2(spent),
        net: round2(revenue - spent),
        growth: before ? pctChange(revenue, before) : null,
      };
    });

    const years = [
      ...new Set([thisYear, ...payments.map((p) => istYear(p.date))]),
    ].sort((a, b) => b - a);

    res.json({
      success: true,
      year,
      years,
      stats: {
        total: round2(total),
        totalChange: pctChange(total, sum(prev, (p) => p.amount)),
        monthRevenue: round2(monthRevenue),
        monthChange: pctChange(monthRevenue, monthRevenuePrev),
        dailyAverage: round2(dailyAvg),
        dailyChange: pctChange(dailyAvg, prevMonthDaily),
        growthRate: curYtd || prevYtd ? pctChange(curYtd, prevYtd) : 0,
        payments: cur.length,
      },
      monthly,
      yearly,
      byService: topN(byService, 8),
      bySource: topN(bySource, 8),
      topClients,
      quarters,
      monthlyBreakdown,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ----------------------------------------------------------------- reports
// Profit & loss on a cash basis:
//   Revenue          payments received in the range
//   Team cost        logged time x hourly rate (Time Tracking)
//   Operating costs  finance expenses in the range
exports.getReports = async (req, res) => {
  try {
    const now = new Date();
    const thisYear = istYear(now);

    const from = req.query.from ? new Date(`${req.query.from}T00:00:00+05:30`) : yearStart(thisYear);
    const to = req.query.to
      ? new Date(new Date(`${req.query.to}T00:00:00+05:30`).getTime() + 86400000)
      : new Date(now.getTime() + 1);
    if (isNaN(from) || isNaN(to) || to <= from) return fail(res, 400, "Choose a valid date range");

    const [payments, expenses, time, invoices] = await Promise.all([
      Payment.find({ status: "SUCCESSFUL", date: { $gte: from, $lt: to } }),
      FinanceExpense.find({ status: { $ne: "REJECTED" }, date: { $gte: from, $lt: to } }),
      TimeEntry.find({ date: { $gte: from, $lt: to } }, "date hours hourlyRate"),
      Invoice.find({ status: "SENT" }),
    ]);

    const revenue = sum(payments, (p) => p.amount);
    const teamCost = sum(time, (t) => t.hours * t.hourlyRate);
    const opex = sum(expenses, (e) => e.amount);
    const grossProfit = revenue - teamCost;
    const netProfit = grossProfit - opex;
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

    const byCategory = {};
    expenses.forEach((e) => (byCategory[e.category] = (byCategory[e.category] || 0) + e.amount));

    // Chart: 12 months of the year the range ends in
    const chartYear = istYear(new Date(to.getTime() - 1));
    const chart = MONTHS.map((month, m) => {
      const a = monthStart(chartYear, m);
      const b = monthStart(chartYear, m + 1);
      return {
        month,
        revenue: round2(sum(payments.filter((p) => between(p.date, a, b)), (p) => p.amount)),
        expenses: round2(
          sum(expenses.filter((e) => between(e.date, a, b)), (e) => e.amount) +
            sum(time.filter((t) => between(t.date, a, b)), (t) => t.hours * t.hourlyRate),
        ),
      };
    });

    const open = invoices.map(presentInvoice).filter((i) => !["PAID", "DRAFT"].includes(i.displayStatus));

    res.json({
      success: true,
      range: { from, to: new Date(to.getTime() - 1) },
      chartYear,
      kpis: {
        grossMargin: pct(grossProfit, revenue),
        netMargin: pct(netProfit, revenue),
        netProfit: round2(netProfit),
        receivables: round2(sum(open, (i) => i.balance)),
        overdue: round2(sum(open.filter((i) => i.displayStatus === "OVERDUE"), (i) => i.balance)),
      },
      pnl: {
        revenue: round2(revenue),
        teamCost: round2(teamCost),
        grossProfit: round2(grossProfit),
        expenses: Object.entries(byCategory)
          .map(([category, amount]) => ({ category, amount: round2(amount) }))
          .sort((a, b) => b.amount - a.amount),
        totalExpenses: round2(opex),
        netProfit: round2(netProfit),
      },
      chart,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
