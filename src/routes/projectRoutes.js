const express = require("express");
const router = express.Router();

const c = require("../controllers/projectController");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

// Costs are built from salaries, so projects are admin only
router.use(auth, role("ADMIN"));

router.get("/", c.getProjects);
router.get("/:id", c.getProject);
router.put("/:id", c.updateProject);
router.put("/:id/team", c.setTeam);
router.put("/:id/support", c.setSupport);

module.exports = router;
