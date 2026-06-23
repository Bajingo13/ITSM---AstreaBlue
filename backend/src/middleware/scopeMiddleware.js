const normalizeRole = (role = "") => {
  return role.toLowerCase().replace(/[\s_-]/g, "");
};

const isSuperAdmin = (role = "") => {
  const normalized = normalizeRole(role);
  return normalized === "superadmin";
};

export const scopeMiddleware = (req, res, next) => {
  const role = req.user?.role;
  const branchId = req.user?.branchId;

  if (!role) {
    return res.status(403).json({ message: "User role is missing" });
  }

  if (isSuperAdmin(role)) {
    req.branchScope = {};
    return next();
  }

  if (!branchId) {
    return res.status(403).json({
      message: "Branch access denied. User has no branch assigned.",
    });
  }

  req.branchScope = {
    branchId,
  };

  next();
};