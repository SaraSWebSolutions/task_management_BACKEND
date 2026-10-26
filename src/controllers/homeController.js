const Payment = require("../models/Payment");
const Invoice = require("../models/Invoice");
const Lead = require("../models/Lead");
const FollowUp = require("../models/FollowUp");
const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const TimeEntry = require("../models/TimeEntry");
const CalendarEvent = require("../models/CalendarEvent");
const Notification = require("../models/Notification");
const Subscription = require("../models/Subscription");
const { occurrences } = require("../utils/calendar");
const { SERVICE_LABEL, DAY, sum, between, pct, change, add, monthBuckets, bucketOf, round2 } = require("../utils/analytics");
const { istYear, istMonth, monthStart, startOfToday, yearStart, presentInvoice, MONTHS } = require("../utils/finance");

const has = (req, perm) => req.isAdmin || req.perms.includes(perm);
const any = (req, ...perms) => perms.some((p) => has(req, p));

// Everything on the home dashboard in one call. Each block is only filled in when
// the caller may see that data; otherwise it is null and the page hides the card.
exports.getOverview = async (req, res) => {
  try {
    const me = req.user.id;
    const now = new Date();
    const today = startOfToday();
    const tomorrow = new Date(today.getTime() + DAY);
    const y = istYear(now), m = istMonth(now);
    const thisMonth = monthStart(y, m), lastMonth = monthStart(y, m - 1);
    const weekAgo = new Date(today.getTime() - 6 * DAY);
    const out = { success: true, mine: null, finance: null, crm: null, projects: null, invoices: null, subscriptions: null, activity: [], notifications: null };

    // ---- always: the caller's own work
    const [myTasks, myHours, todaysEvents, unread, latest] = await Promise.all([
      ProjectTask.find({ assignee: me, status: { $ne: "DONE" } }, "dueDate"),
      TimeEntry.find({ user: me, date: { $gte: weekAgo, $lt: tomorrow } }, "hours date"),
      CalendarEvent.find({ $or: [{ createdBy: me }, { "attendees.user": me }], start: { $lt: tomorrow }, $and: [{ $or: [{ "recurrence.freq": { $ne: "NONE" } }, { end: { $gte: today } }] }] }),
      Notification.countDocuments({ user: me, read: false }),
      Notification.find({ user: me }).sort({ createdAt: -1 }).limit(4),
    ]);
    const evToday = todaysEvents.flatMap((e) => occurrences(e, today, tomorrow).map((o) => ({ title: e.title, start: o.start, allDay: e.allDay }))).sort((a, b) => a.start - b.start);
    out.mine = {
      open: myTasks.length,
      dueToday: myTasks.filter((t) => t.dueDate && between(t.dueDate, today, tomorrow)).length,
      overdue: myTasks.filter((t) => t.dueDate && new Date(t.dueDate) < today).length,
      hoursWeek: round2(sum(myHours, (t) => t.hours)),
      eventsToday: evToday.length,
      nextEvents: evToday.slice(0, 3),
    };
    out.notifications = { unread, latest };

    // ---- finance: revenue, stacked by service, recent invoices
    if (has(req, "finance.view") || has(req, "invoices.view")) {
      const [payments, invoices] = await Promise.all([
        Payment.find({ status: "SUCCESSFUL", date: { $gte: new Date(Math.min(yearStart(y - 1), lastMonth)), $lt: tomorrow } }).populate("invoice", "serviceType"),
        Invoice.find({ status: "SENT" }).sort({ issueDate: -1 }),
      ]);
      const inY = payments.filter((p) => new Date(p.date) >= yearStart(y));
      const prevYtd = payments.filter((p) => between(p.date, yearStart(y - 1), new Date(new Date(now).setFullYear(now.getFullYear() - 1))));
      const monthSum = (from, to) => sum(payments.filter((p) => between(p.date, from, to)), (p) => p.amount);
      const thisM = monthSum(thisMonth, tomorrow), lastM = monthSum(lastMonth, thisMonth);

      const months = monthBuckets(yearStart(y), new Date(monthStart(y, 12))).map((b) => ({ ...b, services: {} }));
      const keys = new Set();
      inY.forEach((p) => {
        const k = SERVICE_LABEL[p.invoice?.serviceType] || "Other";
        const b = bucketOf(months, p.date);
        if (b) { add(b.services, k, p.amount); keys.add(k); }
      });
      const spark = Array.from({ length: 14 }, (_, i) => {
        const from = new Date(today.getTime() - (13 - i) * DAY);
        return { v: round2(sum(payments.filter((p) => between(p.date, from, new Date(from.getTime() + DAY))), (p) => p.amount)) };
      });
      if (has(req, "finance.view")) {
        out.finance = {
          ytd: round2(sum(inY, (p) => p.amount)), ytdChange: change(sum(inY, (p) => p.amount), sum(prevYtd, (p) => p.amount)),
          month: round2(thisM), monthChange: change(thisM, lastM),
          serviceKeys: [...keys],
          byMonth: months.map((b, i) => ({ month: MONTHS[i], ...Object.fromEntries([...keys].map((k) => [k, round2(b.services[k] || 0)])) })),
          spark,
        };
      }
      if (has(req, "invoices.view")) {
        const rows = invoices.slice(0, 6).map(presentInvoice);
        const open = invoices.map(presentInvoice).filter((i) => i.balance > 0 && !["DRAFT", "CANCELLED"].includes(i.displayStatus));
        out.invoices = {
          recent: rows.map((i) => ({ _id: i._id, number: i.number, clientName: i.clientName, total: i.total, status: i.displayStatus, issueDate: i.issueDate })),
          pending: round2(sum(open, (i) => i.balance)), overdue: open.filter((i) => i.displayStatus === "OVERDUE").length,
        };
      }
    }

    // ---- CRM
    if (has(req, "leads.view")) {
      const leads = await Lead.find({ createdAt: { $gte: new Date(Math.min(lastMonth, weekAgo)) } }, "status createdAt");
      const week = Array.from({ length: 7 }, (_, i) => {
        const from = new Date(weekAgo.getTime() + i * DAY), to = new Date(from.getTime() + DAY);
        const day = leads.filter((l) => between(l.createdAt, from, to));
        return { label: from.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }), leads: day.length, won: day.filter((l) => l.status === "PROJECT").length };
      });
      const lm = leads.filter((l) => between(l.createdAt, thisMonth, tomorrow));
      const pm = leads.filter((l) => between(l.createdAt, lastMonth, thisMonth));
      const followUps = await FollowUp.countDocuments({ assignedTo: me, status: "PENDING", scheduledAt: { $lt: tomorrow } });
      out.crm = {
        month: lm.length, monthChange: change(lm.length, pm.length),
        conversion: pct(lm.filter((l) => l.status === "PROJECT").length, lm.length),
        week, spark: week.map((d) => ({ v: d.leads })), followUpsDue: followUps,
      };
    }

    // ---- projects
    if (any(req, "projects.view", "projecttasks.view")) {
      const [projects, openTasks, weekHours] = await Promise.all([
        Project.countDocuments({ status: { $nin: ["COMPLETED"] } }),
        ProjectTask.find({ status: { $ne: "DONE" } }, "dueDate"),
        TimeEntry.find({ date: { $gte: weekAgo, $lt: tomorrow } }, "hours"),
      ]);
      out.projects = {
        active: projects, openTasks: openTasks.length,
        overdue: openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < today).length,
        hoursWeek: round2(sum(weekHours, (t) => t.hours)),
      };
    }

    // ---- recurring revenue
    if (has(req, "subscriptions.view")) {
      const subs = await Subscription.find({ status: { $in: ["ACTIVE", "PAST_DUE"] } }, "amount billingCycle");
      out.subscriptions = { active: subs.length, mrr: round2(sum(subs, (s) => (s.billingCycle === "YEARLY" ? s.amount / 12 : s.amount))) };
    }

    // ---- activity feed: what happened lately, limited to what the caller may see
    const feed = [];
    const jobs = [];
    if (has(req, "payments.view")) jobs.push(Payment.find({ status: "SUCCESSFUL" }).sort({ date: -1 }).limit(4).then((l) => l.forEach((p) => feed.push({ at: p.date, tone: "green", text: `Payment of ₹${Math.round(p.amount).toLocaleString("en-IN")} received from ${p.customerName}` }))));
    if (has(req, "leads.view")) jobs.push(Lead.find().sort({ createdAt: -1 }).limit(4).then((l) => l.forEach((x) => feed.push({ at: x.createdAt, tone: "violet", text: `New lead: ${x.name}${x.company ? ` (${x.company})` : ""}` }))));
    if (has(req, "invoices.view")) jobs.push(Invoice.find({ status: "SENT" }).sort({ createdAt: -1 }).limit(3).then((l) => l.forEach((i) => feed.push({ at: i.createdAt, tone: "amber", text: `Invoice ${i.number} raised for ${i.clientName}` }))));
    jobs.push(ProjectTask.find(has(req, "projecttasks.view") ? { status: "DONE", completedAt: { $ne: null } } : { assignee: me, status: "DONE", completedAt: { $ne: null } }).sort({ completedAt: -1 }).limit(4).populate("assignee", "name").then((l) => l.forEach((t) => feed.push({ at: t.completedAt, tone: "cyan", text: `${t.assignee?.name && String(t.assignee._id) !== String(me) ? `${t.assignee.name} completed` : "Completed"} "${t.title}"` }))));
    await Promise.all(jobs);
    out.activity = feed.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 7);

    res.json(out);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
