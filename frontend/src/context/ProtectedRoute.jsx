import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useDeployment } from "./DeploymentContext";

export default function ProtectedRoute({ children, allowedRoles, requiredCapability }) {
  const { user, loading } = useAuth();
  const { loading: deploymentLoading, hasCapability } = useDeployment();
  const location = useLocation();

  if (loading || deploymentLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const role = (user?.role_name || user?.role || "").toString();
  const normalizedRole = role.trim().toLowerCase();

  if (normalizedRole === "employee" && user.must_complete_onboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }

  if (
    allowedRoles &&
    !allowedRoles.some((r) => (r || "").toString().trim().toLowerCase() === normalizedRole)
  ) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requiredCapability && !hasCapability(requiredCapability)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}
