const mongoose = require("mongoose");

// Company running costs (payroll, rent, tools...). This is separate from the
// marketing "Expense" model, which feeds the lead target dashboard.
const CATEGORIES = [
  "Salaries & Wages",
  "Marketing",
  "Infrastructure",
  "Office & Admin",
  "Travel & Events",
  "Software & Tools",
  "Legal & Compliance",
  "Other",
];
const STATUSES = ["PENDING", "APPROVED", "PAID", "REJECTED"];

const financeExpenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    category: { type: String, enum: CATEGORIES, required: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    // GST paid on this purchase. Counted as input tax credit on the Tax page.
    taxAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: STATUSES, default: "PENDING" },

    receipt: String, // data URL, same approach as the lead expense copy
    receiptName: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

financeExpenseSchema.index({ date: -1 });
financeExpenseSchema.statics.CATEGORIES = CATEGORIES;
financeExpenseSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("FinanceExpense", financeExpenseSchema);
