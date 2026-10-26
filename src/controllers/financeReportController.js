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

// The GST part of a payment: the invoice's tax in proportion to what this payment covers
const gstShare = (p) =>
  p.invoice && p.invoice.total > 0 ? (p.amount * (p.invoice.taxAmount || 0)) / p.invoice.total : 0;
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
      Payment.find({ status: "SUCCESSFUL", date: { $gte: from, $lt: to } }).populate("invoice", "taxAmount total"),
      FinanceExpense.find({ status: { $ne: "REJECTED" }, date: { $gte: from, $lt: to } }),
      TimeEntry.find({ date: { $gte: from, $lt: to } }, "date hours hourlyRate"),
      Invoice.find({ status: "SENT" }),
    ]);

    // Payments include the GST on the invoice. That part belongs to the government,
    // so it comes off before profit; GST paid on expenses comes back as a credit.
    const revenue = sum(payments, (p) => p.amount);
    const gstCollected = sum(payments, gstShare);
    const gstCredit = sum(expenses, (e) => e.taxAmount);
    const teamCost = sum(time, (t) => t.hours * t.hourlyRate);
    const opex = sum(expenses, (e) => e.amount);
    const revenueExGst = revenue - gstCollected;
    const grossProfit = revenueExGst - teamCost;
    const netProfit = grossProfit - opex + gstCredit;
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

    const open = invoices.map(presentInvoice).filter((i) => !["PAID", "DRAFT", "CANCELLED"].includes(i.displayStatus));

    res.json({
      success: true,
      range: { from, to: new Date(to.getTime() - 1) },
      chartYear,
      kpis: {
        grossMargin: pct(grossProfit, revenueExGst),
        netMargin: pct(netProfit, revenueExGst),
        netProfit: round2(netProfit),
        receivables: round2(sum(open, (i) => i.balance)),
        overdue: round2(sum(open.filter((i) => i.displayStatus === "OVERDUE"), (i) => i.balance)),
      },
      pnl: {
        revenue: round2(revenue),
        gstCollected: round2(gstCollected),
        teamCost: round2(teamCost),
        grossProfit: round2(grossProfit),
        gstCredit: round2(gstCredit),
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

// ------------------------------------------------------------ finance dashboard
// One call for the whole dashboard. "This year" is Jan 1 to today (Indian dates);
// "last period" is the same stretch of the previous year.
const { getSettings } = require("../utils/finance");
const DAY_MS = 86400000;
const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const chg = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : now ? 100 : 0);

exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const y = istYear(now);
    const m = istMonth(now);
    const tomorrow = new Date(new Date(now).setHours(23, 59, 59, 999) + 1);
    const since = yearStart(y - 4);
    const prevEnd = new Date(new Date(now).setFullYear(now.getFullYear() - 1));

    const [payments, expenses, time, invoices, settings] = await Promise.all([
      Payment.find({ status: "SUCCESSFUL", date: { $gte: since, $lt: tomorrow } }).populate("invoice", "taxAmount total issueDate"),
      FinanceExpense.find({ status: { $ne: "REJECTED" }, date: { $gte: since, $lt: tomorrow } }).select("-receipt"),
      TimeEntry.find({ date: { $gte: since, $lt: tomorrow } }, "date hours hourlyRate"),
      Invoice.find({ status: "SENT" }),
      getSettings(),
    ]);

    // Money figures for any window
    const figures = (from, to) => {
      const pay = payments.filter((p) => between(p.date, from, to));
      const exp = expenses.filter((e) => between(e.date, from, to));
      const revenue = sum(pay, (p) => p.amount);
      const gst = sum(pay, gstShare);
      const team = sum(time.filter((t) => between(t.date, from, to)), (t) => t.hours * t.hourlyRate);
      const opex = sum(exp, (e) => e.amount);
      const credit = sum(exp, (e) => e.taxAmount);
      const expensesTotal = team + opex;
      return { pay, exp, revenue, gst, team, opex, credit, expensesTotal, net: revenue - gst - expensesTotal + credit };
    };

    const ytd = figures(yearStart(y), tomorrow);
    const prev = figures(yearStart(y - 1), prevEnd);

    // Invoices raised this year and what is still owed overall
    const live = invoices.map(presentInvoice).filter((i) => !["DRAFT", "CANCELLED"].includes(i.displayStatus));
    const raised = live.filter((i) => between(i.issueDate, yearStart(y), tomorrow));
    const invoicedYtd = sum(raised, (i) => i.total);
    const collectedYtd = sum(raised, (i) => i.paidAmount);
    const open = live.filter((i) => i.balance > 0);
    const pending = sum(open, (i) => i.balance);
    const overdueList = open.filter((i) => i.displayStatus === "OVERDUE");
    const overdueAmt = sum(overdueList, (i) => i.balance);

    // Budget (monthly amounts in settings) against what was spent this year
    const months = m + 1;
    const budgets = Object.fromEntries(settings.expenseBudgets || []);
    const monthlyBudget = sum(Object.values(budgets), (v) => v);
    const byCategory = {};
    ytd.exp.forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount; });
    const totalSpent = sum(ytd.exp, (e) => e.amount);
    const budgetRows = Object.keys({ ...budgets, ...byCategory }).map((category) => {
      const budget = (budgets[category] || 0) * months;
      const spent = byCategory[category] || 0;
      return { category, budget: round2(budget), spent: round2(spent), used: budget ? Math.round((spent / budget) * 100) : null };
    }).sort((a, b) => b.spent + b.budget - (a.spent + a.budget));

    // Trend: months of this year, quarters, last five years
    const periodRow = (label, from, to) => {
      const f = figures(from, to);
      const exGst = f.revenue - f.gst;
      return { label, revenue: round2(f.revenue), net: round2(f.net), margin: exGst > 0 ? Math.round((f.net / exGst) * 1000) / 10 : 0 };
    };
    const trend = {
      monthly: Array.from({ length: m + 1 }, (_, i) => periodRow(MONTHS[i], monthStart(y, i), monthStart(y, i + 1))),
      quarterly: Array.from({ length: Math.floor(m / 3) + 1 }, (_, q) => periodRow(`Q${q + 1}`, monthStart(y, q * 3), monthStart(y, q * 3 + 3))),
      yearly: Array.from({ length: 5 }, (_, i) => periodRow(String(y - 4 + i), yearStart(y - 4 + i), yearStart(y - 3 + i))),
    };

    // Waterfall for each quarter of this year
    const waterfall = Array.from({ length: Math.floor(m / 3) + 1 }, (_, q) => {
      const f = figures(monthStart(y, q * 3), monthStart(y, q * 3 + 3));
      return { quarter: q + 1, steps: { revenue: round2(f.revenue), gst: round2(f.gst), team: round2(f.team), expenses: round2(f.opex), credit: round2(f.credit), net: round2(f.net) } };
    });

    // This month's cash movement
    const mf = figures(monthStart(y, m), tomorrow);
    const today = new Date(new Date(now).setHours(0, 0, 0, 0));
    const daily = Array.from({ length: 14 }, (_, i) => {
      const from = new Date(today.getTime() - (13 - i) * DAY_MS);
      const to = new Date(from.getTime() + DAY_MS);
      const inflow = sum(payments.filter((p) => between(p.date, from, to)), (p) => p.amount);
      const outflow = sum(expenses.filter((e) => between(e.date, from, to)), (e) => e.amount);
      return { inflow: round2(inflow), outflow: round2(outflow), net: round2(inflow - outflow) };
    });

    const byMethod = {};
    ytd.pay.forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });

    // Average days between invoice date and payment, for payments tied to an invoice
    const linked = ytd.pay.filter((p) => p.invoice?.issueDate);
    const days = linked.length ? sum(linked, (p) => Math.max(0, (new Date(p.date) - new Date(p.invoice.issueDate)) / DAY_MS)) / linked.length : null;

    const exGstYtd = ytd.revenue - ytd.gst;
    const indicators = [
      { key: "collection", label: "Collection rate", value: pctOf(collectedYtd, invoicedYtd), unit: "%", guide: "> 80%", ok: invoicedYtd ? pctOf(collectedYtd, invoicedYtd) >= 80 : null, note: "Invoiced money actually received" },
      { key: "margin", label: "Net profit margin", value: pctOf(ytd.net, exGstYtd), unit: "%", guide: "> 20%", ok: exGstYtd ? pctOf(ytd.net, exGstYtd) >= 20 : null, note: "Profit after GST, team time and expenses" },
      { key: "expense", label: "Expense ratio", value: pctOf(ytd.expensesTotal - ytd.credit, exGstYtd), unit: "%", guide: "< 70%", ok: exGstYtd ? pctOf(ytd.expensesTotal - ytd.credit, exGstYtd) <= 70 : null, note: "Costs as a share of revenue" },
      { key: "overdue", label: "Overdue share", value: pctOf(overdueAmt, pending), unit: "%", guide: "< 10%", ok: pending ? pctOf(overdueAmt, pending) <= 10 : null, note: "Late money as a share of everything owed" },
      { key: "days", label: "Days to collect", value: days == null ? null : Math.round(days), unit: " days", guide: "< 30 days", ok: days == null ? null : days <= 30, note: "Invoice date to payment, on average" },
      { key: "budget", label: "Budget used", value: monthlyBudget ? pctOf(totalSpent, monthlyBudget * months) : null, unit: "%", guide: "<= 100%", ok: monthlyBudget ? totalSpent <= monthlyBudget * months : null, note: "Year to date against your monthly budgets" },
    ];

    const approved = expenses.filter((e) => e.status === "APPROVED");
    const pendingApproval = expenses.filter((e) => e.status === "PENDING");

    const recent = [
      ...payments.slice().sort((a, b) => b.date - a.date).slice(0, 8).map((p) => ({ kind: "in", title: p.customerName, at: p.date, sub: p.method.replace("_", " "), amount: round2(p.amount), status: "Received" })),
      ...expenses.slice().sort((a, b) => b.date - a.date).slice(0, 8).map((e) => ({ kind: "out", title: e.description, at: e.date, sub: e.category, amount: round2(e.amount), status: e.status === "PAID" ? "Paid" : e.status === "APPROVED" ? "Approved" : "Pending" })),
    ].sort((a, b) => b.at - a.at).slice(0, 8);

    res.json({
      success: true,
      year: y,
      kpis: {
        revenue: { value: round2(ytd.revenue), prev: round2(prev.revenue), change: chg(ytd.revenue, prev.revenue), ring: Math.min(100, pctOf(collectedYtd, invoicedYtd)) },
        expenses: { value: round2(ytd.expensesTotal), prev: round2(prev.expensesTotal), change: chg(ytd.expensesTotal, prev.expensesTotal), ring: Math.min(100, pctOf(ytd.expensesTotal, ytd.revenue)) },
        net: { value: round2(ytd.net), prev: round2(prev.net), change: chg(ytd.net, prev.net), ring: Math.max(0, Math.min(100, pctOf(ytd.net, exGstYtd))) },
        pending: { value: round2(pending), invoices: open.length, overdue: overdueList.length, ring: Math.min(100, pctOf(pending, invoicedYtd)) },
      },
      trend,
      cashflow: {
        inflow: round2(mf.revenue), outflow: round2(sum(mf.exp, (e) => e.amount)),
        net: round2(mf.revenue - sum(mf.exp, (e) => e.amount)), daily,
      },
      waterfall,
      budget: {
        hasBudget: monthlyBudget > 0, monthly: round2(monthlyBudget),
        allocation: Object.entries(budgets).map(([category, amount]) => ({ category, amount, percent: Math.round((amount / monthlyBudget) * 100) })).sort((a, b) => b.amount - a.amount),
        rows: budgetRows,
      },
      expenseBreakdown: { total: round2(totalSpent), rows: Object.entries(byCategory).map(([category, amount]) => ({ category, amount: round2(amount), percent: pctOf(amount, totalSpent) })).sort((a, b) => b.amount - a.amount) },
      recent,
      progress: [
        { label: "Invoices collected", value: Math.min(100, pctOf(collectedYtd, invoicedYtd)), detail: `₹${Math.round(collectedYtd).toLocaleString("en-IN")} of ₹${Math.round(invoicedYtd).toLocaleString("en-IN")}` },
        ...(monthlyBudget ? [{ label: "Budget used", value: Math.min(100, pctOf(totalSpent, monthlyBudget * months)), detail: `₹${Math.round(totalSpent).toLocaleString("en-IN")} of ₹${Math.round(monthlyBudget * months).toLocaleString("en-IN")}` }] : []),
        { label: "Late money (of what is owed)", value: Math.min(100, pctOf(overdueAmt, pending)), detail: `₹${Math.round(overdueAmt).toLocaleString("en-IN")} of ₹${Math.round(pending).toLocaleString("en-IN")}`, lowerIsBetter: true },
      ],
      methods: Object.entries(byMethod).map(([method, amount]) => ({ method, amount: round2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 4),
      indicators,
      accounts: {
        receivable: { amount: round2(pending), invoices: open.length, overdue: overdueList.length },
        payable: { amount: round2(sum(approved, (e) => e.amount)), bills: approved.length, pendingApproval: pendingApproval.length },
        net: round2(pending - sum(approved, (e) => e.amount)),
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
