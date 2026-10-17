const FinanceExpense = require("../models/FinanceExpense");
const {
  MONTHS,
  istYear,
  istMonth,
  yearStart,
  monthStart,
  round2,
  pctChange,
  getSettings,
  fail,
  pick,
} = require("../utils/finance");

const MAX_DOC = 7 * 1024 * 1024; // data URL of a ~5 MB file
const FIELDS = ["date", "category", "description", "amount", "taxAmount", "status"];

const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);

// Rejected expenses never count towards any total.
const counted = (e) => e.status !== "REJECTED";

exports.getExpenses = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || istYear(now);
    const settings = await getSettings();

    const all = await FinanceExpense.find().select("-receipt").sort({ date: -1, createdAt: -1 });

    const inYear = (y) =>
      all.filter(
        (e) => counted(e) && new Date(e.date) >= yearStart(y) && new Date(e.date) < yearStart(y + 1),
      );
    const cur = inYear(year);
    const prev = inYear(year - 1);

    // How many months of budget have run so far in the chosen year
    const monthsElapsed = year < istYear(now) ? 12 : istMonth(now) + 1;

    const budgets = Object.fromEntries(settings.expenseBudgets || []);
    const monthlyBudget = sum(Object.values(budgets), (v) => v);

    const categories = FinanceExpense.CATEGORIES.map((category) => {
      const actual = sum(cur.filter((e) => e.category === category), (e) => e.amount);
      const budget = (budgets[category] || 0) * monthsElapsed;
      return { category, actual: round2(actual), budget: round2(budget), monthly: budgets[category] || 0 };
    });

    const totalActual = sum(cur, (e) => e.amount);
    const totalBudget = monthlyBudget * monthsElapsed;
    // Over budget / savings only make sense for categories that have a budget
    const budgeted = categories.filter((c) => c.monthly > 0);

    const monthly = MONTHS.map((month, m) => {
      const list = cur.filter(
        (e) => new Date(e.date) >= monthStart(year, m) && new Date(e.date) < monthStart(year, m + 1),
      );
      return { month, actual: round2(sum(list, (e) => e.amount)), budget: monthlyBudget };
    });

    res.json({
      success: true,
      year,
      expenses: all.map((e) => ({ ...e.toObject(), hasReceipt: !!e.receiptName })),
      stats: {
        total: round2(totalActual),
        totalChange: pctChange(totalActual, sum(prev, (e) => e.amount)),
        hasBudget: monthlyBudget > 0,
        budgetUsed: totalBudget ? Math.round((totalActual / totalBudget) * 1000) / 10 : 0,
        overBudget: round2(sum(budgeted, (c) => Math.max(0, c.actual - c.budget))),
        savings: round2(sum(budgeted, (c) => Math.max(0, c.budget - c.actual))),
        pending: round2(sum(all.filter((e) => e.status === "PENDING"), (e) => e.amount)),
      },
      categories,
      monthly,
      years: [...new Set([istYear(now), ...all.map((e) => istYear(e.date))])].sort((a, b) => b - a),
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getReceipt = async (req, res) => {
  try {
    const e = await FinanceExpense.findById(req.params.id).select("receipt receiptName");
    if (!e?.receipt) return fail(res, 404, "No receipt uploaded");
    res.json({ success: true, receipt: e.receipt, receiptName: e.receiptName });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

const check = (b) => {
  if (!b.date) return "Select a date";
  if (!b.category) return "Select a category";
  if (!b.description?.trim()) return "Enter a description";
  if (!(Number(b.amount) > 0)) return "Enter a valid amount";
  if (Number(b.taxAmount) < 0) return "Tax can't be negative";
  if (Number(b.taxAmount) > Number(b.amount)) return "Tax can't be more than the amount";
  return null;
};

const setReceipt = (expense, body) => {
  if (body.removeReceipt) {
    expense.receipt = undefined;
    expense.receiptName = undefined;
  }
  if (body.receipt) {
    if (body.receipt.length > MAX_DOC) throw new Error("Receipt is too large (max 5 MB)");
    expense.receipt = body.receipt;
    expense.receiptName = body.receiptName || "receipt";
  }
};

exports.addExpense = async (req, res) => {
  try {
    const data = pick(req.body, FIELDS);
    const problem = check(data);
    if (problem) return fail(res, 400, problem);

    const expense = new FinanceExpense({ ...data, createdBy: req.user.id });
    setReceipt(expense, req.body);
    await expense.save();
    res.status(201).json({ success: true, message: "Expense added" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const expense = await FinanceExpense.findById(req.params.id);
    if (!expense) return fail(res, 404, "Expense not found");

    expense.set(pick(req.body, FIELDS));
    const problem = check(expense.toObject());
    if (problem) return fail(res, 400, problem);

    setReceipt(expense, req.body);
    await expense.save();
    res.json({ success: true, message: "Expense updated" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setExpenseStatus = async (req, res) => {
  try {
    if (!FinanceExpense.STATUSES.includes(req.body.status)) return fail(res, 400, "Invalid status");
    const expense = await FinanceExpense.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { returnDocument: "after" },
    ).select("-receipt");
    if (!expense) return fail(res, 404, "Expense not found");
    res.json({ success: true, message: "Status updated", expense });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    await FinanceExpense.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Expense deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// Monthly budget per category: { "Marketing": 20000, ... }
exports.saveBudgets = async (req, res) => {
  try {
    const incoming = req.body.budgets || {};
    const clean = {};
    for (const category of FinanceExpense.CATEGORIES) {
      const v = Number(incoming[category]);
      if (incoming[category] !== undefined && incoming[category] !== "" && !(v >= 0))
        return fail(res, 400, `Enter a valid budget for ${category}`);
      if (v > 0) clean[category] = v;
    }
    await getSettings();
    const FinanceSettings = require("../models/FinanceSettings");
    await FinanceSettings.updateOne({ key: "default" }, { $set: { expenseBudgets: clean } });
    res.json({ success: true, message: "Budgets saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};
