const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

// hourlyRate is saved when the entry is added, so later salary changes
// don't rewrite the cost of work that is already done.
const entry = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  hours: { type: Number, default: 0 },
  hourlyRate: { type: Number, default: 0 },
};

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    clientName: String,

    status: {
      type: String,
      enum: ["PLANNING", "IN_PROGRESS", "ON_HOLD", "COMPLETED"],
      default: "PLANNING",
    },

    description: { type: String, trim: true },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
    },
    startDate: { type: Date, set: emptyToUndefined },
    endDate: { type: Date, set: emptyToUndefined },

    projectValue: { type: Number, default: 0 }, // original project value
    clientEstimationHours: { type: Number, default: 0 },
    teamEstimationHours: { type: Number, default: 0 },

    team: [new mongoose.Schema(entry, { _id: false })],

    // Support work done by our team after the project is completed
    support: [
      new mongoose.Schema({
        ...entry,
        note: String,
        date: { type: Date, default: Date.now },
      }),
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Project", projectSchema);
