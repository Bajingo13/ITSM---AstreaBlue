import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ticket,
  Clock,
  CheckCircle,
  AlertCircle,
  Play,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { authHeaders } from "../services/authHeaders";
import DashboardHero from "../components/DashboardHero";
import { subscribeToTicketChanges } from "../services/realtimeTickets";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass, getSeverityLevel } from "../utils/ticketVisuals";
import { getTicketCompletionLabel } from "../utils/ticketDuration";

const API_BASE = `${API_URL}/api/v1`;

export default function TechnicianDashboard({ view = "dashboard" }) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolutionTicket, setResolutionTicket] = useState(null);
  const [ignoredTicketIds, setIgnoredTicketIds] = useState([]);
  const [acceptingTicketId, setAcceptingTicketId] = useState(null);

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
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to refresh technician tickets.");
      }
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch technician tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    const refresh = (event) => {
      const refreshPromise = fetchTickets();
      event?.detail?.waitUntil?.(refreshPromise);
      return refreshPromise;
    };
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [fetchTickets]);

  useEffect(() => {
    let timeoutId;
    const unsubscribe = subscribeToTicketChanges(() => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => void fetchTickets(), 150);
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [fetchTickets]);

  const myTickets = useMemo(() => {
    return tickets.filter((ticket) => Number(ticket.assigned_to) === Number(technicianId));
  }, [tickets, technicianId]);

  const assignedTickets = useMemo(() => {
    return myTickets.filter(
      (ticket) => ticket.status !== "Resolved" && ticket.status !== "Closed"
    );
  }, [myTickets]);

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
        ticket.status === "Open Queue" &&
        !ignoredTicketIds.includes(ticket.id)
      );
    });
  }, [tickets, ignoredTicketIds, technicianBranchId]);

  const resolvedTickets = useMemo(() => {
    return myTickets.filter(
      (ticket) => ticket.status === "Resolved" || ticket.status === "Closed"
    );
  }, [myTickets]);

  const inProgress = assignedTickets.filter((t) => t.status === "In Progress").length;
  const open = assignedTickets.filter((t) => t.status === "Open Queue").length;
  const resolved = resolvedTickets.length;
  const critical = assignedTickets.filter((t) => getSeverityLevel(t.priority) === "critical").length;
  const showOverview = view === "dashboard";
  const showAssigned = view === "dashboard" || view === "assigned";
  const showAvailable = view === "dashboard" || view === "available";
  const showResolved = view === "dashboard" || view === "resolved";

  const updateStatus = async (ticketId, status) => {
    try {
      const res = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PUT",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(buildTicketPayload(user, { status })),
      });

      if (!res.ok) throw new Error("Failed to update ticket");

      fetchTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const acceptTicket = async (ticketId) => {
    try {
      setAcceptingTicketId(ticketId);

      const assignRes = await fetch(`${API_BASE}/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          ...buildTicketPayload(user, { assigned_to: technicianId }),
        }),
      });

      if (!assignRes.ok) throw new Error("Failed to accept ticket");

      const statusRes = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PUT",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(buildTicketPayload(user, { status: "In Progress" })),
      });

      if (!statusRes.ok) throw new Error("Failed to start ticket");

      setIgnoredTicketIds((prev) => prev.filter((id) => id !== ticketId));
      fetchTickets();
    } catch (err) {
      console.error(err);
    } finally {
      setAcceptingTicketId(null);
    }
  };

  const ignoreTicket = (ticketId) => {
    setIgnoredTicketIds((prev) =>
      prev.includes(ticketId) ? prev : [...prev, ticketId]
    );
  };

  return (
    <div className="space-y-6">
      {showOverview ? <DashboardHero title="Technician Operations Workspace" subtitle="Review assigned work, priority incidents, and service progress from one operational view." /> : <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">Technician Workspace</h1>
        <p className="mt-2 text-blue-100">
          View assigned tickets, start work, and resolve service desk tasks.
        </p>
      </section>}

      {showOverview && (
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card icon={Ticket} label="Assigned To Me" value={assignedTickets.length} color="blue" />
        <Card icon={Clock} label="Open Queue" value={open} color="amber" />
        <Card icon={Play} label="In Progress" value={inProgress} color="sky" />
        <Card icon={CheckCircle} label="Resolved" value={resolved} color="emerald" />
      </section>
      )}

      {showOverview && critical > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">
          <div className="flex items-center gap-3">
            <AlertCircle />
            <div>
              <h2 className="font-black">Critical Ticket Alert</h2>
              <p className="text-sm font-semibold">
                You have {critical} critical ticket(s) assigned to you.
              </p>
            </div>
          </div>
        </section>
      )}

      {showAssigned && (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">My Assigned Tickets</h2>
        <p className="mt-1 text-sm text-slate-500">
          Open and in-progress tickets assigned to your technician account.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left">
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
                      <span className={getPriorityBadgeClass(ticket.priority)}>
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
                            Start
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
      )}

      {showAvailable && (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">Available Tickets</h2>
        <p className="mt-1 text-sm text-slate-500">
          Filed tickets waiting for a technician to accept ownership.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading available tickets...
                  </td>
                </tr>
              ) : availableTickets.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    No available tickets right now.
                  </td>
                </tr>
              ) : (
                availableTickets.map((ticket) => (
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
                      {ticket.created_at
                        ? new Date(ticket.created_at).toLocaleString()
                        : "Not recorded"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => acceptTicket(ticket.id)}
                          disabled={acceptingTicketId === ticket.id}
                          className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-60"
                        >
                          {acceptingTicketId === ticket.id ? "Accepting..." : "Accept"}
                        </button>

                        <button
                          onClick={() => ignoreTicket(ticket.id)}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50"
                        >
                          Ignore
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
      )}

      {showResolved && (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">Resolved Tickets</h2>
        <p className="mt-1 text-sm text-slate-500">
          Tickets you have resolved or closed, including resolution details.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Resolution Notes</th>
                <th className="px-4 py-3">Resolved At</th>
                <th className="px-4 py-3">Completion Time</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading resolved tickets...
                  </td>
                </tr>
              ) : resolvedTickets.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center font-bold text-slate-400">
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
                      <span className={getPriorityBadgeClass(ticket.priority)}>
                        {formatPriority(ticket.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={getStatusBadgeClass(ticket.status)}>
                        {ticket.status}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-4 text-sm leading-6 text-slate-600">
                      <span className="line-clamp-3">
                        {ticket.resolution_notes || "No notes provided."}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.resolved_at
                        ? new Date(ticket.resolved_at).toLocaleString()
                        : "Not recorded"}
                    </td>
                    <td className="px-4 py-4 text-sm font-black text-emerald-700">
                      {getTicketCompletionLabel(ticket)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

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

    if (
      form.time_spent_minutes.trim() &&
      Number.isNaN(Number(form.time_spent_minutes))
    ) {
      setError("Time spent minutes must be a number.");
      return;
    }

    try {
      setSaving(true);

      const payload = buildTicketPayload(user, {
        status: "Resolved",
        resolution_notes: form.resolution_notes.trim(),
        root_cause: form.root_cause.trim() || null,
        time_spent_minutes: form.time_spent_minutes.trim()
          ? Number(form.time_spent_minutes)
          : null,
        parts_used: form.parts_used.trim() || null,
      });

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
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
            <h2 className="mt-1 text-xl font-black text-slate-900">
              Resolve Ticket
            </h2>
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

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Resolution Notes *
            </label>
            <textarea
              value={form.resolution_notes}
              onChange={(e) => updateForm("resolution_notes", e.target.value)}
              rows={5}
              placeholder="Describe the fix, verification performed, and customer outcome..."
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Root Cause
            </label>
            <input
              value={form.root_cause}
              onChange={(e) => updateForm("root_cause", e.target.value)}
              placeholder="What caused the issue?"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Time Spent Minutes
              </label>
              <input
                value={form.time_spent_minutes}
                onChange={(e) => updateForm("time_spent_minutes", e.target.value)}
                inputMode="numeric"
                placeholder="Example: 45"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Parts Used
              </label>
              <input
                value={form.parts_used}
                onChange={(e) => updateForm("parts_used", e.target.value)}
                placeholder="Parts, licenses, or supplies used"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>
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

function Card({ icon: Icon, label, value, color }) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
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

