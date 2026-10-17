const User = require("../models/User");
const { permissionsFor } = require("../utils/rbac");

// can("users.view")            -> needs that permission
// can("users.edit", "users.delete") -> needs ANY of them
// Must run after authMiddleware. Sets req.perms and req.isAdmin.
module.exports =
  (...required) =>
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).select(
        "role roleKey permissions status",
      );

      if (!user || user.status === "INACTIVE") {
        return res.status(403).json({ message: "Account is unavailable" });
      }

      req.perms = await permissionsFor(user);
      req.isAdmin = user.role === "ADMIN";

      if (required.length && !required.some((p) => req.perms.includes(p))) {
        return res.status(403).json({ message: "Access Denied" });
      }

      next();
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  };
