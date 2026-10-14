const express = require("express");
const router = express.Router();

const c = require("../controllers/reportController");
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

// Reports include salary based costs, so admin only
router.use(auth, role("ADMIN"));

router.get("/quotations", c.quotationReport);
router.get("/employees", c.employeeReport);
router.get("/dashboard", c.dashboard);
router.put("/settings/:month", c.saveSettings);
router.post("/expenses", c.addExpense);
router.delete("/expenses/:id", c.deleteExpense);

module.exports = router;
