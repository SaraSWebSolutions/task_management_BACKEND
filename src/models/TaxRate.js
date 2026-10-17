const mongoose = require("mongoose");

const TAX_TYPES = ["GST", "IGST", "CGST", "SGST", "VAT", "SALES_TAX", "OTHER"];

const taxRateSchema = new mongoose.Schema(
  {
    region: { type: String, required: true, trim: true }, // e.g. "India - GST 18%"
    rate: { type: Number, required: true, min: 0, max: 100 },
    type: { type: String, enum: TAX_TYPES, default: "GST" },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

taxRateSchema.statics.TAX_TYPES = TAX_TYPES;

module.exports = mongoose.model("TaxRate", taxRateSchema);
