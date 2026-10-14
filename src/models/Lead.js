const mongoose = require("mongoose");

const marketingEntry = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  hours: { type: Number, default: 0 },
  hourlyRate: { type: Number, default: 0 },
  note: String,
  date: { type: Date, default: Date.now },
});

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true },

    // Where the lead came from (used by the target dashboard)
    source: {
      type: String,
      enum: ["BNI", "EVENT", "META", "INDIAMART", "OTHER"],
      default: "OTHER",
    },

    // What the lead asked for when they first contacted us
    requestType: { type: String, enum: ["DEMO", "QUOTATION"], required: true },

    // Only when requestType === "DEMO"
    demoType: { type: String, enum: ["ONLINE", "OFFLINE"] },

    // Demo details (location / spend / copy only for OFFLINE)
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    demoDate: Date,
    location: String,
    spendAmount: Number,
    spendDoc: String, // expense copy stored as data URL
    spendDocName: String,

    quotationSentAt: Date,

    // Marketing time spent to win this lead / project
    marketing: [marketingEntry],

    status: {
      type: String,
      enum: [
        "NEW",
        "DEMO_SCHEDULED",
        "QUOTATION_SENT",
        "SALES",
        "PROJECT",
        "LOST",
      ],
      default: "NEW",
    },

    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Lead", leadSchema);
