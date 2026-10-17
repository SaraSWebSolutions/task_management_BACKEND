const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const Milestone = require("../models/Milestone");
const TimeEntry = require("../models/TimeEntry");
const Lead = require("../models/Lead");
const { buildEntries, sumHours, sumCost } = require("../utils/costing");

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

const summarize = (project) => {
  const marketing = project.lead?.marketing || [];

  const teamCost = sumCost(project.team);
  const supportCost = sumCost(project.support);
  const marketingCost = sumCost(marketing);
  const totalCost = teamCost + supportCost + marketingCost;

  return {
    teamHours: sumHours(project.team),
    supportHours: sumHours(project.support),
    marketingHours: sumHours(marketing),
    teamCost,
    supportCost,
    marketingCost,
    totalCost,
    profit: (project.projectValue || 0) - totalCost,
  };
};

const withSummary = (project) => ({
  ...project.toObject(),
  summary: summarize(project),
});

const populate = (query) =>
  query
    .populate("team.user", "name designation")
    .populate("support.user", "name designation")
    .populate({
      path: "lead",
      select: "name email company marketing",
      populate: { path: "marketing.user", select: "name" },
    });

// done / total tasks per project, in one query
const taskStatsByProject = async () => {
  const rows = await ProjectTask.aggregate([
    {
      $group: {
        _id: "$project",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$status", "DONE"] }, 1, 0] } },
      },
    },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r]));
};

const withProgress = (project, stats) => {
  const t = stats[String(project._id)] || { total: 0, done: 0 };
  const obj = withSummary(project);
  obj.tasks = { total: t.total, done: t.done };
  obj.progress =
    project.status === "COMPLETED"
      ? 100
      : t.total
        ? Math.round((t.done / t.total) * 100)
        : 0;
  obj.overdue =
    project.status !== "COMPLETED" &&
    !!project.endDate &&
    new Date(project.endDate) < new Date(new Date().setHours(0, 0, 0, 0));
  return obj;
};

exports.getProjects = async (req, res) => {
  try {
    const [projects, stats] = await Promise.all([
      populate(Project.find().sort({ createdAt: -1 })),
      taskStatsByProject(),
    ]);
    res.json({
      success: true,
      projects: projects.map((p) => withProgress(p, stats)),
    });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getProject = async (req, res) => {
  try {
    const project = await populate(Project.findById(req.params.id));
    if (!project) return fail(res, 404, "Project not found");

    const stats = await taskStatsByProject();
    res.json({ success: true, project: withProgress(project, stats) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return fail(res, 404, "Project not found");

    [
      "name",
      "clientName",
      "description",
      "priority",
      "startDate",
      "endDate",
      "status",
      "projectValue",
      "clientEstimationHours",
      "teamEstimationHours",
    ].forEach((f) => {
      if (req.body[f] !== undefined) project[f] = req.body[f];
    });

    await project.save();
    res.json({ success: true, message: "Project updated" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setTeam = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return fail(res, 404, "Project not found");

    const ids = (req.body.team || []).map((m) => String(m.user));
    if (new Set(ids).size !== ids.length)
      return fail(res, 400, "A member is added more than once");

    project.team = await buildEntries(req.body.team, project.team, {
      byUser: true,
    });
    if (project.status === "PLANNING" && project.team.length)
      project.status = "IN_PROGRESS";

    await project.save();
    res.json({ success: true, message: "Team saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.setSupport = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return fail(res, 404, "Project not found");
    if (project.status !== "COMPLETED")
      return fail(res, 400, "Support can be added after the project is completed");

    project.support = await buildEntries(req.body.support, project.support);

    await project.save();
    res.json({ success: true, message: "Support time saved" });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

// Direct project creation (projects can also come from converting a lead).
exports.createProject = async (req, res) => {
  try {
    const b = req.body;
    if (!b.name?.trim()) return fail(res, 400, "Project title is required");
    if (b.startDate && b.endDate && new Date(b.endDate) < new Date(b.startDate))
      return fail(res, 400, "End date cannot be before the start date");

    const ids = (b.members || []).map(String);
    if (new Set(ids).size !== ids.length)
      return fail(res, 400, "A member is added more than once");

    const project = new Project({
      name: b.name,
      clientName: b.clientName,
      description: b.description,
      priority: b.priority,
      startDate: b.startDate,
      endDate: b.endDate,
      projectValue: Number(b.projectValue) || 0,
      clientEstimationHours: Number(b.clientEstimationHours) || 0,
      teamEstimationHours: Number(b.teamEstimationHours) || 0,
      status: b.status || (ids.length ? "IN_PROGRESS" : "PLANNING"),
    });
    project.team = await buildEntries(
      ids.map((user) => ({ user, hours: 0 })),
      [],
      { byUser: true },
    );

    await project.save();
    res.status(201).json({ success: true, message: "Project created", project });
  } catch (error) {
    fail(res, 400, error.message);
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return fail(res, 404, "Project not found");

    // Leads keep a link to the project they were converted into.
    if (await Lead.exists({ project: project._id }))
      return fail(
        res,
        400,
        "This project was created from a lead. Set it to On Hold or Completed instead of deleting it.",
      );

    await Promise.all([
      ProjectTask.deleteMany({ project: project._id }),
      Milestone.deleteMany({ project: project._id }),
      TimeEntry.deleteMany({ project: project._id }),
    ]);
    await project.deleteOne();

    res.json({ success: true, message: "Project deleted" });
  } catch (error) {
    fail(res, 500, error.message);
  }
};
