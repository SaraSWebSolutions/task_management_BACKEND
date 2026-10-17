const User = require("../models/User");
const Task = require("../models/Task");
const ProjectTask = require("../models/ProjectTask");
const Project = require("../models/Project");
const TimeEntry = require("../models/TimeEntry");
const {
  DAY, MONTHS, sum, between, pct, change, parseRange, ymd, buckets, bucketOf,
  failJson, istYear, istMonth, monthStart, startOfToday, round2,
} = require("../utils/analytics");

const joined = (u) => u.joiningDate || u.createdAt;
const isLate = (t, when) => new Date(when) > new Date(new Date(t.dueDate).getTime() + DAY);

// ------------------------------------------------------------------- users
// People analytics. Salary and bank details are never read here.
exports.users = async (req, res) => {
  try {
    const r = parseRange(req.query);
    const now = new Date();
    const y = istYear(now), m = istMonth(now);

    const [users, doneTasks, openTasks, daily, time] = await Promise.all([
      User.find({}, "name role designation department status joiningDate createdAt"),
      ProjectTask.find({ status: "DONE", completedAt: { $gte: r.start, $lt: r.end } }, "assignee completedAt dueDate"),
      ProjectTask.find({ status: { $ne: "DONE" } }, "assignee dueDate"),
      Task.find({ date: { $gte: ymd(r.start), $lte: ymd(new Date(r.end.getTime() - 1)) } }, "employeeId status"),
      TimeEntry.find({ date: { $gte: r.start, $lt: r.end } }, "user hours date"),
    ]);

    const active = users.filter((u) => u.status !== "INACTIVE");
    const newUsers = users.filter((u) => between(joined(u), r.start, r.end));
    const newPrev = users.filter((u) => between(joined(u), r.prevStart, r.prevEnd));

    // Headcount: last 12 months and last 5 years (everyone who has joined by then)
    const growthMonthly = Array.from({ length: 12 }, (_, i) => {
      const from = monthStart(y, m - 11 + i), to = monthStart(y, m - 10 + i);
      return {
        label: MONTHS[(((m - 11 + i) % 12) + 12) % 12],
        total: users.filter((u) => new Date(joined(u)) < to).length,
        joined: users.filter((u) => between(joined(u), from, to)).length,
      };
    });
    const growthYearly = Array.from({ length: 5 }, (_, i) => {
      const yr = y - 4 + i;
      return {
        label: String(yr),
        total: users.filter((u) => new Date(joined(u)) < monthStart(yr + 1, 0)).length,
        joined: users.filter((u) => between(joined(u), monthStart(yr, 0), monthStart(yr + 1, 0))).length,
      };
    });

    const byDesignation = {};
    active.forEach((u) => { const k = u.designation || "Other"; byDesignation[k] = (byDesignation[k] || 0) + 1; });

    const rows = active.map((u) => {
      const id = String(u._id);
      const done = doneTasks.filter((t) => String(t.assignee) === id);
      const open = openTasks.filter((t) => String(t.assignee) === id);
      const entries = time.filter((t) => String(t.user) === id);
      const dailyDone = daily.filter((t) => String(t.employeeId) === id && t.status === "Completed").length;
      const last = [...done.map((t) => t.completedAt), ...entries.map((t) => t.date)].sort((a, b) => new Date(b) - new Date(a))[0];
      return {
        _id: u._id, name: u.name, designation: u.designation, role: u.role,
        tasksDone: done.length, dailyDone, activity: done.length + dailyDone,
        hours: round2(sum(entries, (t) => t.hours)),
        openTasks: open.length,
        overdue: open.filter((t) => t.dueDate && new Date(t.dueDate).getTime() + DAY < Date.now()).length,
        lastActive: last || null,
      };
    });

    res.json({
      success: true,
      range: { from: r.start, to: new Date(r.end.getTime() - 1), days: r.days },
      kpis: {
        total: users.length,
        active: active.length, inactive: users.length - active.length,
        newUsers: newUsers.length, newChange: change(newUsers.length, newPrev.length),
        hours: round2(sum(time, (t) => t.hours)),
        tasksDone: doneTasks.length,
      },
      growth: { monthly: growthMonthly, yearly: growthYearly },
      byDesignation: Object.entries(byDesignation).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      topUsers: [...rows].sort((a, b) => b.activity - a.activity || b.hours - a.hours).slice(0, 8),
      workload: [...rows].sort((a, b) => b.openTasks - a.openTasks),
    });
  } catch (error) {
    failJson(res, error);
  }
};

// ------------------------------------------------------------- performance
exports.performance = async (req, res) => {
  try {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const end = new Date(startOfToday().getTime() + DAY);
    const start = new Date(end.getTime() - days * DAY);
    const prevStart = new Date(start.getTime() - days * DAY);

    const [tasks, projects, time, allTime, daily, users] = await Promise.all([
      ProjectTask.find({}, "project title status priority assignee dueDate completedAt estimatedHours").populate("assignee", "name").populate("project", "name"),
      Project.find({ status: { $ne: "COMPLETED" } }, "name status teamEstimationHours clientEstimationHours endDate"),
      TimeEntry.find({ date: { $gte: prevStart, $lt: end } }, "user hours billable date"),
      TimeEntry.aggregate([{ $group: { _id: "$project", hours: { $sum: "$hours" } } }]),
      Task.find({ date: { $gte: ymd(prevStart), $lte: ymd(new Date(end.getTime() - 1)) } }, "date status"),
      User.find({ status: { $ne: "INACTIVE" } }, "name designation"),
    ]);

    const inRange = (list, f, a, b) => list.filter((x) => between(f(x), a, b));
    const done = tasks.filter((t) => t.status === "DONE" && t.completedAt);
    const doneNow = inRange(done, (t) => t.completedAt, start, end);
    const donePrev = inRange(done, (t) => t.completedAt, prevStart, start);

    const onTime = (list) => list.filter((t) => !t.dueDate || !isLate(t, t.completedAt)).length;
    const dueNow = tasks.filter((t) => between(t.dueDate, start, end));
    const duePrev = tasks.filter((t) => between(t.dueDate, prevStart, start));
    const completionRate = (due) => pct(due.filter((t) => t.status === "DONE").length, due.length);

    const timeNow = inRange(time, (t) => t.date, start, end);
    const timePrev = inRange(time, (t) => t.date, prevStart, start);
    const hoursNow = sum(timeNow, (t) => t.hours);
    const billableRate = (list) => pct(sum(list.filter((t) => t.billable), (t) => t.hours), sum(list, (t) => t.hours));

    const dailyNow = daily.filter((t) => t.date >= ymd(start));
    const dailyRate = pct(dailyNow.filter((t) => t.status === "Completed").length, dailyNow.length);

    const overdue = tasks.filter((t) => t.status !== "DONE" && t.dueDate && new Date(t.dueDate).getTime() + DAY < Date.now());

    const timeline = buckets(start, end, days).map((b) => ({ ...b, done: 0, hours: 0 }));
    doneNow.forEach((t) => { const b = bucketOf(timeline, t.completedAt); if (b) b.done += 1; });
    timeNow.forEach((t) => { const b = bucketOf(timeline, t.date); if (b) b.hours += t.hours; });

    const hoursByProject = Object.fromEntries(allTime.map((x) => [String(x._id), x.hours]));
    const health = projects.map((p) => {
      const list = tasks.filter((t) => String(t.project?._id) === String(p._id));
      const doneCount = list.filter((t) => t.status === "DONE").length;
      const late = list.filter((t) => overdue.includes(t)).length;
      const planned = p.teamEstimationHours || p.clientEstimationHours || 0;
      const logged = hoursByProject[String(p._id)] || 0;
      const used = planned ? logged / planned : 0;
      const status = (list.length && late / list.length > 0.3) || used > 1.2 ? "CRITICAL" : late > 0 || used > 0.9 ? "WARNING" : "OK";
      return {
        _id: p._id, name: p.name, projectStatus: p.status, tasks: list.length,
        progress: pct(doneCount, list.length), overdue: late,
        loggedHours: round2(logged), plannedHours: planned, status,
      };
    }).sort((a, b) => ({ CRITICAL: 0, WARNING: 1, OK: 2 }[a.status] - { CRITICAL: 0, WARNING: 1, OK: 2 }[b.status]) || b.overdue - a.overdue);

    const team = users.map((u) => {
      const id = String(u._id);
      const mine = doneNow.filter((t) => String(t.assignee?._id) === id);
      const hrs = timeNow.filter((t) => String(t.user) === id);
      return { _id: u._id, name: u.name, designation: u.designation, done: mine.length, onTime: pct(onTime(mine), mine.length), hours: round2(sum(hrs, (t) => t.hours)) };
    }).filter((u) => u.done || u.hours).sort((a, b) => b.done - a.done);

    res.json({
      success: true,
      days,
      kpis: {
        completionRate: completionRate(dueNow), completionChange: Math.round((completionRate(dueNow) - completionRate(duePrev)) * 10) / 10,
        onTimeRate: pct(onTime(doneNow), doneNow.length), onTimeChange: Math.round((pct(onTime(doneNow), doneNow.length) - pct(onTime(donePrev), donePrev.length)) * 10) / 10,
        overdue: overdue.length,
        hours: round2(hoursNow), hoursChange: change(hoursNow, sum(timePrev, (t) => t.hours)),
        tasksDone: doneNow.length, tasksDoneChange: change(doneNow.length, donePrev.length),
      },
      scores: [
        { name: "On-time delivery", value: pct(onTime(doneNow), doneNow.length) },
        { name: "Task completion", value: completionRate(dueNow) },
        { name: "Billable hours", value: billableRate(timeNow) },
        { name: "Daily task completion", value: dailyRate },
      ],
      timeline: timeline.map((b) => ({ label: b.label, done: b.done, hours: round2(b.hours) })),
      health,
      overdueTasks: overdue
        .map((t) => ({ _id: t._id, title: t.title, project: t.project?.name, assignee: t.assignee?.name, priority: t.priority, dueDate: t.dueDate, daysLate: Math.max(1, Math.floor((Date.now() - new Date(t.dueDate).getTime()) / DAY)) }))
        .sort((a, b) => b.daysLate - a.daysLate).slice(0, 10),
      team,
    });
  } catch (error) {
    failJson(res, error);
  }
};

