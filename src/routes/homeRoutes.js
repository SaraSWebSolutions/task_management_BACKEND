const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const { getOverview } = require("../controllers/homeController");

// Needs dashboard.view. The controller leaves out any block the caller isn't allowed to see.
router.get("/overview", auth, can("dashboard.view"), getOverview);

module.exports = router;
