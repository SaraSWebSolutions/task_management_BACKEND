const Campaign = require("../models/Campaign");
const Lead = require("../models/Lead");
const { sendCampaignEmail } = require("../utils/mailer");
const { notify } = require("../utils/notify");

const MAX_RECIPIENTS = 100; // sent one after another, so keep a request reasonable
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const fail = (res, code, message) => res.status(code).json({ success: false, message });

// "a@x.com, b@y.com\nc@z.com" or an array -> unique, lower-case, valid
const cleanEmails = (input) => {
  const list = Array.isArray(input) ? input : String(input || "").split(/[\s,;]+/);
  const all = list.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const emails = [...new Set(all.filter((e) => EMAIL.test(e)))];
  return { emails, invalid: [...new Set(all.filter((e) => !EMAIL.test(e)))] };
};

const toHtml = (body) =>
  body
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`)
    .join("");

const validateForSend = (c) => {
  if (!c.name?.trim()) return "Give the campaign a name";
  if (!c.title?.trim()) return "Enter the email subject";
  if (!c.body?.trim()) return "Write the message";
  if (!c.emails?.length) return "Add at least one recipient";
  if (c.emails.length > MAX_RECIPIENTS) return `You can send to at most ${MAX_RECIPIENTS} recipients at a time`;
  return null;
};

// Sends one by one and reports progress over socket.io (same events as before).
const deliver = async ({ id, emails, subject, body, io, prefix }) => {
  const html = toHtml(body);
  const failures = [];
  let ok = 0;
  for (let i = 0; i < emails.length; i++) {
    try {
      await sendCampaignEmail(emails[i], subject, body, html);
      ok += 1;
      io?.emit(`campaign:${prefix}progress`, { campaignId: id, email: emails[i], index: i + 1, total: emails.length, success: true });
    } catch (err) {
      failures.push({ email: emails[i], error: err.message });
      io?.emit(`campaign:${prefix}progress`, { campaignId: id, email: emails[i], index: i + 1, total: emails.length, success: false, error: err.message });
    }
  }
  io?.emit(`campaign:${prefix}complete`, { campaignId: id, total: emails.length, successCount: ok, failCount: failures.length });
  return { ok, failures };
};

const sendNow = async (campaign, req) => {
  const { ok, failures } = await deliver({ id: campaign._id, emails: campaign.emails, subject: campaign.title, body: campaign.body, io: req.app.get("io"), prefix: "" });
  campaign.sentCount = ok;
  campaign.failCount = failures.length;
  campaign.failures = failures;
  campaign.status = ok === 0 ? "FAILED" : failures.length ? "PARTIAL" : "SENT";
  campaign.sentAt = new Date();
  await campaign.save();

  await notify(req.user.id, {
    type: "CAMPAIGN",
    title: ok === 0 ? "Campaign failed to send" : failures.length ? "Campaign sent with errors" : "Campaign sent",
    message: `${campaign.name}: ${ok} sent${failures.length ? `, ${failures.length} failed` : ""}`,
    link: "/campaigns",
  });
  return { ok, failures };
};

const result = (res, campaign, { ok, failures }) => {
  const code = ok === 0 ? 502 : failures.length ? 207 : 200;
  res.status(code).json({
    success: ok > 0 && !failures.length,
    message: ok === 0 ? "No emails were sent. Check the mail settings." : failures.length ? `${ok} sent, ${failures.length} failed` : `Sent to ${ok} recipient${ok > 1 ? "s" : ""}`,
    campaign,
    stats: { total: campaign.emails.length, successCount: ok, failCount: failures.length },
    failures,
  });
};

const fromBody = (b) => ({
  name: b.name,
  title: b.title,
  body: b.body,
  ...(b.emails !== undefined ? { emails: cleanEmails(b.emails).emails } : {}),
});

// Create and send straight away
exports.addCampaign = async (req, res) => {
  try {
    const data = fromBody(req.body);
    const bad = cleanEmails(req.body.emails).invalid;
    if (bad.length) return fail(res, 400, `Not a valid email: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "..." : ""}`);
    const problem = validateForSend(data);
    if (problem) return fail(res, 400, problem);

    const campaign = await Campaign.create({ ...data, createdBy: req.user.id });
    result(res, campaign, await sendNow(campaign, req));
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Save (or update) a draft. Nothing is sent and nothing is required.
exports.saveDraft = async (req, res) => {
  try {
    const data = fromBody(req.body);
    if (!data.name?.trim() && !data.title?.trim() && !data.body?.trim() && !data.emails?.length)
      return fail(res, 400, "Write something to save");

    let campaign;
    if (req.body.id) {
      campaign = await Campaign.findById(req.body.id);
      if (!campaign) return fail(res, 404, "Campaign not found");
      if (campaign.status !== "DRAFT") return fail(res, 400, "This campaign was already sent");
      campaign.set(data);
      await campaign.save();
    } else {
      campaign = await Campaign.create({ ...data, name: data.name?.trim() || data.title?.trim() || "Untitled draft", status: "DRAFT", createdBy: req.user.id });
    }
    res.json({ success: true, message: "Draft saved", campaign });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Send a saved draft (or retry one that failed completely)
exports.sendCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return fail(res, 404, "Campaign not found");
    if (!["DRAFT", "FAILED"].includes(campaign.status)) return fail(res, 400, "This campaign was already sent");

    campaign.set(fromBody(req.body));
    const problem = validateForSend(campaign);
    if (problem) return fail(res, 400, problem);

    result(res, campaign, await sendNow(campaign, req));
  } catch (error) {
    fail(res, 400, error.message);
  }
};

const statusOf = (c) => c.status || (c.emails?.length ? "SENT" : "DRAFT");

exports.listCampaign = async (req, res) => {
  try {
    const all = await Campaign.find().sort({ updatedAt: -1 }).populate("createdBy", "name");
    const rows = all.map((c) => ({ ...c.toObject(), status: statusOf(c) }));
    const live = rows.filter((c) => !c.trashed);
    res.json({
      success: true,
      campaigns: rows,
      counts: {
        sent: live.filter((c) => c.status !== "DRAFT").length,
        drafts: live.filter((c) => c.status === "DRAFT").length,
        trash: rows.filter((c) => c.trashed).length,
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.viewCampaign = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).populate("createdBy", "name");
    if (!c) return fail(res, 404, "Campaign not found");
    res.json({ success: true, campaign: { ...c.toObject(), status: statusOf(c) } });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Send another email to everyone on a campaign that has already gone out
exports.followUpCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return fail(res, 404, "Campaign not found");
    if (statusOf(campaign) === "DRAFT") return fail(res, 400, "Send the campaign first");

    const { title, body } = req.body;
    if (!title?.trim()) return fail(res, 400, "Enter the email subject");
    if (!body?.trim()) return fail(res, 400, "Write the message");

    const { ok, failures } = await deliver({ id: campaign._id, emails: campaign.emails, subject: title, body, io: req.app.get("io"), prefix: "followup-" });
    if (ok > 0) {
      campaign.isFollowedUp = true;
      campaign.followUpCount = (campaign.followUpCount || 0) + 1;
      campaign.lastFollowUpAt = new Date();
      await campaign.save();
    }
    result(res, campaign, { ok, failures });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setTrashed = (trashed) => async (req, res) => {
  try {
    const c = await Campaign.findByIdAndUpdate(req.params.id, { trashed }, { returnDocument: "after" });
    if (!c) return fail(res, 404, "Campaign not found");
    res.json({ success: true, message: trashed ? "Moved to trash" : "Restored" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteForever = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return fail(res, 404, "Campaign not found");
    if (!c.trashed) return fail(res, 400, "Move it to trash first");
    await c.deleteOne();
    res.json({ success: true, message: "Deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// Lead emails to pick recipients from. Needs lead access as well.
exports.recipients = async (req, res) => {
  try {
    if (!req.isAdmin && !req.perms.includes("leads.view")) return fail(res, 403, "You need lead access to pick recipients from leads");
    const filter = { email: { $nin: [null, ""] } };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.source) filter.source = req.query.source;
    const leads = await Lead.find(filter, "name company email status source").sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, recipients: leads.filter((l) => EMAIL.test(String(l.email).trim())).map((l) => ({ name: l.name, company: l.company, email: String(l.email).trim().toLowerCase(), status: l.status, source: l.source })) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
