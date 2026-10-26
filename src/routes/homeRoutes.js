const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const { getOverview } = require("../controllers/homeController");

// Login only. The controller leaves out any block the caller isn't allowed to see.
router.get("/overview", auth, can(), getOverview);

module.exports = router;
