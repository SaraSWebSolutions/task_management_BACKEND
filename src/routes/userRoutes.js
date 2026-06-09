const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const { getEmployees } = require("../controllers/userController");

router.get("/employees", auth, getEmployees);

module.exports = router;
