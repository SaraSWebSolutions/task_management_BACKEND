const express = require("express");
const router = express.Router();

const c = require("../controllers/campaignController");
const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");

router.get("/", auth, can("campaigns.view"), c.listCampaign);
router.get("/recipients", auth, can("campaigns.manage"), c.recipients); // before /:id
router.post("/add", auth, can("campaigns.manage"), c.addCampaign);
router.post("/draft", auth, can("campaigns.manage"), c.saveDraft);
router.get("/:id", auth, can("campaigns.view"), c.viewCampaign);
router.post("/:id/send", auth, can("campaigns.manage"), c.sendCampaign);
router.post("/:id/follow-up", auth, can("campaigns.manage"), c.followUpCampaign);
router.patch("/:id/trash", auth, can("campaigns.manage"), c.setTrashed(true));
router.patch("/:id/restore", auth, can("campaigns.manage"), c.setTrashed(false));
router.delete("/:id", auth, can("campaigns.manage"), c.deleteForever);

module.exports = router;
