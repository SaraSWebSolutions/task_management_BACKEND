const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const UserPreference = require("../models/UserPreference");
const User = require("../models/User");
const ProjectTask = require("../models/ProjectTask");
const CrmTask = require("../models/CrmTask");
const FollowUp = require("../models/FollowUp");
const Invoice = require("../models/Invoice");
const CalendarEvent = require("../models/CalendarEvent");
const { permissionsFor } = require("../utils/rbac");
const { notify } = require("../utils/notify");
const { occurrences } = require("../utils/calendar");
const { startOfToday, ist } = require("../utils/finance");

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const DAY = 86400000;
const ymd = (d) => ist(d).toISOString().slice(0, 10);

// ---- reminders -----------------------------------------------------------
// Created when the person opens the app (at most every 5 minutes), so there is
// no background job to run. `key` makes each reminder appear once per day.
const lastRun = new Map();
const THROTTLE_MS = 5 * 60 * 1000;

const generateReminders = async (user, perms, isAdmin) => {
  const me = String(user._id);
  if (Date.now() - (lastRun.get(me) || 0) < THROTTLE_MS) return;
  lastRun.set(me, Date.now());

  const today = startOfToday();
  const endOfToday = new Date(today.getTime() + DAY);
  const day = ymd(today);
  const now = new Date();
  const jobs = [];

  // Project tasks and CRM tasks that are due today or late
  const [tasks, crm, followUps] = await Promise.all([
    ProjectTask.find({ assignee: me, status: { $ne: "DONE" }, dueDate: { $lt: endOfToday, $ne: null } }, "title dueDate").limit(15),
    CrmTask.find({ assignee: me, status: { $ne: "COMPLETED" }, dueDate: { $lt: endOfToday, $ne: null } }, "title dueDate").limit(15),
    FollowUp.find({ assignedTo: me, status: "PENDING", scheduledAt: { $lt: endOfToday } }).populate("lead", "name company").limit(15),
  ]);

  tasks.forEach((t) => {
    const late = new Date(t.dueDate) < today;
    jobs.push(notify(me, { type: "TASK", title: late ? "Task overdue" : "Task due today", message: t.title, link: "/my-work", key: `task:${t._id}:${day}` }));
  });
  crm.forEach((t) => {
    const late = new Date(t.dueDate) < today;
    jobs.push(notify(me, { type: "LEAD", title: late ? "CRM task overdue" : "CRM task due today", message: t.title, link: "/crm-tasks", key: `crm:${t._id}:${day}` }));
  });
  followUps.forEach((f) => {
    const late = new Date(f.scheduledAt) < today;
    jobs.push(notify(me, { type: "LEAD", title: late ? "Follow-up missed" : "Follow-up today", message: `${f.type.toLowerCase()} with ${f.lead?.name || "lead"}${f.lead?.company ? ` (${f.lead.company})` : ""}`, link: "/follow-ups", key: `followup:${f._id}:${day}` }));
  });

  // Calendar events starting within their reminder window
  const events = await CalendarEvent.find({
    reminderMinutes: { $ne: null },
    $or: [{ createdBy: me }, { "attendees.user": me }],
    start: { $lt: new Date(now.getTime() + 3 * DAY) },
    $and: [{ $or: [{ "recurrence.freq": { $ne: "NONE" } }, { end: { $gte: now } }] }],
  }).limit(100);

  events.forEach((e) => {
    // an attendee who declined doesn't need the reminder
    if (e.attendees.some((a) => String(a.user) === me && a.response === "DECLINED")) return;
    occurrences(e, now, new Date(now.getTime() + 2 * DAY)).forEach((o) => {
      const remindAt = new Date(o.start.getTime() - e.reminderMinutes * 60000);
      if (remindAt <= now && o.start > now) {
        const mins = Math.max(1, Math.round((o.start - now) / 60000));
        jobs.push(notify(me, { type: "CALENDAR", title: `Starting in ${mins} min`, message: e.title, link: `/calendar/event/${e._id}?at=${o.start.getTime()}`, key: `event:${e._id}:${o.start.getTime()}` }));
      }
    });
  });

  // Money owed late (only for people who can see invoices)
  if (isAdmin || perms.includes("invoices.view")) {
    const open = await Invoice.find({ status: "SENT", dueDate: { $lt: today } }, "total paidAmount");
    const late = open.filter((i) => i.total - i.paidAmount > 0.005);
    if (late.length) {
      const amount = late.reduce((s, i) => s + (i.total - i.paidAmount), 0);
      jobs.push(notify(me, { type: "FINANCE", title: `${late.length} invoice${late.length > 1 ? "s" : ""} overdue`, message: `₹${Math.round(amount).toLocaleString("en-IN")} is waiting to be collected`, link: "/finance/invoices", key: `invoices-overdue:${day}` }));
    }
  }

  await Promise.all(jobs);
};

// ---- API -----------------------------------------------------------------
const currentUser = (req) => User.findById(req.user.id).select("role roleKey permissions status");

exports.list = async (req, res) => {
  try {
    const user = await currentUser(req);
    const perms = await permissionsFor(user);
    await generateReminders(user, perms, user.role === "ADMIN").catch((e) => console.error("reminders:", e.message));

    const filter = { user: req.user.id };
    if (req.query.type && Notification.TYPES.includes(req.query.type)) filter.type = req.query.type;
    const limit = Math.min(Number(req.query.limit) || 60, 200);

    const [items, unread, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(limit),
      Notification.countDocuments({ user: req.user.id, read: false }),
      Notification.countDocuments({ user: req.user.id }),
    ]);
    res.json({ success: true, notifications: items, unread, total });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// Light call for the bell: no reminder generation, just the count + latest few
exports.summary = async (req, res) => {
  try {
    const [unread, latest] = await Promise.all([
      Notification.countDocuments({ user: req.user.id, read: false }),
      Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(6),
    ]);
    res.json({ success: true, unread, latest });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.markRead = async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user.id }, { read: true });
    res.json({ success: true });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const r = await Notification.updateMany({ user: req.user.id, read: false }, { read: true });
    res.json({ success: true, updated: r.modifiedCount });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.remove = async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, user: req.user.id });
    res.json({ success: true });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.clearRead = async (req, res) => {
  try {
    const r = await Notification.deleteMany({ user: req.user.id, read: true });
    res.json({ success: true, deleted: r.deletedCount });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

const TYPES = ["TASK", "LEAD", "CALENDAR", "FINANCE", "CAMPAIGN", "SYSTEM"];

exports.getPreferences = async (req, res) => {
  try {
    const p = await UserPreference.findOne({ user: req.user.id });
    res.json({ success: true, notify: Object.fromEntries(TYPES.map((t) => [t, p?.notify?.[t] !== false])) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.savePreferences = async (req, res) => {
  try {
    const incoming = req.body.notify || {};
    const set = {};
    TYPES.forEach((t) => { if (typeof incoming[t] === "boolean") set[`notify.${t}`] = incoming[t]; });
    await UserPreference.updateOne({ user: new mongoose.Types.ObjectId(req.user.id) }, { $set: set }, { upsert: true });
    res.json({ success: true });
  } catch (error) {
    fail(res, 400, error.message);
  }
};
