const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const can = require("../middleware/permissionMiddleware");

const {
  getClients,
  addClient,
  getClient,
  updateClient,
  deleteClient,
} = require("../controllers/clientController");

router.use(auth);

router.get("/", can("clients.view"), getClients);
router.post("/", can("clients.manage"), addClient);
router.get("/:id", can("clients.view"), getClient);
router.put("/:id", can("clients.manage"), updateClient);
router.delete("/:id", can("clients.manage"), deleteClient);

module.exports = router;
