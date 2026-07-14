const jwt = require("jsonwebtoken");
const db = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod";
const allowedPrefixes = [
  "/onboarding",
  "/consent",
  "/notifications",
  "/invites",
  "/laptop-monitoring",
  "/endpoint-management",
  "/endpoints",
  "/external",
];

module.exports = async function onboardingAccessGuard(req, res, next) {
  if (allowedPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return next();
  let actor;
  try {
    actor = jwt.verify(header.slice(7), JWT_SECRET);
  } catch (_error) {
    // The route's normal authentication middleware owns invalid-token responses.
    return next();
  }
  try {
    const result = await db.query(
      `SELECT u.onboarding_required,u.onboarding_status,r.role_name
       FROM users u
       LEFT JOIN system_roles r ON r.role_id=u.role_id
       WHERE u.user_id=$1`,
      [actor.userId || actor.user_id]
    );
    const user = result.rows[0];

    // Authorization must use the current database role. JWT role claims can be
    // stale after an administrator changes a user's role, but must never cause
    // a SuperAdmin/Admin to inherit the Employee-only onboarding restriction.
    if (!user || String(user.role_name || "").toLowerCase().replace(/[\s_-]/g, "") !== "employee") {
      return next();
    }

    if (user?.onboarding_required && user.onboarding_status !== "Completed") {
      return res.status(428).json({
        success: false,
        code: "ONBOARDING_REQUIRED",
        message: "Complete mandatory onboarding before accessing this resource.",
        onboarding_status: user.onboarding_status,
      });
    }
    return next();
  } catch (error) {
    console.error("[onboarding-guard] state lookup failed:", error.message);
    return res.status(503).json({
      success: false,
      code: "ONBOARDING_STATE_UNAVAILABLE",
      message: "Onboarding status could not be verified. Access is temporarily locked.",
    });
  }
};
