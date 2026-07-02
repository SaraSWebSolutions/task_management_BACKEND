// const express = require("express");

// const router = express.Router();

// const auth = require("../middleware/authMiddleware");

// const {
//   adminDashboard,
//   employeeDashboard,
//   weeklyReport,
//   topEmployees,
//   adminWeeklyReport,
// } = require("../controllers/dashboardController");

// router.get("/admin", auth, adminDashboard);

// router.get("/employee", auth, employeeDashboard);

// router.get("/weekly", auth, weeklyReport);

// router.get("/admin-weekly", auth, adminWeeklyReport);

// router.get("/top-employees", auth, topEmployees);

// module.exports = router;

const express = require("express");

const router = express.Router();

const auth = require("../middleware/authMiddleware");

const {
  adminDashboard,
  employeeDashboard,
  weeklyReport,
  topEmployees,
  adminWeeklyReport,
  upcomingBirthdays,
} = require("../controllers/dashboardController");

router.get("/admin", auth, adminDashboard);

router.get("/employee", auth, employeeDashboard);

router.get("/weekly", auth, weeklyReport);

router.get("/admin-weekly", auth, adminWeeklyReport);

router.get("/top-employees", auth, topEmployees);

router.get("/birthdays", auth, upcomingBirthdays);

module.exports = router;