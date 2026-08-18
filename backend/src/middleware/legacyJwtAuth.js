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

async function requireAuthenticatedRequest(req, res, next) {
  try {
    const { loadCurrentActor } = require("./currentActor");
    const actor = await loadCurrentActor(req);
    if (!actor) {
      return res
        .status(401)
        .json({ success: false, error: "Authentication required." });
    }
    req.authenticatedUser = actor;
    req.currentActor = actor;
    return next();
  } catch (error) {
    console.error("[legacy-auth] Failed to resolve authenticated account:", error.message);
    return res.status(503).json({
      success: false,
      error: "Authorization service is temporarily unavailable.",
    });
  }
}

async function requireSuperAdminRequest(req, res, next) {
  return requireAuthenticatedRequest(req, res, () => {
    if (req.currentActor.role !== "superadmin") {
      return res
        .status(403)
        .json({ success: false, error: "SuperAdmin access required." });
    }
    return next();
  });
}

module.exports = {
  getAuthFromRequest,
  requireAuthenticatedRequest,
  requireSuperAdminRequest,
};
