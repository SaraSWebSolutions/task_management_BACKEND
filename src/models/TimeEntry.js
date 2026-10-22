const mongoose = require("mongoose");

// hourlyRate is saved with the entry (same idea as Project.team) so later
// salary changes don't rewrite the cost of time already logged.
const timeEntrySchema = new mongoose.Schema(
  {
    // Optional: time on support / other work has no project.
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      index: true,
    },
    taskRef: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectTask", index: true },
    startTime: { type: String, trim: true }, // "HH:MM", optional
    endTime: { type: String, trim: true },
    task: { type: String, trim: true }, // free text description of the work
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0.01, max: 24 },
    billable: { type: Boolean, default: true },
    notes: { type: String, trim: true },
    hourlyRate: { type: Number, default: 0 },
  },
  { timestamps: true },
);

timeEntrySchema.index({ date: -1 });

module.exports = mongoose.model("TimeEntry", timeEntrySchema);
