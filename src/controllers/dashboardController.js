const User = require("../models/User");
const Task = require("../models/Task");
const Client = require("../models/Clients");

exports.adminDashboard = async (req, res) => {
  try {
    const employees = await User.countDocuments({
      role: "EMPLOYEE",
    });

    const totalTasks = await Task.countDocuments();

    const completed = await Task.countDocuments({
      status: "Completed",
    });

    const pending = await Task.countDocuments({
      status: "Pending",
    });

    const inProgress = await Task.countDocuments({
      status: "In Progress",
    });

    const notStarted = await Task.countDocuments({
      status: "Not Started",
    });

    const blocked = await Task.countDocuments({
      status: "Blocked",
    });

    const totalClients = await Client.countDocuments();

    const today = new Date();

    const dueSoon = await Client.countDocuments({
      renewalDate: {
        $gte: today,
        $lte: new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000),
      },
    });

    const recentTasks = await Task.find()
      .populate("employeeId", "name email")
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      employees,
      totalTasks,
      completed,
      pending,
      inProgress,
      notStarted,
      blocked,
      totalClients,
      dueSoon,
      recentTasks,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: error.message,
    });
  }
};

exports.employeeDashboard = async (req, res) => {
  try {
    const employeeId = req.user.id;

    const totalTasks = await Task.countDocuments({
      employeeId,
    });

    const completed = await Task.countDocuments({
      employeeId,
      status: "Completed",
    });

    const pending = await Task.countDocuments({
      employeeId,
      status: "Pending",
    });

    const inProgress = await Task.countDocuments({
      employeeId,
      status: "In Progress",
    });

    const notStarted = await Task.countDocuments({
      employeeId,
      status: "Not Started",
    });

    const recentTasks = await Task.find({
      employeeId,
    })
      .sort({
        createdAt: -1,
      })
      .limit(5);

    res.json({
      totalTasks,
      completed,
      pending,
      inProgress,
      notStarted,
      recentTasks,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: error.message,
    });
  }
};

exports.weeklyReport = async (req, res) => {
  try {
    const employeeId = req.user.id;

    const today = new Date();

    const start = new Date(today);
    start.setDate(today.getDate() - 6);

    const startDate = start
      .toISOString()
      .split("T")[0];

    const tasks = await Task.find({
      employeeId,
      date: { $gte: startDate },
    });

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    const result = days.map((day) => ({
      day,
      count: 0,
    }));

    tasks.forEach((task) => {
      const d = new Date(task.date);

      let index = d.getDay();

      index = index === 0 ? 6 : index - 1;

      result[index].count += 1;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.adminWeeklyReport = async (req, res) => {
  try {
    const today = new Date();

    const start = new Date(today);

    start.setDate(today.getDate() - 6);

    const startDate = start
      .toISOString()
      .split("T")[0];

    const tasks = await Task.find({
      date: {
        $gte: startDate,
      },
    });

    const days = [
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ];

    const result = days.map((day) => ({
      day,
      count: 0,
    }));

    tasks.forEach((task) => {
      const d = new Date(task.date);

      let index = d.getDay();

      index = index === 0 ? 6 : index - 1;

      result[index].count += 1;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.topEmployees = async (req, res) => {
  try {
    const employees = await Task.aggregate([
      {
        $match: {
          status: "Completed",
        },
      },

      {
        $group: {
          _id: "$employeeId",
          completedTasks: {
            $sum: 1,
          },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "employee",
        },
      },

      {
        $unwind: "$employee",
      },

      {
        $project: {
          _id: 1,
          name: "$employee.name",
          completedTasks: 1,
        },
      },

      {
        $sort: {
          completedTasks: -1,
        },
      },

      {
        $limit: 5,
      },
    ]);

    res.json(employees);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: error.message,
    });
  }
};
