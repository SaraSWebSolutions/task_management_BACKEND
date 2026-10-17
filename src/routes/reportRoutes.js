const express = require("express");
const router = express.Router();

const c = require("../controllers/reportController");
const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");

// Reports include salary based costs, so admin only
router.use(auth);

router.get("/quotations", can("reports.view"), c.quotationReport);
router.get("/employees", can("reports.view"), c.employeeReport);
router.get("/dashboard", can("reports.view"), c.dashboard);
router.put("/settings/:month", can("reports.manage"), c.saveSettings);
router.post("/expenses", can("reports.manage"), c.addExpense);
router.delete("/expenses/:id", can("reports.manage"), c.deleteExpense);

module.exports = router;
