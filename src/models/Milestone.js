const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const milestoneSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    dueDate: { type: Date, set: emptyToUndefined },
    status: {
      type: String,
      enum: ["UPCOMING", "IN_PROGRESS", "COMPLETED"],
      default: "UPCOMING",
    },
    // Used only while no task is linked to the milestone.
    // Once tasks are linked, progress = done tasks / linked tasks.
    manualProgress: { type: Number, default: 0, min: 0, max: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Milestone", milestoneSchema);
