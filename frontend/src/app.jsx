import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./login";
import ProtectedRoute from "./context/ProtectedRoute";
import MainLayout from "./components/layout/MainLayout";

import Dashboard from "./views/Dashboard";
import AdminDashboard from "./views/AdminDashboard";
import TechnicianDashboard from "./views/TechnicianDashboard";
import EmployeeDashboard from "./views/EmployeeDashboard";

import Tickets from "./views/Tickets";
import KnowledgeBase from "./views/KnowledgeBase";
import Assets from "./views/Assets";
import CMDB from "./views/CMDB";
import ChangeManagement from "./views/ChangeManagement";
import ProblemManagement from "./views/ProblemManagement";
import Analytics from "./views/Analytics";
import EndpointMonitoring from "./views/EndpointMonitoring";
import Settings from "./views/Settings";
import UserManagement from "./views/UserManagement";
import BranchManagement from "./views/BranchManagement";

const ALL_ROLES = ["SuperAdmin", "Admin", "Technician", "Employee"];
const ADMIN_ROLES = ["SuperAdmin", "Admin"];

function ServiceCatalog() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black text-slate-900">Service Catalog</h1>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">Service Catalog module coming soon.</p>
      </div>
    </div>
  );
}

function SLAMonitor() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black text-slate-900">SLA Monitor</h1>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-600">SLA monitoring module coming soon.</p>
      </div>
    </div>
  );
}

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
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute allowedRoles={ALL_ROLES}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
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
              <AdminDashboard />
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
              <TechnicianDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/available"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <TechnicianDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/assigned"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <TechnicianDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technician/resolved"
          element={
            <ProtectedRoute allowedRoles={["Technician"]}>
              <TechnicianDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/dashboard"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/create-ticket"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-tickets"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/tickets"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin", "Technician"]}>
              <Tickets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/service-catalog"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin", "Employee"]}>
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
            <ProtectedRoute allowedRoles={["SuperAdmin", "Admin"]}>
              <SLAMonitor />
            </ProtectedRoute>
          }
        />

        <Route
          path="/assets"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Assets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/software-licenses"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Assets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/asset-discovery"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Assets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/financial-tracking"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Assets />
            </ProtectedRoute>
          }
        />

        <Route
          path="/cmdb"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <CMDB />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dependency-map"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <CMDB />
            </ProtectedRoute>
          }
        />
        <Route
          path="/change-impact"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <CMDB />
            </ProtectedRoute>
          }
        />

        <Route
          path="/change-management"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <ChangeManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/release-planning"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <ChangeManagement />
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
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <ProblemManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/root-cause-analysis"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <ProblemManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/known-errors"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <ProblemManagement />
            </ProtectedRoute>
          }
        />

        <Route
          path="/analytics"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/report-builder"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-insights"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <Analytics />
            </ProtectedRoute>
          }
        />

        <Route
          path="/endpoint-monitoring"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/device-status"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/network-traffic"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dlp-security"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <EndpointMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ra-10173-compliance"
          element={
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <EndpointMonitoring />
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
            <ProtectedRoute allowedRoles={["SuperAdmin"]}>
              <BranchManagement />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
