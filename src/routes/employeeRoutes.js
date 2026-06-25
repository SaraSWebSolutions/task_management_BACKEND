
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

const {
  addEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} = require("../controllers/employeeController");

router.post("/", auth, role("ADMIN"), addEmployee);

router.get("/",  auth, role("ADMIN"), getEmployees);

router.get("/:id",  auth, role("ADMIN"), getEmployeeById);

router.put("/:id",  auth, role("ADMIN"), updateEmployee);

router.delete("/:id",  auth, role("ADMIN"), deleteEmployee);

module.exports = router;