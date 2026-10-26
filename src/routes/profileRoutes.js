const router = require("express").Router();

const auth = require("../middleware/authMiddleware");

const {
  getProfile,
  updateProfile,
  changePassword,
  getSummary,
} = require("../controllers/profileController");

router.get("/", auth, getProfile);

router.get("/summary", auth, getSummary);

router.put("/", auth, updateProfile);

router.put("/change-password", auth, changePassword);

module.exports = router;
