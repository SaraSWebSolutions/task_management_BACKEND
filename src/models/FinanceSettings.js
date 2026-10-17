const mongoose = require("mongoose");

// One document for the whole company ("default"). Holds invoice / payment
// counters, tax calculation switches and the monthly expense budgets.
const financeSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },

    invoiceSeq: { type: Number, default: 0 },
    paymentSeq: { type: Number, default: 0 },

    companyName: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },

    autoCalculateTax: { type: Boolean, default: true },
    taxInclusive: { type: Boolean, default: false },
    defaultTaxRate: { type: Number, default: 18, min: 0, max: 100 },

    // % discount shown on the yearly toggle of the pricing page
    yearlyDiscount: { type: Number, default: 20, min: 0, max: 100 },

    // category -> monthly budget amount
    expenseBudgets: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FinanceSettings", financeSettingsSchema);
