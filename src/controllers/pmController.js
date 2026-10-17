const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const Milestone = require("../models/Milestone");
const TimeEntry = require("../models/TimeEntry");
const User = require("../models/User");
const { hourlyRateOf } = require("../utils/costing");

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Monday 00:00 of the week containing d
const startOfWeek = (d = new Date()) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

const pick = (body, fields) =>
  Object.fromEntries(
    fields.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );

// An employee with only "view" access can see all project work, but we never
// send salaries or costs from these endpoints.
const canSeeAllTime = (req) =>
  req.isAdmin || req.perms.includes("projects.manage");

// ---------------------------------------------------------------- options
exports.getOptions = async (req, res) => {
  try {
    const [users, projects, milestones] = await Promise.all([
      User.find({ status: "ACTIVE" }, "name designation").sort({ name: 1 }),
      Project.find({}, "name status").sort({ name: 1 }),
      Milestone.find({}, "title project").sort({ title: 1 }),
    ]);
    res.json({ users, projects, milestones });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ------------------------------------------------------------------ tasks
const TASK_FIELDS = [
  "project",
  "milestone",
  "title",
  "description",
  "status",
  "priority",
  "assignee",
  "dueDate",
  "estimatedHours",
];

const withCompletion = (task) => {
  if (task.status === "DONE" && !task.completedAt) task.completedAt = new Date();
  if (task.status !== "DONE") task.completedAt = undefined;
};

const presentTask = (t, logged = {}) => ({
  ...t.toObject(),
  loggedHours: logged[String(t._id)] || 0,
  overdue:
    t.status !== "DONE" && !!t.dueDate && new Date(t.dueDate) < startOfDay(),
});

exports.getTasks = async (req, res) => {
  try {
    const filter = {};
    if (req.query.project) filter.project = req.query.project;
    if (req.query.assignee === "me") filter.assignee = req.user.id;

    const tasks = await ProjectTask.find(filter)
      .populate("project", "name")
      .populate("assignee", "name")
      .populate("milestone", "title")
      .sort({ createdAt: -1 });

    const list = tasks.map((t) => presentTask(t));
    res.json({
      success: true,
      tasks: list,
      stats: {
        total: list.length,
        done: list.filter((t) => t.status === "DONE").length,
        inProgress: list.filter((t) => t.status === "IN_PROGRESS").length,
        overdue: list.filter((t) => t.overdue).length,
      },
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addTask = async (req, res) => {
  try {
    if (!req.body.title?.trim()) return fail(res, 400, "Task title is required");
    if (!req.body.project) return fail(res, 400, "Select a project");
    if (!(await Project.exists({ _id: req.body.project })))
      return fail(res, 404, "Project not found");

    const task = new ProjectTask({
      ...pick(req.body, TASK_FIELDS),
      createdBy: req.user.id,
    });
    withCompletion(task);
    await task.save();
    res.status(201).json({ success: true, message: "Task added", task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await ProjectTask.findById(req.params.id);
    if (!task) return fail(res, 404, "Task not found");
    if (req.body.title !== undefined && !req.body.title.trim())
      return fail(res, 400, "Task title is required");

    task.set(pick(req.body, TASK_FIELDS));
    withCompletion(task);
    await task.save();
    res.json({ success: true, message: "Task updated", task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Drag between board columns. Managers can move any task; an employee can
// move the tasks assigned to them.
exports.setTaskStatus = async (req, res) => {
  try {
    const task = await ProjectTask.findById(req.params.id);
    if (!task) return fail(res, 404, "Task not found");

    const mine = task.assignee && String(task.assignee) === String(req.user.id);
    if (!req.perms.includes("projecttasks.manage") && !mine)
      return fail(res, 403, "You can only move tasks assigned to you");

    if (!["TODO", "IN_PROGRESS", "REVIEW", "DONE"].includes(req.body.status))
      return fail(res, 400, "Invalid status");

    task.status = req.body.status;
    withCompletion(task);
    await task.save();
    res.json({ success: true, task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteTask = async (req, res) => {
  try {
    await ProjectTask.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ------------------------------------------------------------- milestones
const MILESTONE_FIELDS = [
  "project",
  "title",
  "description",
  "dueDate",
  "status",
  "manualProgress",
];

const presentMilestones = async (milestones) => {
  const tasks = await ProjectTask.find(
    { milestone: { $in: milestones.map((m) => m._id) } },
    "milestone status assignee",
  ).populate("assignee", "name");

  return milestones.map((m) => {
    const mine = tasks.filter((t) => String(t.milestone) === String(m._id));
    const done = mine.filter((t) => t.status === "DONE").length;

    const progress =
      m.status === "COMPLETED"
        ? 100
        : mine.length
          ? Math.round((done / mine.length) * 100)
          : m.manualProgress || 0;

    const team = [];
    mine.forEach((t) => {
      if (t.assignee && !team.some((u) => String(u._id) === String(t.assignee._id)))
        team.push({ _id: t.assignee._id, name: t.assignee.name });
    });

    return {
      ...m.toObject(),
      progress,
      tasks: { total: mine.length, done },
      team,
      overdue:
        m.status !== "COMPLETED" && !!m.dueDate && new Date(m.dueDate) < startOfDay(),
    };
  });
};

exports.getMilestones = async (req, res) => {
  try {
    const filter = req.query.project ? { project: req.query.project } : {};
    const milestones = await Milestone.find(filter)
      .populate("project", "name")
      .sort({ dueDate: 1, createdAt: 1 });

    res.json({ success: true, milestones: await presentMilestones(milestones) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addMilestone = async (req, res) => {
  try {
    if (!req.body.title?.trim())
      return fail(res, 400, "Milestone title is required");
    if (!req.body.project) return fail(res, 400, "Select a project");
    if (!(await Project.exists({ _id: req.body.project })))
      return fail(res, 404, "Project not found");

    const milestone = await Milestone.create({
      ...pick(req.body, MILESTONE_FIELDS),
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, message: "Milestone added", milestone });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateMilestone = async (req, res) => {
  try {
    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) return fail(res, 404, "Milestone not found");
    if (req.body.title !== undefined && !req.body.title.trim())
      return fail(res, 400, "Milestone title is required");

    milestone.set(pick(req.body, MILESTONE_FIELDS));
    await milestone.save();
    res.json({ success: true, message: "Milestone updated", milestone });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteMilestone = async (req, res) => {
  try {
    await Milestone.findByIdAndDelete(req.params.id);
    // Tasks stay, they just lose the link
    await ProjectTask.updateMany(
      { milestone: req.params.id },
      { $unset: { milestone: 1 } },
    );
    res.json({ success: true, message: "Milestone deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ---------------------------------------------------------- time tracking
exports.getTimeEntries = async (req, res) => {
  try {
    const all = canSeeAllTime(req);
    const filter = all ? {} : { user: req.user.id };

    const entries = await TimeEntry.find(filter)
      .populate("project", "name")
      .populate("user", "name")
      .sort({ date: -1, createdAt: -1 });

    const weekStart = startOfWeek();
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const sum = (list) => list.reduce((s, e) => s + e.hours, 0);
    const inRange = (from, to) =>
      entries.filter(
        (e) => new Date(e.date) >= from && (!to || new Date(e.date) < to),
      );

    const week = inRange(weekStart);
    const month = inRange(monthStart);
    const billable = sum(month.filter((e) => e.billable));
    const nonBillable = sum(month.filter((e) => !e.billable));

    // Mon..Sun for the current week
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const weekly = days.map((day, i) => {
      const from = new Date(weekStart);
      from.setDate(from.getDate() + i);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      const list = inRange(from, to);
      return {
        day,
        billable: sum(list.filter((e) => e.billable)),
        nonBillable: sum(list.filter((e) => !e.billable)),
      };
    });

    res.json({
      success: true,
      scope: all ? "all" : "mine",
      entries: entries.map((e) => {
        // cost stays out of the response on purpose
        const { hourlyRate, ...rest } = e.toObject();
        void hourlyRate;
        return rest;
      }),
      stats: {
        weekHours: sum(week),
        lastWeekHours: sum(inRange(lastWeekStart, weekStart)),
        monthHours: sum(month),
        billableHours: billable,
        nonBillableHours: nonBillable,
        billableRate: billable + nonBillable
          ? Math.round((billable / (billable + nonBillable)) * 100)
          : 0,
      },
      weekly,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.addTimeEntry = async (req, res) => {
  try {
    const b = req.body;
    if (!b.project) return fail(res, 400, "Select a project");
    if (!b.date) return fail(res, 400, "Select a date");
    const hours = Number(b.hours);
    if (!(hours > 0 && hours <= 24))
      return fail(res, 400, "Hours must be between 0 and 24");
    if (!(await Project.exists({ _id: b.project })))
      return fail(res, 404, "Project not found");

    // Only people who manage projects can log time for someone else
    const userId =
      b.user && canSeeAllTime(req) ? b.user : req.user.id;

    const entry = await TimeEntry.create({
      project: b.project,
      task: b.task,
      notes: b.notes,
      date: b.date,
      hours,
      billable: b.billable !== false,
      user: userId,
      hourlyRate: await hourlyRateOf(userId),
    });
    res.status(201).json({ success: true, message: "Time entry saved", entry });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteTimeEntry = async (req, res) => {
  try {
    const entry = await TimeEntry.findById(req.params.id);
    if (!entry) return fail(res, 404, "Entry not found");
    if (!canSeeAllTime(req) && String(entry.user) !== String(req.user.id))
      return fail(res, 403, "You can only delete your own entries");

    await entry.deleteOne();
    res.json({ success: true, message: "Entry deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// -------------------------------------------------------------- dashboard
// One "active task" = 10% of a person's capacity. Change if your team differs.
const TASKS_AT_FULL_CAPACITY = 10;

exports.getDashboard = async (req, res) => {
  try {
    const [projects, tasks, timeEntries] = await Promise.all([
      Project.find({}, "name status startDate endDate team"),
      ProjectTask.find()
        .populate("project", "name")
        .populate("assignee", "name designation"),
      TimeEntry.find({ date: { $gte: startOfWeek() } }),
    ]);

    const today = startOfDay();
    const byProject = {};
    tasks.forEach((t) => {
      const k = String(t.project?._id);
      byProject[k] = byProject[k] || { total: 0, done: 0 };
      byProject[k].total += 1;
      if (t.status === "DONE") byProject[k].done += 1;
    });

    const health = (p, progress) => {
      if (p.status === "COMPLETED") return "COMPLETED";
      if (p.endDate && new Date(p.endDate) < today) return "DELAYED";
      if (p.startDate && p.endDate) {
        const span = new Date(p.endDate) - new Date(p.startDate);
        const elapsed = Math.min(1, Math.max(0, (today - new Date(p.startDate)) / span));
        if (span > 0 && progress < elapsed * 100 - 15) return "AT_RISK";
      }
      return "ON_TRACK";
    };

    const projectProgress = projects.map((p) => {
      const s = byProject[String(p._id)] || { total: 0, done: 0 };
      const progress =
        p.status === "COMPLETED" ? 100 : s.total ? Math.round((s.done / s.total) * 100) : 0;
      return { _id: p._id, name: p.name, progress, health: health(p, progress) };
    });

    const open = tasks.filter((t) => t.status !== "DONE");
    const overdueTasks = open.filter((t) => t.dueDate && new Date(t.dueDate) < today);

    const memberIds = new Set();
    projects.forEach((p) => p.team.forEach((m) => memberIds.add(String(m.user))));
    tasks.forEach((t) => t.assignee && memberIds.add(String(t.assignee._id)));

    const distribution = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"].map((status) => ({
      status,
      count: tasks.filter((t) => t.status === status).length,
    }));

    const upcomingDeadlines = open
      .filter((t) => t.dueDate)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .slice(0, 8)
      .map((t) => ({
        _id: t._id,
        title: t.title,
        project: t.project?.name,
        dueDate: t.dueDate,
        assignee: t.assignee?.name,
        priority: t.priority,
        overdue: new Date(t.dueDate) < today,
      }));

    const workloadMap = {};
    open.forEach((t) => {
      if (!t.assignee) return;
      const k = String(t.assignee._id);
      workloadMap[k] = workloadMap[k] || {
        _id: k,
        name: t.assignee.name,
        designation: t.assignee.designation,
        activeTasks: 0,
      };
      workloadMap[k].activeTasks += 1;
    });
    const teamWorkload = Object.values(workloadMap)
      .map((w) => ({
        ...w,
        capacity: Math.min(100, Math.round((w.activeTasks / TASKS_AT_FULL_CAPACITY) * 100)),
      }))
      .sort((a, b) => b.capacity - a.capacity);

    const weekStart = startOfWeek();
    const hoursThisWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
      const from = new Date(weekStart);
      from.setDate(from.getDate() + i);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      const list = timeEntries.filter((e) => new Date(e.date) >= from && new Date(e.date) < to);
      return {
        day,
        billable: list.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0),
        nonBillable: list.filter((e) => !e.billable).reduce((s, e) => s + e.hours, 0),
      };
    });

    const recentActivity = [...tasks]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 8)
      .map((t) => ({
        _id: t._id,
        title: t.title,
        status: t.status,
        project: t.project?.name,
        who: t.assignee?.name,
        at: t.updatedAt,
        isNew: Math.abs(new Date(t.updatedAt) - new Date(t.createdAt)) < 1000,
      }));

    res.json({
      success: true,
      stats: {
        activeProjects: projects.filter((p) => ["PLANNING", "IN_PROGRESS"].includes(p.status)).length,
        completedTasks: tasks.filter((t) => t.status === "DONE").length,
        overdueTasks: overdueTasks.length,
        teamMembers: memberIds.size,
        totalTasks: tasks.length,
      },
      projectProgress,
      distribution,
      upcomingDeadlines,
      teamWorkload,
      hoursThisWeek,
      weekTotal: hoursThisWeek.reduce((s, d) => s + d.billable + d.nonBillable, 0),
      recentActivity,
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

// ------------------------------------------------- project overview tab
exports.getProjectOverview = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id, "name");
    if (!project) return fail(res, 404, "Project not found");

    const [milestones, tasks, entries] = await Promise.all([
      Milestone.find({ project: project._id }).sort({ dueDate: 1 }),
      ProjectTask.find({ project: project._id }, "status"),
      TimeEntry.find({ project: project._id }, "hours billable"),
    ]);

    res.json({
      success: true,
      milestones: await presentMilestones(milestones),
      tasks: {
        total: tasks.length,
        done: tasks.filter((t) => t.status === "DONE").length,
      },
      loggedHours: entries.reduce((s, e) => s + e.hours, 0),
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
