const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const pm = require("../controllers/pmController");

router.use(auth);

const anyView = [
  "projects.view",
  "projecttasks.view",
  "milestones.view",
  "timelogs.view",
];

router.get("/dashboard", can("projects.view", "projecttasks.view"), pm.getDashboard);
router.get("/options", can(...anyView, "timelogs.manage"), pm.getOptions);
router.get("/projects/:id/overview", can("projects.view"), pm.getProjectOverview);

// Tasks (board + list)
router.get("/tasks", can("projecttasks.view"), pm.getTasks);
router.post("/tasks", can("projecttasks.manage"), pm.addTask);
router.put("/tasks/:id", can("projecttasks.manage"), pm.updateTask);
// permission is checked inside: managers any task, others only their own
router.patch("/tasks/:id/status", can("projecttasks.view"), pm.setTaskStatus);
router.delete("/tasks/:id", can("projecttasks.manage"), pm.deleteTask);

// Milestones
router.get("/milestones", can("milestones.view"), pm.getMilestones);
router.post("/milestones", can("milestones.manage"), pm.addMilestone);
router.put("/milestones/:id", can("milestones.manage"), pm.updateMilestone);
router.delete("/milestones/:id", can("milestones.manage"), pm.deleteMilestone);

// Time tracking
router.get("/time", can("timelogs.view"), pm.getTimeEntries);
router.post("/time", can("timelogs.manage"), pm.addTimeEntry);
router.delete("/time/:id", can("timelogs.manage"), pm.deleteTimeEntry);

module.exports = router;
