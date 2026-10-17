const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const STATUSES = ["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED"];

const subscriptionSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      set: emptyToUndefined,
    },
    customerName: { type: String, required: true, trim: true },

    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      set: emptyToUndefined,
    },
    planName: { type: String, required: true, trim: true }, // snapshot

    // Price per billing cycle, saved when the subscription is created so a
    // later plan price change doesn't rewrite what this customer pays.
    amount: { type: Number, required: true, min: 0 },
    billingCycle: { type: String, enum: ["MONTHLY", "YEARLY"], default: "MONTHLY" },

    startDate: { type: Date, required: true, default: Date.now },
    nextBilling: { type: Date, set: emptyToUndefined },
    status: { type: String, enum: STATUSES, default: "ACTIVE" },
    cancelledAt: Date,

    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

subscriptionSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Subscription", subscriptionSchema);
