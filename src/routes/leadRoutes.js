const express = require("express");
const router = express.Router();

const c = require("../controllers/leadController");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

router.use(auth, role("ADMIN", "MANAGER"));

router.get("/assignees", c.getAssignees); // must stay above "/:id"

router.get("/", c.getLeads);
router.post("/", c.addLead);
router.get("/:id", c.getLead);
router.put("/:id", c.updateLead);
router.delete("/:id", c.deleteLead);

router.put("/:id/demo", c.saveDemo);
router.put("/:id/marketing", c.setMarketing);
router.post("/:id/quotation", c.sendQuotation);
router.post("/:id/convert-sales", c.convertToSales);
router.post("/:id/convert-project", c.convertToProject);

module.exports = router;
