const mongoose = require("mongoose");

// One document per month ("2026-10"): targets + follower counts per source
const marketingMonthSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true }, // YYYY-MM

    marginPercent: { type: Number, default: 30 },

    target: {
      followers: { type: Number, default: 200 },
      enquiries: { type: Number, default: 10 },
      finalized: { type: Number, default: 10 },
      signed: { type: Number, default: 5 },
    },

    // Actual followers gained, entered by hand
    followers: {
      BNI: { type: Number, default: 0 },
      EVENT: { type: Number, default: 0 },
      META: { type: Number, default: 0 },
      INDIAMART: { type: Number, default: 0 },
      OTHER: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MarketingMonth", marketingMonthSchema);
