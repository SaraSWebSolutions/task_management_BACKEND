const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const { GROUPS, ALL_PERMISSIONS } = require("../config/permissions");
const { ensureSystemRoles, findRole } = require("../utils/rbac");

const STATUSES = ["ACTIVE", "INACTIVE"];
const DESIGNATIONS = User.schema.path("designation").enumValues;
const GENDERS = ["Male", "Female", "Other"];
const MIN_PASSWORD = 8;
const IMAGE_RX = /^data:image\/(png|jpe?g|webp);base64,/;

// Never send HR / bank data from user-management screens.
const PUBLIC_FIELDS =
  "-password -salary -otAmount -bankName -accountNumber -ifscCode -branch";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (v) => (typeof v === "string" ? v.trim() : v);
const isSelf = (req, user) => String(req.user.id) === String(user._id);

const view = (u) => {
  const o = u.toObject ? u.toObject() : u;
  return { ...o, roleKey: o.roleKey || o.role, joinDate: o.joiningDate || o.createdAt };
};

const hasOtherActiveAdmin = async (excludeId) =>
  (await User.countDocuments({
    role: "ADMIN",
    status: { $ne: "INACTIVE" },
    _id: { $ne: excludeId },
  })) > 0;

// Returns { code, message } when the change is not allowed, else null.
// nextRole = base role after the change ("__DELETED__" when removing the user).
const guardChange = async (req, user, nextRole, nextStatus) => {
  if (user.role === "ADMIN" && !req.isAdmin) {
    return { code: 403, message: "Only admins can modify admin accounts" };
  }

  const losesAdmin = user.role === "ADMIN" && nextRole !== "ADMIN";
  const deactivates = user.status !== "INACTIVE" && nextStatus === "INACTIVE";

  if (isSelf(req, user)) {
    if (losesAdmin) return { code: 400, message: "You cannot remove your own admin role" };
    if (deactivates) return { code: 400, message: "You cannot deactivate your own account" };
  }

  if (
    user.role === "ADMIN" &&
    user.status !== "INACTIVE" &&
    (losesAdmin || deactivates) &&
    !(await hasOtherActiveAdmin(user._id))
  ) {
    return { code: 400, message: "At least one active admin is required" };
  }

  return null;
};

// Validates the role picked in the form against the actor's own power.
const resolveRole = async (req, roleKey) => {
  const role = await findRole(roleKey);
  if (!role) return { error: { code: 400, message: "Invalid role" } };

  if (role.baseRole === "ADMIN" && !req.isAdmin) {
    return { error: { code: 403, message: "Only admins can assign the Admin role" } };
  }
  // Only compare permissions that still exist (ignore stale keys on old roles).
  const roleValid = role.permissions.filter((p) => ALL_PERMISSIONS.includes(p));
  if (!req.isAdmin && roleValid.some((p) => !req.perms.includes(p))) {
    return {
      error: { code: 403, message: "You cannot assign a role with more access than you have" },
    };
  }
  return { role };
};

const resolveExtras = (req, perms) => {
  const extras = [...new Set(Array.isArray(perms) ? perms : [])].filter((p) =>
    ALL_PERMISSIONS.includes(p),
  );
  if (!req.isAdmin && extras.some((p) => !req.perms.includes(p))) {
    return { error: { code: 403, message: "You can only grant permissions you have yourself" } };
  }
  return { extras };
};

const fullName = (b) =>
  clean(b.name) || [clean(b.firstName), clean(b.lastName)].filter(Boolean).join(" ");

const buildFilter = (q) => {
  const and = [];
  if (STATUSES.includes(q.status)) {
    and.push(q.status === "INACTIVE" ? { status: "INACTIVE" } : { status: { $ne: "INACTIVE" } });
  }
  if (q.role) and.push({ $or: [{ roleKey: q.role }, { roleKey: null, role: q.role }] });
  if (q.search && q.search.trim()) {
    const rx = new RegExp(escapeRegex(q.search.trim()), "i");
    and.push({
      $or: [{ name: rx }, { email: rx }, { phone: rx }, { employeeId: rx }, { department: rx }],
    });
  }
  return and.length ? { $and: and } : {};
};

exports.getMeta = async (req, res) => {
  try {
    await ensureSystemRoles();
    const roles = await Role.find().sort({ isSystem: -1, createdAt: 1 });
    res.json({
      roles: roles.map((r) => ({
        key: r.key,
        name: r.name,
        baseRole: r.baseRole,
        isSystem: r.isSystem,
        permissions: r.key === "ADMIN" ? ALL_PERMISSIONS : r.permissions,
      })),
      groups: GROUPS,
      totalPermissions: ALL_PERMISSIONS.length,
      designations: DESIGNATIONS,
      statuses: STATUSES,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 8, 1), 100);
    const filter = buildFilter(req.query);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [total, users, all, inactive, newUsers] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(PUBLIC_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(),
      User.countDocuments({ status: "INACTIVE" }),
      User.countDocuments({ createdAt: { $gte: since } }),
    ]);

    res.json({
      users: users.map(view),
      stats: { total: all, active: all - inactive, inactive, newUsers },
      pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.exportUsers = async (req, res) => {
  try {
    const users = await User.find(buildFilter(req.query))
      .select(PUBLIC_FIELDS)
      .sort({ createdAt: -1 })
      .limit(5000);
    res.json({ users: users.map(view) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(PUBLIC_FIELDS);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(view(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const b = req.body;
    const name = fullName(b);
    const email = clean(b.email)?.toLowerCase();
    const status = b.status || "ACTIVE";
    const designation = b.designation || undefined;
    const gender = b.gender || undefined;

    if (!name || !email || !b.password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }
    if (b.password.length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
    }
    if (!STATUSES.includes(status)) return res.status(400).json({ message: "Invalid status" });
    if (designation && !DESIGNATIONS.includes(designation)) {
      return res.status(400).json({ message: "Invalid designation" });
    }
    if (gender && !GENDERS.includes(gender)) return res.status(400).json({ message: "Invalid gender" });
    if (b.profileImage && !IMAGE_RX.test(b.profileImage)) {
      return res.status(400).json({ message: "Profile photo must be a PNG, JPG or WebP image" });
    }

    const { role, error: roleErr } = await resolveRole(req, b.roleKey || "EMPLOYEE");
    if (roleErr) return res.status(roleErr.code).json({ message: roleErr.message });

    const { extras, error: extraErr } = resolveExtras(req, b.permissions);
    if (extraErr) return res.status(extraErr.code).json({ message: extraErr.message });

    const employeeId = clean(b.employeeId) || undefined;
    const exists = await User.findOne({
      $or: [{ email }, ...(employeeId ? [{ employeeId }] : [])],
    });
    if (exists) {
      return res.status(400).json({ message: "A user with this email or employee ID already exists" });
    }

    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(b.password, 10),
      role: role.baseRole,
      roleKey: role.key,
      permissions: role.baseRole === "ADMIN" ? [] : extras,
      status,
      designation,
      employeeId,
      phone: clean(b.phone),
      department: clean(b.department),
      dob: b.dob,
      gender,
      address: clean(b.address),
      city: clean(b.city),
      state: clean(b.state),
      zipCode: clean(b.zipCode),
      country: clean(b.country),
      profileImage: b.profileImage || undefined,
    });

    const { password: _pw, ...safe } = view(user);
    res.status(201).json(safe);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const b = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const nextStatus = b.status ?? user.status;
    if (!STATUSES.includes(nextStatus)) return res.status(400).json({ message: "Invalid status" });
    if (b.designation && !DESIGNATIONS.includes(b.designation)) {
      return res.status(400).json({ message: "Invalid designation" });
    }
    if (b.gender && !GENDERS.includes(b.gender)) return res.status(400).json({ message: "Invalid gender" });
    if (b.profileImage && !IMAGE_RX.test(b.profileImage)) {
      return res.status(400).json({ message: "Profile photo must be a PNG, JPG or WebP image" });
    }

    let nextRole = user.role;
    let nextRoleKey = user.roleKey || user.role;
    if (b.roleKey && b.roleKey !== nextRoleKey) {
      const { role, error } = await resolveRole(req, b.roleKey);
      if (error) return res.status(error.code).json({ message: error.message });
      nextRole = role.baseRole;
      nextRoleKey = role.key;
    }

    const blocked = await guardChange(req, user, nextRole, nextStatus);
    if (blocked) return res.status(blocked.code).json({ message: blocked.message });

    if (b.permissions !== undefined) {
      const { extras, error } = resolveExtras(req, b.permissions);
      if (error) return res.status(error.code).json({ message: error.message });
      user.permissions = nextRole === "ADMIN" ? [] : extras;
    }

    if (b.email !== undefined) {
      const email = clean(b.email).toLowerCase();
      if (!email) return res.status(400).json({ message: "Email is required" });
      if (email !== user.email) {
        if (await User.findOne({ email, _id: { $ne: user._id } })) {
          return res.status(400).json({ message: "Email is already in use" });
        }
        user.email = email;
      }
    }

    if (b.employeeId !== undefined) {
      const employeeId = clean(b.employeeId) || undefined;
      if (employeeId && employeeId !== user.employeeId) {
        if (await User.findOne({ employeeId, _id: { $ne: user._id } })) {
          return res.status(400).json({ message: "Employee ID is already in use" });
        }
      }
      user.employeeId = employeeId;
    }

    if (b.name !== undefined || b.firstName !== undefined) {
      const name = fullName(b);
      if (!name) return res.status(400).json({ message: "Name is required" });
      user.name = name;
    }

    for (const f of ["phone", "department", "address", "city", "state", "zipCode", "country"]) {
      if (b[f] !== undefined) user[f] = clean(b[f]);
    }
    if (b.designation) user.designation = b.designation;
    if (b.dob !== undefined) user.dob = b.dob;
    if (b.gender !== undefined) user.gender = b.gender;
    if (b.profileImage !== undefined) user.profileImage = b.profileImage || undefined;

    user.role = nextRole;
    user.roleKey = nextRoleKey;
    user.status = nextStatus;

    if (b.password) {
      if (b.password.length < MIN_PASSWORD) {
        return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
      }
      user.password = await bcrypt.hash(b.password, 10);
    }

    await user.save();

    const { password: _pw, ...safe } = view(user);
    res.json(safe);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.setUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ message: "Invalid status" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const blocked = await guardChange(req, user, user.role, status);
    if (blocked) return res.status(blocked.code).json({ message: blocked.message });

    user.status = status;
    await user.save();
    res.json({ _id: user._id, status: user.status });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const removeUser = async (req, user) => {
  if (isSelf(req, user)) return { code: 400, message: "You cannot delete your own account" };
  const blocked = await guardChange(req, user, "__DELETED__", "INACTIVE");
  if (blocked) return blocked;
  await user.deleteOne();
  return null;
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const err = await removeUser(req, user);
    if (err) return res.status(err.code).json({ message: err.message });
    res.json({ message: "User deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Applies one action to many users; each user is guarded individually.
exports.bulkAction = async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      return res.status(400).json({ message: "Select between 1 and 100 users" });
    }
    if (!["activate", "deactivate", "delete"].includes(action)) {
      return res.status(400).json({ message: "Invalid bulk action" });
    }
    const needed = action === "delete" ? "users.delete" : "users.edit";
    if (!req.perms.includes(needed)) {
      return res.status(403).json({ message: "Access Denied" });
    }

    let done = 0;
    const failed = [];

    for (const id of ids) {
      const user = await User.findById(id);
      if (!user) continue;

      let err = null;
      if (action === "delete") {
        err = await removeUser(req, user);
      } else {
        const next = action === "activate" ? "ACTIVE" : "INACTIVE";
        err = await guardChange(req, user, user.role, next);
        if (!err) {
          user.status = next;
          await user.save();
        }
      }

      if (err) failed.push({ id, name: user.name, reason: err.message });
      else done += 1;
    }

    res.json({ done, failed });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
