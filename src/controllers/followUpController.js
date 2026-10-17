const FollowUp = require("../models/FollowUp");

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const present = (f) => ({
  ...f.toObject(),
  overdue: f.status === "PENDING" && new Date(f.scheduledAt) < new Date(),
});

const FIELDS = ["lead", "type", "notes", "scheduledAt", "reminder", "assignedTo"];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

exports.getFollowUps = async (req, res) => {
  try {
    const items = await FollowUp.find()
      .populate("lead", "name company")
      .populate("assignedTo", "name")
      .sort({ scheduledAt: 1 });

    const list = items.map(present);
    res.json({
      success: true,
      followUps: list,
      stats: {
        total: list.length,
        upcoming: list.filter((f) => f.status === "PENDING" && !f.overdue).length,
        overdue: list.filter((f) => f.overdue).length,
        completed: list.filter((f) => f.status === "COMPLETED").length,
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addFollowUp = async (req, res) => {
  try {
    if (!req.body.lead) return fail(res, 400, "Select a lead");
    if (!req.body.scheduledAt) return fail(res, 400, "Select date and time");
    const item = await FollowUp.create({ ...pick(req.body), createdBy: req.user.id });
    res.status(201).json({ success: true, message: "Follow-up scheduled", followUp: item });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateFollowUp = async (req, res) => {
  try {
    const item = await FollowUp.findById(req.params.id);
    if (!item) return fail(res, 404, "Follow-up not found");

    item.set(pick(req.body));
    await item.save();
    res.json({ success: true, message: "Follow-up updated", followUp: item });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Mark done / reopen
exports.toggleFollowUp = async (req, res) => {
  try {
    const item = await FollowUp.findById(req.params.id);
    if (!item) return fail(res, 404, "Follow-up not found");

    const done = item.status !== "COMPLETED";
    item.status = done ? "COMPLETED" : "PENDING";
    item.completedAt = done ? new Date() : undefined;
    await item.save();
    res.json({ success: true, followUp: item });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteFollowUp = async (req, res) => {
  try {
    await FollowUp.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Follow-up deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
