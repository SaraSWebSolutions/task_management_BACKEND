const CalendarEvent = require("../models/CalendarEvent");
const FollowUp = require("../models/FollowUp");
const CrmTask = require("../models/CrmTask");
const ProjectTask = require("../models/ProjectTask");
const Milestone = require("../models/Milestone");
const Invoice = require("../models/Invoice");
const Lead = require("../models/Lead");
const User = require("../models/User");
const { occurrences } = require("../utils/calendar");
const { notify } = require("../utils/notify");

const DAY = 86400000;
const fail = (res, code, message) => res.status(code).json({ success: false, message });
const istMidnight = (v) => new Date(`${String(v).slice(0, 10)}T00:00:00+05:30`);
const has = (req, perm) => req.isAdmin || req.perms.includes(perm);

const FIELDS = ["title", "description", "category", "allDay", "start", "end", "location", "color", "recurrence", "reminderMinutes"];
const pick = (b) => Object.fromEntries(FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));

// Events I created or was invited to. Admin sees everything.
const visibleFilter = (req) => (req.isAdmin ? {} : { $or: [{ createdBy: req.user.id }, { "attendees.user": req.user.id }] });
const canEdit = (req, e) => req.isAdmin || String(e.createdBy) === String(req.user.id);
const myResponse = (req, e) => e.attendees.find((a) => String(a.user) === String(req.user.id))?.response || null;

// ---- list for the calendar grid -------------------------------------------
exports.getCalendar = async (req, res) => {
  try {
    if (!req.query.from || !req.query.to) return fail(res, 400, "Choose a date range");
    const from = istMidnight(req.query.from);
    const to = new Date(istMidnight(req.query.to).getTime() + DAY);
    if (isNaN(from) || isNaN(to) || to <= from) return fail(res, 400, "Choose a valid date range");
    if (to - from > 70 * DAY) return fail(res, 400, "Date range is too long");

    const me = req.user.id;
    const inRange = { $gte: from, $lt: to };

    const [events, followUps, crm, tasks, milestones, invoices, demos] = await Promise.all([
      CalendarEvent.find({
        ...visibleFilter(req),
        start: { $lt: to },
        $and: [{ $or: [{ "recurrence.freq": { $ne: "NONE" } }, { end: { $gte: from } }] }],
      }),
      FollowUp.find({ status: "PENDING", scheduledAt: inRange, assignedTo: me }).populate("lead", "name company"),
      CrmTask.find({ status: { $ne: "COMPLETED" }, dueDate: inRange, assignee: me }, "title dueDate"),
      ProjectTask.find({ status: { $ne: "DONE" }, dueDate: inRange, assignee: me }, "title dueDate"),
      has(req, "projects.view") ? Milestone.find({ status: { $ne: "COMPLETED" }, dueDate: inRange }).populate("project", "name") : [],
      has(req, "invoices.view") ? Invoice.find({ status: "SENT", dueDate: inRange }, "number clientName dueDate total paidAmount") : [],
      has(req, "leads.view") ? Lead.find({ demoDate: inRange, assignedTo: me, status: { $ne: "LOST" } }, "name company demoDate demoType") : [],
    ]);

    const out = [];
    events.forEach((e) => {
      occurrences(e, from, to).forEach((o) => {
        out.push({
          id: `${e._id}:${o.start.getTime()}`, eventId: e._id, source: "event",
          title: e.title, category: e.category, color: e.color, location: e.location,
          start: o.start, end: o.end, allDay: e.allDay, recurring: e.recurrence?.freq !== "NONE",
          attendees: e.attendees.length, response: myResponse(req, e), mine: canEdit(req, e),
          link: `/calendar/event/${e._id}?at=${o.start.getTime()}`,
        });
      });
    });

    // Things that already live elsewhere in the app, shown read-only
    const auto = (id, source, title, start, extra) =>
      out.push({ id: `${source}:${id}`, source, title, start, end: start, allDay: true, readOnly: true, ...extra });

    followUps.forEach((f) => auto(f._id, "followup", `Follow-up: ${f.lead?.name || "lead"}`, f.scheduledAt, { category: "FOLLOW_UP", color: "#f59e0b", allDay: false, link: "/follow-ups" }));
    crm.forEach((t) => auto(t._id, "crm", t.title, t.dueDate, { category: "DEADLINE", color: "#ef4444", link: "/crm-tasks" }));
    tasks.forEach((t) => auto(t._id, "task", t.title, t.dueDate, { category: "DEADLINE", color: "#ef4444", link: "/my-work" }));
    milestones.forEach((m) => auto(m._id, "milestone", `Milestone: ${m.title}${m.project?.name ? ` (${m.project.name})` : ""}`, m.dueDate, { category: "DEADLINE", color: "#8b5cf6", link: "/pm/milestones" }));
    invoices
      .filter((i) => i.total - i.paidAmount > 0.005)
      .forEach((i) => auto(i._id, "invoice", `Invoice ${i.number} due: ${i.clientName}`, i.dueDate, { category: "DEADLINE", color: "#10b981", link: "/finance/invoices" }));
    demos.forEach((l) => auto(l._id, "demo", `${l.demoType === "OFFLINE" ? "Offline" : "Online"} demo: ${l.name}${l.company ? ` (${l.company})` : ""}`, l.demoDate, { category: "DEMO", color: "#06b6d4", allDay: false, link: "/leads" }));

    out.sort((a, b) => new Date(a.start) - new Date(b.start));
    res.json({ success: true, events: out });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getOptions = async (req, res) => {
  try {
    const users = await User.find({ status: { $ne: "INACTIVE" } }, "name designation").sort({ name: 1 });
    res.json({ success: true, users, categories: CalendarEvent.CATEGORIES });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ---- one event --------------------------------------------------------------
exports.getEvent = async (req, res) => {
  try {
    const e = await CalendarEvent.findOne({ _id: req.params.id, ...visibleFilter(req) })
      .populate("attendees.user", "name designation")
      .populate("createdBy", "name designation")
      .populate("lead", "name company");
    if (!e) return fail(res, 404, "Event not found");

    const at = Number(req.query.at);
    const length = new Date(e.end) - new Date(e.start);
    const occ = at && e.recurrence?.freq !== "NONE"
      ? { start: new Date(at), end: new Date(at + length) }
      : { start: e.start, end: e.end };

    const counts = { ACCEPTED: 0, MAYBE: 0, DECLINED: 0, PENDING: 0 };
    e.attendees.forEach((a) => { counts[a.response] += 1; });

    res.json({ success: true, event: e, occurrence: occ, canEdit: canEdit(req, e), myResponse: myResponse(req, e), counts });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// ---- create / edit / delete ---------------------------------------------------
const normalise = (data) => {
  if (data.allDay) {
    data.start = istMidnight(new Date(data.start).toISOString());
    data.end = new Date(istMidnight(new Date(data.end || data.start).toISOString()).getTime() + DAY - 1);
  }
  return data;
};

const check = (e) => {
  if (!e.title?.trim()) return "Event title is required";
  if (!e.start || isNaN(new Date(e.start))) return "Select the start date and time";
  if (!e.end || isNaN(new Date(e.end))) return "Select the end date and time";
  if (new Date(e.end) < new Date(e.start)) return "End can't be before the start";
  if (e.color && !/^#[0-9a-fA-F]{6}$/.test(e.color)) return "Invalid colour";
  const r = e.recurrence;
  if (r && r.freq && r.freq !== "NONE" && r.until && new Date(r.until) < new Date(e.start)) return "Repeat end date can't be before the event";
  return null;
};

const cleanAttendees = async (ids = [], keep = []) => {
  const wanted = [...new Set(ids.map(String))];
  const valid = await User.find({ _id: { $in: wanted }, status: { $ne: "INACTIVE" } }, "_id");
  const ok = new Set(valid.map((u) => String(u._id)));
  const old = new Map(keep.map((a) => [String(a.user), a.response]));
  return wanted.filter((id) => ok.has(id)).map((id) => ({ user: id, response: old.get(id) || "PENDING" }));
};

exports.addEvent = async (req, res) => {
  try {
    const data = normalise(pick(req.body));
    const problem = check(data);
    if (problem) return fail(res, 400, problem);

    const attendees = await cleanAttendees(req.body.attendees);
    const event = await CalendarEvent.create({ ...data, attendees, createdBy: req.user.id });

    await notify(attendees.map((a) => a.user), {
      type: "CALENDAR", title: `Invited: ${event.title}`,
      message: `${new Date(event.start).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: event.allDay ? undefined : "short", timeZone: "Asia/Kolkata" })}`,
      link: `/calendar/event/${event._id}`,
    }, { except: req.user.id });

    res.status(201).json({ success: true, message: "Event added", event });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const event = await CalendarEvent.findOne({ _id: req.params.id, ...visibleFilter(req) });
    if (!event) return fail(res, 404, "Event not found");
    if (!canEdit(req, event)) return fail(res, 403, "Only the person who created this event can change it");

    const before = { start: +event.start, ids: event.attendees.map((a) => String(a.user)) };
    const body = pick(req.body);
    if (["allDay", "start", "end"].some((k) => body[k] !== undefined)) {
      Object.assign(body, normalise({ allDay: body.allDay ?? event.allDay, start: body.start ?? event.start, end: body.end ?? event.end }));
    }
    event.set(body);
    const problem = check(event.toObject());
    if (problem) return fail(res, 400, problem);

    if (Array.isArray(req.body.attendees)) event.attendees = await cleanAttendees(req.body.attendees, event.attendees);
    await event.save();

    const now = event.attendees.map((a) => String(a.user));
    const added = now.filter((id) => !before.ids.includes(id));
    const stayed = now.filter((id) => before.ids.includes(id));
    await notify(added, { type: "CALENDAR", title: `Invited: ${event.title}`, link: `/calendar/event/${event._id}` }, { except: req.user.id });
    if (+event.start !== before.start) {
      await notify(stayed, { type: "CALENDAR", title: `Event rescheduled: ${event.title}`, message: new Date(event.start).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }), link: `/calendar/event/${event._id}` }, { except: req.user.id });
    }
    res.json({ success: true, message: "Event updated", event });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const event = await CalendarEvent.findOne({ _id: req.params.id, ...visibleFilter(req) });
    if (!event) return fail(res, 404, "Event not found");
    if (!canEdit(req, event)) return fail(res, 403, "Only the person who created this event can delete it");
    await event.deleteOne();
    await notify(event.attendees.map((a) => a.user), { type: "CALENDAR", title: `Event cancelled: ${event.title}` }, { except: req.user.id });
    res.json({ success: true, message: "Event deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.respond = async (req, res) => {
  try {
    if (!["ACCEPTED", "DECLINED", "MAYBE"].includes(req.body.response)) return fail(res, 400, "Invalid response");
    const event = await CalendarEvent.findOne({ _id: req.params.id, "attendees.user": req.user.id });
    if (!event) return fail(res, 404, "You are not invited to this event");

    event.attendees.find((a) => String(a.user) === String(req.user.id)).response = req.body.response;
    await event.save();
    const me = await User.findById(req.user.id, "name");
    await notify(event.createdBy, {
      type: "CALENDAR", title: `${me?.name || "Someone"} ${req.body.response === "ACCEPTED" ? "accepted" : req.body.response === "DECLINED" ? "declined" : "may attend"}`,
      message: event.title, link: `/calendar/event/${event._id}`,
    }, { except: req.user.id });
    res.json({ success: true, message: "Response saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};
