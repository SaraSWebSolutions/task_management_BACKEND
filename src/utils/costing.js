const User = require("../models/User");

// Salary is monthly, so hourly rate = salary / (working days x hours per day).
// Change these two numbers if your company counts differently.
const WORKING_DAYS_PER_MONTH = 26;
const HOURS_PER_DAY = 8;

const hourlyRateOf = async (userId) => {
  const user = await User.findById(userId, "salary");
  return user?.salary
    ? user.salary / (WORKING_DAYS_PER_MONTH * HOURS_PER_DAY)
    : 0;
};

// Turns [{user, hours, note?, date?, _id?}] from the browser into saved entries.
// The hourly rate is snapshotted when an entry is first added, so later salary
// changes don't rewrite old cost. Existing entries are matched by _id
// (or by user when byUser is true, used for the project team).
const buildEntries = async (incoming = [], existing = [], { byUser = false } = {}) =>
  Promise.all(
    incoming.map(async (item) => {
      if (!item.user) throw new Error("Select a person");

      const hours = Number(item.hours);
      if (!(hours >= 0)) throw new Error("Enter valid hours");

      const old = byUser
        ? existing.find((e) => String(e.user) === String(item.user))
        : item._id && existing.find((e) => String(e._id) === String(item._id));

      const date = item.date || old?.date;

      return {
        ...(old && !byUser && { _id: old._id }),
        user: item.user,
        hours,
        hourlyRate: old?.hourlyRate || (await hourlyRateOf(item.user)),
        ...(item.note !== undefined && { note: item.note }),
        ...(date && { date }),
      };
    }),
  );

const sumHours = (list = []) => list.reduce((s, e) => s + (e.hours || 0), 0);
const sumCost = (list = []) =>
  list.reduce((s, e) => s + (e.hours || 0) * (e.hourlyRate || 0), 0);

module.exports = { hourlyRateOf, buildEntries, sumHours, sumCost };
