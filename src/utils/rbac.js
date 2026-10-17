const Role = require("../models/Role");
const { ALL_PERMISSIONS, SYSTEM_ROLES } = require("../config/permissions");

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
