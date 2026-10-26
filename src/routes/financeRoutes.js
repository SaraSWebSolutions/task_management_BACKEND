const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const billing = require("../controllers/financeBillingController");
const expenses = require("../controllers/financeExpenseController");
const subs = require("../controllers/financeSubscriptionController");
const tax = require("../controllers/financeTaxController");
const reports = require("../controllers/financeReportController");

router.use(auth);

// Dropdown data for every finance form
router.get(
  "/options",
  can(
    "invoices.view",
    "invoices.manage",
    "payments.view",
    "payments.manage",
    "expenses.view",
    "expenses.manage",
    "subscriptions.view",
    "subscriptions.manage",
    "tax.view",
  ),
  tax.getOptions,
);

// Revenue + finance reports
router.get("/revenue", can("finance.view"), reports.getRevenue);
router.get("/dashboard", can("finance.view"), reports.getDashboard);
router.get("/reports", can("finance.view"), reports.getReports);

// Invoices
router.get("/invoices", can("invoices.view"), billing.getInvoices);
router.get("/invoices/:id", can("invoices.view"), billing.getInvoice);
router.post("/invoices", can("invoices.manage"), billing.addInvoice);
router.put("/invoices/:id", can("invoices.manage"), billing.updateInvoice);
router.patch("/invoices/:id/status", can("invoices.manage"), billing.setInvoiceStatus);
router.delete("/invoices/:id", can("invoices.manage"), billing.deleteInvoice);

// Payments
router.get("/payments", can("payments.view"), billing.getPayments);
router.post("/payments", can("payments.manage"), billing.addPayment);
router.patch("/payments/:id/status", can("payments.manage"), billing.setPaymentStatus);
router.delete("/payments/:id", can("payments.manage"), billing.deletePayment);

// Expenses
router.get("/expenses", can("expenses.view"), expenses.getExpenses);
router.get("/expenses/:id/receipt", can("expenses.view"), expenses.getReceipt);
router.post("/expenses", can("expenses.manage"), expenses.addExpense);
router.put("/expenses/budgets", can("expenses.manage"), expenses.saveBudgets);
router.put("/expenses/:id", can("expenses.manage"), expenses.updateExpense);
router.patch("/expenses/:id/status", can("expenses.manage"), expenses.setExpenseStatus);
router.delete("/expenses/:id", can("expenses.manage"), expenses.deleteExpense);

// Subscriptions
router.get("/subscriptions", can("subscriptions.view"), subs.getSubscriptions);
router.post("/subscriptions", can("subscriptions.manage"), subs.addSubscription);
router.put("/subscriptions/:id", can("subscriptions.manage"), subs.updateSubscription);
router.patch("/subscriptions/:id/status", can("subscriptions.manage"), subs.setSubscriptionStatus);
router.delete("/subscriptions/:id", can("subscriptions.manage"), subs.deleteSubscription);

// Plans & pricing
router.get("/plans", can("plans.view"), subs.getPlans);
router.post("/plans", can("plans.manage"), subs.addPlan);
router.put("/plans/yearly-discount", can("plans.manage"), subs.saveYearlyDiscount);
router.put("/plans/:id", can("plans.manage"), subs.updatePlan);
router.delete("/plans/:id", can("plans.manage"), subs.deletePlan);

// Tax
router.get("/tax", can("tax.view"), tax.getTax);
router.put("/tax/settings", can("tax.manage"), tax.saveSettings);
router.post("/tax/rates", can("tax.manage"), tax.addRate);
router.put("/tax/rates/:id", can("tax.manage"), tax.updateRate);
router.delete("/tax/rates/:id", can("tax.manage"), tax.deleteRate);

module.exports = router;
