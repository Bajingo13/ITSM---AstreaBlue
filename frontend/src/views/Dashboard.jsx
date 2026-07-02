import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ticket,
  CheckCircle,
  AlertCircle,
  Activity,
  BarChart3,
  Clock,
  XCircle,
} from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";
import DashboardHero from "../components/DashboardHero";

const API_BASE = `${API_URL}/api/v1`;

function KPICard({ item }) {
  const Icon = item.icon;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
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
        <h3
          className={`text-3xl font-black ${
            item.alert ? "text-red-600" : "text-slate-950"
          }`}
        >
          {item.value}
        </h3>
        <p className="mt-1 font-semibold text-slate-700">{item.title}</p>
        <p className="mt-1 text-sm text-slate-400">{item.subtitle}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
const { user } = useAuth();
  const [summary, setSummary] = useState({
    openTickets: 0,
    inProgressTickets: 0,
    resolvedTickets: 0,
    closedTickets: 0,
    criticalTickets: 0,
    totalTickets: 0,
  });
  const [recentTickets, setRecentTickets] = useState([]);
  const [assetCount, setAssetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const query = buildTicketQuery(user);
      const [res, assetsRes] = await Promise.all([
        fetch(`${API_BASE}/dashboard/summary${query}`),
        fetch(`${API_BASE}/hardware-assets${query}`),
      ]);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch dashboard summary.");
      }

      setSummary(data.stats || data.summary || {});
      setRecentTickets(
        Array.isArray(data.recentTickets)
          ? data.recentTickets
          : Array.isArray(data.recent_tickets)
          ? data.recent_tickets
          : []
      );
      if (assetsRes.ok) {
        const assetData = await assetsRes.json();
        setAssetCount(Array.isArray(assetData) ? assetData.length : 0);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    const refresh = () => fetchSummary();
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [fetchSummary]);

  const stats = useMemo(
    () => [
      {
        title: "Open Tickets",
        value: summary.openTickets || 0,
        subtitle: "Open Queue tickets",
        icon: Ticket,
        accent: "#2563EB",
        bg: "#EFF6FF",
        color: "#2563EB",
      },
      {
        title: "In Progress",
        value: summary.inProgressTickets || 0,
        subtitle: "Tickets currently being worked",
        icon: Clock,
        accent: "#0EA5E9",
        bg: "#F0F9FF",
        color: "#0284C7",
      },
      {
        title: "Critical Tickets",
        value: summary.criticalTickets || 0,
        subtitle: "P1 tickets still needing attention",
        icon: AlertCircle,
        accent: "#EF4444",
        bg: "#FEF2F2",
        color: "#DC2626",
        alert: Number(summary.criticalTickets || 0) > 0,
      },
      {
        title: "Resolved Tickets",
        value: summary.resolvedTickets || 0,
        subtitle: "Resolved tickets",
        icon: CheckCircle,
        accent: "#10B981",
        bg: "#ECFDF5",
        color: "#059669",
      },
      {
        title: "Closed Tickets",
        value: summary.closedTickets || 0,
        subtitle: "Accepted and closed tickets",
        icon: CheckCircle,
        accent: "#64748B",
        bg: "#F1F5F9",
        color: "#475569",
      },
      {
        title: "Cancelled Tickets",
        value: summary.cancelledTickets || 0,
        subtitle: "Cancelled tickets",
        icon: XCircle,
        accent: "#F43F5E",
        bg: "#FFF1F2",
        color: "#E11D48",
      },
      {
        title: "Open Service Load",
        value: summary.totalTickets || 0,
        subtitle: "All visible tickets",
        icon: Activity,
        accent: "#8B5CF6",
        bg: "#F5F3FF",
        color: "#7C3AED",
      },
      {
        title: "Asset Inventory",
        value: assetCount,
        subtitle: "Tracked hardware assets",
        icon: Activity,
        accent: "#06B6D4",
        bg: "#ECFEFF",
        color: "#0891B2",
      },
    ],
    [assetCount, summary]
  );

  const chartValues = [
    { label: "Open", value: Number(summary.openTickets || 0) },
    { label: "Progress", value: Number(summary.inProgressTickets || 0) },
    { label: "Critical", value: Number(summary.criticalTickets || 0) },
    { label: "Resolved", value: Number(summary.resolvedTickets || 0) },
    { label: "Closed", value: Number(summary.closedTickets || 0) },
    { label: "Total", value: Number(summary.totalTickets || 0) },
  ];
  const maxChartValue = Math.max(...chartValues.map((item) => item.value), 1);

  return (
    <div className="space-y-6">
      <DashboardHero title="Service Operations Overview" />

      {error && (
        <section className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
          {error}
        </section>
      )}

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-black text-slate-900">
            Operations Overview
          </h2>
          <p className="text-sm text-slate-500">
            Live ticket metrics from the AstreaBlue service desk database.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((item) => (
            <KPICard key={item.title} item={item} />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-black text-slate-900">
            Ticket Snapshot
          </h2>
          <p className="text-sm text-slate-500">
            Visible ticket counts by operational state
          </p>

          <div className="mt-8 flex h-64 items-end gap-4 border-b border-slate-200 px-4">
            {chartValues.map((item) => (
              <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-xl bg-gradient-to-t from-blue-700 to-sky-400"
                  style={{
                    height: `${Math.max((item.value / maxChartValue) * 220, item.value ? 18 : 4)}px`,
                  }}
                />
                <span className="text-xs font-bold text-slate-500">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Dashboard Health</h2>
          <p className="text-sm text-slate-500">Current live data status</p>

          <div className="mt-6 space-y-3">
            <StatusTile
              icon={BarChart3}
              label="Summary Source"
              value={loading ? "Loading" : "Live API"}
              tone="blue"
            />
            <StatusTile
              icon={Clock}
              label="Recent Tickets"
              value={recentTickets.length}
              tone="emerald"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Recent Tickets</h2>
            <p className="text-sm text-slate-500">
              Latest service desk activities
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-5 text-sm font-bold text-slate-400">
              Loading recent tickets...
            </div>
          ) : recentTickets.length === 0 ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-5 text-sm font-bold text-slate-400">
              No recent tickets found.
            </div>
          ) : (
            recentTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <p className="font-bold text-slate-800">{ticket.title}</p>
                  <p className="text-sm text-slate-400">
                    {ticket.ticket_number || `TKT-${ticket.id}`}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={getPriorityBadgeClass, formatPriority(ticket.priority)}>
                    {formatPriority(ticket.priority)}
                  </span>
                  <span className={getStatusBadgeClass(ticket.status)}>
                    {ticket.status || "Open Queue"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                    {ticket.branch_name || "Unassigned Branch"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatusTile({ icon: Icon, label, value, tone }) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
  };

  return (
    <div className={`rounded-2xl p-4 ${tones[tone] || tones.blue}`}>
      <Icon size={20} />
      <p className="mt-3 text-2xl font-black">{value}</p>
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}
