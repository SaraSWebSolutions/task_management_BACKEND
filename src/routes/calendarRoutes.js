const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const c = require("../controllers/calendarController");

// Login only. can() with no arguments just loads the caller's permissions.
// People see events they created or were invited to (admin sees all).
router.use(auth, can());

router.get("/", c.getCalendar);
router.get("/options", c.getOptions);
router.post("/events", c.addEvent);
router.get("/events/:id", c.getEvent);
router.put("/events/:id", c.updateEvent);
router.delete("/events/:id", c.deleteEvent);
router.patch("/events/:id/response", c.respond);

module.exports = router;
