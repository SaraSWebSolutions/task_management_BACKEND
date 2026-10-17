const mongoose = require("mongoose");

// hourlyRate is saved with the entry (same idea as Project.team) so later
// salary changes don't rewrite the cost of time already logged.
const timeEntrySchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
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
