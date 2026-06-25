const User = require("../models/User");
const bcrypt = require("bcryptjs");

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password");

    res.json(user);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        name: req.body.name,
        phone: req.body.phone,
        department: req.body.department,
        profileImage: req.body.profileImage,
      },
      { 
        returnDocument: "after",
      }
    ).select("-password");

    res.json(user);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    const validPassword =
      await bcrypt.compare(
        req.body.currentPassword,
        user.password
      );

    if (!validPassword) {
      return res.status(400).json({
        message: "Enter Valid Password",
      });
    }

    const hashedPassword =
      await bcrypt.hash(
        req.body.newPassword,
        10
      );

    user.password = hashedPassword;

    await user.save();

    res.json({
      message:
        "Password updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};