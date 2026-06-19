import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Clock, Timer } from "lucide-react";

const API_BASE = "http://localhost:5000/api/v1";

export default function SLAMonitor() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch SLA tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const now = Date.now();
  const enrichedTickets = useMemo(() => {
    return tickets.map((ticket) => {
      const due = ticket.sla_due_date ? new Date(ticket.sla_due_date).getTime() : null;
      const resolved = ticket.resolved_at ? new Date(ticket.resolved_at).getTime() : null;
      const closed = ticket.closed_at ? new Date(ticket.closed_at).getTime() : null;
      const created = ticket.created_at ? new Date(ticket.created_at).getTime() : null;
      const endTime = resolved || closed || now;
      const breached = due ? endTime > due && ticket.status !== "Closed" : false;
      const resolutionHours = created && resolved
        ? ((resolved - created) / 36e5).toFixed(1)
        : "Open";
      const responseHours = created && ticket.first_response_at
        ? ((new Date(ticket.first_response_at).getTime() - created) / 36e5).toFixed(1)
        : "Pending";

      return { ...ticket, breached, resolutionHours, responseHours };
    });
  }, [now, tickets]);

  const breached = enrichedTickets.filter((ticket) => ticket.breached);
  const dueSoon = enrichedTickets.filter((ticket) => {
    if (!ticket.sla_due_date || ticket.status === "Closed") return false;
    const due = new Date(ticket.sla_due_date).getTime();
    return due >= now && due - now <= 4 * 60 * 60 * 1000;
  });
  const met = enrichedTickets.filter((ticket) => {
    if (!ticket.sla_due_date || !ticket.resolved_at) return false;
    return new Date(ticket.resolved_at).getTime() <= new Date(ticket.sla_due_date).getTime();
  });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">SLA Monitor</h1>
        <p className="mt-2 text-blue-100">
          Track SLA due dates, breached tickets, and response and resolution timing.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card icon={Timer} label="Tracked Tickets" value={enrichedTickets.length} color="blue" />
        <Card icon={AlertTriangle} label="Breached" value={breached.length} color="red" />
        <Card icon={Clock} label="Due Soon" value={dueSoon.length} color="amber" />
        <Card icon={CheckCircle} label="Met SLA" value={met.length} color="emerald" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">SLA Ticket Queue</h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">SLA Due</th>
                <th className="px-4 py-3">Response Time</th>
                <th className="px-4 py-3">Resolution Time</th>
                <th className="px-4 py-3">SLA State</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading SLA tickets...
                  </td>
                </tr>
              ) : enrichedTickets.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center font-bold text-slate-400">
                    No tickets found.
                  </td>
                </tr>
              ) : (
                enrichedTickets.map((ticket) => (
                  <tr key={ticket.id} className="border-t border-slate-100">
                    <td className="px-4 py-4 text-sm font-black text-blue-700">
                      {ticket.ticket_number}
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-900">{ticket.title}</td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.priority}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.status}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.sla_due_date
                        ? new Date(ticket.sla_due_date).toLocaleString()
                        : "Not set"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.responseHours === "Pending"
                        ? "Pending"
                        : `${ticket.responseHours} hrs`}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.resolutionHours === "Open"
                        ? "Open"
                        : `${ticket.resolutionHours} hrs`}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          ticket.breached
                            ? "bg-red-50 text-red-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {ticket.breached ? "Breached" : "Within SLA"}
                      </span>
                    </td>
                  </tr>
                ))
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
    blue: "bg-blue-50 text-blue-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`rounded-2xl p-3 ${colorMap[color]}`}>
          <Icon size={22} />
        </div>
        <div>
          <p className="text-2xl font-black text-slate-900">{value}</p>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
