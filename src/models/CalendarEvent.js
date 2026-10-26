const mongoose = require("mongoose");

const emptyToUndefined = (v) => (v === "" ? undefined : v);

const CATEGORIES = ["MEETING", "DEMO", "FOLLOW_UP", "DEADLINE", "REMINDER", "OTHER"];

const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, enum: CATEGORIES, default: "MEETING" },
    allDay: { type: Boolean, default: false },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    location: { type: String, trim: true }, // place or meeting link
    color: { type: String, default: "#3b82f6" },

    recurrence: {
      freq: { type: String, enum: ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"], default: "NONE" },
      interval: { type: Number, default: 1, min: 1, max: 52 },
      until: { type: Date, set: emptyToUndefined },
    },

    // Minutes before the start. null means no reminder.
    reminderMinutes: { type: Number, default: 30, min: 0, set: (v) => (v === "" || v === undefined ? null : v) },

    attendees: [
      new mongoose.Schema(
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          response: { type: String, enum: ["PENDING", "ACCEPTED", "DECLINED", "MAYBE"], default: "PENDING" },
        },
        { _id: false },
      ),
    ],

    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", set: emptyToUndefined },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

calendarEventSchema.index({ start: 1 });
calendarEventSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model("CalendarEvent", calendarEventSchema);
