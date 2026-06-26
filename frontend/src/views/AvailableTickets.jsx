import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass } from "../utils/ticketVisuals";

const API_BASE = "http://localhost:5001/api/v1";

export default function AvailableTickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState(null);

  const technicianId = user?.user_id || 3;

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch available tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const availableTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const isUnassigned =
        ticket.assigned_to === null ||
        ticket.assigned_to === undefined ||
        ticket.assigned_to === "";

      return isUnassigned && ticket.status === "Open Queue";
    });
  }, [tickets]);

  const acceptTicket = async (ticketId) => {
    try {
      setAcceptingId(ticketId);

      const assignRes = await fetch(`${API_BASE}/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildTicketPayload(user, { assigned_to: technicianId })
        ),
      });

      if (!assignRes.ok) throw new Error("Failed to accept ticket");

      const statusRes = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { status: "In Progress" })),
      });

      if (!statusRes.ok) throw new Error("Failed to start ticket");

      fetchTickets();
    } catch (err) {
      console.error(err);
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">Available Tickets</h1>
        <p className="mt-2 text-blue-100">
          Open Queue tickets waiting for a technician to accept ownership.
        </p>
      </section>

      <TicketTable
        icon={FileText}
        loading={loading}
        tickets={availableTickets}
        emptyText="No available tickets right now."
        columns={["Ticket No.", "Title", "Priority", "Category", "Created", "Actions"]}
        renderRow={(ticket) => (
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
              <span className={getPriorityBadgeClass(ticket.priority)}>
                {ticket.priority}
              </span>
            </td>
            <td className="px-4 py-4 text-sm font-semibold text-slate-600">
              {ticket.category || "Uncategorized"}
            </td>
            <td className="px-4 py-4 text-sm font-semibold text-slate-600">
              {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : "Not recorded"}
            </td>
            <td className="px-4 py-4">
              <button
                onClick={() => acceptTicket(ticket.id)}
                disabled={acceptingId === ticket.id}
                className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {acceptingId === ticket.id ? "Accepting..." : "Accept"}
              </button>
            </td>
          </tr>
        )}
      />
    </div>
  );
}

function TicketTable({ loading, tickets, emptyText, columns, renderRow }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[860px] text-left">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center font-bold text-slate-400">
                  Loading tickets...
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center font-bold text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              tickets.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
