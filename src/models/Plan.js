const mongoose = require("mongoose");

// A pricing plan. `features` drives both the plan card and the comparison
// table: value is free text ("25", "Unlimited", "Yes", "No").
const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    monthlyPrice: { type: Number, required: true, min: 0 },
    // Leave empty to use monthly x 12 less the yearly discount from settings.
    yearlyPrice: { type: Number, min: 0 },
    features: [
      new mongoose.Schema(
        {
          name: { type: String, required: true, trim: true },
          value: { type: String, default: "Yes", trim: true },
        },
        { _id: false },
      ),
    ],
    popular: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Plan", planSchema);
