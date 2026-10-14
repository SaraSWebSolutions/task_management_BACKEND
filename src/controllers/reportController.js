const Lead = require("../models/Lead");
const User = require("../models/User");
const Project = require("../models/Project");
const Expense = require("../models/Expense");
const MarketingMonth = require("../models/MarketingMonth");

const SOURCES = ["BNI", "EVENT", "META", "INDIAMART", "OTHER"];

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// from / to arrive as YYYY-MM-DD (both days included). Defaults to this month.
const dateRange = (q) => {
  const now = new Date();
  const from = q.from
    ? new Date(`${q.from}T00:00:00.000Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDay = q.to ? new Date(`${q.to}T00:00:00.000Z`) : now;
  const end = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate()) + DAY);

  if (isNaN(from) || isNaN(end)) throw new Error("Invalid date range");
  return { $gte: from, $lt: end };
};

const monthRange = (month) => {
  if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error("Invalid month");
  const [y, m] = month.split("-").map(Number);
  return { $gte: new Date(Date.UTC(y, m - 1, 1)), $lt: new Date(Date.UTC(y, m, 1)) };
};

// Total marketing-time cost (hours x saved hourly rate), optionally grouped by person
const marketingTotals = async (range, byUser = false) =>
  Lead.aggregate([
    { $unwind: "$marketing" },
    { $match: { "marketing.date": range } },
    {
      $group: {
        _id: byUser ? "$marketing.user" : null,
        hours: { $sum: "$marketing.hours" },
        cost: { $sum: { $multiply: ["$marketing.hours", "$marketing.hourlyRate"] } },
      },
    },
  ]);

/* ---------- Quotation based report ---------- */
exports.quotationReport = async (req, res) => {
  try {
    const range = dateRange(req.query);

    const leads = await Lead.find({ quotationSentAt: range })
      .select("-spendDoc -marketing")
      .populate("project", "name projectValue")
      .sort({ quotationSentAt: -1 });

    const won = (l) => ["SALES", "PROJECT"].includes(l.status);
    const projects = leads.filter((l) => l.status === "PROJECT");

    const daily = {};
    leads.forEach((l) => {
      const d = isoDay(l.quotationSentAt);
      daily[d] = (daily[d] || 0) + 1;
    });

    res.json({
      success: true,
      summary: {
        sent: leads.length,
        pending: leads.filter((l) => l.status === "QUOTATION_SENT").length,
        toSales: leads.filter(won).length,
        toProject: projects.length,
        lost: leads.filter((l) => l.status === "LOST").length,
        conversionPercent: leads.length
          ? Math.round((projects.length / leads.length) * 100)
          : 0,
        valueWon: projects.reduce((s, l) => s + (l.project?.projectValue || 0), 0),
      },
      daily: Object.entries(daily)
        .sort()
        .map(([date, sent]) => ({ date, sent })),
      rows: leads.map((l) => ({
        _id: l._id,
        name: l.name,
        company: l.company,
        source: l.source,
        quotationSentAt: l.quotationSentAt,
        status: l.status,
        projectValue: l.project?.projectValue || 0,
      })),
    });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

/* ---------- Employee based report ---------- */
exports.employeeReport = async (req, res) => {
  try {
    const range = dateRange(req.query);

    const [users, demos, marketing, projects, supportRows] = await Promise.all([
      User.find({ status: "ACTIVE", role: { $in: ["EMPLOYEE", "MANAGER"] } }, "name designation"),
      Lead.find({ requestType: "DEMO", assignedTo: { $ne: null }, demoDate: range }).select(
        "assignedTo demoType spendAmount",
      ),
      marketingTotals(range, true),
      // Team hours have no date of their own, so they follow the project start date
      Project.find({ createdAt: range }).select("team"),
      Project.aggregate([
        { $unwind: "$support" },
        { $match: { "support.date": range } },
        {
          $group: {
            _id: "$support.user",
            hours: { $sum: "$support.hours" },
            cost: { $sum: { $multiply: ["$support.hours", "$support.hourlyRate"] } },
          },
        },
      ]),
    ]);

    const rows = users.map((u) => {
      const id = String(u._id);
      const myDemos = demos.filter((d) => String(d.assignedTo) === id);
      const mk = marketing.find((m) => String(m._id) === id);
      const sp = supportRows.find((m) => String(m._id) === id);

      let projectHours = 0;
      let projectCost = 0;
      projects.forEach((p) =>
        p.team
          .filter((t) => String(t.user) === id)
          .forEach((t) => {
            projectHours += t.hours || 0;
            projectCost += (t.hours || 0) * (t.hourlyRate || 0);
          }),
      );

      const row = {
        _id: u._id,
        name: u.name,
        designation: u.designation,
        demos: myDemos.length,
        onlineDemos: myDemos.filter((d) => d.demoType === "ONLINE").length,
        offlineDemos: myDemos.filter((d) => d.demoType === "OFFLINE").length,
        demoSpend: myDemos.reduce((s, d) => s + (d.spendAmount || 0), 0),
        marketingHours: mk?.hours || 0,
        marketingCost: mk?.cost || 0,
        projectHours,
        projectCost,
        supportHours: sp?.hours || 0,
        supportCost: sp?.cost || 0,
      };
      row.totalHours = row.marketingHours + row.projectHours + row.supportHours;
      row.totalCost = row.marketingCost + row.projectCost + row.supportCost;
      return row;
    });

    res.json({
      success: true,
      rows: rows.filter((r) => r.demos || r.totalHours),
    });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

/* ---------- Target dashboard ---------- */
const defaultsFor = (month) => ({
  month,
  marginPercent: 30,
  target: { followers: 200, enquiries: 10, finalized: 10, signed: 5 },
  followers: { BNI: 0, EVENT: 0, META: 0, INDIAMART: 0, OTHER: 0 },
});

exports.dashboard = async (req, res) => {
  try {
    const month = req.query.month;
    const range = monthRange(month);

    const saved = await MarketingMonth.findOne({ month });
    const settings = saved ? saved.toObject() : defaultsFor(month);

    const [expenses, demoLeads, mkTotals, leads, projects] = await Promise.all([
      Expense.find({ date: range }).sort({ date: -1 }),
      Lead.find({ requestType: "DEMO", demoDate: range }).select("spendAmount"),
      marketingTotals(range),
      // Funnel follows the leads created in this month
      Lead.find({ createdAt: range }).select("source status"),
      Project.find({ createdAt: range }).select("projectValue"),
    ]);

    // ----- expense -----
    const manual = expenses.reduce((s, e) => s + e.amount, 0);
    const demo = demoLeads.reduce((s, l) => s + (l.spendAmount || 0), 0);
    const marketingTime = mkTotals[0]?.cost || 0;
    const total = manual + demo + marketingTime;

    // ----- funnel -----
    const finalizedStatuses = ["SALES", "PROJECT"];
    const sources = SOURCES.map((source) => {
      const mine = leads.filter((l) => (l.source || "OTHER") === source);
      return {
        source,
        followers: settings.followers?.[source] || 0,
        enquiries: mine.length,
        finalized: mine.filter((l) => finalizedStatuses.includes(l.status)).length,
        signed: mine.filter((l) => l.status === "PROJECT").length,
      };
    });
    const sum = (k) => sources.reduce((s, r) => s + r[k], 0);

    // ----- target value -----
    const requiredRevenue = total * (1 + (settings.marginPercent || 0) / 100);
    const actualRevenue = projects.reduce((s, p) => s + (p.projectValue || 0), 0);
    const signedActual = sum("signed");

    res.json({
      success: true,
      month,
      settings,
      expenses,
      expense: { manual, demo, marketingTime, total },
      required: {
        revenue: requiredRevenue,
        perDeal: settings.target.signed ? requiredRevenue / settings.target.signed : 0,
      },
      actual: {
        revenue: actualRevenue,
        signed: signedActual,
        avgDeal: signedActual ? actualRevenue / signedActual : 0,
      },
      funnel: {
        followers: sum("followers"),
        enquiries: sum("enquiries"),
        finalized: sum("finalized"),
        signed: signedActual,
      },
      sources,
    });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const { month } = req.params;
    monthRange(month);

    const num = (v) => Math.max(0, Number(v) || 0);
    const { marginPercent, target = {}, followers = {} } = req.body;

    await MarketingMonth.findOneAndUpdate(
      { month },
      {
        month,
        marginPercent: num(marginPercent),
        target: {
          followers: num(target.followers),
          enquiries: num(target.enquiries),
          finalized: num(target.finalized),
          signed: num(target.signed),
        },
        followers: Object.fromEntries(SOURCES.map((s) => [s, num(followers[s])])),
      },
      { upsert: true },
    );

    res.json({ success: true, message: "Targets saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

/* ---------- Marketing expenses ---------- */
exports.addExpense = async (req, res) => {
  try {
    const { date, source, amount, note } = req.body;

    const expense = await Expense.create({
      date: date ? new Date(date) : new Date(),
      source: SOURCES.includes(source) ? source : "OTHER",
      amount: Number(amount),
      note,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, expense });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Expense deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
