const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ["ADMIN", "EMPLOYEE"],
  },

  message: {
    type: String,
    required: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const taskSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    date: String,

    timeSlot: String,

    project: String,

    taskDescription: String,

    status: {
      type: String,
      enum: ["Not Started", "Pending", "In Progress", "Completed", "Blocked"],
      default: "Not Started",
    },

    remarks: String,

    adminReply: String,

    comments: [commentSchema],
  },
  {
    timestamps: true,
  },
);

taskSchema.index(
  {
    employeeId: 1,
    date: 1,
    timeSlot: 1,
  },
  {
    unique: true,
  },
);

module.exports = mongoose.model("Task", taskSchema);
