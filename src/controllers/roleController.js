const Role = require("../models/Role");
const User = require("../models/User");
const { GROUPS, ALL_PERMISSIONS } = require("../config/permissions");
const { ensureSystemRoles, permissionsFor } = require("../utils/rbac");

const slug = (s) =>
  String(s)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const sanitize = (perms) =>
  [...new Set(Array.isArray(perms) ? perms : [])].filter((p) =>
    ALL_PERMISSIONS.includes(p),
  );

// A non-admin can only hand out permissions they hold themselves.
const notGrantable = (req, perms) =>
  req.isAdmin ? [] : perms.filter((p) => !req.perms.includes(p));

const shape = (role, countMap) => ({
  _id: role._id,
  key: role.key,
  name: role.name,
  description: role.description || "",
  baseRole: role.baseRole,
  isSystem: role.isSystem,
  permissions: role.key === "ADMIN" ? ALL_PERMISSIONS : role.permissions,
  userCount: countMap[role.key] || 0,
});

exports.listRoles = async (req, res) => {
  try {
    await ensureSystemRoles();

    const [roles, counts] = await Promise.all([
      Role.find().sort({ isSystem: -1, createdAt: 1 }),
      User.aggregate([
        { $group: { _id: { $ifNull: ["$roleKey", "$role"] }, count: { $sum: 1 } } },
      ]),
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));

    res.json({
      roles: roles.map((r) => shape(r, countMap)),
      groups: GROUPS,
      totalPermissions: ALL_PERMISSIONS.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// The caller's own fresh permissions (used by the frontend after every role edit).
exports.myPermissions = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "role roleKey permissions status",
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      role: user.role,
      roleKey: user.roleKey || user.role,
      status: user.status,
      permissions: await permissionsFor(user),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createRole = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ message: "Role name is required" });

    const key = slug(name);
    if (!key) return res.status(400).json({ message: "Invalid role name" });

    const baseRole = req.body.baseRole === "MANAGER" ? "MANAGER" : "EMPLOYEE";
    const permissions = sanitize(req.body.permissions);

    const blocked = notGrantable(req, permissions);
    if (blocked.length) {
      return res
        .status(403)
        .json({ message: "You can only grant permissions you have yourself" });
    }

    if (await Role.findOne({ key })) {
      return res.status(400).json({ message: "A role with this name already exists" });
    }

    const role = await Role.create({
      key,
      name,
      description: req.body.description?.trim(),
      baseRole,
      permissions,
      isSystem: false,
    });

    res.status(201).json(shape(role, {}));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });

    if (role.key === "ADMIN") {
      return res.status(400).json({ message: "The Admin role is locked" });
    }

    if (req.body.permissions !== undefined) {
      const next = sanitize(req.body.permissions);
      const added = next.filter((p) => !role.permissions.includes(p));
      if (notGrantable(req, added).length) {
        return res
          .status(403)
          .json({ message: "You can only grant permissions you have yourself" });
      }
      role.permissions = next;
    }

    if (req.body.description !== undefined) {
      role.description = req.body.description?.trim();
    }

    if (!role.isSystem) {
      if (req.body.name !== undefined) {
        const name = req.body.name.trim();
        if (!name) return res.status(400).json({ message: "Role name is required" });
        role.name = name; // key stays stable so assigned users keep working
      }
      if (req.body.baseRole) {
        role.baseRole = req.body.baseRole === "MANAGER" ? "MANAGER" : "EMPLOYEE";
      }
    }

    await role.save();
    const count = await User.countDocuments({
      $or: [{ roleKey: role.key }, { roleKey: null, role: role.key }],
    });

    res.json(shape(role, { [role.key]: count }));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });

    if (role.isSystem) {
      return res.status(400).json({ message: "Built-in roles cannot be deleted" });
    }

    const assigned = await User.countDocuments({ roleKey: role.key });
    if (assigned > 0) {
      return res.status(400).json({
        message: `${assigned} user(s) still have this role. Reassign them first.`,
      });
    }

    await role.deleteOne();
    res.json({ message: "Role deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
