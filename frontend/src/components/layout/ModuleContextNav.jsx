import { BarChart3, Briefcase, ClipboardList, FileText, HardDrive, LayoutDashboard, Shield } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const groups = {
  replacements: {
    label: "Replacement Management workspace",
    items: [
      { label: "Replacement Requests", path: "/replacement-requests", icon: ClipboardList },
    ],
  },
  analytics: {
    label: "Reporting & Analytics workspace",
    items: [
      { label: "Executive", path: "/analytics", icon: LayoutDashboard },
      { label: "Operations", path: "/analytics/service-desk", icon: BarChart3 },
      { label: "Assets & Endpoints", path: "/analytics/assets", icon: HardDrive },
      { label: "Governance", path: "/analytics/compliance", icon: Shield },
      { label: "Projects", path: "/analytics/projects", icon: Briefcase },
      { label: "Custom Reports", path: "/custom-reports", icon: FileText },
    ],
  },
};

export default function ModuleContextNav({ group }) {
  const location = useLocation();
  const context = groups[group];
  if (!context) return null;

  return (
    <nav className="astrea-context-nav astrea-dashboard-enter" aria-label={context.label}>
      <div className="astrea-context-nav-title">
        <span className="astrea-context-nav-mark" />
        <span>{context.label}</span>
      </div>
      <div className="astrea-context-nav-links">
        {context.items.map(({ label, path, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <Link key={path} to={path} className={`astrea-context-link ${active ? "is-active" : ""}`}>
              <Icon size={15} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
