const express = require("express");
const router = express.Router();

const {
  login,
  forgotPassword,
  verifyResetToken,
  resetPassword,
} = require("../controllers/authController");

router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.get("/reset-password/:token", verifyResetToken);
router.post("/reset-password/:token", resetPassword);
module.exports = router;
