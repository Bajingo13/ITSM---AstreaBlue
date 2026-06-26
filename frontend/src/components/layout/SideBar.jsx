import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Briefcase,
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
  RotateCcw,
  Settings,
  Shield,
  Ticket,
  UserCog,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";

const coreModuleItems = [
  {
    label: "Service Desk & Ticketing",
    icon: Ticket,
    children: [
      { label: "Incident Management", icon: AlertTriangle, path: "/tickets" },
      { label: "Service Request Management", icon: ClipboardList, path: "/service-requests" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
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
      { label: "Dependency Mapping", icon: GitBranch, path: "/dependency-map" },
      { label: "Change Impact Analysis", icon: AlertTriangle, path: "/change-impact" },
    ],
  },
  {
    label: "Change & Release Management",
    icon: GitBranch,
    children: [
      { label: "Change Request Workflow", icon: ClipboardList, path: "/change-management" },
      { label: "Release Planning", icon: Briefcase, path: "/release-planning" },
      { label: "Rollback Procedures", icon: RotateCcw, path: "/rollback-procedures" },
    ],
  },
  {
    label: "Problem Management",
    icon: AlertTriangle,
    children: [
      { label: "Root Cause Analysis", icon: GitBranch, path: "/root-cause-analysis" },
      { label: "Known Error Database", icon: Database, path: "/known-errors" },
      { label: "Trend Analysis", icon: BarChart3, path: "/trend-analysis" },
    ],
  },
  {
    label: "Reporting & Analytics",
    icon: BarChart3,
    children: [
      { label: "Executive Dashboards", icon: LayoutDashboard, path: "/analytics" },
      { label: "Custom Reports", icon: FileText, path: "/custom-reports" },
      { label: "Predictive Analytics", icon: Activity, path: "/predictive-analytics" },
    ],
  },
  { label: "System Configuration", icon: Settings, path: "/system-configuration" },
  {
    label: "Laptop Activity Monitoring",
    icon: Monitor,
    children: [
      { label: "User Activity Tracking", icon: Activity, path: "/endpoint-monitoring" },
      { label: "Endpoint Data Collection", icon: HardDrive, path: "/endpoint-data-collection" },
      { label: "Screenshot Capture", icon: Monitor, path: "/screenshot-capture" },
      { label: "USB & DLP Monitoring", icon: Shield, path: "/usb-dlp-monitoring" },
      { label: "Network Traffic Analysis", icon: GitBranch, path: "/network-traffic" },
      { label: "Productivity Analytics", icon: BarChart3, path: "/productivity-analytics" },
      { label: "Alert & Escalation Engine", icon: AlertTriangle, path: "/alert-escalation-engine" },
      { label: "RA 10173 Compliance", icon: Shield, path: "/ra-10173-compliance" },
    ],
  },
  {
    label: "System Administration",
    icon: UserCog,
    children: [
      { label: "User & Role Management", icon: UserCog, path: "/settings/users" },
      { label: "Branch Management", icon: GitBranch, path: "/settings/branches" },
      { label: "System Configuration", icon: Settings, path: "/settings" },
      { label: "Audit Logging", icon: FileText, path: "/audit-logging" },
      { label: "Backup & Recovery", icon: RotateCcw, path: "/backup-recovery" },
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
      { label: "My Assigned Tickets", icon: Ticket, path: "/technician/my-assigned-tickets" },
      { label: "Resolved Tickets", icon: Activity, path: "/technician/resolved-tickets" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
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
  const itemPath = item.label === "Dashboard" ? dashboardPath : item.path;
  const [open, setOpen] = useState(
    item.children?.some((child) => child.path === location.pathname) || false
  );

  const hasActiveChild =
    item.children?.some((child) => location.pathname === child.path) || false;
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
        title={collapsed ? item.label : undefined}
        className={`astrea-nav-item flex items-center gap-3 rounded-xl px-3 py-3 transition-all ${
          isActive
            ? "astrea-nav-active text-white"
            : "text-[#F4F8FF] hover:bg-white/12 hover:text-white"
        }`}
      >
        <Icon size={18} className="shrink-0 text-[#F4F8FF]" />
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
            : "text-[#F4F8FF] hover:bg-white/12 hover:text-white"
        }`}
      >
        <Icon size={18} className="shrink-0 text-[#F4F8FF]" />

        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left text-sm font-semibold">
              {item.label}
            </span>
            <ChevronRightSmall
              size={14}
              className={`text-[#BFD2FF] transition-transform ${
                open ? "rotate-90" : ""
              }`}
            />
          </>
        )}
      </button>

      {!collapsed && open && (
        <div className="ml-4 mt-1 space-y-1 border-l border-white/20 pl-3">
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            const childActive = location.pathname === child.path;

            return (
              <Link
                key={child.path}
                to={child.path}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                  childActive
                    ? "bg-white/18 text-white"
                    : "text-[#BFD2FF] hover:bg-white/12 hover:text-white"
                }`}
              >
                <ChildIcon size={15} className="shrink-0 text-[#BFD2FF]" />
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
        background:
          "linear-gradient(180deg, #071A3A 0%, #0D2D66 45%, #1454D9 100%)",
        borderRight: "1px solid rgba(255,255,255,0.22)",
      }}
    >
      <div className="relative flex min-h-[86px] items-center justify-center border-b border-white/15 px-4 py-3">
        {collapsed ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/20 bg-white/95 shadow-lg shadow-black/20">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue"
              className="h-8 w-8 object-contain"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-[18px] border border-white/20 bg-white/10 px-4 py-3 text-center shadow-lg shadow-black/15 backdrop-blur-sm">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue"
              className="h-14 max-w-[205px] rounded-xl bg-white/90 px-2 py-1 object-contain shadow-sm"
            />
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#BFD2FF]">
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

      <div className="border-t border-white/15 p-2.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm text-[#F4F8FF] transition hover:bg-white/18 hover:text-white"
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
