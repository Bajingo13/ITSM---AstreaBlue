import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Paperclip, RotateCcw, Star, Ticket, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";
import PageHero from "../components/layout/PageHero";

const API_BASE = `${API_URL}/api/v1`;

export default function MyTickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null);

  const employeeId = user?.user_id;

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch my tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const myTickets = useMemo(() => {
    return tickets.filter(
      (ticket) => Number(ticket.requester_id) === Number(employeeId)
    );
  }, [employeeId, tickets]);

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Employee Service Hub" title="My Tickets" subtitle="Track submitted requests, technician progress, and completed resolutions." compact />

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Technician</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading your tickets...
                  </td>
                </tr>
              ) : myTickets.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center font-bold text-slate-400">
                    No tickets filed yet.
                  </td>
                </tr>
              ) : (
                myTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket)}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40"
                  >
                    <td className="px-4 py-4 text-sm font-black text-blue-700">
                      {ticket.ticket_number}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-slate-900">{ticket.title}</p>
                      <p className="line-clamp-1 text-sm text-slate-400">
                        {ticket.desc || ticket.description}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.category || "Uncategorized"}
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
                      {ticket.assigned_name || "Unassigned"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : "Not recorded"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedTicket && (
        <TicketDetails
          ticket={selectedTicket}
          user={user}
          onClose={() => setSelectedTicket(null)}
          onUpdated={() => {
            setSelectedTicket(null);
            fetchTickets();
          }}
        />
      )}
    </div>
  );
}

function TicketDetails({ ticket, user, onClose, onUpdated }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [rating, setRating] = useState(ticket.satisfaction_rating || 0);

  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}${buildTicketQuery(user)}`);
      const data = await res.json();
      setDetails(data);
    } catch (err) {
      console.error("Fetch ticket details failed:", err);
    } finally {
      setLoading(false);
    }
  }, [ticket.id, user]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const item = details || ticket;

  useEffect(() => {
    setRating(item.satisfaction_rating || 0);
  }, [item.satisfaction_rating]);

  const updateTicketStatus = async (status) => {
    try {
      setUpdating(true);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { status })),
      });
      if (!res.ok) throw new Error("Failed to update ticket.");
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const submitRating = async (value) => {
    try {
      setRating(value);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { satisfaction_rating: value })),
      });
      if (!res.ok) throw new Error("Failed to save rating.");
      fetchDetails();
    } catch (err) {
      console.error(err);
    }
  };

  const openAttachment = async (attachmentId) => {
    try {
      const attachment = item.attachments?.find(
        (entry) => entry.attachment_id === attachmentId
      );
      if (!attachment?.file_path) throw new Error("Attachment file path not found");
      window.open(`${API_URL}${attachment.file_path}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-white px-7 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-blue-600">
                {item.ticket_number || `TKT-${item.id}`}
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">
                {item.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 p-8 font-bold text-slate-500">
            Loading ticket details...
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto p-7 pb-28">
            <section className="grid grid-cols-2 gap-4">
              <InfoTile label="Status" value={item.status} />
              <InfoTile label="Assigned Technician" value={item.assigned_name || "Unassigned"} />
              <InfoTile label="Priority" value={formatPriority(item.priority)} />
              <InfoTile label="Category" value={item.category || "Uncategorized"} />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 font-black text-slate-900">Description</h3>
              <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
                {item.desc || item.description || "No description provided."}
              </p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <Paperclip size={18} className="text-blue-600" />
                <h3 className="font-black text-slate-900">Attachments</h3>
              </div>
              {item.attachments?.length ? (
                <div className="space-y-2">
                  {item.attachments.map((attachment) => (
                    <button
                      key={attachment.attachment_id}
                      onClick={() => openAttachment(attachment.attachment_id)}
                      className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <span>{attachment.file_name}</span>
                      <span className="text-xs text-slate-400">
                        {attachment.mime_type}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-400">
                  No attachments uploaded.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5">
              <div className="mb-4 flex items-center gap-2">
                <CheckCircle size={18} className="text-emerald-600" />
                <h3 className="font-black text-slate-900">Resolution Details</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Resolution Notes
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-7 text-slate-700">
                    {item.resolution_notes || "No resolution notes yet."}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <InfoTile label="Root Cause" value={item.root_cause || "Not specified"} />
                  <InfoTile
                    label="Time Spent"
                    value={
                      item.time_spent_minutes !== null &&
                      item.time_spent_minutes !== undefined &&
                      item.time_spent_minutes !== ""
                        ? `${item.time_spent_minutes} minutes`
                        : "Not specified"
                    }
                  />
                  <InfoTile label="Parts Used" value={item.parts_used || "None recorded"} />
                  <InfoTile
                    label="Resolved At"
                    value={item.resolved_at ? new Date(item.resolved_at).toLocaleString() : "Not recorded"}
                  />
                </div>
              </div>
            </section>

            {(item.status === "Resolved" || item.status === "Closed") && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
                <h3 className="mb-3 font-black text-slate-900">Satisfaction Rating</h3>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      onClick={() => submitRating(value)}
                      className={`rounded-xl p-2 ${
                        value <= rating
                          ? "bg-amber-100 text-amber-600"
                          : "bg-white text-slate-300"
                      }`}
                    >
                      <Star size={22} fill={value <= rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <div className="border-t border-slate-200 bg-white/95 px-7 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
            {item.status === "Resolved" && (
              <>
                <button
                  onClick={() => updateTicketStatus("Open Queue")}
                  disabled={updating}
                  className="flex items-center gap-2 rounded-xl border border-blue-200 px-5 py-3 font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                >
                  <RotateCcw size={17} />
                  Reopen Ticket
                </button>
                <button
                  onClick={() => updateTicketStatus("Closed")}
                  disabled={updating}
                  className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-700 disabled:opacity-60"
                >
                  Accept Resolution / Close Ticket
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
    </div>
  );
}

