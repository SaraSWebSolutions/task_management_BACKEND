const User = require("../models/User");
const ProjectTask = require("../models/ProjectTask");
const TimeEntry = require("../models/TimeEntry");
const Project = require("../models/Project");
const bcrypt = require("bcryptjs");

const MAX_IMAGE = 2_800_000; // characters of base64, roughly 2 MB
const round2 = (n) => Math.round(n * 100) / 100;

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// People can change their own name, phone and photo. Role, designation,
// department and pay are changed by an admin in User Management.
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, profileImage } = req.body;
    const update = {};

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: "Name is required" });
      update.name = String(name).trim();
    }
    if (phone !== undefined) {
      const p = String(phone).trim();
      if (p && !/^[0-9+()\-\s]{7,18}$/.test(p)) return res.status(400).json({ message: "Enter a valid phone number" });
      update.phone = p;
    }
    if (profileImage !== undefined) {
      if (profileImage && !String(profileImage).startsWith("data:image/"))
        return res.status(400).json({ message: "Profile photo must be an image" });
      if (profileImage && profileImage.length > MAX_IMAGE)
        return res.status(400).json({ message: "Photo is too large (max 2 MB)" });
      update.profileImage = profileImage || undefined;
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, { returnDocument: "after" }).select("-password");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: "Enter your current and new password" });
    if (String(newPassword).length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });

    const user = await User.findById(req.user.id);
    if (!(await bcrypt.compare(currentPassword, user.password)))
      return res.status(400).json({ message: "Enter Valid Password" });
    if (await bcrypt.compare(newPassword, user.password))
      return res.status(400).json({ message: "New password must be different from the current one" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Numbers and recent activity for the profile page. Always the caller's own.
exports.getSummary = async (req, res) => {
  try {
    const me = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(new Date().setHours(0, 0, 0, 0) - 6 * 86400000);

    const [tasks, time, projectIds] = await Promise.all([
      ProjectTask.find({ assignee: me }, "title status completedAt dueDate project").populate("project", "name"),
      TimeEntry.find({ user: me, date: { $gte: weekAgo > monthStart ? monthStart : weekAgo } }, "date hours task project").populate("project", "name").sort({ date: -1 }),
      Project.find({ "team.user": me }, "_id"),
    ]);

    const monthTime = time.filter((t) => new Date(t.date) >= monthStart);
    const done = tasks.filter((t) => t.status === "DONE" && t.completedAt);

    // last 7 days: tasks completed + hours logged
    const week = Array.from({ length: 7 }, (_, i) => {
      const from = new Date(weekAgo.getTime() + i * 86400000);
      const to = new Date(from.getTime() + 86400000);
      return {
        label: from.toLocaleDateString("en-IN", { weekday: "short" }),
        done: done.filter((t) => new Date(t.completedAt) >= from && new Date(t.completedAt) < to).length,
        hours: round2(time.filter((t) => new Date(t.date) >= from && new Date(t.date) < to).reduce((s, t) => s + t.hours, 0)),
      };
    });

    const activity = [
      ...done.map((t) => ({ at: t.completedAt, text: `Completed "${t.title}"`, kind: "task" })),
      ...time.map((t) => ({ at: t.date, text: `Logged ${t.hours}h${t.task ? ` on "${t.task}"` : ""}${t.project?.name ? ` (${t.project.name})` : ""}`, kind: "time" })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);

    res.json({
      success: true,
      stats: {
        openTasks: tasks.filter((t) => t.status !== "DONE").length,
        doneMonth: done.filter((t) => new Date(t.completedAt) >= monthStart).length,
        hoursMonth: round2(monthTime.reduce((s, t) => s + t.hours, 0)),
        projects: new Set([...projectIds.map((p) => String(p._id)), ...tasks.filter((t) => t.project).map((t) => String(t.project._id))]).size,
        overdue: tasks.filter((t) => t.status !== "DONE" && t.dueDate && new Date(t.dueDate).getTime() + 86400000 < Date.now()).length,
      },
      week,
      activity,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
