const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const FinanceExpense = require("../models/FinanceExpense");
const Subscription = require("../models/Subscription");
const Deal = require("../models/Deal");
const Lead = require("../models/Lead");
const {
  DAY, MONTHS, sum, between, pct, change, parseRange, buckets, monthBuckets, bucketOf,
  SERVICE_LABEL, SOURCE_LABEL, rank, add, failJson, istYear, istMonth, monthStart, startOfToday, round2,
} = require("../utils/analytics");

const leadPopulate = { path: "project", select: "lead", populate: { path: "lead", select: "source" } };
const sourceOf = (invoice) => SOURCE_LABEL[invoice.project?.lead?.source] || "Direct / Not linked";
const dealDate = (d) => d.closeDate || d.updatedAt;

// ------------------------------------------------------------------- sales
// Sales = invoices raised in the period (sent invoices, tax included).
exports.sales = async (req, res) => {
  try {
    const r = parseRange(req.query);
    const [invoices, refunds, deals] = await Promise.all([
      Invoice.find({ status: "SENT", issueDate: { $gte: r.prevStart, $lt: r.end } }).populate(leadPopulate),
      Payment.find({ status: "REFUNDED", date: { $gte: r.prevStart, $lt: r.end } }, "amount date"),
      Deal.find({ stage: "CLOSED_WON" }, "value closeDate updatedAt"),
    ]);

    const cur = invoices.filter((i) => between(i.issueDate, r.start, r.end));
    const prev = invoices.filter((i) => between(i.issueDate, r.prevStart, r.prevEnd));
    const total = sum(cur, (i) => i.total);
    const prevTotal = sum(prev, (i) => i.total);
    const avg = cur.length ? total / cur.length : 0;
    const prevAvg = prev.length ? prevTotal / prev.length : 0;

    const wonNow = deals.filter((d) => between(dealDate(d), r.start, r.end));
    const wonPrev = deals.filter((d) => between(dealDate(d), r.prevStart, r.prevEnd));
    const refunded = sum(refunds.filter((p) => between(p.date, r.start, r.end)), (p) => p.amount);
    const refundedPrev = sum(refunds.filter((p) => between(p.date, r.prevStart, r.prevEnd)), (p) => p.amount);

    const trend = buckets(r.start, r.end, r.days).map((b) => ({ ...b, amount: 0, count: 0 }));
    cur.forEach((i) => {
      const b = bucketOf(trend, i.issueDate);
      if (b) { b.amount += i.total; b.count += 1; }
    });

    const byService = {}, bySource = {}, byClient = {}, byClientPrev = {};
    cur.forEach((i) => {
      add(byService, SERVICE_LABEL[i.serviceType] || "Other", i.total);
      add(bySource, sourceOf(i), i.total);
      add(byClient, i.clientName, i.total);
    });
    prev.forEach((i) => add(byClientPrev, i.clientName, i.total));

    res.json({
      success: true,
      range: { from: r.start, to: new Date(r.end.getTime() - 1), days: r.days },
      kpis: {
        totalSales: round2(total), salesChange: change(total, prevTotal),
        invoices: cur.length, invoicesChange: change(cur.length, prev.length),
        avgInvoice: round2(avg), avgChange: change(avg, prevAvg),
        dealsWon: wonNow.length, dealsWonValue: round2(sum(wonNow, (d) => d.value)), dealsWonChange: change(wonNow.length, wonPrev.length),
        refunded: round2(refunded), refundedChange: change(refunded, refundedPrev),
      },
      trend: trend.map((b) => ({ label: b.label, amount: round2(b.amount), count: b.count })),
      byService: rank(byService),
      bySource: rank(bySource),
      topClients: rank(byClient, 10).map((c) => ({
        ...c,
        invoices: cur.filter((i) => i.clientName === c.name).length,
        change: byClientPrev[c.name] ? change(c.amount, byClientPrev[c.name]) : null,
      })),
    });
  } catch (error) {
    failJson(res, error);
  }
};

// ----------------------------------------------------------------- revenue
// Revenue = money received (successful payments) on the payment date.
exports.revenue = async (req, res) => {
  try {
    const now = new Date();
    const y = istYear(now);
    const m = istMonth(now);

    const r = parseRange({ from: req.query.from || `${y}-01-01`, to: req.query.to }, 365);
    const lowest = new Date(Math.min(r.prevStart, monthStart(y, m - 6)));

    const [payments, expenses, subs] = await Promise.all([
      Payment.find({ status: "SUCCESSFUL", date: { $gte: lowest, $lt: new Date(Math.max(r.end.getTime(), Date.now() + DAY)) } }).populate("invoice", "serviceType"),
      FinanceExpense.find({ status: { $ne: "REJECTED" }, date: { $gte: r.start, $lt: r.end } }, "amount"),
      Subscription.find({ status: { $in: ["ACTIVE", "PAST_DUE"] } }, "amount billingCycle"),
    ]);

    const service = (p) => SERVICE_LABEL[p.invoice?.serviceType] || "Other";
    const cur = payments.filter((p) => between(p.date, r.start, r.end));
    const prev = payments.filter((p) => between(p.date, r.prevStart, r.prevEnd));
    const gross = sum(cur, (p) => p.amount);
    const prevGross = sum(prev, (p) => p.amount);
    const net = gross - sum(expenses, (e) => e.amount);

    // Month by month, split by service for the stacked chart
    const months = monthBuckets(r.start, r.end).map((b) => ({ ...b, total: 0, services: {} }));
    const serviceKeys = new Set();
    cur.forEach((p) => {
      const b = bucketOf(months, p.date);
      if (!b) return;
      b.total += p.amount;
      add(b.services, service(p), p.amount);
      serviceKeys.add(service(p));
    });

    // Run rate: last 90 days x 365/90
    const last90 = sum(payments.filter((p) => between(p.date, new Date(r.end.getTime() - 90 * DAY), r.end)), (p) => p.amount);

    // This month vs last month, independent of the chosen range
    const thisM = monthStart(y, m), lastM = monthStart(y, m - 1);
    const monthSum = (from, to, list = payments) => sum(list.filter((p) => between(p.date, from, to)), (p) => p.amount);
    const thisMonth = monthSum(thisM, monthStart(y, m + 1));
    const lastMonth = monthSum(lastM, thisM);

    const mrr = sum(subs, (s) => (s.billingCycle === "YEARLY" ? s.amount / 12 : s.amount));

    // Forecast: the last 6 complete months, straight-line trend, next 4 quarters
    const hist = Array.from({ length: 6 }, (_, i) => monthSum(monthStart(y, m - 6 + i), monthStart(y, m - 5 + i)));
    const active = hist.filter((v) => v > 0).length;
    let forecast = [];
    if (active >= 3) {
      const n = hist.length;
      const xm = (n - 1) / 2;
      const ym = hist.reduce((a, b) => a + b, 0) / n;
      const slope = hist.reduce((s, v, i) => s + (i - xm) * (v - ym), 0) / hist.reduce((s, _, i) => s + (i - xm) ** 2, 0);
      const mean = ym;
      const spread = Math.sqrt(hist.reduce((s, v) => s + (v - mean) ** 2, 0) / n) / (mean || 1);
      forecast = Array.from({ length: 4 }, (_, q) => {
        let amount = 0;
        for (let k = 0; k < 3; k++) amount += Math.max(0, ym + slope * (n + q * 3 + k - xm));
        const first = monthStart(y, m + q * 3);
        const last = monthStart(y, m + q * 3 + 2);
        const [y1, m1, y2, m2] = [istYear(first), istMonth(first), istYear(last), istMonth(last)];
        return {
          quarter: y1 === y2 ? `${MONTHS[m1]} - ${MONTHS[m2]} ${y1}` : `${MONTHS[m1]} ${y1} - ${MONTHS[m2]} ${y2}`,
          amount: round2(amount),
          confidence: q === 0 && spread < 0.3 ? "High" : q <= 1 && spread < 0.6 ? "Medium" : "Low",
        };
      });
    }

    const keys = [...serviceKeys];
    const curMonthByService = {}, lastMonthByService = {};
    payments.filter((p) => between(p.date, thisM, monthStart(y, m + 1))).forEach((p) => add(curMonthByService, service(p), p.amount));
    payments.filter((p) => between(p.date, lastM, thisM)).forEach((p) => add(lastMonthByService, service(p), p.amount));

    res.json({
      success: true,
      range: { from: r.start, to: new Date(r.end.getTime() - 1) },
      kpis: {
        gross: round2(gross), grossChange: change(gross, prevGross),
        net: round2(net), netChange: null,
        growth: change(gross, prevGross),
        projectedAnnual: round2((last90 / 90) * 365),
        payments: cur.length,
      },
      overTime: months.map((b) => ({ label: b.label, amount: round2(b.total) })),
      stacked: months.map((b) => ({ label: b.label, ...Object.fromEntries(keys.map((k) => [k, round2(b.services[k] || 0)])) })),
      serviceKeys: keys,
      recurring: { mrr: round2(mrr), arr: round2(mrr * 12), subscribers: subs.length },
      monthCompare: { thisMonth: round2(thisMonth), lastMonth: round2(lastMonth), diff: round2(thisMonth - lastMonth), change: change(thisMonth, lastMonth), ofLast: pct(thisMonth, lastMonth) },
      forecast,
      breakdown: [...new Set([...Object.keys(curMonthByService), ...Object.keys(lastMonthByService)])]
        .map((name) => ({ name, thisMonth: round2(curMonthByService[name] || 0), lastMonth: round2(lastMonthByService[name] || 0), change: lastMonthByService[name] ? change(curMonthByService[name] || 0, lastMonthByService[name]) : null }))
        .sort((a, b) => b.thisMonth - a.thisMonth),
    });
  } catch (error) {
    failJson(res, error);
  }
};

// ------------------------------------------------------------ lead sources
const LEAD_STATUS_LABEL = { NEW: "New", DEMO_SCHEDULED: "Demo scheduled", QUOTATION_SENT: "Quotation sent", SALES: "Sales", PROJECT: "Won (project)", LOST: "Lost" };
const leadCost = (l) => (l.spendAmount || 0) + sum(l.marketing || [], (e) => e.hours * e.hourlyRate);

exports.leadSources = async (req, res) => {
  try {
    const r = parseRange(req.query);
    const leads = await Lead.find({ createdAt: { $gte: r.prevStart, $lt: r.end } });
    const cur = leads.filter((l) => between(l.createdAt, r.start, r.end));
    const prev = leads.filter((l) => between(l.createdAt, r.prevStart, r.prevEnd));
    const won = (l) => l.status === "PROJECT";

    const trend = buckets(r.start, r.end, r.days).map((b) => ({ ...b, leads: 0, won: 0 }));
    cur.forEach((l) => {
      const b = bucketOf(trend, l.createdAt);
      if (b) { b.leads += 1; if (won(l)) b.won += 1; }
    });

    const spend = sum(cur, leadCost);
    const sources = Object.keys(SOURCE_LABEL).map((k) => {
      const list = cur.filter((l) => l.source === k);
      return {
        name: SOURCE_LABEL[k], leads: list.length, won: list.filter(won).length,
        conversion: pct(list.filter(won).length, list.length),
        value: round2(sum(list, (l) => l.value)), spend: round2(sum(list, leadCost)),
        share: pct(list.length, cur.length),
      };
    }).filter((s) => s.leads > 0).sort((a, b) => b.leads - a.leads);

    const count = (f) => cur.filter(f).length;
    res.json({
      success: true,
      range: { from: r.start, to: new Date(r.end.getTime() - 1), days: r.days },
      kpis: {
        leads: cur.length, leadsChange: change(cur.length, prev.length),
        won: count(won), wonChange: change(count(won), prev.filter(won).length),
        conversion: pct(count(won), cur.length), conversionChange: Math.round((pct(count(won), cur.length) - pct(prev.filter(won).length, prev.length)) * 10) / 10,
        spend: round2(spend), costPerLead: cur.length ? round2(spend / cur.length) : 0,
        costPerWin: count(won) ? round2(spend / count(won)) : 0,
        pipelineValue: round2(sum(cur.filter((l) => !["PROJECT", "LOST"].includes(l.status)), (l) => l.value)),
      },
      trend: trend.map((b) => ({ label: b.label, leads: b.leads, won: b.won })),
      sources,
      requestTypes: [
        { name: "Online demo", count: count((l) => l.requestType === "DEMO" && l.demoType === "ONLINE") },
        { name: "Offline demo", count: count((l) => l.requestType === "DEMO" && l.demoType === "OFFLINE") },
        { name: "Quotation", count: count((l) => l.requestType === "QUOTATION") },
      ],
      statuses: Object.entries(LEAD_STATUS_LABEL).map(([k, name]) => ({ name, count: count((l) => l.status === k) })),
    });
  } catch (error) {
    failJson(res, error);
  }
};

// -------------------------------------------------------------- conversion
exports.conversion = async (req, res) => {
  try {
    const r = parseRange(req.query);
    const [leads, openDeals] = await Promise.all([
      Lead.find({ createdAt: { $gte: r.prevStart, $lt: r.end } }).populate("project", "createdAt"),
      Deal.find({}, "stage value probability"),
    ]);
    const cur = leads.filter((l) => between(l.createdAt, r.start, r.end));
    const prev = leads.filter((l) => between(l.createdAt, r.prevStart, r.prevEnd));

    // A lead's status is where it is now, so each stage counts everything that got that far.
    const engaged = (l) => ["DEMO_SCHEDULED", "QUOTATION_SENT", "SALES", "PROJECT"].includes(l.status);
    const sales = (l) => ["SALES", "PROJECT"].includes(l.status);
    const won = (l) => l.status === "PROJECT";
    const stageCounts = (list) => [list.length, list.filter(engaged).length, list.filter(sales).length, list.filter(won).length];

    const names = ["New leads", "Demo / quotation", "Sales stage", "Won (project)"];
    const counts = stageCounts(cur);
    const funnel = names.map((name, i) => ({
      name, count: counts[i],
      ofTotal: pct(counts[i], counts[0]),
      fromPrevious: i === 0 ? 100 : pct(counts[i], counts[i - 1]),
    }));

    const cycle = cur.filter((l) => won(l) && l.project?.createdAt).map((l) => (new Date(l.project.createdAt) - new Date(l.createdAt)) / DAY);

    const stages = ["DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"];
    const stageLabel = { DISCOVERY: "Discovery", PROPOSAL: "Proposal", NEGOTIATION: "Negotiation", CLOSED_WON: "Closed won", CLOSED_LOST: "Closed lost" };
    const deals = stages.map((s) => {
      const list = openDeals.filter((d) => d.stage === s);
      return { name: stageLabel[s], count: list.length, value: round2(sum(list, (d) => d.value)), weighted: round2(sum(list, (d) => (d.value * (d.probability ?? 0)) / 100)) };
    });
    const wonDeals = openDeals.filter((d) => d.stage === "CLOSED_WON").length;
    const lostDeals = openDeals.filter((d) => d.stage === "CLOSED_LOST").length;

    res.json({
      success: true,
      range: { from: r.start, to: new Date(r.end.getTime() - 1), days: r.days },
      kpis: {
        conversion: pct(counts[3], counts[0]),
        conversionChange: Math.round((pct(counts[3], counts[0]) - pct(stageCounts(prev)[3], prev.length)) * 10) / 10,
        leads: counts[0], leadsChange: change(counts[0], prev.length),
        openDeals: openDeals.filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage)).length,
        pipelineWeighted: round2(sum(openDeals.filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage)), (d) => (d.value * (d.probability ?? 0)) / 100)),
        customers: counts[3], customersChange: change(counts[3], stageCounts(prev)[3]),
        lost: cur.filter((l) => l.status === "LOST").length,
        avgCycleDays: cycle.length ? Math.round((sum(cycle, (x) => x) / cycle.length) * 10) / 10 : 0,
        dealWinRate: pct(wonDeals, wonDeals + lostDeals),
      },
      funnel,
      deals,
      bySource: Object.keys(SOURCE_LABEL).map((k) => {
        const list = cur.filter((l) => l.source === k);
        return { name: SOURCE_LABEL[k], leads: list.length, won: list.filter(won).length, rate: pct(list.filter(won).length, list.length) };
      }).filter((s) => s.leads > 0).sort((a, b) => b.rate - a.rate),
    });
  } catch (error) {
    failJson(res, error);
  }
};

