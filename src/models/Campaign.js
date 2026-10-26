const mongoose = require("mongoose");

const CampaignSchema = new mongoose.Schema(
  {
    // Drafts can be saved half written, so these are checked when sending
    name: { type: String, trim: true },
    title: { type: String, trim: true }, // email subject
    body: { type: String },
    emails: { type: [String], default: [] },

    // Campaigns made before drafts existed have no status and count as sent
    status: { type: String, enum: ["DRAFT", "SENT", "PARTIAL", "FAILED"], default: "DRAFT" },
    sentCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    failures: [{ _id: false, email: String, error: String }],
    sentAt: Date,

    isFollowedUp: { type: Boolean, default: false },
    followUpCount: { type: Number, default: 0 },
    lastFollowUpAt: Date,

    trashed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Campaign", CampaignSchema);
