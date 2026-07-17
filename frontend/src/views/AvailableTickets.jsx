import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority } from "../utils/ticketVisuals";
import { authHeaders } from "../services/authHeaders";
import PageHero from "../components/layout/PageHero";
import TicketDetails from "./TicketDetails";

const API_BASE = `${API_URL}/api/v1`;

export default function AvailableTickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);

  const technicianId = user?.user_id || null;
  const technicianBranchId = user?.branch_id || null;

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
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

      return (
        isUnassigned &&
        technicianBranchId &&
        ticket.branch_id &&
        Number(ticket.branch_id) === Number(technicianBranchId) &&
        !ticket.integration_id &&
        !ticket.origin_system &&
        ticket.created_via !== "External API" &&
        ticket.status === "Open Queue"
      );
    });
  }, [tickets, technicianBranchId]);

  const acceptTicket = async (ticketId) => {
    try {
      setAcceptingId(ticketId);

      const assignRes = await fetch(`${API_BASE}/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(
          buildTicketPayload(user, { assigned_to: technicianId })
        ),
      });

      if (!assignRes.ok) throw new Error("Failed to accept ticket");

      const statusRes = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
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
      <PageHero eyebrow="Technician Queue" title="Available Tickets" subtitle="Review open service work awaiting technician ownership." compact />

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
                {formatPriority(ticket.priority)}
              </span>
            </td>
            <td className="px-4 py-4 text-sm font-semibold text-slate-600">
              {ticket.category || "Uncategorized"}
            </td>
            <td className="px-4 py-4 text-sm font-semibold text-slate-600">
              {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : "Not recorded"}
            </td>
            <td className="px-4 py-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedTicket(ticket)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200"
                >
                  View
                </button>
                <button
                  onClick={() => acceptTicket(ticket.id)}
                  disabled={acceptingId === ticket.id}
                  className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {acceptingId === ticket.id ? "Accepting..." : "Accept"}
                </button>
              </div>
            </td>
          </tr>
        )}
      />

      {selectedTicket && (
        <TicketDetails
          id={selectedTicket.id}
          onClose={() => setSelectedTicket(null)}
          onUpdate={fetchTickets}
        />
      )}
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

