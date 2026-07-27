const jwt = require("jsonwebtoken");

const JWT_SECRET =
  process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";

function getAuthFromRequest(req) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;

    const token = authHeader.split(" ")[1];
    if (!token) return null;

    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuthenticatedRequest(req, res, next) {
  const auth = getAuthFromRequest(req);
  if (!auth?.userId) {
    return res
      .status(401)
      .json({ success: false, error: "Authentication required." });
  }

  req.authenticatedUser = auth;
  return next();
}

function requireSuperAdminRequest(req, res, next) {
  const auth = getAuthFromRequest(req);
  if (!auth?.userId) {
    return res
      .status(401)
      .json({ success: false, error: "Authentication required." });
  }

  const normalizedRole = String(auth.role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");

  if (normalizedRole !== "superadmin") {
    return res
      .status(403)
      .json({ success: false, error: "SuperAdmin access required." });
  }

  req.authenticatedUser = auth;
  return next();
}

module.exports = {
  getAuthFromRequest,
  requireAuthenticatedRequest,
  requireSuperAdminRequest,
};
