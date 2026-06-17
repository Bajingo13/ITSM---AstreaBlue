import {
  Ticket,
  CheckCircle,
  Package,
  GitBranch,
  AlertCircle,
  Activity,
  Cpu,
  Clock,
  RefreshCw,
  Calendar,
  Monitor,
  Server,
  Wifi,
  Shield,
} from "lucide-react";

const stats = [
  {
    title: "Open Tickets",
    value: "247",
    subtitle: "12 critical · 38 high",
    icon: Ticket,
    accent: "#2563EB",
    bg: "#EFF6FF",
    color: "#2563EB",
  },
  {
    title: "SLA Compliance",
    value: "94.7%",
    subtitle: "Target: 95%",
    icon: CheckCircle,
    accent: "#10B981",
    bg: "#ECFDF5",
    color: "#059669",
  },
  {
    title: "Active Assets",
    value: "1,834",
    subtitle: "76.4% utilization",
    icon: Package,
    accent: "#8B5CF6",
    bg: "#F5F3FF",
    color: "#7C3AED",
  },
  {
    title: "Pending Changes",
    value: "18",
    subtitle: "3 require CAB approval",
    icon: GitBranch,
    accent: "#F59E0B",
    bg: "#FFFBEB",
    color: "#D97706",
  },
  {
    title: "Critical Incidents",
    value: "3",
    subtitle: "2 unassigned",
    icon: AlertCircle,
    accent: "#EF4444",
    bg: "#FEF2F2",
    color: "#DC2626",
    alert: true,
  },
  {
    title: "Productivity Score",
    value: "82%",
    subtitle: "Across 312 endpoints",
    icon: Activity,
    accent: "#0EA5E9",
    bg: "#F0F9FF",
    color: "#0284C7",
  },
  {
    title: "Asset Utilization",
    value: "76.4%",
    subtitle: "140 assets idle",
    icon: Cpu,
    accent: "#2563EB",
    bg: "#EFF6FF",
    color: "#1D4ED8",
  },
  {
    title: "Avg Resolution",
    value: "2.4h",
    subtitle: "Down from 2.8h",
    icon: Clock,
    accent: "#8B5CF6",
    bg: "#F5F3FF",
    color: "#7C3AED",
  },
];

const recentTickets = [
  ["Outlook not syncing emails on multiple workstations", "TKT-2026-0847", "High", "In Progress"],
  ["VPN connection drops every 30 minutes", "TKT-2026-0846", "Critical", "Open"],
  ["Request for Adobe Creative Cloud license", "TKT-2026-0845", "Medium", "Pending"],
  ["Printer offline in 3rd floor HR office", "TKT-2026-0844", "Low", "Resolved"],
  ["New employee onboarding - laptop setup", "TKT-2026-0843", "Medium", "In Progress"],
];

function KPICard({ item }) {
  const Icon = item.icon;

  return (
    <div
      className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 transition hover:-translate-y-1 hover:shadow-lg"
      style={{ borderTop: `4px solid ${item.accent}` }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: item.bg }}
        >
          <Icon size={21} style={{ color: item.color }} />
        </div>

        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600">
          Live
        </span>
      </div>

      <div className="mt-5">
        <h3 className={`text-3xl font-black ${item.alert ? "text-red-600" : "text-slate-950"}`}>
          {item.value}
        </h3>
        <p className="mt-1 font-semibold text-slate-700">{item.title}</p>
        <p className="mt-1 text-sm text-slate-400">{item.subtitle}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-8 text-white shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-black">IT Service Management Dashboard</h1>
            <div className="mt-2 flex items-center gap-2 text-blue-100">
              <Calendar size={16} />
              <span>Operations overview for AstreaBlue Enterprise ITSM</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-white/20">
              <RefreshCw size={15} />
              Refresh
            </button>
            <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-4 py-2 text-sm font-bold text-emerald-200">
              ● LIVE
            </span>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-black text-slate-900">Operations Overview</h2>
          <p className="text-sm text-slate-500">Live metrics, SLA health, assets, and service operations.</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((item) => (
            <KPICard key={item.title} item={item} />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-black text-slate-900">Ticket Trends</h2>
          <p className="text-sm text-slate-500">Opened vs resolved tickets this week</p>

          <div className="mt-8 flex h-64 items-end gap-4 border-b border-slate-200 px-4">
            {[42, 50, 36, 62, 47, 59, 54].map((value, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-xl bg-gradient-to-t from-blue-700 to-sky-400"
                  style={{ height: `${value * 2.4}px` }}
                />
                <span className="text-xs text-slate-400">D{index + 1}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Endpoint Health</h2>
          <p className="text-sm text-slate-500">Current monitored devices</p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              ["Online", 289, Monitor, "bg-emerald-50 text-emerald-600"],
              ["Offline", 23, Server, "bg-red-50 text-red-600"],
              ["Net Issues", 7, Wifi, "bg-amber-50 text-amber-600"],
              ["Secured", 312, Shield, "bg-blue-50 text-blue-600"],
            ].map(([label, value, Icon, style]) => (
              <div key={label} className={`rounded-2xl p-4 ${style}`}>
                <Icon size={20} />
                <p className="mt-3 text-2xl font-black">{value}</p>
                <p className="text-sm font-semibold">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">Recent Tickets</h2>
              <p className="text-sm text-slate-500">Latest service desk activities</p>
            </div>
          </div>

          <div className="space-y-3">
            {recentTickets.map(([title, code, priority, status]) => (
              <div key={code} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div>
                  <p className="font-bold text-slate-800">{title}</p>
                  <p className="text-sm text-slate-400">{code}</p>
                </div>

                <div className="flex gap-2">
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">
                    {priority}
                  </span>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                    {status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Top Technicians</h2>
          <p className="text-sm text-slate-500">This month performance</p>

          <div className="mt-6 space-y-5">
            {[
              ["J. Santos", 48],
              ["M. Cruz", 41],
              ["R. Dela Cruz", 53],
              ["A. Reyes", 37],
              ["L. Garcia", 45],
            ].map(([name, count]) => (
              <div key={name}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-bold text-slate-700">{name}</span>
                  <span className="font-black text-slate-900">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-violet-600"
                    style={{ width: `${count * 1.5}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}