const Lead = require("../models/Lead");

const TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;

const PIPELINE = [
  "NEW",
  "DEMO_SCHEDULED",
  "QUOTATION_SENT",
  "SALES",
  "PROJECT",
  "LOST",
];
const CONVERTED = ["SALES", "PROJECT"];
const ACTIVE = ["NEW", "DEMO_SCHEDULED", "QUOTATION_SENT"];

// Current year/month as seen in India, regardless of server timezone.
const istYearMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return {
    y: Number(parts.find((p) => p.type === "year").value),
    m: Number(parts.find((p) => p.type === "month").value),
  };
};

// Start of IST month (offset months from the current one) as a UTC Date.
const monthStart = (y, m, offset = 0) =>
  new Date(Date.UTC(y, m - 1 + offset, 1) - IST_OFFSET_MS);

const pct = (part, whole) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;

exports.getCrmDashboard = async (req, res) => {
  try {
    const now = new Date();
    const { y, m } = istYearMonth(now);
    const thisMonth = monthStart(y, m);
    const trendFrom = monthStart(y, m, -5);

    const [
      statusRows,
      sourceRows,
      requestRows,
      newThisMonth,
      trendRows,
      recentLeads,
      upcomingDemos,
      assigneeRows,
    ] = await Promise.all([
      Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Lead.aggregate([
        {
          $group: {
            _id: "$source",
            count: { $sum: 1 },
            converted: {
              $sum: { $cond: [{ $in: ["$status", CONVERTED] }, 1, 0] },
            },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Lead.aggregate([{ $group: { _id: "$requestType", count: { $sum: 1 } } }]),
      Lead.countDocuments({ createdAt: { $gte: thisMonth } }),
      Lead.aggregate([
        { $match: { createdAt: { $gte: trendFrom } } },
        {
          $group: {
            _id: {
              y: { $year: { date: "$createdAt", timezone: TZ } },
              m: { $month: { date: "$createdAt", timezone: TZ } },
            },
            leads: { $sum: 1 },
            converted: {
              $sum: { $cond: [{ $in: ["$status", CONVERTED] }, 1, 0] },
            },
          },
        },
      ]),
      Lead.find()
        .sort({ createdAt: -1 })
        .limit(8)
        .select("name company email source status requestType createdAt assignedTo")
        .populate("assignedTo", "name"),
      Lead.find({ status: "DEMO_SCHEDULED", demoDate: { $gte: now } })
        .sort({ demoDate: 1 })
        .limit(5)
        .select("name company demoDate demoType location assignedTo")
        .populate("assignedTo", "name"),
      Lead.aggregate([
        { $match: { assignedTo: { $ne: null } } },
        {
          $group: {
            _id: "$assignedTo",
            leads: { $sum: 1 },
            converted: {
              $sum: { $cond: [{ $in: ["$status", CONVERTED] }, 1, 0] },
            },
          },
        },
        { $sort: { leads: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $project: {
            _id: 1,
            leads: 1,
            converted: 1,
            name: { $arrayElemAt: ["$user.name", 0] },
          },
        },
      ]),
    ]);

    const statusCount = Object.fromEntries(
      statusRows.map((r) => [r._id, r.count]),
    );
    const total = statusRows.reduce((sum, r) => sum + r.count, 0);
    const converted = CONVERTED.reduce((s, k) => s + (statusCount[k] || 0), 0);
    const activePipeline = ACTIVE.reduce((s, k) => s + (statusCount[k] || 0), 0);
    const closed = converted + (statusCount.LOST || 0);

    const pipeline = PIPELINE.map((status) => ({
      status,
      count: statusCount[status] || 0,
    }));

    // Always return 6 months, even when a month has no leads.
    const trendMap = new Map(
      trendRows.map((r) => [`${r._id.y}-${r._id.m}`, r]),
    );
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      const row = trendMap.get(key);
      trend.push({
        month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
        year: d.getUTCFullYear(),
        leads: row?.leads || 0,
        converted: row?.converted || 0,
      });
    }

    res.json({
      kpis: {
        totalLeads: total,
        newThisMonth,
        activePipeline,
        converted,
        lost: statusCount.LOST || 0,
        conversionRate: pct(converted, total),
        winRate: pct(converted, closed), // converted vs. closed (won + lost)
      },
      pipeline,
      sources: sourceRows.map((r) => ({
        source: r._id || "OTHER",
        count: r.count,
        converted: r.converted,
      })),
      requestTypes: requestRows.map((r) => ({
        type: r._id,
        count: r.count,
      })),
      trend,
      recentLeads,
      upcomingDemos,
      topAssignees: assigneeRows.map((r) => ({
        _id: r._id,
        name: r.name || "Unknown",
        leads: r.leads,
        converted: r.converted,
        conversionRate: pct(r.converted, r.leads),
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ------------------------------------------------------------------ */
/* Lead pipeline (kanban)                                              */
/* ------------------------------------------------------------------ */

const User = require("../models/User");
const Client = require("../models/Clients");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

exports.getPipeline = async (req, res) => {
  try {
    const leads = await Lead.find()
      .select("-spendDoc -marketing")
      .populate("assignedTo", "name")
      .sort({ createdAt: -1 });

    const sum = (list) => list.reduce((s, l) => s + (l.value || 0), 0);
    const by = (statuses) => leads.filter((l) => statuses.includes(l.status));

    const converted = by(CONVERTED);
    const closed = converted.length + by(["LOST"]).length;

    res.json({
      leads,
      stats: {
        totalLeads: leads.length,
        newThisWeek: leads.filter(
          (l) => Date.now() - new Date(l.createdAt).getTime() < WEEK_MS,
        ).length,
        pipelineValue: sum(by(ACTIVE)),
        wonValue: sum(converted),
        winRate: pct(converted.length, closed),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Only the moves that need no extra details happen here. Demo, quotation,
// sales and project moves keep using the lead flow endpoints.
exports.moveLeadStage = async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (status === "LOST") {
      if (lead.status === "PROJECT")
        return res
          .status(400)
          .json({ message: "A lead that became a project cannot be marked lost" });
    } else if (status === "NEW") {
      if (lead.status !== "LOST")
        return res.status(400).json({ message: "Only lost leads can be reopened" });
    } else {
      return res
        .status(400)
        .json({ message: "Use the lead details page to move to this stage" });
    }

    lead.status = status;
    await lead.save();
    res.json({ success: true, message: "Lead moved", lead });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/* ------------------------------------------------------------------ */
/* Customers = clients, with spend / tier info                         */
/* ------------------------------------------------------------------ */

// Tier by total billed amount (INR). Change the numbers to suit your business.
const TIERS = [
  { tier: "PLATINUM", min: 1000000 },
  { tier: "GOLD", min: 500000 },
  { tier: "SILVER", min: 200000 },
  { tier: "BRONZE", min: 0 },
];
const tierFor = (amount) => TIERS.find((t) => amount >= t.min).tier;

exports.getCustomers = async (req, res) => {
  try {
    const clients = await Client.find()
      .select(
        "companyName clientName phone1 basicType totalCost balance paymentStatus renewalDate createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();

    const customers = clients.map((c) => ({
      ...c,
      totalCost: c.totalCost || 0,
      balance: c.balance || 0,
      tier: tierFor(c.totalCost || 0),
    }));

    const totalRevenue = customers.reduce((s, c) => s + c.totalCost, 0);
    const pendingBalance = customers.reduce((s, c) => s + c.balance, 0);

    res.json({
      customers,
      stats: {
        totalCustomers: customers.length,
        totalRevenue,
        pendingBalance,
        avgValue: customers.length ? Math.round(totalRevenue / customers.length) : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ------------------------------------------------------------------ */
/* Shared pickers for CRM forms                                        */
/* ------------------------------------------------------------------ */

exports.getOptions = async (req, res) => {
  try {
    const [users, leads] = await Promise.all([
      User.find({ status: "ACTIVE" }, "name designation").sort({ name: 1 }),
      Lead.find({ status: { $nin: ["LOST"] } }, "name company")
        .sort({ createdAt: -1 })
        .limit(500),
    ]);
    res.json({ users, leads });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
