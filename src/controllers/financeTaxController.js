const TaxRate = require("../models/TaxRate");
const Invoice = require("../models/Invoice");
const FinanceExpense = require("../models/FinanceExpense");
const FinanceSettings = require("../models/FinanceSettings");
const Client = require("../models/Clients");
const Project = require("../models/Project");
const Plan = require("../models/Plan");
const Payment = require("../models/Payment");
const { round2, getSettings, presentInvoice, fail, pick } = require("../utils/finance");

const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);

// Lists for the dropdowns inside finance forms.
exports.getOptions = async (req, res) => {
  try {
    const [clients, projects, taxRates, plans, openInvoices, settings] = await Promise.all([
      Client.find({}, "companyName gstNumber basicType").sort({ companyName: 1 }),
      Project.find({}, "name clientName").sort({ name: 1 }),
      TaxRate.find({ active: true }).sort({ rate: 1 }),
      Plan.find({ active: true }).sort({ order: 1, monthlyPrice: 1 }),
      Invoice.find({ status: "SENT" }, "number clientName total paidAmount dueDate status").sort({ issueDate: -1 }),
      getSettings(),
    ]);

    res.json({
      clients,
      projects,
      taxRates,
      plans,
      openInvoices: openInvoices
        .map(presentInvoice)
        .filter((i) => i.balance > 0)
        .map((i) => ({ _id: i._id, number: i.number, clientName: i.clientName, balance: i.balance })),
      settings: {
        defaultTaxRate: settings.defaultTaxRate,
        taxInclusive: settings.taxInclusive,
        autoCalculateTax: settings.autoCalculateTax,
        yearlyDiscount: settings.yearlyDiscount,
      },
      serviceTypes: Invoice.SERVICE_TYPES,
      categories: FinanceExpense.CATEGORIES,
      paymentMethods: Payment.METHODS,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getTax = async (req, res) => {
  try {
    const [rates, settings, invoices, expenses] = await Promise.all([
      TaxRate.find().sort({ createdAt: 1 }),
      getSettings(),
      Invoice.find({ status: "SENT" }),
      FinanceExpense.find({ status: { $ne: "REJECTED" } }, "taxAmount"),
    ]);

    // Tax is "collected" in the same proportion the invoice has been paid.
    const share = (i) => (i.total > 0 ? Math.min(1, i.paidAmount / i.total) : 0);
    const collected = sum(invoices, (i) => i.taxAmount * share(i));
    const taxableCollected = sum(invoices, (i) => i.subtotal * share(i));
    const credits = sum(expenses, (e) => e.taxAmount);

    // Summary grouped by the rate used on the invoice
    const groups = {};
    invoices.forEach((i) => {
      const key = `${i.taxLabel || "No tax"}|${i.taxRate}`;
      groups[key] = groups[key] || {
        label: i.taxLabel || "No tax",
        rate: i.taxRate,
        invoices: 0,
        taxable: 0,
        billed: 0,
        collected: 0,
      };
      const g = groups[key];
      g.invoices += 1;
      g.taxable += i.subtotal;
      g.billed += i.taxAmount;
      g.collected += i.taxAmount * share(i);
    });

    res.json({
      success: true,
      rates,
      settings: {
        autoCalculateTax: settings.autoCalculateTax,
        taxInclusive: settings.taxInclusive,
        defaultTaxRate: settings.defaultTaxRate,
        companyName: settings.companyName || "",
        gstin: settings.gstin || "",
      },
      stats: {
        collected: round2(collected),
        billed: round2(sum(invoices, (i) => i.taxAmount)),
        credits: round2(credits),
        payable: round2(Math.max(0, collected - credits)),
        effectiveRate: taxableCollected ? Math.round((collected / taxableCollected) * 1000) / 10 : 0,
      },
      summary: Object.values(groups)
        .map((g) => ({
          ...g,
          taxable: round2(g.taxable),
          billed: round2(g.billed),
          collected: round2(g.collected),
        }))
        .sort((a, b) => b.billed - a.billed),
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

const check = (b) => {
  if (!b.region?.trim()) return "Region / tax name is required";
  if (b.rate === "" || b.rate == null || !(Number(b.rate) >= 0 && Number(b.rate) <= 100))
    return "Tax rate must be between 0 and 100";
  return null;
};

exports.addRate = async (req, res) => {
  try {
    const data = pick(req.body, ["region", "rate", "type", "active"]);
    const problem = check(data);
    if (problem) return fail(res, 400, problem);
    const rate = await TaxRate.create({ ...data, createdBy: req.user.id });
    res.status(201).json({ success: true, message: "Tax rate added", rate });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateRate = async (req, res) => {
  try {
    const rate = await TaxRate.findById(req.params.id);
    if (!rate) return fail(res, 404, "Tax rate not found");
    rate.set(pick(req.body, ["region", "rate", "type", "active"]));
    const problem = check(rate.toObject());
    if (problem) return fail(res, 400, problem);
    await rate.save();
    res.json({ success: true, message: "Tax rate updated", rate });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteRate = async (req, res) => {
  try {
    // Invoices keep their own copy of the rate, so deleting is safe.
    await TaxRate.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Tax rate removed" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const data = pick(req.body, ["autoCalculateTax", "taxInclusive", "defaultTaxRate", "companyName", "gstin"]);
    if (data.defaultTaxRate !== undefined) {
      const v = Number(data.defaultTaxRate);
      if (data.defaultTaxRate === "" || !(v >= 0 && v <= 100))
        return fail(res, 400, "Default tax rate must be between 0 and 100");
      data.defaultTaxRate = v;
    }
    if (data.gstin && !/^[0-9A-Z]{15}$/.test(data.gstin.trim().toUpperCase()))
      return fail(res, 400, "GSTIN must be 15 characters");

    await getSettings();
    await FinanceSettings.updateOne({ key: "default" }, { $set: data });
    res.json({ success: true, message: "Settings saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};
