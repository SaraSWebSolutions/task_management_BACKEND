const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const followUpSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    type: { type: String, enum: ["CALL", "EMAIL", "MEETING"], default: "CALL" },
    notes: { type: String, trim: true },
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: ["PENDING", "COMPLETED"], default: "PENDING" },
    completedAt: Date,
    reminder: { type: Boolean, default: false },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      set: emptyToUndefined,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FollowUp", followUpSchema);
