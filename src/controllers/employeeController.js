const User = require("../models/User");
const bcrypt = require("bcryptjs");

exports.addEmployee = async (req, res) => {
  try {
    const {
      employeeId,
      name,
      email,
      phone,
      password,
      dob,
      bloodGroup,
      role,
      department,
      designation,
      joiningDate,
      status,
      salary,
      otAmount,
      bankName,
      accountNumber,
      ifscCode,
      branch,
      address,
    } = req.body;

    if (
      !employeeId ||
      !name ||
      !email ||
      !phone ||
      !password ||
      !department ||
      !joiningDate ||
      !salary
    ) {
      return res.status(400).json({
        message: "Fill the required fields",
      });
    }

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
      phone,
      password: hashedPassword,
      dob: dob || undefined,
      bloodGroup,
      role: role || "EMPLOYEE" || "MANAGER",
      department,
      designation,
      joiningDate,
      status: status || "ACTIVE",
      salary,
      otAmount: otAmount || undefined,
      bankName,
      accountNumber,
      ifscCode,
      branch,
      address,
    });

    const { password: _pw, ...employeeWithoutPassword } = employee.toObject();

    res.status(201).json(employeeWithoutPassword);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getEmployees = async (req, res) => {
  try {
    const employees = await User.find({
      role: { $in: ["ADMIN", "EMPLOYEE", "MANAGER"] },
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
    const {
      employeeId,
      name,
      email,
      phone,
      password,
      dob,
      bloodGroup,
      role,
      department,
      designation,
      joiningDate,
      status,
      salary,
      otAmount,
      bankName,
      accountNumber,
      ifscCode,
      branch,
      address,
    } = req.body;

    if (!employeeId || !name || !email || !phone || !department) {
      return res.status(400).json({
        message: "Fill the required fields",
      });
    }

    // Guard against another employee already using this ID/email
    const duplicate = await User.findOne({
      _id: { $ne: req.params.id },
      $or: [{ email }, { employeeId }],
    });

    if (duplicate) {
      return res.status(400).json({
        message: "Another employee already uses this Email or Employee ID",
      });
    }

    const updateData = {
      employeeId,
      name,
      email,
      phone,
      dob: dob || undefined,
      bloodGroup,
      role,
      department,
      designation,
      joiningDate: joiningDate || undefined,
      status,
      salary,
      otAmount: otAmount || undefined,
      bankName,
      accountNumber,
      ifscCode,
      branch,
      address,
    };

    // Only touch the password if the admin actually typed a new one —
    // an empty/missing password here should never overwrite the existing hash.
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const employee = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

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