import { lazy } from "react";
import { recoverFromStaleChunk } from "../services/chunkRecovery";

// Keep page modules out of the initial application bundle. Each page is loaded
// only when its route is opened, while shared layout/auth code stays warm.
export const Dashboard = lazy(() => import("../views/Dashboard"));
export const SoftwareLicenses = lazy(() => import("../views/SoftwareLicenses"));
export const AdminDashboard = lazy(() => import("../views/AdminDashboard"));
export const TechnicianDashboard = lazy(() => import("../views/TechnicianDashboard"));
export const EmployeeDashboard = lazy(() => import("../views/EmployeeDashboard"));
export const SuperAdminDashboard = lazy(() => import("../views/SuperAdminDashboard"));
export const AvailableTickets = lazy(() => import("../views/AvailableTickets"));
export const MyAssignedTickets = lazy(() => import("../views/MyAssignedTickets"));
export const ResolvedTickets = lazy(() => import("../views/ResolvedTickets"));
export const CreateTicket = lazy(() => import("../views/CreateTicket"));
export const MyTickets = lazy(() => import("../views/MyTickets"));
export const Tickets = lazy(() => import("../views/Tickets"));
export const ServiceCatalog = lazy(() => import("../views/ServiceCatalog"));
export const KnowledgeBase = lazy(() => import("../views/KnowledgeBase"));
export const SLAMonitor = lazy(() => import("../views/SLAMonitor"));
export const Assets = lazy(() => import("../views/Assets"));
export const AssetDiscovery = lazy(() => import("../views/AssetDiscovery"));
export const AssetFinancials = lazy(() => import("../views/AssetFinancials"));
export const CMDB = lazy(() => import("../views/CMDB"));
export const ProblemManagement = lazy(() => import("../views/ProblemManagement"));
export const Analytics = lazy(() => import("../views/Analytics"));
export const EndpointPolicies = lazy(() => import("../views/EndpointPolicies"));
export const EndpointMonitoring = lazy(() => import("../views/EndpointMonitoring"));
export const EndpointAgentAdministration = lazy(() => import("../views/EndpointAgentAdministration"));
export const Settings = lazy(() => import("../views/Settings"));
export const UserManagement = lazy(() => import("../views/UserManagement"));
export const BranchManagement = lazy(() => import("../views/BranchManagement"));
export const Integrations = lazy(() => import("../views/Integrations"));
export const InviteRegistration = lazy(() => import("../views/InviteRegistration"));
export const RA10173Compliance = lazy(() => import("../views/RA10173Compliance"));
export const ModulePlaceholder = lazy(() => import("../views/ModulePlaceholder"));
export const NotificationTicketDetails = lazy(() => import("../views/NotificationTicketDetails"));
export const ConsentPage = lazy(() => import("../views/ConsentPage"));
export const ConsentManagement = lazy(() => import("../views/ConsentManagement"));
export const ScreenshotCapture = lazy(() => import("../views/ScreenshotCapture"));
export const UsbDlpMonitoring = lazy(() => import("../views/UsbDlpMonitoring"));
export const MandatoryOnboarding = lazy(() => import("../views/MandatoryOnboarding"));
export const ReplacementRequests = lazy(() => import("../views/ReplacementRequests"));
export const AdvancedProjectDashboard = lazy(() => import("../views/AdvancedProjectDashboard"));
export const ExecutiveOperationsDashboard = lazy(() => import("../views/ExecutiveOperationsDashboard"));
export const AnalyticsSection = lazy(() => import("../views/AnalyticsSection"));
export const PredictiveAnalytics = lazy(() => import("../views/PredictiveAnalytics"));
export const CustomReports = lazy(() => import("../views/CustomReports"));
export const Calendar = lazy(() => import("../views/Calendar"));

const routePreloaders = {
  "/tickets": () => import("../views/Tickets"),
  "/service-requests": () => import("../views/ServiceCatalog"),
  "/knowledge-base": () => import("../views/KnowledgeBase"),
  "/sla-monitor": () => import("../views/SLAMonitor"),
  "/assets": () => import("../views/Assets"),
  "/software-licenses": () => import("../views/SoftwareLicenses"),
  "/asset-discovery": () => import("../views/AssetDiscovery"),
  "/financial-tracking": () => import("../views/AssetFinancials"),
  "/cmdb": () => import("../views/CMDB"),
  "/replacement-requests": () => import("../views/ReplacementRequests"),
  "/analytics": () => import("../views/ExecutiveOperationsDashboard"),
  "/analytics/service-desk": () => import("../views/AnalyticsSection"),
  "/analytics/assets": () => import("../views/AnalyticsSection"),
  "/analytics/compliance": () => import("../views/AnalyticsSection"),
  "/analytics/projects": () => import("../views/AdvancedProjectDashboard"),
  "/custom-reports": () => import("../views/CustomReports"),
  "/endpoint-management": () => import("../views/EndpointMonitoring"),
  "/endpoint-monitoring": () => import("../views/EndpointMonitoring"),
  "/consent-management": () => import("../views/ConsentManagement"),
  "/endpoint-administration": () => import("../views/EndpointAgentAdministration"),
  "/settings/users": () => import("../views/UserManagement"),
  "/settings/branches": () => import("../views/BranchManagement"),
  "/settings/integrations": () => import("../views/Integrations"),
  "/settings": () => import("../views/Settings"),
  "/technician/dashboard": () => import("../views/TechnicianDashboard"),
  "/technician/available-tickets": () => import("../views/AvailableTickets"),
  "/technician/my-assigned-tickets": () => import("../views/MyAssignedTickets"),
  "/technician/resolved-tickets": () => import("../views/ResolvedTickets"),
  "/employee/dashboard": () => import("../views/EmployeeDashboard"),
  "/employee/my-tickets": () => import("../views/MyTickets"),
  "/employee/create-ticket": () => import("../views/CreateTicket"),
  "/ra-10173-compliance": () => import("../views/RA10173Compliance"),
  "/employee/consent": () => import("../views/ConsentPage"),
  "/calendar": () => import("../views/Calendar"),
};

export function preloadRoute(path) {
  const pathname = String(path || "").split("?")[0];
  const preload = routePreloaders[pathname];
  if (!preload) return Promise.resolve();
  return preload().catch((error) => {
    if (!recoverFromStaleChunk(error)) {
      console.warn("Route preload failed; navigation will retry the module.", error);
    }
  });
}
