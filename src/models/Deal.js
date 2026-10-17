const mongoose = require("mongoose");

const STAGES = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
  "CLOSED_LOST",
];

// Default win probability for each stage (can be overridden per deal).
const STAGE_PROBABILITY = {
  DISCOVERY: 25,
  PROPOSAL: 60,
  NEGOTIATION: 75,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const dealSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    value: { type: Number, default: 0, min: 0 },
    stage: { type: String, enum: STAGES, default: "DISCOVERY" },
    probability: { type: Number, min: 0, max: 100 },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      set: emptyToUndefined,
    },
    closeDate: { type: Date, set: emptyToUndefined },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      set: emptyToUndefined,
    },
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

dealSchema.statics.STAGES = STAGES;
dealSchema.statics.STAGE_PROBABILITY = STAGE_PROBABILITY;

module.exports = mongoose.model("Deal", dealSchema);
