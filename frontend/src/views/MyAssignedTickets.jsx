import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";

const API_BASE = `${API_URL}/api/v1`;

export default function MyAssignedTickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolutionTicket, setResolutionTicket] = useState(null);

  const technicianId = user?.user_id || 3;

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch assigned tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const assignedTickets = useMemo(() => {
    return tickets.filter(
      (ticket) =>
        Number(ticket.assigned_to) === Number(technicianId) &&
        ticket.status !== "Resolved" &&
        ticket.status !== "Closed"
    );
  }, [technicianId, tickets]);

  const updateStatus = async (ticketId, status) => {
    try {
      const res = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { status })),
      });

      if (!res.ok) throw new Error("Failed to update ticket");
      fetchTickets();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">My Assigned Tickets</h1>
        <p className="mt-2 text-blue-100">
          Active tickets assigned to your technician account.
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading assigned tickets...
                  </td>
                </tr>
              ) : assignedTickets.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    No active tickets assigned to you.
                  </td>
                </tr>
              ) : (
                assignedTickets.map((ticket) => (
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
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.category || "Uncategorized"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        {ticket.status === "Open Queue" && (
                          <button
                            onClick={() => updateStatus(ticket.id, "In Progress")}
                            className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800"
                          >
                            Start Work
                          </button>
                        )}
                        <button
                          onClick={() => setResolutionTicket(ticket)}
                          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"
                        >
                          Resolve
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {resolutionTicket && (
        <ResolutionModal
          ticket={resolutionTicket}
          user={user}
          onClose={() => setResolutionTicket(null)}
          onResolved={() => {
            setResolutionTicket(null);
            fetchTickets();
          }}
        />
      )}
    </div>
  );
}

function ResolutionModal({ ticket, user, onClose, onResolved }) {
  const [form, setForm] = useState({
    resolution_notes: "",
    root_cause: "",
    time_spent_minutes: "",
    parts_used: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.resolution_notes.trim()) {
      setError("Resolution notes are required before resolving.");
      return;
    }

    if (form.time_spent_minutes.trim() && Number.isNaN(Number(form.time_spent_minutes))) {
      setError("Time spent minutes must be a number.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, {
          status: "Resolved",
          resolution_notes: form.resolution_notes.trim(),
          root_cause: form.root_cause.trim() || null,
          time_spent_minutes: form.time_spent_minutes.trim()
            ? Number(form.time_spent_minutes)
            : null,
          parts_used: form.parts_used.trim() || null,
        })),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resolve ticket.");
      onResolved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-blue-600">
              {ticket.ticket_number || `TKT-${ticket.id}`}
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-900">Resolve Ticket</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-7 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
          <Field
            label="Resolution Notes *"
            value={form.resolution_notes}
            onChange={(value) => updateForm("resolution_notes", value)}
            textarea
          />
          <Field
            label="Root Cause"
            value={form.root_cause}
            onChange={(value) => updateForm("root_cause", value)}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Time Spent Minutes"
              value={form.time_spent_minutes}
              onChange={(value) => updateForm("time_spent_minutes", value)}
            />
            <Field
              label="Parts Used"
              value={form.parts_used}
              onChange={(value) => updateForm("parts_used", value)}
            />
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Resolving..." : "Resolve Ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, textarea = false }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          rows={5}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
        />
      )}
    </div>
  );
}

