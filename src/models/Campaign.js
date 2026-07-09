const mongoose = require("mongoose");

const CampaignSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        title: {
            type: String,
            required: true,
        },
        body: {
            type: String,
            required: true,
        },
        emails: {
            type: [String],
            default: [],
        },
        isFollowedUp:{
            type: Boolean,
            default: false
        }
    },
    { timestamps: true },
);

module.exports = mongoose.model("Campaign", CampaignSchema);