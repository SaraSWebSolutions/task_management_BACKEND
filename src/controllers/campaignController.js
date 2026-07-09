const Campaign = require("../models/Campaign");
const { sendCampaignEmail } = require("../utils/mailer");

exports.addCampaign = async (req, res) => {
    const { name, title, body, emails = [] } = req.body;

    try {
        const campaign = await Campaign.create({ name, title, body, emails });

        // Socket instance attached to app in server.js
        const io = req.app.get("io");

        const total = emails.length;
        let successCount = 0;
        let failCount = 0;

        // Send emails sequentially so we can emit progress per email
        for (let i = 0; i < emails.length; i++) {
            const email = emails[i];
            try {
                const htmlBody = body
                    .split(/\n\s*\n/)
                    .map(paragraph => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
                    .join("");
                await sendCampaignEmail(
                    email,
                    title,
                    body,
                    htmlBody
                );

                successCount += 1;
                io?.emit("campaign:progress", {
                    campaignId: campaign._id,
                    email,
                    index: i + 1,
                    total,
                    success: true,
                });
            } catch (err) {
                failCount += 1;
                io?.emit("campaign:progress", {
                    campaignId: campaign._id,
                    email,
                    index: i + 1,
                    total,
                    success: false,
                    error: err.message,
                });
            }
        }

        io?.emit("campaign:complete", {
            campaignId: campaign._id,
            total,
            successCount,
            failCount,
        });

        res.status(200).json({
            success: true,
            message: "Campaign created and emails processed",
            campaign,
            stats: { total, successCount, failCount },
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.listCampaign = async (req, res) => {
    try {
        const listData = await Campaign.find().sort({ createdAt: -1 });
        res.status(200).json({
            success: true,
            data: listData
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

exports.viewCampaign = async (req, res) => {
    const { id } = req.params;
    try {
        const campaignData = await Campaign.findById(id);
        if (!campaignData) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found"
            })
        }
        res.status(200).json({
            success: true,
            data: campaignData
        })
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

exports.followUpCampaign = async (req, res) => {
    const { id } = req.params;
    const { title, body } = req.body;

    try {
        const campaign = await Campaign.findById(id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found"
            });
        }

        const io = req.app.get("io");

        const total = campaign.emails.length;
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < campaign.emails.length; i++) {
            const email = campaign.emails[i];

            try {
                const htmlBody = body
                    .split(/\n\s*\n/)
                    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
                    .join("");
                await sendCampaignEmail(
                    email,
                    title,
                    body,
                    htmlBody
                );

                successCount++;

                io?.emit("campaign:followup-progress", {
                    campaignId: campaign._id,
                    email,
                    index: i + 1,
                    total,
                    success: true
                });

            } catch (err) {
                failCount++;

                io?.emit("campaign:followup-progress", {
                    campaignId: campaign._id,
                    email,
                    index: i + 1,
                    total,
                    success: false,
                    error: err.message
                });
            }
        }

        io?.emit("campaign:followup-complete", {
            campaignId: campaign._id,
            total,
            successCount,
            failCount
        });

        campaign.isFollowedUp = true;
        campaign.save();

        res.status(200).json({
            success: true,
            message: "Follow-up emails sent successfully",
            stats: {
                total,
                successCount,
                failCount
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};