const User = require("../models/User");
const Lead = require("../models/Lead");
const Deal = require("../models/Deal");
const Client = require("../models/Clients");
const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const TimeEntry = require("../models/TimeEntry");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const FinanceExpense = require("../models/FinanceExpense");
const Subscription = require("../models/Subscription");
const { parseRange, ymd, failJson } = require("../utils/analytics");

const MAX_ROWS = 5000;
const name = (x) => x?.name || x?.companyName || "";

// Each dataset: who may read it, which date the range applies to, and the columns.
// Sensitive fields (salary, bank details, hourly rates) are deliberately left out.
const DATASETS = {
  leads: {
    label: "Leads", perm: "leads.view", model: Lead, dateField: "createdAt", populate: [["assignedTo", "name"]],
    columns: [
      ["name", "Name", (d) => d.name], ["company", "Company", (d) => d.company], ["email", "Email", (d) => d.email],
      ["phone", "Phone", (d) => d.phone], ["source", "Source", (d) => d.source], ["request", "Request", (d) => d.requestType],
      ["demoType", "Demo type", (d) => d.demoType], ["status", "Status", (d) => d.status], ["priority", "Priority", (d) => d.priority],
      ["value", "Expected value", (d) => d.value], ["assigned", "Assigned to", (d) => name(d.assignedTo)],
      ["spend", "Demo spend", (d) => d.spendAmount], ["created", "Created", (d) => ymd(d.createdAt)],
    ],
  },
  deals: {
    label: "Deals", perm: "deals.view", model: Deal, dateField: "createdAt", populate: [["owner", "name"]],
    columns: [
      ["name", "Deal", (d) => d.name], ["company", "Company", (d) => d.company], ["value", "Value", (d) => d.value],
      ["stage", "Stage", (d) => d.stage], ["probability", "Probability %", (d) => d.probability], ["owner", "Owner", (d) => name(d.owner)],
      ["closeDate", "Close date", (d) => ymd(d.closeDate)], ["created", "Created", (d) => ymd(d.createdAt)],
    ],
  },
  clients: {
    label: "Clients", perm: "clients.view", model: Client, dateField: "createdAt",
    columns: [
      ["company", "Company", (d) => d.companyName], ["contact", "Contact", (d) => d.clientName], ["gst", "GST number", (d) => d.gstNumber],
      ["type", "Type", (d) => d.basicType], ["created", "Created", (d) => ymd(d.createdAt)],
    ],
  },
  projects: {
    label: "Projects", perm: "projects.view", model: Project, dateField: "createdAt",
    columns: [
      ["name", "Project", (d) => d.name], ["client", "Client", (d) => d.clientName], ["status", "Status", (d) => d.status],
      ["priority", "Priority", (d) => d.priority], ["start", "Start", (d) => ymd(d.startDate)], ["end", "End", (d) => ymd(d.endDate)],
      ["value", "Project value", (d) => d.projectValue], ["created", "Created", (d) => ymd(d.createdAt)],
    ],
  },
  projectTasks: {
    label: "Project tasks", perm: "projecttasks.view", model: ProjectTask, dateField: "createdAt", populate: [["project", "name"], ["assignee", "name"]],
    columns: [
      ["title", "Task", (d) => d.title], ["project", "Project", (d) => name(d.project)], ["status", "Status", (d) => d.status],
      ["priority", "Priority", (d) => d.priority], ["assignee", "Assignee", (d) => name(d.assignee)], ["due", "Due", (d) => ymd(d.dueDate)],
      ["estimate", "Estimated hours", (d) => d.estimatedHours], ["completed", "Completed", (d) => ymd(d.completedAt)], ["created", "Created", (d) => ymd(d.createdAt)],
    ],
  },
  timeEntries: {
    label: "Time entries", perm: "timelogs.view", model: TimeEntry, dateField: "date", populate: [["project", "name"], ["user", "name"]],
    columns: [
      ["date", "Date", (d) => ymd(d.date)], ["project", "Project", (d) => name(d.project)], ["user", "User", (d) => name(d.user)],
      ["task", "Work done", (d) => d.task], ["hours", "Hours", (d) => d.hours], ["billable", "Billable", (d) => (d.billable ? "Yes" : "No")],
    ],
  },
  invoices: {
    label: "Invoices", perm: "invoices.view", model: Invoice, dateField: "issueDate",
    columns: [
      ["number", "Invoice #", (d) => d.number], ["client", "Client", (d) => d.clientName], ["service", "Service", (d) => d.serviceType],
      ["issue", "Issue date", (d) => ymd(d.issueDate)], ["due", "Due date", (d) => ymd(d.dueDate)], ["subtotal", "Subtotal", (d) => d.subtotal],
      ["tax", "Tax", (d) => d.taxAmount], ["total", "Total", (d) => d.total], ["paid", "Paid", (d) => d.paidAmount], ["status", "Status", (d) => d.status],
    ],
  },
  payments: {
    label: "Payments", perm: "payments.view", model: Payment, dateField: "date",
    columns: [
      ["number", "Payment ID", (d) => d.number], ["customer", "Customer", (d) => d.customerName], ["amount", "Amount", (d) => d.amount],
      ["method", "Method", (d) => d.method], ["date", "Date", (d) => ymd(d.date)], ["status", "Status", (d) => d.status], ["reference", "Reference", (d) => d.reference],
    ],
  },
  expenses: {
    label: "Expenses", perm: "expenses.view", model: FinanceExpense, dateField: "date", select: "-receipt",
    columns: [
      ["date", "Date", (d) => ymd(d.date)], ["category", "Category", (d) => d.category], ["description", "Description", (d) => d.description],
      ["amount", "Amount", (d) => d.amount], ["tax", "GST included", (d) => d.taxAmount], ["status", "Status", (d) => d.status],
    ],
  },
  subscriptions: {
    label: "Subscriptions", perm: "subscriptions.view", model: Subscription, dateField: "startDate",
    columns: [
      ["customer", "Customer", (d) => d.customerName], ["plan", "Plan", (d) => d.planName], ["amount", "Amount", (d) => d.amount],
      ["cycle", "Billing", (d) => d.billingCycle], ["start", "Start", (d) => ymd(d.startDate)], ["next", "Next billing", (d) => ymd(d.nextBilling)], ["status", "Status", (d) => d.status],
    ],
  },
  users: {
    label: "Team members", perm: "users.view", model: User, dateField: "createdAt", select: "name email role designation department status joiningDate createdAt",
    columns: [
      ["name", "Name", (d) => d.name], ["email", "Email", (d) => d.email], ["role", "Role", (d) => d.role], ["designation", "Designation", (d) => d.designation],
      ["department", "Department", (d) => d.department], ["status", "Status", (d) => d.status], ["joined", "Joined", (d) => ymd(d.joiningDate || d.createdAt)],
    ],
  },
};

const allowed = (req) => Object.entries(DATASETS).filter(([, d]) => req.isAdmin || req.perms.includes(d.perm));

exports.listDatasets = (req, res) => {
  res.json({
    success: true,
    canExport: req.isAdmin || req.perms.includes("analytics.export"),
    datasets: allowed(req).map(([key, d]) => ({ key, label: d.label, columns: d.columns.map(([k, label]) => ({ key: k, label })) })),
  });
};

exports.getDataset = async (req, res) => {
  try {
    const def = DATASETS[req.params.key];
    if (!def || !allowed(req).some(([k]) => k === req.params.key))
      return res.status(403).json({ success: false, message: "You don't have access to this data" });

    // No dates = everything. Dates narrow it by the dataset's own date.
    const filter = {};
    if (req.query.from || req.query.to) {
      const r = parseRange(req.query, 3650);
      filter[def.dateField] = { $gte: r.start, $lt: r.end };
    }

    let q = def.model.find(filter).sort({ [def.dateField]: -1 }).limit(MAX_ROWS + 1);
    if (def.select) q = q.select(def.select);
    (def.populate || []).forEach(([path, select]) => { q = q.populate(path, select); });

    const docs = await q;
    const truncated = docs.length > MAX_ROWS;
    const rows = docs.slice(0, MAX_ROWS).map((d) =>
      Object.fromEntries(def.columns.map(([key, , get]) => [key, get(d) ?? ""])),
    );

    res.json({
      success: true,
      key: req.params.key,
      label: def.label,
      columns: def.columns.map(([key, label]) => ({ key, label })),
      rows,
      truncated,
    });
  } catch (error) {
    failJson(res, error);
  }
};
