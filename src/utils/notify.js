const Notification = require("../models/Notification");
const UserPreference = require("../models/UserPreference");

// Notifications must never break the action that caused them,
// so every failure here is swallowed.
const unique = (ids) => [...new Set(ids.filter(Boolean).map(String))];

/**
 * notify(userIds, { type, title, message, link, key }, { except })
 * - `except`: the person who did the action (they don't need to be told)
 * - `key`: same key for the same user is only stored once
 */
const notify = async (userIds, { type = "SYSTEM", title, message, link, key }, { except } = {}) => {
  try {
    const ids = unique([].concat(userIds)).filter((id) => id !== String(except || ""));
    if (!ids.length || !title) return;

    const prefs = await UserPreference.find({ user: { $in: ids } }, "user notify");
    const off = new Set(
      prefs.filter((p) => p.notify?.[type] === false).map((p) => String(p.user)),
    );

    const docs = ids
      .filter((id) => !off.has(id))
      .map((user) => ({ user, type, title, message, link, ...(key ? { key } : {}) }));
    if (!docs.length) return;

    // ordered:false -> a duplicate `key` for one person doesn't stop the others
    await Notification.insertMany(docs, { ordered: false }).catch((e) => {
      if (e?.code !== 11000 && !e?.writeErrors) throw e;
    });
  } catch (error) {
    console.error("notify failed:", error.message);
  }
};

module.exports = { notify };
