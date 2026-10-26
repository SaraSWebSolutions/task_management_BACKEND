const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const c = require("../controllers/notificationController");

// Login only. Everything is scoped to the caller.
router.use(auth);

router.get("/", c.list);
router.get("/summary", c.summary);
router.get("/preferences", c.getPreferences);
router.put("/preferences", c.savePreferences);
router.patch("/read-all", c.markAllRead);
router.delete("/read", c.clearRead);
router.patch("/:id/read", c.markRead);
router.delete("/:id", c.remove);

module.exports = router;
