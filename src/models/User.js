// const mongoose = require("mongoose");

// const userSchema = new mongoose.Schema(
//   {
//     name: String,

//     email: {
//       type: String,
//       unique: true,
//     },

//     password: String,

//     role: {
//       type: String,
//       enum: ["ADMIN", "EMPLOYEE"],
//       default: "EMPLOYEE",
//     },

//     phone: String,

//     department: String,

//     profileImage: String,
//   },
//   {
//     timestamps: true,
//   }
// );

// module.exports = mongoose.model(
//   "User",
//   userSchema
// );

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },

    name: String,

    email: {
      type: String,
      unique: true,
    },

    password: String,

    role: {
      type: String,
      enum: ["ADMIN", "EMPLOYEE"],
      default: "EMPLOYEE",
    },

    designation: {
      type: String,
      enum: [
        "Developer",
        "Tester",
        "UI Designer",
        "Team Lead",
        "Project Manager",
      ],
      default: "Developer",
    },

    phone: String,

    department: String,

    joiningDate: Date,

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },

    profileImage: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);