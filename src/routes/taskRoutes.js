const express = require("express");

const router = express.Router();

const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

const {
  createTask,
  getMyTasks,
  getAllTasks,
  commentTask,
  bulkCreateTasks,
  updateTask,
  deleteTask,
  getTaskById,
  addComment,
  assignTasks,
} = require("../controllers/taskController");

router.post("/", auth, createTask);

router.get("/my-tasks", auth, getMyTasks);

router.get("/all-tasks", auth, role("ADMIN"), getAllTasks);

router.post("/assign", auth, role("ADMIN"), assignTasks);

router.get("/:id", auth, getTaskById);

router.post("/:id/comment", auth, addComment);

router.put("/comment/:id", auth, role("ADMIN"), commentTask);

router.post("/bulk-create", auth, bulkCreateTasks);

router.put("/:id", auth, updateTask);

router.delete("/:id", auth, deleteTask);

module.exports = router;
