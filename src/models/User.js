const mongoose = require("mongoose");

// <input type="date"> sends "" when left blank; Mongoose can't cast that
// to a Date, so treat empty string the same as "no value provided".
const emptyStringToUndefined = (v) => (v === "" ? undefined : v);

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },

    name: String,

    dob: {
      type: Date,
      set: emptyStringToUndefined,
    },

    bloodGroup: String,

    email: {
      type: String,
      unique: true,
    },

    password: String,

    role: {
      type: String,
      enum: ["ADMIN", "EMPLOYEE", "MANAGER"],
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

    joiningDate: {
      type: Date,
      set: emptyStringToUndefined,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },

    salary: Number,

    otAmount: Number,

    bankName: String,

    accountNumber: String,

    ifscCode: String,

    branch: String,

    address: String,

    profileImage: String,
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("User", userSchema);