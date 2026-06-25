const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    clientName: {
      type: String,
      required: true,
    },

    basicType: {
      type: String,
      enum: ["WEBSITE", "BILLING", "SOFTWARE"],
      required: true,
    },

    domainName: String,

    hostingUrl: String,

    softwareName: String,

    renewalDate: {
      type: Date,
      required: true,
    },

    cost: {
      type: Number,
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["PAID", "PENDING"],
      default: "PENDING",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Client", clientSchema);
