const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    permissions: [String],

    // Which legacy dashboard/menu a user of this role lands on.
    // Custom roles can only be MANAGER- or EMPLOYEE-based, never ADMIN.
    baseRole: {
      type: String,
      enum: ["ADMIN", "MANAGER", "EMPLOYEE"],
      default: "EMPLOYEE",
    },

    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Role", roleSchema);
