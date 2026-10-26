const mongoose = require("mongoose");

// Which kinds of in-app notifications a person wants. Everything is on by default.
const flag = { type: Boolean, default: true };

const userPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    notify: {
      TASK: flag,
      LEAD: flag,
      CALENDAR: flag,
      FINANCE: flag,
      CAMPAIGN: flag,
      SYSTEM: flag,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("UserPreference", userPreferenceSchema);
