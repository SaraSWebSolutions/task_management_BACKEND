const User = require("../models/User");

exports.getEmployees = async (req, res) => {
  try {
    const employees = await User.find(
      { role: "EMPLOYEE" },
      "name email"
    );

    res.json(employees);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: error.message,
    });
  }
};