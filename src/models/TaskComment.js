const mongoose = require("mongoose");

const taskCommentSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    senderRole: String,

    message: String,
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("TaskComment", taskCommentSchema);
