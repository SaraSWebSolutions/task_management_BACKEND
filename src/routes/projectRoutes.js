const express = require("express");
const router = express.Router();

const c = require("../controllers/projectController");
const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");

// Costs are built from salaries, so projects are admin only
router.use(auth);

router.get("/", can("projects.view"), c.getProjects);
router.post("/", can("projects.manage"), c.createProject);
router.get("/:id", can("projects.view"), c.getProject);
router.put("/:id", can("projects.manage"), c.updateProject);
router.delete("/:id", can("projects.manage"), c.deleteProject);
router.put("/:id/team", can("projects.manage"), c.setTeam);
router.put("/:id/support", can("projects.manage"), c.setSupport);

module.exports = router;
