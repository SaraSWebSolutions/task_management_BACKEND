const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const METHODS = ["UPI", "BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "OTHER"];
const STATUSES = ["SUCCESSFUL", "PENDING", "FAILED", "REFUNDED"];

const paymentSchema = new mongoose.Schema(
  {
    number: { type: String, unique: true }, // PAY-0001

    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      set: emptyToUndefined,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      set: emptyToUndefined,
    },
    customerName: { type: String, required: true, trim: true },

    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: METHODS, default: "UPI" },
    date: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: STATUSES, default: "SUCCESSFUL" },

    reference: { type: String, trim: true }, // UTR / cheque no. / txn id
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

paymentSchema.index({ date: -1 });
paymentSchema.statics.METHODS = METHODS;
paymentSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Payment", paymentSchema);
