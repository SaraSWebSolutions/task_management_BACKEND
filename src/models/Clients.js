const mongoose = require("mongoose");

// <input type="date"> sends "" when left blank; Mongoose can't cast that
// to a Date, so treat empty string the same as "no value provided".
const emptyStringToUndefined = (v) => (v === "" ? undefined : v);

const clientSchema = new mongoose.Schema(
  {
    // Company details
    companyName: {
      type: String,
      required: true,
    },

    clientName: {
      type: String,
      required: true,
    },

    gstNumber: String,

    address: String,

    phone1: {
      // Mobile Number
      type: String,
      required: true,
    },

    phone2: String, // WhatsApp Number

    sameAsMobile: {
      type: Boolean,
      default: false,
    },

    // Type & service details
    basicType: {
      type: String,
      enum: ["WEBSITE", "BILLING", "SOFTWARE", "E-COMMERCE"],
      required: true,
    },

    domainName: {
      type: String,
      required: function () {
        return this.basicType === "WEBSITE" || this.basicType === "E-COMMERCE";
      },
    },

    domainOwnership: {
      type: String,
      enum: ["CLIENT", "US"],
      default: "CLIENT",
    },

    domainRegDate: {
      type: Date,
      set: emptyStringToUndefined,
      required: function () {
        return (
          (this.basicType === "WEBSITE" || this.basicType === "E-COMMERCE") &&
          this.domainOwnership === "US"
        );
      },
    },

    siteLiveDate: {
      type: Date,
      set: emptyStringToUndefined,
    },

    softwareName: String,

    installationDate: {
      type: Date,
      set: emptyStringToUndefined,
      required: function () {
        return this.basicType === "BILLING" || this.basicType === "SOFTWARE";
      },
    },

    // Renewal & billing
    renewalDate: {
      type: Date,
      set: emptyStringToUndefined,
      required: true,
    },

    totalCost: {
      type: Number,
      required: true,
    },

    advanceAmount: {
      type: Number,
      default: 0,
    },

    advanceReceivedDate: {
      type: Date,
      set: emptyStringToUndefined,
    },

    balance: {
      type: Number,
      default: 0,
    },

    balanceReceivedExpectedDate: {
      type: Date,
      set: emptyStringToUndefined,
    },

    paymentStatus: {
      type: String,
      enum: ["PAID", "PENDING", "PARTIALLY_PAID"],
      default: "PENDING",
    },

    amcAmount: Number,

    // Contact person
    contactPerson: String,

    contactPersonPhone: String,

    contactPersonWhatsapp: String,

    contactPersonSameAsPhone: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Always trust the server's own math for the balance rather than
// whatever the client sent — advance/total can be edited independently.
clientSchema.pre("save", function () {
  const total = this.totalCost || 0;
  const advance = this.advanceAmount || 0;
  this.balance = Math.max(total - advance, 0);
});

// findByIdAndUpdate bypasses pre("save"), so recompute balance here too
// whenever totalCost or advanceAmount is part of the update payload.
clientSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();

  if (update.totalCost === undefined && update.advanceAmount === undefined) {
    return;
  }

  // Merge with the existing document so a partial update (e.g. only
  // advanceAmount changing) still recalculates against the full totals.
  const doc = await this.model.findOne(this.getQuery());

  const total =
    update.totalCost !== undefined ? update.totalCost : doc?.totalCost || 0;
  const advance =
    update.advanceAmount !== undefined
      ? update.advanceAmount
      : doc?.advanceAmount || 0;

  update.balance = Math.max(total - advance, 0);
});

module.exports = mongoose.model("Client", clientSchema);