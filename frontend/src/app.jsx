import { Navigate, Route, Routes } from "react-router-dom";
import { Suspense } from "react";
import Login from "./login";
import ProtectedRoute from "./context/ProtectedRoute";
import MainLayout from "./components/layout/MainLayout";

import { ErrorBoundary } from "./components/ErrorBoundary";
import ForgotPassword from "./ForgotPassword";
import ResetPassword from "./ResetPassword";
import {
  AdminDashboard,
  AdvancedProjectDashboard,
  Analytics,
  AnalyticsSection,
  AssetDiscovery,
  AssetFinancials,
  Assets,
  AvailableTickets,
  BranchManagement,
  ChangeManagement,
  CMDB,
  ConsentManagement,
  ConsentPage,
  CreateTicket,
  CustomReports,
  Dashboard,
  EmployeeDashboard,
  EndpointAgentAdministration,
  EndpointMonitoring,
  EndpointPolicies,
  ExecutiveOperationsDashboard,
  Integrations,
  InviteRegistration,
  KnowledgeBase,
  MandatoryOnboarding,
  ModulePlaceholder,
  MyAssignedTickets,
  MyTickets,
  NotificationTicketDetails,
  PredictiveAnalytics,
  ProblemManagement,
  RA10173Compliance,
  ReleasePlanning,
  ResolvedTickets,
  RollbackProcedures,
  ScreenshotCapture,
  ServiceCatalog,
  Settings,
  SLAMonitor,
  SoftwareLicenses,
  SuperAdminDashboard,
  TechnicianDashboard,
  Tickets,
  UserManagement,
  Calendar,
} from "./routes/lazyViews";

const ALL_ROLES = ["SuperAdmin", "Admin", "Technician", "Employee"];
const ADMIN_ROLES = ["SuperAdmin", "Admin"];

function Unauthorized() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="rounded-2xl bg-white p-10 text-center text-slate-900 shadow-2xl">
        <h1 className="text-3xl font-bold">Unauthorized</h1>
        <p className="mt-3 text-slate-500">
          You do not have permission to access this page.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary><Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600"/></div>}><Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<ErrorBoundary><InviteRegistration /></ErrorBoundary>} />
      <Route path="/register-invite/:token" element={<ErrorBoundary><InviteRegistration /></ErrorBoundary>} />
      <Route path="/onboarding" element={<ProtectedRoute allowedRoles={["Employee"]}><MandatoryOnboarding /></ProtectedRoute>} />

      <Route
        element={
          <ProtectedRoute allowedRoles={ALL_ROLES}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/ticket/:ticketId" element={<NotificationTicketDetails />} />
        <Route path="/endpoint-management" element={<EndpointMonitoring />} />
        <Route path="/endpoint-policies" element={<EndpointPolicies />} />
        <Route path="/endpoint-administration" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><EndpointAgentAdministration /></ProtectedRoute>} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/superadmin/dashboard"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <SuperAdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={["Admin"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/dashboard"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <TechnicianDashboard view="dashboard" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/available-tickets"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <AvailableTickets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/my-assigned-tickets"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <MyAssignedTickets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/resolved-tickets"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <ResolvedTickets />
            </ProtectedRoute>
          }
        />
        <Route path="/technician/available" element={<Navigate to="/technician/available-tickets" replace />} />
        <Route path="/technician/assigned" element={<Navigate to="/technician/my-assigned-tickets" replace />} />
        <Route path="/technician/resolved" element={<Navigate to="/technician/resolved-tickets" replace />} />
        <Route
          path="/employee/dashboard"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/create-ticket"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <CreateTicket />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/my-tickets"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <MyTickets />
            </ProtectedRoute>
          }
        />
        <Route path="/create-ticket" element={<Navigate to="/employee/create-ticket" replace />} />
        <Route path="/my-tickets" element={<Navigate to="/employee/my-tickets" replace />} />

        <Route
          path="/tickets"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin", "Technician"]}>
              <Tickets />
            </ProtectedRoute>
          }
        />
        <Route path="/service-catalog" element={<Navigate to="/service-requests" replace />} />
        <Route
          path="/service-requests"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin", "Technician"]}>
              <ServiceCatalog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/knowledge-base"
          element={
            <ProtectedRoute allowedRoles={ALL_ROLES}>
              <KnowledgeBase />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sla-monitor"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin", "Technician"]}>
              <SLAMonitor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin", "Technician"]}>
              <Calendar />
            </ProtectedRoute>
          }
        />

        <Route
          path="/assets"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <Assets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/software-licenses"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin"]}>
              <SoftwareLicenses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/asset-discovery"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <AssetDiscovery />
            </ProtectedRoute>
          }
        />
        <Route
          path="/financial-tracking"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <AssetFinancials />
            </ProtectedRoute>
          }
        />

        <Route
          path="/cmdb"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <CMDB initialTab="config-items" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dependency-map"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <CMDB initialTab="dependency-map" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/change-impact"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <CMDB initialTab="change-impact" />
            </ProtectedRoute>
          }
        />

        <Route
          path="/change-management"
          element={
            <ProtectedRoute allowedRoles={ALL_ROLES}>
              <ChangeManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/release-planning"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ReleasePlanning />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rollback-procedures"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <RollbackProcedures />
            </ProtectedRoute>
          }
        />
        <Route
          path="/change-calendar"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <ChangeManagement />
            </ProtectedRoute>
          }
        />

        <Route
          path="/problem-management"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ProblemManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/root-cause-analysis"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ProblemManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/known-errors"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ProblemManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/trend-analysis"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="Trend Analysis" />
            </ProtectedRoute>
          }
        />

        <Route
          path="/analytics"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ExecutiveOperationsDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/analytics/service-desk" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="service_desk" /></ProtectedRoute>} />
        <Route path="/analytics/problems" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="problems" /></ProtectedRoute>} />
        <Route path="/analytics/assets" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="assets" /></ProtectedRoute>} />
        <Route path="/analytics/endpoints" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="endpoints" /></ProtectedRoute>} />
        <Route path="/analytics/sla" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="sla" /></ProtectedRoute>} />
        <Route path="/analytics/change" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="change" /></ProtectedRoute>} />
        <Route path="/analytics/compliance" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="compliance" /></ProtectedRoute>} />
        <Route path="/analytics/resources" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AnalyticsSection section="resources" /></ProtectedRoute>} />
        <Route
          path="/report-builder"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <CustomReports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/custom-reports"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <CustomReports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/predictive-analytics"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <PredictiveAnalytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-insights"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/system-configuration"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="System Configuration" />
            </ProtectedRoute>
          }
        />

        <Route
          path="/endpoint-management"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/endpoints"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/endpoint-monitoring"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-status"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/endpoint-data-collection"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="Endpoint Data Collection" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/screenshot-capture"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ScreenshotCapture />
            </ProtectedRoute>
          }
        />
        <Route
          path="/usb-dlp-monitoring"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="USB & Device Control" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/network-traffic"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/productivity-analytics"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="Productivity Analytics" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/alert-escalation-engine"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="Endpoint Alerts & Escalation" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dlp-security"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ra-10173-compliance"
          element={
            <ProtectedRoute allowedRoles={ALL_ROLES}>
              <RA10173Compliance />
            </ProtectedRoute>
          }
        />
        <Route
          path="/consent-management"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ConsentManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/consent"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <ConsentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit-logging"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="Audit Logging" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/backup-recovery"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <ModulePlaceholder title="Backup & Recovery" />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/users"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <UserManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/branches"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <BranchManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics/projects"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <AdvancedProjectDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/integrations"
          element={
            <ProtectedRoute allowedRoles={ADMIN_ROLES}>
              <Integrations />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes></Suspense></ErrorBoundary>
  );
}
