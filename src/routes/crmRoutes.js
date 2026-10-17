const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const crm = require("../controllers/crmController");
const deals = require("../controllers/dealController");
const tasks = require("../controllers/crmTaskController");
const followUps = require("../controllers/followUpController");

router.use(auth);

router.get("/dashboard", can("leads.view"), crm.getCrmDashboard);

// Users / leads for the dropdowns inside CRM forms
router.get(
  "/options",
  can("leads.view", "deals.view", "crmtasks.view", "followups.view"),
  crm.getOptions,
);

// Lead pipeline (kanban)
router.get("/pipeline", can("leads.view"), crm.getPipeline);
router.patch("/pipeline/:id/stage", can("leads.manage"), crm.moveLeadStage);

// Customers (built from clients)
router.get("/customers", can("clients.view"), crm.getCustomers);

// Deals
router.get("/deals", can("deals.view"), deals.getDeals);
router.post("/deals", can("deals.manage"), deals.addDeal);
router.put("/deals/:id", can("deals.manage"), deals.updateDeal);
router.delete("/deals/:id", can("deals.manage"), deals.deleteDeal);

// CRM tasks
router.get("/tasks", can("crmtasks.view"), tasks.getTasks);
router.post("/tasks", can("crmtasks.manage"), tasks.addTask);
router.patch("/tasks/:id/toggle", can("crmtasks.manage"), tasks.toggleTask);
router.put("/tasks/:id", can("crmtasks.manage"), tasks.updateTask);
router.delete("/tasks/:id", can("crmtasks.manage"), tasks.deleteTask);

// Follow-ups
router.get("/follow-ups", can("followups.view"), followUps.getFollowUps);
router.post("/follow-ups", can("followups.manage"), followUps.addFollowUp);
router.patch("/follow-ups/:id/toggle", can("followups.manage"), followUps.toggleFollowUp);
router.put("/follow-ups/:id", can("followups.manage"), followUps.updateFollowUp);
router.delete("/follow-ups/:id", can("followups.manage"), followUps.deleteFollowUp);

module.exports = router;
