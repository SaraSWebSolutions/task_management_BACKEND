const CrmTask = require("../models/CrmTask");

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const isOverdue = (t) =>
  t.status !== "COMPLETED" && t.dueDate && new Date(t.dueDate) < startOfToday();

const present = (t) => ({ ...t.toObject(), overdue: !!isOverdue(t) });

const FIELDS = [
  "title",
  "description",
  "priority",
  "status",
  "dueDate",
  "project",
  "assignee",
  "lead",
];

const pick = (body) =>
  Object.fromEntries(FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

const withCompletion = (task) => {
  if (task.status === "COMPLETED" && !task.completedAt) task.completedAt = new Date();
  if (task.status !== "COMPLETED") task.completedAt = undefined;
};

exports.getTasks = async (req, res) => {
  try {
    const tasks = await CrmTask.find()
      .populate("assignee", "name")
      .populate("lead", "name company")
      .sort({ createdAt: -1 });

    const list = tasks.map(present);
    res.json({
      success: true,
      tasks: list,
      stats: {
        total: list.length,
        completed: list.filter((t) => t.status === "COMPLETED").length,
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
    const task = new CrmTask({ ...pick(req.body), createdBy: req.user.id });
    withCompletion(task);
    await task.save();
    res.status(201).json({ success: true, message: "Task added", task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await CrmTask.findById(req.params.id);
    if (!task) return fail(res, 404, "Task not found");
    if (req.body.title !== undefined && !req.body.title.trim())
      return fail(res, 400, "Task title is required");

    task.set(pick(req.body));
    withCompletion(task);
    await task.save();
    res.json({ success: true, message: "Task updated", task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Tick / untick the checkbox in the list.
exports.toggleTask = async (req, res) => {
  try {
    const task = await CrmTask.findById(req.params.id);
    if (!task) return fail(res, 404, "Task not found");

    task.status = task.status === "COMPLETED" ? "TODO" : "COMPLETED";
    withCompletion(task);
    await task.save();
    res.json({ success: true, task });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteTask = async (req, res) => {
  try {
    await CrmTask.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Task deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
