const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const a = require("../controllers/analyticsController");
const team = require("../controllers/analyticsTeamController");
const data = require("../controllers/analyticsDataController");

router.use(auth);

// Every page needs analytics.view AND permission to see the data it summarises,
// so this menu can't be used to read something a role can't open elsewhere.
const view = can("analytics.view");

router.get("/sales", view, can("finance.view", "invoices.view"), a.sales);
router.get("/revenue", view, can("finance.view"), a.revenue);
router.get("/lead-sources", view, can("leads.view"), a.leadSources);
router.get("/conversion", view, can("leads.view", "deals.view"), a.conversion);
router.get("/users", view, can("users.view", "employees.view"), team.users);
router.get("/performance", view, can("projecttasks.view", "projects.view"), team.performance);

// Custom reports and export: each dataset checks its own permission
router.get("/datasets", view, can(), data.listDatasets);
router.get("/dataset/:key", view, can(), data.getDataset);

module.exports = router;
