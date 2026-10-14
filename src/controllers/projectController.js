const Project = require("../models/Project");
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

exports.getProjects = async (req, res) => {
  try {
    const projects = await populate(Project.find().sort({ createdAt: -1 }));
    res.json({ success: true, projects: projects.map(withSummary) });
  } catch (error) {
    fail(res, 500, error.message);
  }
};

exports.getProject = async (req, res) => {
  try {
    const project = await populate(Project.findById(req.params.id));
    if (!project) return fail(res, 404, "Project not found");

    res.json({ success: true, project: withSummary(project) });
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
