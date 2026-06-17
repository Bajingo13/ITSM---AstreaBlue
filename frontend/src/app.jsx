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
          <ProtectedRoute allowedRoles={["Admin", "Technician", "Employee"]}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/tickets" element={<Tickets />} />
        <Route path="/knowledge-base" element={<KnowledgeBase />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/cmdb" element={<CMDB />} />
        <Route path="/change-management" element={<ChangeManagement />} />
        <Route path="/problem-management" element={<ProblemManagement />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/endpoint-monitoring" element={<EndpointMonitoring />} />
        <Route path="/settings" element={<Settings />} />

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
          path="/employee/dashboard"
          element={
            <ProtectedRoute allowedRoles={["Employee"]}>
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}