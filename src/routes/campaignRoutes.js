const express = require("express");
const router = express.Router();

const { addCampaign, listCampaign, viewCampaign, followUpCampaign } = require("../controllers/campaignController");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");


router.post('/add', auth, role("ADMIN", "MANAGER"), addCampaign);
router.get('/', auth, role("ADMIN", "MANAGER"), listCampaign);
router.get('/:id', auth, role("ADMIN", "MANAGER"), viewCampaign);
router.post(
    "/:id/follow-up",
    auth,
    role("ADMIN", "MANAGER"),
    followUpCampaign
);

module.exports = router;