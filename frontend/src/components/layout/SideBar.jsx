import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Ticket,
  Package,
  Database,
  GitBranch,
  Bug,
  BarChart3,
  Monitor,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightSmall,
  BookOpen,
  Shield,
  Activity,
  Cpu,
  FileText,
  Layers,
  Wrench,
  AlertTriangle,
  Network,
  HardDrive,
  Globe,
  Lock,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";

const adminNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  {
    label: "Service Desk",
    icon: Ticket,
    children: [
      { label: "All Tickets", icon: FileText, path: "/tickets" },
      { label: "Service Catalog", icon: Layers, path: "/service-catalog" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
      { label: "SLA Monitor", icon: Activity, path: "/sla-monitor" },
    ],
  },
  {
    label: "Asset Management",
    icon: Package,
    children: [
      { label: "Hardware Assets", icon: HardDrive, path: "/assets" },
      { label: "Software Licenses", icon: FileText, path: "/software-licenses" },
      { label: "Asset Discovery", icon: Globe, path: "/asset-discovery" },
      { label: "Financial Tracking", icon: BarChart3, path: "/financial-tracking" },
    ],
  },
  {
    label: "CMDB",
    icon: Database,
    children: [
      { label: "Config Items", icon: Cpu, path: "/cmdb" },
      { label: "Dependency Map", icon: Network, path: "/dependency-map" },
      { label: "Change Impact", icon: AlertTriangle, path: "/change-impact" },
    ],
  },
  {
    label: "Change & Release",
    icon: GitBranch,
    children: [
      { label: "Change Requests", icon: Wrench, path: "/change-management" },
      { label: "Release Planning", icon: Layers, path: "/release-planning" },
      { label: "Change Calendar", icon: LayoutDashboard, path: "/change-calendar" },
    ],
  },
  {
    label: "Problem Mgmt",
    icon: Bug,
    children: [
      { label: "Problems", icon: AlertTriangle, path: "/problem-management" },
      { label: "Root Cause Analysis", icon: Network, path: "/root-cause-analysis" },
      { label: "Known Errors", icon: Database, path: "/known-errors" },
    ],
  },
  {
    label: "Analytics",
    icon: BarChart3,
    children: [
      { label: "Executive Dashboard", icon: LayoutDashboard, path: "/analytics" },
      { label: "Report Builder", icon: FileText, path: "/report-builder" },
      { label: "AI Insights", icon: Activity, path: "/ai-insights" },
    ],
  },
  {
    label: "Endpoint Monitor",
    icon: Monitor,
    children: [
      { label: "User Activity", icon: Activity, path: "/endpoint-monitoring" },
      { label: "Device Status", icon: HardDrive, path: "/device-status" },
      { label: "Network Traffic", icon: Network, path: "/network-traffic" },
      { label: "DLP & Security", icon: Lock, path: "/dlp-security" },
      { label: "RA 10173 Compliance", icon: Shield, path: "/ra-10173-compliance" },
    ],
  },
  { label: "System Config", icon: Settings, path: "/settings" },
];

const technicianNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/technician/dashboard" },
  {
    label: "My Work",
    icon: Ticket,
    children: [
      { label: "Available Tickets", icon: FileText, path: "/technician/dashboard" },
      { label: "My Assigned Tickets", icon: Ticket, path: "/technician/dashboard" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
      { label: "SLA Monitor", icon: Activity, path: "/sla-monitor" },
    ],
  },
  {
    label: "Assets",
    icon: Package,
    children: [
      { label: "Hardware Assets", icon: HardDrive, path: "/assets" },
    ],
  },
  {
    label: "Problem Mgmt",
    icon: Bug,
    children: [
      { label: "Problems", icon: AlertTriangle, path: "/problem-management" },
      { label: "Known Errors", icon: Database, path: "/known-errors" },
    ],
  },
  {
    label: "Endpoint Monitor",
    icon: Monitor,
    children: [
      { label: "User Activity", icon: Activity, path: "/endpoint-monitoring" },
      { label: "Device Status", icon: HardDrive, path: "/device-status" },
    ],
  },
];

const employeeNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/employee/dashboard" },
  {
    label: "Service Portal",
    icon: Ticket,
    children: [
      { label: "Service Catalog", icon: Layers, path: "/service-catalog" },
      { label: "Create Ticket", icon: FileText, path: "/create-ticket" },
      { label: "My Tickets", icon: Ticket, path: "/my-tickets" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
    ],
  },
];

function getDashboardPath(role) {
  const normalizedRole = String(role || "").toLowerCase();

  if (normalizedRole === "technician") return "/technician/dashboard";
  if (normalizedRole === "employee") return "/employee/dashboard";
  if (normalizedRole === "admin") return "/admin/dashboard";

  return "/dashboard";
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
    ["/dashboard", "/admin/dashboard", "/technician/dashboard", "/employee/dashboard"].includes(
      location.pathname
    );
  const isActive = location.pathname === itemPath || hasActiveChild || isDashboardActive;

  if (!item.children) {
    const Icon = item.icon;

    return (
      <Link
        to={itemPath}
        title={collapsed ? item.label : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-all ${
          isActive
            ? "bg-blue-600/30 text-white shadow-lg shadow-blue-900/20"
            : "text-sky-100 hover:bg-blue-600/15 hover:text-white"
        }`}
      >
        <Icon size={18} className="shrink-0 text-sky-300" />
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
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 transition-all ${
          isActive
            ? "bg-blue-600/20 text-white"
            : "text-sky-100 hover:bg-blue-600/15 hover:text-white"
        }`}
      >
        <Icon size={18} className="shrink-0 text-sky-300" />

        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left text-sm font-semibold">
              {item.label}
            </span>
            <ChevronRightSmall
              size={14}
              className={`text-sky-400 transition-transform ${
                open ? "rotate-90" : ""
              }`}
            />
          </>
        )}
      </button>

      {!collapsed && open && (
        <div className="ml-4 mt-1 space-y-1 border-l border-blue-500/20 pl-3">
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            const childActive = location.pathname === child.path;

            return (
              <Link
                key={child.label}
                to={child.path}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all ${
                  childActive
                    ? "bg-blue-600/25 text-white"
                    : "text-sky-200 hover:bg-blue-600/15 hover:text-white"
                }`}
              >
                <ChildIcon size={15} className="shrink-0 text-sky-300" />
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
  const normalizedRole = String(activeRole || "").toLowerCase();
  const dashboardPath = getDashboardPath(activeRole);
  const visibleNavItems =
    normalizedRole === "employee"
      ? employeeNavItems
      : normalizedRole === "technician"
      ? technicianNavItems
      : adminNavItems;

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col transition-all duration-300 ${
        collapsed ? "w-[68px]" : "w-[260px]"
      }`}
      style={{
        background:
          "linear-gradient(180deg, #07102E 0%, #060D25 50%, #050920 100%)",
        borderRight: "1px solid rgba(37,99,235,0.18)",
      }}
    >
      <div className="flex min-h-[78px] items-center justify-center border-b border-blue-500/15 px-4 py-3">
        {collapsed ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 shadow-lg shadow-blue-700/20">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue"
              className="h-8 w-8 object-contain"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue"
              className="h-11 max-w-[190px] object-contain"
            />
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
              Enterprise ITSM
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-4">
        {visibleNavItems.map((item) => (
          <NavGroup
            key={item.label}
            item={item}
            collapsed={collapsed}
            dashboardPath={dashboardPath}
          />
        ))}
      </nav>

      <div className="border-t border-blue-500/15 p-2.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600/10 px-3 py-2.5 text-sm text-sky-300 transition hover:bg-blue-600/20 hover:text-white"
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
