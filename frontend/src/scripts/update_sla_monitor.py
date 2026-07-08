import sys

file_path = "C:/Users/janis/asset-monitoring-backend/frontend/src/views/SLAMonitor.jsx"

new_content = """import { API_URL } from "../config/api";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Clock, Timer, Activity, Zap } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";
import PageHero from "../components/layout/PageHero";

const API_BASE = `${API_URL}/api/v1`;

export default function SLAMonitor() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({
    activeSLA: 0,
    dueSoon: 0,
    breached: 0,
    met: 0,
    compliancePercent: 100,
    avgResponseTimeMins: 0,
    avgResolutionTimeMins: 0
  });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch stats
      const statsRes = await fetch(`${API_BASE}/sla/dashboard${buildTicketQuery(user)}`);
      const statsData = await statsRes.json();
      if (statsData.success) {
        setStats(statsData.stats);
      }

      // Fetch active SLA tickets
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      const allTickets = Array.isArray(data) ? data : [];
      // Filter out completed ones to show what needs attention
      setTickets(allTickets.filter(t => t.status !== 'Closed' && t.status !== 'Cancelled' && t.status !== 'Resolved'));
    } catch (err) {
      console.error("Fetch SLA data failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getSlaBadgeClass = (status) => {
    switch (status) {
      case "Met": return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "Breached": return "bg-red-100 text-red-800 border-red-200";
      case "Due Soon": return "bg-amber-100 text-amber-800 border-amber-200";
      default: return "bg-blue-100 text-blue-800 border-blue-200"; // Pending / Active
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHero
        icon={Timer}
        title="SLA Monitoring"
        subtitle="Track Service Level Agreement compliance, response times, and identify breached or at-risk tickets."
      />

      <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card icon={Activity} label="Active SLAs" value={stats.activeSLA} color="blue" />
        <Card icon={CheckCircle} label="Compliance %" value={`${stats.compliancePercent}%`} color="emerald" />
        <Card icon={AlertTriangle} label="Due Soon" value={stats.dueSoon} color="amber" />
        <Card icon={Clock} label="Breached" value={stats.breached} color="red" />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="text-blue-500" size={24} />
            <h3 className="text-lg font-black text-slate-800">Avg Response Time</h3>
          </div>
          <p className="text-3xl font-black text-slate-900">{stats.avgResponseTimeMins} <span className="text-sm font-semibold text-slate-500">mins</span></p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <Timer className="text-indigo-500" size={24} />
            <h3 className="text-lg font-black text-slate-800">Avg Resolution Time</h3>
          </div>
          <p className="text-3xl font-black text-slate-900">{stats.avgResolutionTimeMins} <span className="text-sm font-semibold text-slate-500">mins</span></p>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">Active SLA Tickets</h2>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-700">
            {tickets.length} total
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4">Ticket</th>
                <th className="px-6 py-4">Priority & Status</th>
                <th className="px-6 py-4">Response Due</th>
                <th className="px-6 py-4">Resolution Due</th>
                <th className="px-6 py-4">SLA Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-slate-400">
                    Loading SLA data...
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-slate-400">
                    No active tickets.
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => {
                  const resolSla = ticket.resolution_sla_status || 'Pending';
                  const resSla = ticket.response_sla_status || 'Pending';
                  const overallSla = (resolSla === 'Breached' || resSla === 'Breached') ? 'Breached' : (resolSla === 'Met' ? 'Met' : 'Active');
                  return (
                    <tr key={ticket.id} className="transition hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">
                          {ticket.ticket_number || `TKT-${ticket.id}`}
                        </div>
                        <div className="mt-1 line-clamp-1 max-w-xs text-xs text-slate-500">
                          {ticket.title}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2 items-start">
                          <span className={getPriorityBadgeClass(ticket.priority)}>
                            {formatPriority(ticket.priority)}
                          </span>
                          <span className={getStatusBadgeClass(ticket.status)}>
                            {ticket.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-700">
                        {ticket.response_due_at ? new Date(ticket.response_due_at).toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-700">
                        {ticket.resolution_due_at ? new Date(ticket.resolution_due_at).toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${getSlaBadgeClass(overallSla)}`}>
                          {overallSla === 'Active' ? 'SLA Active' : `SLA ${overallSla}`}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ icon: Icon, label, value, color }) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    red: "bg-red-50 text-red-700 border-red-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };

  return (
    <div className={`rounded-3xl border bg-white p-6 shadow-sm ${colorMap[color].split(" ")[2]}`}>
      <div className="flex items-center gap-4">
        <div className={`rounded-2xl p-3 ${colorMap[color].split(" ").slice(0, 2).join(" ")}`}>
          <Icon size={24} />
        </div>
        <div>
          <p className="text-3xl font-black text-slate-900">{value}</p>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mt-1">{label}</p>
        </div>
      </div>
    </div>
  );
}
"""

with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("SLAMonitor.jsx overwritten successfully")
