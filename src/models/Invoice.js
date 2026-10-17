const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const SERVICE_TYPES = ["WEBSITE", "BILLING", "SOFTWARE", "E-COMMERCE", "AMC", "OTHER"];

const itemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1, min: 0 },
    rate: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, unique: true }, // INV-0001

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      set: emptyToUndefined,
    },
    clientName: { type: String, required: true, trim: true }, // snapshot
    clientGstin: { type: String, trim: true },

    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      set: emptyToUndefined,
    },
    serviceType: { type: String, enum: SERVICE_TYPES, default: "OTHER" },

    issueDate: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date, required: true },

    items: { type: [itemSchema], validate: (v) => v.length > 0 },

    discount: { type: Number, default: 0, min: 0 },
    taxLabel: { type: String, trim: true },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    taxInclusive: { type: Boolean, default: false },

    // Saved on every write, see utils/finance.js
    subtotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    // Sum of SUCCESSFUL payments, kept in sync by the payment controller
    paidAmount: { type: Number, default: 0 },

    // Payment progress is worked out from paidAmount / dueDate. This only
    // tracks whether the invoice was sent or withdrawn.
    status: { type: String, enum: ["DRAFT", "SENT", "CANCELLED"], default: "SENT" },

    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

invoiceSchema.index({ issueDate: -1 });
invoiceSchema.statics.SERVICE_TYPES = SERVICE_TYPES;

module.exports = mongoose.model("Invoice", invoiceSchema);
