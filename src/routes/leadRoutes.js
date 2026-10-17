const express = require("express");
const router = express.Router();

const c = require("../controllers/leadController");
const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");

router.use(auth);

router.get("/assignees", can("leads.view"), c.getAssignees); // must stay above "/:id"

router.get("/", can("leads.view"), c.getLeads);
router.post("/", can("leads.manage"), c.addLead);
router.get("/:id", can("leads.view"), c.getLead);
router.put("/:id", can("leads.manage"), c.updateLead);
router.delete("/:id", can("leads.manage"), c.deleteLead);

router.put("/:id/demo", can("leads.manage"), c.saveDemo);
router.put("/:id/marketing", can("leads.manage"), c.setMarketing);
router.post("/:id/quotation", can("leads.manage"), c.sendQuotation);
router.post("/:id/convert-sales", can("leads.manage"), c.convertToSales);
router.post("/:id/convert-project", can("leads.manage"), c.convertToProject);

module.exports = router;
