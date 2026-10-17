const Subscription = require("../models/Subscription");
const Plan = require("../models/Plan");
const FinanceSettings = require("../models/FinanceSettings");
const {
  MONTHS,
  istMonth,
  istYear,
  monthStart,
  round2,
  pctChange,
  getSettings,
  fail,
  pick,
} = require("../utils/finance");

const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);
const monthlyValue = (s) => (s.billingCycle === "YEARLY" ? s.amount / 12 : s.amount);

// ------------------------------------------------------------ subscriptions
const FIELDS = [
  "client",
  "customerName",
  "plan",
  "planName",
  "amount",
  "billingCycle",
  "startDate",
  "nextBilling",
  "status",
  "notes",
];

const yearlyPriceOf = (plan, discount) =>
  plan.yearlyPrice ?? round2(plan.monthlyPrice * 12 * (1 - discount / 100));

// Plan chosen -> default name and price, unless the form already sent them.
const withPlanDefaults = async (data) => {
  if (!data.plan) return data;
  const plan = await Plan.findById(data.plan);
  if (!plan) throw new Error("Plan not found");
  const settings = await getSettings();
  const cycle = data.billingCycle || "MONTHLY";
  return {
    ...data,
    planName: data.planName?.trim() || plan.name,
    amount:
      data.amount === undefined || data.amount === ""
        ? cycle === "YEARLY"
          ? yearlyPriceOf(plan, settings.yearlyDiscount)
          : plan.monthlyPrice
        : data.amount,
  };
};

const addCycle = (date, cycle) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + (cycle === "YEARLY" ? 12 : 1));
  return d;
};

exports.getSubscriptions = async (req, res) => {
  try {
    const subs = await Subscription.find().sort({ createdAt: -1 });
    const now = new Date();
    const y = istYear(now);
    const m = istMonth(now);

    const alive = subs.filter((s) => s.status !== "CANCELLED");
    const active = subs.filter((s) => s.status === "ACTIVE");

    // 8 months ending now. Alive at a date = started before it and not yet cancelled.
    const growth = Array.from({ length: 8 }, (_, i) => {
      const from = monthStart(y, m - 7 + i);
      const to = monthStart(y, m - 6 + i);
      const aliveAt = (d) =>
        subs.filter((s) => new Date(s.startDate) < d && (!s.cancelledAt || new Date(s.cancelledAt) >= d));
      const startCount = aliveAt(from).length;
      const churned = subs.filter((s) => s.cancelledAt && new Date(s.cancelledAt) >= from && new Date(s.cancelledAt) < to).length;
      const added = subs.filter((s) => new Date(s.startDate) >= from && new Date(s.startDate) < to).length;
      return {
        month: MONTHS[(((m - 7 + i) % 12) + 12) % 12],
        active: aliveAt(to).length,
        new: added,
        churned,
        churnRate: startCount ? Math.round((churned / startCount) * 1000) / 10 : 0,
      };
    });

    const thisMonthStart = monthStart(y, m);
    const mrrBefore = sum(
      subs.filter(
        (s) =>
          s.status !== "TRIAL" &&
          new Date(s.startDate) < thisMonthStart &&
          (!s.cancelledAt || new Date(s.cancelledAt) >= thisMonthStart),
      ),
      monthlyValue,
    );

    const lifetimes = subs.map(
      (s) => (new Date(s.cancelledAt || now) - new Date(s.startDate)) / (30.44 * 86400000),
    );
    const planNames = [...new Set(alive.map((s) => s.planName))];

    res.json({
      success: true,
      subscriptions: subs,
      stats: {
        active: active.length,
        activeNew: growth[7].new,
        trial: subs.filter((s) => s.status === "TRIAL").length,
        cancelled: subs.filter((s) => s.status === "CANCELLED").length,
        pastDue: subs.filter((s) => s.status === "PAST_DUE").length,
        mrr: round2(sum(alive.filter((s) => s.status !== "TRIAL"), monthlyValue)),
        mrrChange: pctChange(
          sum(alive.filter((s) => s.status !== "TRIAL"), monthlyValue),
          mrrBefore,
        ),
      },
      growth,
      planDistribution: planNames
        .map((name) => ({ name, count: alive.filter((s) => s.planName === name).length }))
        .sort((a, b) => b.count - a.count),
      churn: {
        current: growth[7].churnRate,
        change: Math.round((growth[7].churnRate - growth[6].churnRate) * 10) / 10,
        avgLifetimeMonths: lifetimes.length
          ? Math.round((sum(lifetimes, (x) => x) / lifetimes.length) * 10) / 10
          : 0,
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

const validate = (s) => {
  if (!s.customerName?.trim()) return "Customer is required";
  if (!s.planName?.trim()) return "Select a plan";
  if (!(Number(s.amount) >= 0) || s.amount === "" || s.amount == null) return "Enter the amount";
  if (!s.startDate) return "Start date is required";
  return null;
};

exports.addSubscription = async (req, res) => {
  try {
    const data = await withPlanDefaults(pick(req.body, FIELDS));
    if (data.client && !data.customerName?.trim()) {
      const Client = require("../models/Clients");
      const c = await Client.findById(data.client, "companyName");
      data.customerName = c?.companyName;
    }
    const problem = validate(data);
    if (problem) return fail(res, 400, problem);

    const sub = new Subscription({
      ...data,
      nextBilling: data.nextBilling || addCycle(data.startDate, data.billingCycle),
      createdBy: req.user.id,
    });
    if (sub.status === "CANCELLED") sub.cancelledAt = new Date();
    await sub.save();
    res.status(201).json({ success: true, message: "Subscription added", subscription: sub });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return fail(res, 404, "Subscription not found");

    const data = pick(req.body, FIELDS);
    // Changing the plan picks up that plan's name/price unless the form set them
    if (data.plan && String(data.plan) !== String(sub.plan)) {
      Object.assign(data, await withPlanDefaults({ billingCycle: sub.billingCycle, ...data }));
    }
    sub.set(data);
    const problem = validate(sub.toObject());
    if (problem) return fail(res, 400, problem);

    if (sub.status === "CANCELLED" && !sub.cancelledAt) sub.cancelledAt = new Date();
    if (sub.status !== "CANCELLED") sub.cancelledAt = undefined;
    await sub.save();
    res.json({ success: true, message: "Subscription updated", subscription: sub });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setSubscriptionStatus = async (req, res) => {
  try {
    if (!Subscription.STATUSES.includes(req.body.status)) return fail(res, 400, "Invalid status");
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return fail(res, 404, "Subscription not found");

    sub.status = req.body.status;
    sub.cancelledAt = sub.status === "CANCELLED" ? sub.cancelledAt || new Date() : undefined;
    await sub.save();
    res.json({ success: true, message: "Subscription updated", subscription: sub });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteSubscription = async (req, res) => {
  try {
    await Subscription.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Subscription deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// -------------------------------------------------------------------- plans
const PLAN_FIELDS = [
  "name",
  "description",
  "monthlyPrice",
  "yearlyPrice",
  "features",
  "popular",
  "active",
  "order",
];

const cleanFeatures = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((f) => f.name?.trim())
    .map((f) => ({ name: f.name.trim(), value: f.value?.trim() || "Yes" }));

const presentPlans = (plans, discount, subs) =>
  plans.map((p) => ({
    ...p.toObject(),
    yearlyPrice: yearlyPriceOf(p, discount),
    customYearlyPrice: p.yearlyPrice != null,
    subscribers: subs.filter((s) => String(s.plan) === String(p._id)).length,
  }));

exports.getPlans = async (req, res) => {
  try {
    const [plans, settings, subs] = await Promise.all([
      Plan.find().sort({ order: 1, monthlyPrice: 1 }),
      getSettings(),
      Subscription.find({ status: { $ne: "CANCELLED" } }, "plan"),
    ]);
    res.json({
      success: true,
      plans: presentPlans(plans, settings.yearlyDiscount, subs),
      yearlyDiscount: settings.yearlyDiscount,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

const planBody = (body) => {
  const data = pick(body, PLAN_FIELDS);
  if (data.features !== undefined) data.features = cleanFeatures(data.features);
  if (data.yearlyPrice === "" || data.yearlyPrice === null) data.yearlyPrice = undefined;
  return data;
};

// Only one plan carries the "Most popular" ribbon
const clearOtherPopular = (id) => Plan.updateMany({ _id: { $ne: id } }, { popular: false });

exports.addPlan = async (req, res) => {
  try {
    const data = planBody(req.body);
    if (!data.name?.trim()) return fail(res, 400, "Plan name is required");
    if (data.monthlyPrice === "" || !(Number(data.monthlyPrice) >= 0))
      return fail(res, 400, "Enter the monthly price");

    const plan = await Plan.create({ ...data, createdBy: req.user.id });
    if (plan.popular) await clearOtherPopular(plan._id);
    res.status(201).json({ success: true, message: "Plan added", plan });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return fail(res, 404, "Plan not found");

    const data = planBody(req.body);
    if (data.name !== undefined && !data.name.trim()) return fail(res, 400, "Plan name is required");
    if (req.body.yearlyPrice === "" || req.body.yearlyPrice === null) plan.yearlyPrice = undefined;
    plan.set(data);
    await plan.save();
    if (plan.popular) await clearOtherPopular(plan._id);
    res.json({ success: true, message: "Plan updated", plan });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deletePlan = async (req, res) => {
  try {
    if (await Subscription.exists({ plan: req.params.id, status: { $ne: "CANCELLED" } }))
      return fail(res, 400, "Customers are subscribed to this plan. Hide it instead of deleting.");
    await Plan.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Plan deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.saveYearlyDiscount = async (req, res) => {
  try {
    const v = Number(req.body.yearlyDiscount);
    if (!(v >= 0 && v <= 100)) return fail(res, 400, "Discount must be between 0 and 100");
    await getSettings();
    await FinanceSettings.updateOne({ key: "default" }, { yearlyDiscount: v });
    res.json({ success: true, message: "Yearly discount saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};
