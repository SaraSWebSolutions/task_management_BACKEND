const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Client = require("../models/Clients");
const {
  istYear,
  istMonth,
  istDay,
  monthStart,
  startOfToday,
  round2,
  pctChange,
  nextNumber,
  calcInvoice,
  presentInvoice,
  fail,
  pick,
  MONTHS,
} = require("../utils/finance");

const sum = (list, f) => list.reduce((s, x) => s + (f(x) || 0), 0);

// ---------------------------------------------------------------- invoices
const INVOICE_FIELDS = [
  "client",
  "clientName",
  "clientGstin",
  "project",
  "serviceType",
  "issueDate",
  "dueDate",
  "items",
  "discount",
  "taxLabel",
  "taxRate",
  "taxInclusive",
  "status",
  "notes",
];

const cleanItems = (items) =>
  (Array.isArray(items) ? items : [])
    .filter((i) => i.description?.trim())
    .map((i) => ({
      description: i.description.trim(),
      quantity: Number(i.quantity) || 0,
      rate: Number(i.rate) || 0,
    }));

// Fills clientName / GSTIN / service type from the chosen client.
const withClientDefaults = async (data) => {
  if (!data.client) return data;
  const c = await Client.findById(data.client, "companyName gstNumber basicType");
  if (!c) throw new Error("Client not found");
  return {
    ...data,
    clientName: data.clientName?.trim() || c.companyName,
    clientGstin: data.clientGstin ?? c.gstNumber,
    serviceType: data.serviceType || c.basicType,
  };
};

const validateInvoice = (b) => {
  if (!b.clientName?.trim()) return "Select a client or enter a name";
  if (!b.issueDate) return "Issue date is required";
  if (!b.dueDate) return "Due date is required";
  if (new Date(b.dueDate) < new Date(b.issueDate)) return "Due date can't be before the issue date";
  if (!b.items.length) return "Add at least one line item";
  if (b.items.some((i) => !(i.quantity > 0))) return "Quantity must be more than 0";
  return null;
};

exports.getInvoices = async (req, res) => {
  try {
    const invoices = (
      await Invoice.find().populate("project", "name").sort({ issueDate: -1, createdAt: -1 })
    ).map(presentInvoice);

    const live = invoices.filter((i) => !["DRAFT", "CANCELLED"].includes(i.displayStatus));
    const thisMonth = monthStart(istYear(new Date()), istMonth(new Date()));
    const lastMonth = monthStart(istYear(new Date()), istMonth(new Date()) - 1);
    const inRange = (from, to) =>
      live.filter((i) => new Date(i.issueDate) >= from && (!to || new Date(i.issueDate) < to));

    res.json({
      success: true,
      invoices,
      stats: {
        totalInvoiced: round2(sum(live, (i) => i.total)),
        paid: round2(sum(live, (i) => i.paidAmount)),
        pending: round2(sum(live.filter((i) => i.displayStatus !== "OVERDUE"), (i) => i.balance)),
        overdue: round2(sum(live.filter((i) => i.displayStatus === "OVERDUE"), (i) => i.balance)),
        invoicedChange: pctChange(
          sum(inRange(thisMonth), (i) => i.total),
          sum(inRange(lastMonth, thisMonth), (i) => i.total),
        ),
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate("project", "name");
    if (!invoice) return fail(res, 404, "Invoice not found");
    const payments = await Payment.find({ invoice: invoice._id }).sort({ date: -1 });
    res.json({ success: true, invoice: presentInvoice(invoice), payments });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addInvoice = async (req, res) => {
  try {
    const data = await withClientDefaults({
      ...pick(req.body, INVOICE_FIELDS),
      items: cleanItems(req.body.items),
    });
    const problem = validateInvoice(data);
    if (problem) return fail(res, 400, problem);

    const invoice = await Invoice.create({
      ...data,
      ...calcInvoice(data),
      number: await nextNumber("invoiceSeq", "INV"),
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, message: "Invoice created", invoice });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return fail(res, 404, "Invoice not found");

    const data = await withClientDefaults({
      ...pick(req.body, INVOICE_FIELDS),
      ...(req.body.items !== undefined && { items: cleanItems(req.body.items) }),
    });
    invoice.set(data);

    const problem = validateInvoice(invoice.toObject());
    if (problem) return fail(res, 400, problem);

    invoice.set(calcInvoice(invoice.toObject()));
    if (invoice.total < invoice.paidAmount - 0.005)
      return fail(res, 400, "Total can't be less than what is already paid");

    await invoice.save();
    res.json({ success: true, message: "Invoice updated", invoice });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setInvoiceStatus = async (req, res) => {
  try {
    if (!["DRAFT", "SENT", "CANCELLED"].includes(req.body.status))
      return fail(res, 400, "Invalid status");
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return fail(res, 404, "Invoice not found");
    if (req.body.status === "CANCELLED" && invoice.paidAmount > 0)
      return fail(res, 400, "This invoice has payments. Refund them before cancelling.");

    invoice.status = req.body.status;
    await invoice.save();
    res.json({ success: true, message: "Invoice updated", invoice });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    if (await Payment.exists({ invoice: req.params.id }))
      return fail(res, 400, "This invoice has payments. Cancel it instead of deleting.");
    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Invoice deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ---------------------------------------------------------------- payments
// paidAmount on the invoice = sum of its SUCCESSFUL payments.
const syncInvoicePaid = async (invoiceId) => {
  if (!invoiceId) return;
  const rows = await Payment.aggregate([
    { $match: { invoice: invoiceId, status: "SUCCESSFUL" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  await Invoice.findByIdAndUpdate(invoiceId, { paidAmount: round2(rows[0]?.total || 0) });
};

const PAYMENT_FIELDS = ["invoice", "customerName", "amount", "method", "date", "status", "reference", "notes"];

exports.getPayments = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate("invoice", "number")
      .sort({ date: -1, createdAt: -1 });

    const now = new Date();
    const thisMonth = monthStart(istYear(now), istMonth(now));
    const lastMonth = monthStart(istYear(now), istMonth(now) - 1);

    const of = (status, from, to) =>
      payments.filter(
        (p) =>
          (!status || p.status === status) &&
          (!from || new Date(p.date) >= from) &&
          (!to || new Date(p.date) < to),
      );
    const change = (status) =>
      pctChange(
        sum(of(status, thisMonth), (p) => p.amount),
        sum(of(status, lastMonth, thisMonth), (p) => p.amount),
      );

    // Last 30 days, one point per day
    const today = startOfToday();
    const trend = Array.from({ length: 30 }, (_, i) => {
      const from = new Date(today.getTime() - (29 - i) * 86400000);
      const to = new Date(from.getTime() + 86400000);
      const list = of("SUCCESSFUL", from, to);
      return {
        label: `${istDay(from)} ${MONTHS[istMonth(from)]}`,
        amount: round2(sum(list, (p) => p.amount)),
        count: list.length,
      };
    });

    const ok = of("SUCCESSFUL");
    const okTotal = sum(ok, (p) => p.amount);
    const methods = [...new Set(ok.map((p) => p.method))]
      .map((method) => {
        const amount = sum(ok.filter((p) => p.method === method), (p) => p.amount);
        return { method, amount: round2(amount), percent: okTotal ? Math.round((amount / okTotal) * 100) : 0 };
      })
      .sort((a, b) => b.amount - a.amount);

    res.json({
      success: true,
      payments,
      stats: {
        total: round2(sum(payments, (p) => p.amount)),
        successful: round2(okTotal),
        failed: round2(sum(of("FAILED"), (p) => p.amount)),
        refunded: round2(sum(of("REFUNDED"), (p) => p.amount)),
        totalChange: change(null),
        successfulChange: change("SUCCESSFUL"),
        failedChange: change("FAILED"),
        refundedChange: change("REFUNDED"),
      },
      trend,
      methods,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addPayment = async (req, res) => {
  try {
    const data = pick(req.body, PAYMENT_FIELDS);
    const amount = Number(data.amount);
    if (!(amount > 0)) return fail(res, 400, "Enter a valid amount");
    if (!data.date) return fail(res, 400, "Select the payment date");

    let invoice = null;
    if (data.invoice) {
      invoice = await Invoice.findById(data.invoice);
      if (!invoice) return fail(res, 404, "Invoice not found");
      if (invoice.status === "CANCELLED") return fail(res, 400, "This invoice is cancelled");

      const balance = invoice.total - invoice.paidAmount;
      const counts = (data.status || "SUCCESSFUL") === "SUCCESSFUL";
      if (counts && amount > balance + 0.005)
        return fail(res, 400, `Amount is more than the invoice balance (${round2(balance)})`);

      data.customerName = data.customerName?.trim() || invoice.clientName;
      data.client = invoice.client;
    }
    if (!data.customerName?.trim()) return fail(res, 400, "Customer name is required");

    const payment = await Payment.create({
      ...data,
      amount,
      number: await nextNumber("paymentSeq", "PAY"),
      createdBy: req.user.id,
    });
    await syncInvoicePaid(payment.invoice);
    res.status(201).json({ success: true, message: "Payment recorded", payment });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setPaymentStatus = async (req, res) => {
  try {
    if (!["SUCCESSFUL", "PENDING", "FAILED", "REFUNDED"].includes(req.body.status))
      return fail(res, 400, "Invalid status");
    const payment = await Payment.findById(req.params.id);
    if (!payment) return fail(res, 404, "Payment not found");

    payment.status = req.body.status;
    await payment.save();
    await syncInvoicePaid(payment.invoice);
    res.json({ success: true, message: "Payment updated", payment });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (payment) await syncInvoicePaid(payment.invoice);
    res.json({ success: true, message: "Payment deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
