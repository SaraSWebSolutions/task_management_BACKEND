const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");
const c = require("../controllers/roleController");

router.get("/me", auth, c.myPermissions); // any signed-in user

router.get("/", auth, can("roles.view", "roles.manage"), c.listRoles);
router.post("/", auth, can("roles.manage"), c.createRole);
router.put("/:id", auth, can("roles.manage"), c.updateRole);
router.delete("/:id", auth, can("roles.manage"), c.deleteRole);

module.exports = router;
