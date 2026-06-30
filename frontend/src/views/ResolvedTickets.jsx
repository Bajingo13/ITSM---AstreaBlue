import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";

const API_BASE = `${API_URL}/api/v1`;

export default function ResolvedTickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const technicianId = user?.user_id || 3;

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch resolved tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const resolvedTickets = useMemo(() => {
    return tickets.filter(
      (ticket) =>
        Number(ticket.assigned_to) === Number(technicianId) &&
        (ticket.status === "Resolved" || ticket.status === "Closed")
    );
  }, [technicianId, tickets]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <CheckCircle />
          <div>
            <h1 className="text-3xl font-black">Resolved Tickets</h1>
            <p className="mt-2 text-blue-100">
              Tickets you resolved or closed, including resolution details.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[1100px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Resolution Notes</th>
                <th className="px-4 py-3">Root Cause</th>
                <th className="px-4 py-3">Time Spent</th>
                <th className="px-4 py-3">Resolved At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading resolved tickets...
                  </td>
                </tr>
              ) : resolvedTickets.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center font-bold text-slate-400">
                    No resolved tickets yet.
                  </td>
                </tr>
              ) : (
                resolvedTickets.map((ticket) => (
                  <tr key={ticket.id} className="border-t border-slate-100">
                    <td className="px-4 py-4 text-sm font-black text-blue-700">
                      {ticket.ticket_number}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-slate-900">{ticket.title}</p>
                      <p className="line-clamp-1 text-sm text-slate-400">
                        {ticket.desc || ticket.description}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={getPriorityBadgeClass, formatPriority(ticket.priority)}>
                        {formatPriority(ticket.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={getStatusBadgeClass(ticket.status)}>
                        {ticket.status}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-4 text-sm leading-6 text-slate-600">
                      {ticket.resolution_notes || "No notes provided."}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.root_cause || "Not specified"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.time_spent_minutes ? `${ticket.time_spent_minutes} min` : "Not recorded"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.resolved_at ? new Date(ticket.resolved_at).toLocaleString() : "Not recorded"}
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

