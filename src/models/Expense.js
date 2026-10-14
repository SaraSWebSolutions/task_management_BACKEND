const mongoose = require("mongoose");

// Marketing money spent: BNI membership, event stall, Meta ads, IndiaMART plan...
const expenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, default: Date.now },
    source: {
      type: String,
      enum: ["BNI", "EVENT", "META", "INDIAMART", "OTHER"],
      default: "OTHER",
    },
    amount: { type: Number, required: true, min: 0 },
    note: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Expense", expenseSchema);
