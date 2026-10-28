const Role = require("../models/Role");
const { ALL_PERMISSIONS, SYSTEM_ROLES, MANAGER_DEFAULTS } = require("../config/permissions");

// Bump when MANAGER_DEFAULTS grows. The new permissions are added once to the
// existing Manager role; nothing is ever removed and later edits stay.
const SEED_VERSION = 2;

// Creates the three built-in roles if missing. Never overwrites edits.
exports.ensureSystemRoles = async () => {
  await Role.bulkWrite(
    Object.values(SYSTEM_ROLES).map(({ key, ...rest }) => ({
      updateOne: {
        filter: { key },
        update: { $setOnInsert: rest },
        upsert: true,
      },
    })),
  );

  await Role.updateOne(
    { key: "MANAGER", $or: [{ seedVersion: { $exists: false } }, { seedVersion: { $lt: SEED_VERSION } }] },
    { $addToSet: { permissions: { $each: MANAGER_DEFAULTS } }, $set: { seedVersion: SEED_VERSION } },
  );
};

// Falls back to built-in defaults if the seed has not run yet.
exports.findRole = async (key) =>
  (await Role.findOne({ key })) || SYSTEM_ROLES[key] || null;

// Effective permissions = role permissions + per-user extras.
exports.permissionsFor = async (user) => {
  if (user.role === "ADMIN") return ALL_PERMISSIONS;
  const role = await exports.findRole(user.roleKey || user.role);
  const set = new Set([...(role?.permissions || []), ...(user.permissions || [])]);
  return ALL_PERMISSIONS.filter((p) => set.has(p)); // drops stale keys
};
