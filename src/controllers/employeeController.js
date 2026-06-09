const User = require("../models/User");
const bcrypt = require("bcryptjs");

exports.addEmployee = async (req, res) => {
  try {
    const {
      employeeId,
      name,
      email,
      password,
      phone,
      department,
      designation,
      joiningDate,
      role,
    } = req.body;

    const exists = await User.findOne({
      $or: [{ email }, { employeeId }],
    });

    if (exists) {
      return res.status(400).json({
        message: "Employee already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const employee = await User.create({
      employeeId,
      name,
      email,
      password: hashedPassword,
      phone,
      department,
      designation,
      joiningDate,
      role: role || "EMPLOYEE",
    });

    res.status(201).json(employee);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getEmployees = async (req, res) => {
  try {
    const employees = await User.find({
      role: { $in: ["ADMIN", "EMPLOYEE"] },
    }).select("-password");

    res.json(employees);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getEmployeeById = async (req, res) => {
  try {
    const employee = await User.findById(req.params.id).select("-password");

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const { employeeId, name, email, phone, department, designation, status,role } =
      req.body;

    const employee = await User.findByIdAndUpdate(
      req.params.id,
      {
        employeeId,
        name,
        email,
        phone,
        department,
        designation,
        status,
        role,
      },
      {
        returnDocument: "after",
      },
    );

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await User.findByIdAndDelete(req.params.id);

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    res.json({
      message: "Employee deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
