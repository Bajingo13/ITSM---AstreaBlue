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

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  {
    label: "Service Desk",
    icon: Ticket,
    children: [
      { label: "All Tickets", icon: FileText, path: "/tickets" },
      { label: "Service Catalog", icon: Layers, path: "/tickets" },
      { label: "Knowledge Base", icon: BookOpen, path: "/knowledge-base" },
      { label: "SLA Monitor", icon: Activity, path: "/tickets" },
    ],
  },
  {
    label: "Asset Management",
    icon: Package,
    children: [
      { label: "Hardware Assets", icon: HardDrive, path: "/assets" },
      { label: "Software Licenses", icon: FileText, path: "/assets" },
      { label: "Asset Discovery", icon: Globe, path: "/assets" },
      { label: "Financial Tracking", icon: BarChart3, path: "/assets" },
    ],
  },
  {
    label: "CMDB",
    icon: Database,
    children: [
      { label: "Config Items", icon: Cpu, path: "/cmdb" },
      { label: "Dependency Map", icon: Network, path: "/cmdb" },
      { label: "Change Impact", icon: AlertTriangle, path: "/cmdb" },
    ],
  },
  {
    label: "Change & Release",
    icon: GitBranch,
    children: [
      { label: "Change Requests", icon: Wrench, path: "/change-management" },
      { label: "Release Planning", icon: Layers, path: "/change-management" },
      { label: "Change Calendar", icon: LayoutDashboard, path: "/change-management" },
    ],
  },
  {
    label: "Problem Mgmt",
    icon: Bug,
    children: [
      { label: "Problems", icon: AlertTriangle, path: "/problem-management" },
      { label: "Root Cause Analysis", icon: Network, path: "/problem-management" },
      { label: "Known Errors", icon: Database, path: "/problem-management" },
    ],
  },
  {
    label: "Analytics",
    icon: BarChart3,
    children: [
      { label: "Executive Dashboard", icon: LayoutDashboard, path: "/analytics" },
      { label: "Report Builder", icon: FileText, path: "/analytics" },
      { label: "AI Insights", icon: Activity, path: "/analytics" },
    ],
  },
  {
    label: "Endpoint Monitor",
    icon: Monitor,
    children: [
      { label: "User Activity", icon: Activity, path: "/endpoint-monitoring" },
      { label: "Device Status", icon: HardDrive, path: "/endpoint-monitoring" },
      { label: "Network Traffic", icon: Network, path: "/endpoint-monitoring" },
      { label: "DLP & Security", icon: Lock, path: "/endpoint-monitoring" },
      { label: "RA 10173 Compliance", icon: Shield, path: "/endpoint-monitoring" },
    ],
  },
  { label: "System Config", icon: Settings, path: "/settings" },
];

function NavGroup({ item, collapsed }) {
  const location = useLocation();
  const [open, setOpen] = useState(
    item.children?.some((child) => child.path === location.pathname) || false
  );

  const isActive = item.path === location.pathname;
  const hasActiveChild = item.children?.some(
    (child) => child.path === location.pathname
  );

  if (!item.children) {
    const Icon = item.icon;

    return (
      <Link
        to={item.path}
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
          hasActiveChild
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
            const childActive = child.path === location.pathname;

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
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 shadow-lg shadow-blue-700/30">
            <span className="text-lg font-black text-white">A</span>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-3xl font-black tracking-tight">
              <span className="text-violet-300">Astrea</span>
              <span className="text-blue-400">Blue</span>
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
              Enterprise ITSM
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-4">
        {navItems.map((item) => (
          <NavGroup key={item.label} item={item} collapsed={collapsed} />
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