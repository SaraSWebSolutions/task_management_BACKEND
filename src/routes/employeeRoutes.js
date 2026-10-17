
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");

const {
  addEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} = require("../controllers/employeeController");

router.post("/", auth, can("employees.manage"), addEmployee);

router.get("/", auth, can("employees.view"), getEmployees);

router.get("/:id", auth, can("employees.view"), getEmployeeById);

router.put("/:id", auth, can("employees.manage"), updateEmployee);

router.delete("/:id", auth, can("employees.manage"), deleteEmployee);

module.exports = router;