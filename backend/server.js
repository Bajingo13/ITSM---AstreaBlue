const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

if (process.env.NODE_ENV === "production" && !String(process.env.JWT_SECRET || "").trim()) {
  throw new Error("JWT_SECRET is required in production.");
}

const authRoutes = require("./src/routes/auth");
require("./src/services/slaCron");
const dashboardRoutes = require("./src/routes/dashboard");
const slaRoutes = require("./src/routes/sla");
const inviteRoutes = require("./src/routes/invites");
const emailRoutes = require("./src/routes/email");
const assetManagementRoutes = require("./src/routes/assetManagement");
const laptopMonitoringRoutes = require("./src/routes/laptopMonitoring");
const attachmentRoutes = require("./src/routes/attachments");
const ticketRoutes = require("./src/routes/tickets");
const integrationGatewayRoutes = require("./src/routes/integrationGateway");
const integrationManagementRoutes = require("./src/routes/integrations");
const notificationRoutes = require("./src/routes/notifications");
const ra10173ComplianceRoutes = require("./src/routes/ra10173Compliance");
const consentRoutes = require("./src/routes/consent");
const onboardingRoutes = require("./src/routes/onboarding");
const employeeLifecycleRoutes = require("./src/routes/employeeLifecycle");
const cmdbRoutes = require("./src/routes/cmdb");
const projectAnalyticsRoutes = require("./src/routes/projectAnalytics");
const analyticsCenterRoutes = require("./src/routes/analyticsCenter");
const replacementRequestRoutes = require("./src/routes/replacementRequests");
const calendarRoutes = require("./src/routes/calendar");
const reportExportRoutes = require("./src/routes/reportExports");
const branchRoutes = require("./src/routes/branches");
const userRoutes = require("./src/routes/users");
const roleRoutes = require("./src/routes/roles");
const technicianRoutes = require("./src/routes/technicians");
const ticketCategoryRoutes = require("./src/routes/ticketCategories");
const knowledgeBaseRoutes = require("./src/routes/knowledgeBase");
const softwareLicenseRoutes = require("./src/routes/softwareLicenses");
const serviceRequestRoutes = require("./src/routes/serviceRequests");
const aiAssistantRoutes = require("./src/routes/aiAssistant");
const createHardwareAssetRoutes = require("./src/routes/hardwareAssets");
const { setSocketServer } = require("./src/services/socketService");
const { startScreenshotRetentionJob } = require("./src/services/screenshotRetentionService");
const { startSoftwareLicenseReminderJob } = require("./src/services/softwareLicenseReminderService");
const onboardingAccessGuard = require("./src/middleware/onboardingAccessGuard");

const app = express();
startScreenshotRetentionJob();
startSoftwareLicenseReminderJob();

const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://frontend-production-4c52.up.railway.app",
    "https://vibrant-healing-production-bb79.up.railway.app",
    "https://itsm-astreablue-production.up.railway.app",
    process.env.FRONTEND_URL,
  ]
    .filter(Boolean)
    .map((origin) => String(origin).trim().replace(/\/$/, ""))
);

const httpServer = http.createServer(app);
let io = null;
try {
  const { Server } = require("socket.io");
  io = new Server(httpServer, {
    cors: {
      origin: [...allowedOrigins],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  setSocketServer(io);
} catch (error) {
  console.warn("Socket.io initialization failed; HTTP API will continue:", error.message);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // Cache-Control is accepted during rolling deployments so older lifecycle
  // bundles cannot be blocked at the browser preflight before the API runs.
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "Cache-Control"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "3mb" }));

// Catch malformed JSON bodies — return 400, not 500
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON in request body.",
    });
  }
  next(err);
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const { legacySchemaReady, hardwareAssetTablesReady } = require("./src/services/schemaCompatibilityService");

/* ==========================
   AUTH ROUTES
========================== */

app.use("/api/auth", authRoutes);
app.use("/api/v1", async (_req, res, next) => {
  if (await legacySchemaReady) return next();
  return res.status(503).json({ success: false, message: "Database initialization is still unavailable." });
});
app.use("/api/v1", onboardingAccessGuard);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/sla", slaRoutes);
app.use("/api/v1/invites", inviteRoutes);
app.use("/api/v1/email", emailRoutes);
app.use("/api/v1/hardware-assets", async (_req, res, next) => {
  if (await hardwareAssetTablesReady) return next();
  return res.status(503).json({ success: false, message: "Hardware asset storage is unavailable." });
}, assetManagementRoutes);
// Endpoint Management is the evolved parent module for endpoint registration,
// inventory, monitoring, policies, compliance, and health. Keep the legacy
// Laptop Monitoring path as a compatibility alias for existing agents/clients.
app.use("/api/v1/endpoint-management", laptopMonitoringRoutes);
app.use("/api/v1/endpoints", laptopMonitoringRoutes);
app.use("/api/v1/laptop-monitoring", laptopMonitoringRoutes);
app.use("/api/v1/ra-10173-compliance", ra10173ComplianceRoutes);
app.use("/api/v1/tickets", attachmentRoutes);
app.use("/api/v1/tickets", ticketRoutes);
app.use("/api/v1/external", integrationGatewayRoutes);
app.use("/api/v1/integrations", integrationManagementRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/consent", consentRoutes);
app.use("/api/v1/onboarding", onboardingRoutes);
app.use("/api/v1/employee-lifecycle", employeeLifecycleRoutes);
app.use("/api/v1/cmdb", cmdbRoutes);
app.use("/api/v1/projects", projectAnalyticsRoutes);
app.use("/api/v1/analytics", analyticsCenterRoutes);
app.use("/api/v1/calendar", calendarRoutes);
app.use("/api/v1/report-exports", reportExportRoutes);
app.use("/api/v1/replacement-requests", replacementRequestRoutes);
app.use("/api/v1/branches", branchRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/technicians", technicianRoutes);
app.use("/api/v1/ticket-categories", ticketCategoryRoutes);
app.use("/api/v1/knowledge-base", knowledgeBaseRoutes);
app.use("/api/v1/ai-assistant", aiAssistantRoutes);
app.use("/api/v1/software-licenses", softwareLicenseRoutes);
app.use("/api/v1/requests", serviceRequestRoutes);
app.use(
  "/api/v1",
  createHardwareAssetRoutes({ tablesReady: hardwareAssetTablesReady })
);

/* ==========================
   HEALTH CHECK
========================== */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "AstreaBlue API is running",
  });
});

/* ==========================
   KNOWLEDGE BASE
========================== */

/* ==========================
   SERVICE REQUESTS (RBAC)
========================== */

/* ==========================
   START SERVER
========================== */

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`AstreaBlue API active on port ${PORT}`);
  console.log(
    `[AstreaBlue API] health=http://localhost:${PORT}/api/health dashboard=http://localhost:${PORT}/api/v1/dashboard/summary`
  );
  console.log(
    "[AstreaBlue API] mounted routes: /api/auth, /api/v1/dashboard, /api/v1/tickets, /api/v1/branches, /api/v1/users, /api/v1/roles, /api/v1/technicians, /api/v1/ticket-categories, /api/v1/invites, /api/v1/email, /api/v1/knowledge-base, /api/v1/requests, /api/v1/ra-10173-compliance"
  );
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "API route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

module.exports = { app, httpServer, get io() { return io; } };
