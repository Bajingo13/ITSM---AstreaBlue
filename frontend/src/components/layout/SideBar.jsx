import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightSmall,
  ClipboardList,
  Database,
  FileText,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  Monitor,
  Package,
  Plug,
  Settings,
  Shield,
  Ticket,
  UserCog,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { preloadRoute } from "../../routes/lazyViews";

const coreModuleItems = [
  {
    label: "Service Desk & Ticketing",
    icon: Ticket,
    children: [
      { label: "Incident Management", icon: AlertTriangle, path: "/tickets" },
      { label: "Service Request Management", icon: ClipboardList, path: "/service-requests" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
      { label: "Ticket Schedule Calendar", icon: Calendar, path: "/calendar" },
      { label: "SLA Management", icon: Activity, path: "/sla-monitor" },
    ],
  },
  {
    label: "Asset Management",
    icon: Package,
    children: [
      { label: "Hardware Asset Tracking", icon: HardDrive, path: "/assets" },
      { label: "Software License Management", icon: FileText, path: "/software-licenses" },
      { label: "Asset Discovery & Inventory", icon: Monitor, path: "/asset-discovery" },
      { label: "Depreciation & Financial Tracking", icon: BarChart3, path: "/financial-tracking" },
    ],
  },
  {
    label: "Configuration Management (CMDB)",
    icon: Database,
    children: [
      { label: "Configuration Items", icon: Database, path: "/cmdb" },
    ],
  },
  {
    label: "Change & Release",
    icon: GitBranch,
    children: [
      { label: "Change Request Workflow", icon: ClipboardList, path: "/change-management" },
    ],
  },
  {
    label: "Reporting & Analytics",
    icon: BarChart3,
    children: [
      { label: "Executive Dashboard", icon: LayoutDashboard, path: "/analytics" },
      { label: "Operational Analytics", icon: Ticket, path: "/analytics/service-desk" },
      { label: "Asset & Endpoint Analytics", icon: HardDrive, path: "/analytics/assets" },
      { label: "Governance & Compliance", icon: Shield, path: "/analytics/compliance" },
      { label: "Projects & Forecasting", icon: Briefcase, path: "/analytics/projects" },
      { label: "Custom Reports", icon: FileText, path: "/custom-reports" },
    ],
  },
  {
    label: "Endpoint Management",
    icon: Monitor,
    children: [
      { label: "Overview", icon: LayoutDashboard, path: "/endpoint-management" },
      { label: "Devices", icon: Monitor, path: "/endpoint-monitoring?tab=devices" },
      { label: "Inventory", icon: Package, path: "/endpoint-monitoring?tab=software" },
      { label: "Monitoring", icon: Activity, path: "/endpoint-monitoring?tab=activity" },
      { label: "Screenshot Gallery", icon: Monitor, path: "/screenshot-capture" },
      { label: "USB & DLP", icon: HardDrive, path: "/usb-dlp-monitoring" },
      { label: "Security & Compliance", icon: Shield, path: "/consent-management" },
      { label: "Administration", icon: Settings, path: "/endpoint-administration" },
    ],
  },
  {
    label: "System Administration",
    icon: UserCog,
    children: [
      { label: "User & Role Management", icon: UserCog, path: "/settings/users" },
      { label: "Branch Management", icon: GitBranch, path: "/settings/branches" },
      { label: "Integrations", icon: Plug, path: "/settings/integrations" },
      { label: "System Configuration", icon: Settings, path: "/settings" },
    ],
  },
];

const adminCoreModuleItems = coreModuleItems.map((item) => {
  if (item.label !== "System Administration") return item;

  return {
    ...item,
    children: item.children.filter(
      (child) => child.label !== "Branch Management"
    ),
  };
});

const technicianNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/technician/dashboard" },
  {
    label: "Service Desk & Ticketing",
    icon: Ticket,
    children: [
      { label: "Available Tickets", icon: FileText, path: "/technician/available-tickets" },
      { label: "Resolved Tickets", icon: Activity, path: "/technician/resolved-tickets" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
      { label: "Ticket Schedule Calendar", icon: Calendar, path: "/calendar" },
      { label: "SLA Management", icon: Activity, path: "/sla-monitor" },
    ],
  },
];

const employeeNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/employee/dashboard" },
  {
    label: "Service Desk & Ticketing",
    icon: Ticket,
    children: [
      { label: "Incident Management", icon: Ticket, path: "/employee/my-tickets" },
      { label: "Service Request Management", icon: FileText, path: "/employee/create-ticket" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
    ],
  },
  {
    label: "Endpoint Management",
    icon: Monitor,
    children: [
      { label: "General Privacy Record", icon: Shield, path: "/ra-10173-compliance" },
      { label: "Device Monitoring Consent", icon: Shield, path: "/employee/consent" },
    ],
  },
];

function getDashboardPath(role) {
  const normalizedRole = String(role || "").toLowerCase();

  if (normalizedRole === "superadmin") return "/superadmin/dashboard";
  if (normalizedRole === "admin") return "/admin/dashboard";
  if (normalizedRole === "technician") return "/technician/dashboard";
  if (normalizedRole === "employee") return "/employee/dashboard";

  return "/dashboard";
}

function getVisibleNavItems(role) {
  const normalizedRole = String(role || "").toLowerCase();

  const dashboard = {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: getDashboardPath(role),
  };

  if (normalizedRole === "technician") {
    return technicianNavItems;
  }

  if (normalizedRole === "employee") {
    return employeeNavItems;
  }

  if (normalizedRole === "admin") {
    return [dashboard, ...adminCoreModuleItems];
  }

  // SuperAdmin
  return [dashboard, ...coreModuleItems];
}

function NavGroup({ item, collapsed, dashboardPath }) {
  const location = useLocation();
  const currentLocation = `${location.pathname}${location.search}`;
  const itemPath = item.label === "Dashboard" ? dashboardPath : item.path;
  const [open, setOpen] = useState(
    item.children?.some((child) => child.path === currentLocation || child.path === location.pathname) || false
  );

  const hasActiveChild =
    item.children?.some((child) => currentLocation === child.path || location.pathname === child.path) || false;
  const isDashboardActive =
    item.label === "Dashboard" &&
    [
      "/dashboard",
      "/superadmin/dashboard",
      "/admin/dashboard",
      "/technician/dashboard",
      "/employee/dashboard",
    ].includes(location.pathname);
  const isActive = location.pathname === itemPath || hasActiveChild || isDashboardActive;

  if (!item.children) {
    const Icon = item.icon;

    return (
      <Link
        to={itemPath}
        onMouseEnter={() => void preloadRoute(itemPath)}
        onFocus={() => void preloadRoute(itemPath)}
        title={collapsed ? item.label : undefined}
        className={`astrea-nav-item flex items-center gap-3 rounded-xl px-3 py-3 transition-all ${
          isActive
            ? "astrea-nav-active text-white"
            : "text-[#1E2A44] hover:bg-[#EEF6FF] hover:text-[#2563EB]"
        }`}
      >
        <Icon size={18} className="shrink-0 text-[#0B63F6]" />
        {!collapsed && (
          <span className="truncate text-sm font-semibold">{item.label}</span>
        )}
      </Link>
    );
  }

  const Icon = item.icon;

  return (
    <div>
      <button
        onClick={() => setOpen((prev) => !prev)}
        title={collapsed ? item.label : undefined}
        className={`astrea-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-3 transition-all ${
          isActive
            ? "astrea-nav-active text-white"
            : "text-[#1E2A44] hover:bg-[#EEF6FF] hover:text-[#2563EB]"
        }`}
      >
        <Icon size={18} className="shrink-0 text-[#0B63F6]" />

        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left text-sm font-semibold">
              {item.label}
            </span>
            <ChevronRightSmall
              size={14}
              className={`text-[#0B63F6] transition-transform ${
                open ? "rotate-90" : ""
              }`}
            />
          </>
        )}
      </button>

      {!collapsed && open && (
        <div className="ml-4 mt-1 space-y-1 border-l border-[#BFD7FF] pl-3">
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            const childActive = currentLocation === child.path || location.pathname === child.path;

            return (
              <Link
                key={child.path}
                to={child.path}
                onMouseEnter={() => void preloadRoute(child.path)}
                onFocus={() => void preloadRoute(child.path)}
                title={child.label}
                className={`astrea-nav-child flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                  childActive
                    ? "bg-[#EEF6FF] text-[#2563EB]"
                    : "text-[#64748B] hover:bg-[#EEF6FF] hover:text-[#2563EB]"
                }`}
              >
                <ChildIcon size={15} className="shrink-0 text-[#0B63F6]" />
                <span className="truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SideBar({ collapsed, setCollapsed }) {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role;
  const dashboardPath = getDashboardPath(activeRole);
  const visibleNavItems = getVisibleNavItems(activeRole);

  return (
    <aside
      className={`astrea-sidebar fixed left-0 top-0 z-40 flex h-screen flex-col transition-all duration-300 ${
        collapsed ? "w-[68px]" : "w-[260px]"
      }`}
      style={{
        background: "#FFFFFF",
        borderRight: "1px solid #DCE7F6",
        boxShadow: "8px 0 24px rgba(30, 80, 160, 0.08)",
      }}
    >
      <div className="relative flex min-h-[150px] items-center justify-center border-b border-[#DCE7F6] px-4 py-4">
        {collapsed ? (
          <img
            src="/astrea-blue-logo.png"
            alt="AstreaBlue"
            className="h-10 w-10 object-contain"
          />
        ) : (
          <div className="flex flex-col items-center text-center">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue"
              className="h-20 max-w-[210px] object-contain"
            />
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.36em] text-[#64748B]">
              Enterprise ITSM
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-4">
        {visibleNavItems.map((item) => (
          <NavGroup
            key={item.path || item.label}
            item={item}
            collapsed={collapsed}
            dashboardPath={dashboardPath}
          />
        ))}
      </nav>

      <div className="border-t border-[#DCE7F6] p-2.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="astrea-sidebar-toggle flex w-full items-center justify-center gap-2 rounded-xl border border-[#BFD7FF] bg-white px-3 py-2.5 text-sm text-[#2563EB] transition hover:bg-[#EEF6FF]"
        >
          {collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs font-semibold">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
