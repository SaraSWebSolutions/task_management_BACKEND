const express = require("express");
const router = express.Router();

const { addCampaign, listCampaign, viewCampaign, followUpCampaign } = require("../controllers/campaignController");
const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");


router.post('/add', auth, can("campaigns.manage"), addCampaign);
router.get('/', auth, can("campaigns.view"), listCampaign);
router.get('/:id', auth, can("campaigns.view"), viewCampaign);
router.post(
    "/:id/follow-up",
    auth,
    can("campaigns.manage"),
    followUpCampaign
);

module.exports = router;