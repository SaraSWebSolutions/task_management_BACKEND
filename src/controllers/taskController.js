const Task = require("../models/Task");

exports.createTask = async (req, res) => {
  try {
    const existingTask = await Task.findOne({
      employeeId: req.user.id,
      date: req.body.date,
      timeSlot: req.body.timeSlot,
    });

    if (existingTask) {
      return res.status(400).json({
        success: false,
        message: `Task already exists for ${req.body.timeSlot} on ${req.body.date}`,
      });
    }

    const task = await Task.create({
      ...req.body,
      employeeId: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      task,
    });
  } catch (error) {
    console.log(error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Task already exists for this employee, date and time slot",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getMyTasks = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const tasks = await Task.find({
      employeeId: req.user.id,
      date: req.query.date,
    }).sort("timeSlot");
    res.json(tasks);
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getAllTasks = async (req, res) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const tasks = await Task.find()
      .populate("employeeId", "name email")
      .sort("-createdAt");

    res.json(tasks);
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate(
      "employeeId",
      "name email",
    );

    if (!task) {
      return res.status(404).json({
        message: "Task not found",
      });
    }

    res.json(task);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: error.message,
    });
  }
};

exports.commentTask = async (req, res) => {
  const task = await Task.findByIdAndUpdate(
    req.params.id,
    {
      adminComment: req.body.adminComment,
    },
    {
      returnDocument: "after",
    },
  );

  res.json(task);
};

exports.bulkCreateTasks = async (req, res) => {
  try {
    const { date, tasks } = req.body;

    const employeeId = req.user.id;

    for (const task of tasks) {
      if (!task.project && !task.taskDescription) continue;

      const existingTask = await Task.findOne({
        employeeId,
        date,
        timeSlot: task.timeSlot,
      });

      if (existingTask) {
        await Task.findByIdAndUpdate(existingTask._id, {
          project: task.project,
          taskDescription: task.taskDescription,
          status: task.status,
          remarks: task.remarks,
        });
      } else {
        await Task.create({
          employeeId,
          date,
          timeSlot: task.timeSlot,
          project: task.project,
          taskDescription: task.taskDescription,
          status: task.status,
          remarks: task.remarks,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Tasks saved successfully",
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      returnDocument: "after",
    });

    res.json(task);
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.addComment = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        message: "Task not found",
      });
    }

    task.comments.push({
      sender: req.user.role,
      message: req.body.message,
    });

    await task.save();

    res.json(task);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: error.message,
    });
  }
};

exports.assignTasks = async (req, res) => {
  try {
    const { employeeId, date, tasks } = req.body;

    for (const task of tasks) {
      if (!task.project && !task.taskDescription) continue;

      const existingTask = await Task.findOne({
        employeeId,
        date,
        timeSlot: task.timeSlot,
      });

      if (existingTask) {
        await Task.findByIdAndUpdate(existingTask._id, {
          project: task.project,
          taskDescription: task.taskDescription,
          status: task.status,
          remarks: task.remarks,
        });
      } else {
        await Task.create({
          employeeId,
          date,
          timeSlot: task.timeSlot,
          project: task.project,
          taskDescription: task.taskDescription,
          status: task.status,
          remarks: task.remarks,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Tasks assigned successfully",
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getEmployeeTasks = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { date } = req.query;

    const tasks = await Task.find({
      employeeId,
      date,
    }).sort("timeSlot");

    res.json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
