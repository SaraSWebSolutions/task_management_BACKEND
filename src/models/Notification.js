const mongoose = require("mongoose");

const TYPES = ["TASK", "LEAD", "CALENDAR", "FINANCE", "CAMPAIGN", "SYSTEM"];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: TYPES, default: "SYSTEM" },
    title: { type: String, required: true, trim: true },
    message: { type: String, trim: true },
    link: { type: String, trim: true }, // app route to open, e.g. /my-work
    read: { type: Boolean, default: false },
    // Stops the same reminder being created twice (e.g. "task due" once a day)
    key: { type: String },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: "string" } } });
notificationSchema.statics.TYPES = TYPES;

module.exports = mongoose.model("Notification", notificationSchema);
