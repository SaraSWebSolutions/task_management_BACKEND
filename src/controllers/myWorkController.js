const mongoose = require("mongoose");
const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const TimeEntry = require("../models/TimeEntry");
const { hourlyRateOf } = require("../utils/costing");

// "My Work": everything a person sees about their own tasks. Needs only a login.
// Always scoped to the caller. It never returns costs, salaries or other people's data.

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfWeek = () => {
  const x = startOfDay();
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const round2 = (n) => Math.round(n * 100) / 100;

// Projects the person belongs to (team member) or has a task in
const myProjectIds = async (userId) => {
  const [teamOf, taskProjects] = await Promise.all([
    Project.find({ "team.user": userId }, "_id"),
    ProjectTask.distinct("project", { assignee: userId, project: { $ne: null } }),
  ]);
  return [...new Set([...teamOf.map((p) => String(p._id)), ...taskProjects.map(String)])];
};

const hhmmToMinutes = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

exports.getMyWork = async (req, res) => {
  try {
    const me = req.user.id;
    const today = startOfDay();
    const tomorrow = new Date(today.getTime() + 86400000);

    const [tasks, loggedRows, ids, recent] = await Promise.all([
      ProjectTask.find({ assignee: me })
        .populate("project", "name status")
        .populate("milestone", "title")
        .sort({ createdAt: -1 }),
      TimeEntry.aggregate([
        { $match: { user: oid(me), taskRef: { $ne: null } } },
        { $group: { _id: "$taskRef", hours: { $sum: "$hours" } } },
      ]),
      myProjectIds(me),
      TimeEntry.find({ user: me, date: { $gte: new Date(today.getTime() - 14 * 86400000) } })
        .select("-hourlyRate")
        .populate("project", "name")
        .populate("taskRef", "title")
        .sort({ date: -1, createdAt: -1 }),
    ]);

    const logged = Object.fromEntries(loggedRows.map((r) => [String(r._id), round2(r.hours)]));
    const list = tasks.map((t) => {
      const o = t.toObject();
      return {
        ...o,
        loggedHours: logged[String(t._id)] || 0,
        overdue: t.status !== "DONE" && !!t.dueDate && new Date(t.dueDate) < today,
        dueToday: t.status !== "DONE" && !!t.dueDate && new Date(t.dueDate) >= today && new Date(t.dueDate) < tomorrow,
        mine: String(t.createdBy) === String(me), // self-created tasks can be edited/deleted
      };
    });

    const projects = await Project.find({ _id: { $in: ids } }, "name status clientName").sort({ name: 1 });
    const weekStart = startOfWeek();

    res.json({
      success: true,
      tasks: list,
      projects: projects.map((p) => {
        const mine = list.filter((t) => String(t.project?._id) === String(p._id));
        return {
          _id: p._id, name: p.name, status: p.status, clientName: p.clientName,
          tasks: mine.length,
          done: mine.filter((t) => t.status === "DONE").length,
          overdue: mine.filter((t) => t.overdue).length,
        };
      }),
      time: recent,
      stats: {
        open: list.filter((t) => t.status !== "DONE").length,
        inProgress: list.filter((t) => t.status === "IN_PROGRESS").length,
        overdue: list.filter((t) => t.overdue).length,
        dueToday: list.filter((t) => t.dueToday).length,
        hoursWeek: round2(recent.filter((e) => new Date(e.date) >= weekStart).reduce((s, e) => s + e.hours, 0)),
        doneWeek: list.filter((t) => t.status === "DONE" && t.completedAt && new Date(t.completedAt) >= weekStart).length,
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

const TASK_FIELDS = ["title", "description", "dueDate", "estimatedHours"];
const pick = (b) => Object.fromEntries(TASK_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));

// Employee adds their own task. Project is optional: support / other work has none.
exports.addTask = async (req, res) => {
  try {
    const b = req.body;
    const me = req.user.id;
    if (!b.title?.trim()) return fail(res, 400, "Task title is required");
    if (b.estimatedHours !== undefined && b.estimatedHours !== "" && !(Number(b.estimatedHours) >= 0))
      return fail(res, 400, "Estimated hours must be 0 or more");

    let project;
    if (b.project) {
      if (!(await myProjectIds(me)).includes(String(b.project)))
        return fail(res, 403, "You are not part of this project");
      project = b.project;
    }

    const task = await ProjectTask.create({
      ...pick(b),
      title: b.title.trim(),
      project,
      category: project ? "PROJECT" : b.category === "OTHER" ? "OTHER" : "SUPPORT",
      assignee: me,
      createdBy: me,
    });
    res.status(201).json({ success: true, message: "Task added", task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

const ownTask = async (req, res, { createdByMe = false } = {}) => {
  const task = await ProjectTask.findById(req.params.id);
  if (!task || String(task.assignee) !== String(req.user.id)) {
    fail(res, 404, "Task not found");
    return null;
  }
  if (createdByMe && String(task.createdBy) !== String(req.user.id)) {
    fail(res, 403, "This task was assigned by your manager. You can update its status and log time.");
    return null;
  }
  return task;
};

exports.updateTask = async (req, res) => {
  try {
    const task = await ownTask(req, res, { createdByMe: true });
    if (!task) return;
    if (req.body.title !== undefined && !req.body.title.trim()) return fail(res, 400, "Task title is required");

    task.set(pick(req.body));
    if (!task.project && ["SUPPORT", "OTHER"].includes(req.body.category)) task.category = req.body.category;
    await task.save();
    res.json({ success: true, message: "Task updated", task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const task = await ownTask(req, res, { createdByMe: true });
    if (!task) return;
    if (await TimeEntry.exists({ taskRef: task._id }))
      return fail(res, 400, "Time is logged on this task, so it can't be deleted.");
    await task.deleteOne();
    res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.setStatus = async (req, res) => {
  try {
    if (!["TODO", "IN_PROGRESS", "REVIEW", "DONE"].includes(req.body.status))
      return fail(res, 400, "Invalid status");
    const task = await ownTask(req, res);
    if (!task) return;

    task.status = req.body.status;
    task.completedAt = task.status === "DONE" ? task.completedAt || new Date() : undefined;
    await task.save();
    res.json({ success: true, task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Log time on one of my tasks, either as hours or as a from-to time.
exports.addTime = async (req, res) => {
  try {
    const b = req.body;
    const me = req.user.id;
    if (!b.taskRef) return fail(res, 400, "Select the task");
    const task = await ProjectTask.findById(b.taskRef);
    if (!task || String(task.assignee) !== String(me)) return fail(res, 404, "Task not found");

    const date = b.date ? new Date(b.date) : startOfDay();
    if (isNaN(date)) return fail(res, 400, "Select a valid date");
    if (date > new Date(startOfDay().getTime() + 86400000)) return fail(res, 400, "You can't log time for a future date");

    let hours = Number(b.hours);
    const from = hhmmToMinutes(b.startTime), to = hhmmToMinutes(b.endTime);
    if (b.startTime || b.endTime) {
      if (from == null || to == null) return fail(res, 400, "Enter both the from and to time");
      if (to <= from) return fail(res, 400, "End time must be after the start time");
      hours = round2((to - from) / 60);
    }
    if (!(hours > 0 && hours <= 24)) return fail(res, 400, "Enter the time spent (hours, or from and to time)");

    const dayStart = startOfDay(date);
    const already = await TimeEntry.aggregate([
      { $match: { user: oid(me), date: { $gte: dayStart, $lt: new Date(dayStart.getTime() + 86400000) } } },
      { $group: { _id: null, h: { $sum: "$hours" } } },
    ]);
    const used = already[0]?.h || 0;
    if (used + hours > 24) return fail(res, 400, `You have already logged ${round2(used)}h on that day`);

    const entry = await TimeEntry.create({
      project: task.project || undefined,
      taskRef: task._id,
      task: task.title,
      user: me,
      date,
      hours,
      startTime: b.startTime || undefined,
      endTime: b.endTime || undefined,
      billable: b.billable !== false && task.category === "PROJECT",
      notes: b.notes,
      hourlyRate: await hourlyRateOf(me),
    });

    // Working on it means it has started
    if (task.status === "TODO") {
      task.status = "IN_PROGRESS";
      await task.save();
    }
    res.status(201).json({ success: true, message: `${hours}h logged`, entry: { _id: entry._id, hours } });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteTime = async (req, res) => {
  try {
    const entry = await TimeEntry.findById(req.params.id);
    if (!entry || String(entry.user) !== String(req.user.id)) return fail(res, 404, "Entry not found");
    await entry.deleteOne();
    res.json({ success: true, message: "Time entry deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
