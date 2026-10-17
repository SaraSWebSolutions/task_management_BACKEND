const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const c = require("../controllers/userManagementController");

router.use(auth);

// Static paths first so they are not captured by "/:id"
router.get("/meta", can("users.view", "users.create", "users.edit"), c.getMeta);
router.get("/export", can("users.view"), c.exportUsers);
router.post("/bulk", can("users.edit", "users.delete"), c.bulkAction);

router.get("/", can("users.view"), c.getUsers);
router.post("/", can("users.create"), c.createUser);
router.get("/:id", can("users.view"), c.getUser);
router.put("/:id", can("users.edit"), c.updateUser);
router.patch("/:id/status", can("users.edit"), c.setUserStatus);
router.delete("/:id", can("users.delete"), c.deleteUser);

module.exports = router;
