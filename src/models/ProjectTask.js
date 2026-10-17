const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

// Work items inside a project (shown on the Task Board and Task List).
// Separate from the employee daily Task model and from CrmTask.
const projectTaskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    milestone: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Milestone",
      set: emptyToUndefined,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: {
      type: String,
      enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"],
      default: "TODO",
    },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      set: emptyToUndefined,
    },
    dueDate: { type: Date, set: emptyToUndefined },
    estimatedHours: { type: Number, default: 0, min: 0 },
    completedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ProjectTask", projectTaskSchema);
