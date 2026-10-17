const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

// CRM to-dos (separate from the employee Task model used by the task board).
const crmTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
    },
    status: {
      type: String,
      enum: ["TODO", "IN_PROGRESS", "REVIEW", "COMPLETED"],
      default: "TODO",
    },
    dueDate: { type: Date, set: emptyToUndefined },
    project: { type: String, trim: true }, // free-text label / category
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      set: emptyToUndefined,
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      set: emptyToUndefined,
    },
    completedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CrmTask", crmTaskSchema);
