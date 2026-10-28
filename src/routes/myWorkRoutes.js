const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const c = require("../controllers/myWorkController");

// Needs mywork.view. Every handler works on the caller's own data.
router.use(auth, can("mywork.view"));

router.get("/", c.getMyWork);
router.post("/tasks", c.addTask);
router.put("/tasks/:id", c.updateTask);
router.delete("/tasks/:id", c.deleteTask);
router.patch("/tasks/:id/status", c.setStatus);
router.post("/time", c.addTime);
router.delete("/time/:id", c.deleteTime);

module.exports = router;
