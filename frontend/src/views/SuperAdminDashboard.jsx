import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  GitBranch,
  HardDrive,
  Search,
  Settings,
  Ticket,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketQuery } from "../utils/ticketAccess";
import DashboardHero from "../components/DashboardHero";
import { subscribeToTicketChanges } from "../services/realtimeTickets";

const API_BASE = `${API_URL}/api/v1`;

/* ─────────────────────────────────────────────
   StatCard — KPI card with icon, value, label
   ───────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, description, accent = "blue", onClick }) {
  const bgGradients = {
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="astrea-command-stat group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bgGradients[accent]}`}>
          <Icon size={22} />
        </div>
        <ChevronRight size={16} className="mt-1 text-slate-300 transition group-hover:text-slate-500" />
      </div>
      <p className="mt-4 text-3xl font-black text-slate-900">{value ?? "—"}</p>
      <p className="mt-1 text-sm font-bold text-slate-700">{label}</p>
      {description && (
        <p className="mt-0.5 text-xs text-slate-400">{description}</p>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────
   HeroBanner — compact gradient banner with decorative shapes
   ───────────────────────────────────────────── */
function HeroBanner() {
  return <div className="astrea-command-hero"><DashboardHero title="Operations Command Center" subtitle="Monitor service activity, asset movement, user access, and branch performance in one place." /></div>;
}

/* ─────────────────────────────────────────────
   TicketsPerBranchCard — branch ticket distribution
   ───────────────────────────────────────────── */
function TicketsPerBranchCard({ branches, tickets, loading }) {
  const navigate = useNavigate();
  const data = useMemo(() => {
    if (!branches.length) return [];
    const ticketCounts = {};
    tickets.forEach((t) => {
      const bid = t.branch_id;
      if (bid != null) ticketCounts[bid] = (ticketCounts[bid] || 0) + 1;
    });
    return branches
      .map((b) => ({
        id: b.branch_id,
        name: b.branch_name,
        location: b.branch_location || "Branch",
        count: ticketCounts[b.branch_id] || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [branches, tickets]);

  const maxCount = Math.max(...data.map((b) => b.count), 1);
  const totalTickets = data.reduce((sum, b) => sum + b.count, 0);
  const topFive = data.slice(0, 5);
  return (
    <div className="astrea-command-section rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <GitBranch size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">Branch Service Volume</h3>
            <p className="text-xs text-slate-400">Ticket distribution across branches</p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="space-y-3">
          {loading ? (
            <p className="py-4 text-center text-sm text-slate-400">Loading branch data...</p>
          ) : topFive.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No branch data available.</p>
          ) : (
            topFive.map((branch) => (
              <div key={branch.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-slate-50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-black text-slate-500">
                  {branch.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold text-slate-800">{branch.name}</p>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-black text-blue-700">
                      {branch.count}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-400">{branch.location}</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                      style={{ width: `${(branch.count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {!loading && data.length > 5 && (
          <button
            type="button"
            onClick={() => navigate("/settings/branches")}
            className="mt-3 w-full rounded-xl bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-100"
          >
            View More &middot; +{data.length - 5} branches
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
        <p className="text-sm font-bold text-slate-600">
          Total: <span className="text-slate-900">{totalTickets}</span>
        </p>
        <button
          type="button"
          onClick={() => navigate("/tickets")}
          className="rounded-xl bg-blue-50 px-4 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"
        >
          View Report
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   DonutChart — CSS conic-gradient donut
   ───────────────────────────────────────────── */
function DonutChart({ segments, size = 140, strokeWidth = 28 }) {
  if (!segments.length || segments.every((s) => s.value === 0)) {
    return (
      <div
        className="relative flex items-center justify-center rounded-full bg-slate-100"
        style={{ width: size, height: size }}
      >
        <div className="text-center">
          <p className="text-lg font-black text-slate-400">0</p>
        </div>
      </div>
    );
  }

  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let accumulated = 0;
  const gradientParts = segments.map((seg) => {
    if (seg.value === 0) return null;
    const startPct = (accumulated / total) * 100;
    accumulated += seg.value;
    const endPct = (accumulated / total) * 100;
    return `${seg.color} ${startPct}% ${endPct}%`;
  }).filter(Boolean);

  const conicGradient = `conic-gradient(${gradientParts.join(", ")})`;
  const innerSize = size - strokeWidth * 2;

  return (
    <div
      className="relative flex items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: conicGradient,
      }}
    >
      <div
        className="flex items-center justify-center rounded-full bg-white"
        style={{ width: innerSize, height: innerSize }}
      >
        <div className="text-center">
          <p className="text-2xl font-black text-slate-900">{total}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   RoleDistributionCard — donut chart + role list
   ───────────────────────────────────────────── */
function RoleDistributionCard({ users, loading }) {
  const navigate = useNavigate();
  const roleCounts = useMemo(() => {
    if (!users.length) return { admins: 0, technicians: 0, employees: 0, total: 0 };
    const admins = users.filter((u) => u.role_name === "Admin").length;
    const technicians = users.filter((u) => u.role_name === "Technician").length;
    const employees = users.filter((u) => u.role_name === "Employee").length;
    return { admins, technicians, employees, total: admins + technicians + employees };
  }, [users]);

  const segments = useMemo(() => [
    { label: "Admins", value: roleCounts.admins, color: "#6366f1" },
    { label: "Technicians", value: roleCounts.technicians, color: "#06b6d4" },
    { label: "Employees", value: roleCounts.employees, color: "#f59e0b" },
  ], [roleCounts]);

  const roleInfo = useMemo(() => [
    {
      icon: UserCog,
      label: "Admins",
      count: roleCounts.admins,
      color: "bg-indigo-500",
      bg: "bg-indigo-50 text-indigo-600",
      pct: roleCounts.total ? Math.round((roleCounts.admins / roleCounts.total) * 100) : 0,
    },
    {
      icon: Users,
      label: "Technicians",
      count: roleCounts.technicians,
      color: "bg-cyan-500",
      bg: "bg-cyan-50 text-cyan-600",
      pct: roleCounts.total ? Math.round((roleCounts.technicians / roleCounts.total) * 100) : 0,
    },
    {
      icon: Users,
      label: "Employees",
      count: roleCounts.employees,
      color: "bg-amber-500",
      bg: "bg-amber-50 text-amber-600",
      pct: roleCounts.total ? Math.round((roleCounts.employees / roleCounts.total) * 100) : 0,
    },
  ], [roleCounts]);

  return (
    <div className="astrea-command-section flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
          <BarChart3 size={20} />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900">Access &amp; Role Overview</h3>
          <p className="text-xs text-slate-400">User role breakdown</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        {loading ? (
          <p className="py-4 text-center text-sm text-slate-400">Loading...</p>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-center">
              <DonutChart segments={segments} size={140} strokeWidth={22} />
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-1">
              {roleInfo.map((role) => {
                const RoleIcon = role.icon;
                return (
                  <div key={role.label} className="flex items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-slate-50">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${role.bg}`}>
                      <RoleIcon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-800">{role.label}</p>
                        <span className="text-sm font-black text-slate-900">{role.count}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${role.color}`}
                            style={{ width: `${role.pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-400">{role.pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => navigate("/settings/users")}
          className="rounded-xl bg-blue-50 px-4 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"
        >
          View User Report
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   QuickActions — horizontal action buttons
   ───────────────────────────────────────────── */
const QUICK_ACTIONS = [
  { icon: Ticket, label: "Create Ticket", sub: "New support request", path: "/employee/create-ticket", allowed: true },
  { icon: UserCog, label: "Add User", sub: "Register new user", path: "/settings/users", allowed: true },
  { icon: HardDrive, label: "Manage Assets", sub: "Hardware tracking", path: "/assets", allowed: true },
  { icon: BarChart3, label: "Reports & Analytics", sub: "View insights", path: "/analytics", allowed: true },
  { icon: BookOpen, label: "Knowledge Base", sub: "ITSM guides", path: "/knowledge-base", allowed: true },
  { icon: Settings, label: "System Settings", sub: "Configuration", path: "/settings", allowed: true },
];

function QuickActions() {
  const navigate = useNavigate();

  return (
    <div className="astrea-command-section rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <Activity size={20} />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900">Quick Actions</h3>
          <p className="text-xs text-slate-400">Frequently used operations</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {QUICK_ACTIONS.map((action) => {
          const ActionIcon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => navigate(action.path)}
              className="flex flex-col items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-center transition hover:border-blue-200 hover:bg-blue-50 hover:shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm">
                <ActionIcon size={18} />
              </div>
              <div>
                <p className="text-xs font-black text-slate-800">{action.label}</p>
                <p className="text-[10px] text-slate-400">{action.sub}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   UserListCard — role-filtered user list
   ───────────────────────────────────────────── */
function UserListCard({ title, icon: Icon, users, accent = "blue", loading, emptyMessage }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const MAX_VISIBLE = 5;

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const displayed = filtered.slice(0, MAX_VISIBLE);
  const hasMore = filtered.length > MAX_VISIBLE;

  const initials = (name) => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0][0].toUpperCase();
  };

  const accentBg = {
    blue: "bg-blue-50 text-blue-700",
    cyan: "bg-cyan-50 text-cyan-700",
    amber: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="astrea-command-section flex flex-col rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accentBg[accent] || accentBg.blue}`}>
            <Icon size={16} />
          </div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">
            {users.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate("/settings/users")}
          className="text-xs font-bold text-blue-600 hover:text-blue-800"
        >
          View All
        </button>
      </div>

      <div className="border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <Search size={14} className="text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}>
              <X size={14} className="text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-0.5 px-3 py-3">
        {loading ? (
          <p className="py-6 text-center text-xs text-slate-400">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">{emptyMessage || "No users found."}</p>
        ) : (
          displayed.map((u) => (
            <div
              key={u.user_id}
              className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50"
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${
                  accent === "amber" ? "bg-amber-500" : accent === "cyan" ? "bg-cyan-500" : "bg-blue-500"
                }`}
              >
                {initials(u.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800">{u.full_name || "—"}</p>
                <p className="truncate text-xs text-slate-400">{u.email || "—"}</p>
              </div>
              {u.branch_name && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                  {u.branch_name}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {hasMore && (
        <div className="border-t border-slate-100 px-5 py-3 text-center">
          <button
            type="button"
            onClick={() => navigate("/settings/users")}
            className="text-xs font-bold text-blue-600 hover:text-blue-800"
          >
            +{filtered.length - MAX_VISIBLE} more
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main SuperAdminDashboard
   ───────────────────────────────────────────── */
export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const ticketQuery = buildTicketQuery(user);

      const [branchesRes, usersRes, ticketsRes, assetsRes] = await Promise.all([
        fetch(`${API_BASE}/branches`, { cache: "no-store" }),
        fetch(`${API_BASE}/users`, { cache: "no-store" }),
        fetch(`${API_BASE}/tickets${ticketQuery}`, { cache: "no-store" }),
        fetch(`${API_BASE}/hardware-assets${ticketQuery}`, { cache: "no-store" }),
      ]);

      if (!branchesRes.ok) throw new Error("Failed to fetch branches");
      if (!usersRes.ok) throw new Error("Failed to fetch users");
      if (!ticketsRes.ok) throw new Error("Failed to fetch tickets");
      if (!assetsRes.ok) throw new Error("Failed to fetch assets");

      const branchesData = await branchesRes.json();
      const usersData = await usersRes.json();
      const ticketsData = await ticketsRes.json();
      const assetsData = await assetsRes.json();

      setBranches(Array.isArray(branchesData) ? branchesData : []);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setTickets(Array.isArray(ticketsData) ? ticketsData : []);
      setAssets(Array.isArray(assetsData) ? assetsData : []);
    } catch (err) {
      console.error("SuperAdminDashboard fetch error:", err.message);
      setError(err.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const refresh = (event) => {
      const refreshPromise = fetchData();
      event?.detail?.waitUntil?.(refreshPromise);
      return refreshPromise;
    };
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [fetchData]);

  useEffect(() => {
    let timeoutId;
    const unsubscribe = subscribeToTicketChanges(() => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => void fetchData(), 150);
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [fetchData]);

  const activeUsers = useMemo(() => users.filter((u) => u.is_active !== false), [users]);

  const admins = useMemo(() => activeUsers.filter((u) => u.role_name === "Admin"), [activeUsers]);
  const technicians = useMemo(() => activeUsers.filter((u) => u.role_name === "Technician"), [activeUsers]);
  const employees = useMemo(() => activeUsers.filter((u) => u.role_name === "Employee"), [activeUsers]);

  const kpis = useMemo(() => [
    {
      icon: Building2,
      label: "Total Branches",
      value: branches.length,
      description: "Active branch locations",
      accent: "blue",
      onClick: () => navigate("/settings/branches"),
    },
    {
      icon: Users,
      label: "Active Users",
      value: activeUsers.length,
      description: "System-wide registered users",
      accent: "purple",
      onClick: () => navigate("/settings/users"),
    },
    {
      icon: Ticket,
      label: "Open Service Load",
      value: tickets.length,
      description: "All-time support tickets",
      accent: "emerald",
      onClick: () => navigate("/tickets"),
    },
    {
      icon: UserCog,
      label: "Admins",
      value: admins.length,
      description: "Branch administrators",
      accent: "amber",
      onClick: () => navigate("/settings/users"),
    },
    {
      icon: HardDrive,
      label: "Asset Inventory",
      value: assets.length,
      description: "Tracked hardware assets",
      accent: "blue",
      onClick: () => navigate("/assets"),
    },
  ], [branches, activeUsers, tickets, admins, assets]);

  return (
    <div className="astrea-command-dashboard space-y-5">
      {/* Hero Banner */}
      <HeroBanner />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
          <AlertTriangle size={18} />
          {error}
          <button
            type="button"
            onClick={fetchData}
            className="ml-auto rounded-xl bg-rose-100 px-4 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-200"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <section className="astrea-command-kpis grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
              >
                <div className="h-12 w-12 rounded-xl bg-slate-100" />
                <div className="mt-4 h-8 w-20 rounded bg-slate-100" />
                <div className="mt-2 h-4 w-32 rounded bg-slate-100" />
              </div>
            ))
          : kpis.map((kpi) => (
              <StatCard key={kpi.label} {...kpi} />
            ))}
      </section>

      {/* Charts Row */}
      <section className="astrea-command-insight-grid mt-0.5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TicketsPerBranchCard branches={branches} tickets={tickets} loading={loading} />
        <RoleDistributionCard users={activeUsers} loading={loading} />
      </section>

      {/* Quick Actions */}
      <QuickActions />

      <section className="astrea-command-directory grid grid-cols-1 gap-4 lg:grid-cols-3">
        <UserListCard
          title="All Admins"
          icon={UserCog}
          users={admins}
          accent="blue"
          loading={loading}
          emptyMessage="No admins found."
        />
        <UserListCard
          title="All Technicians"
          icon={Users}
          users={technicians}
          accent="cyan"
          loading={loading}
          emptyMessage="No technicians found."
        />
        <UserListCard
          title="All Employees"
          icon={Users}
          users={employees}
          accent="amber"
          loading={loading}
          emptyMessage="No employees found."
        />
      </section>
    </div>
  );
}
