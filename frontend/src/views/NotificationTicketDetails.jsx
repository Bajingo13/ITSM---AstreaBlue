import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarClock, CircleUserRound, MapPin, ShieldAlert, Ticket } from "lucide-react";
import { API_URL } from "../config/api";

function valueOrFallback(value, fallback = "Not set") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not set"
    : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function NotificationTicketDetails() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    async function loadTicket() {
      try {
        const response = await fetch(`${API_URL}/api/v1/tickets/${ticketId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(
            response.status === 403
              ? "You do not have permission to view this ticket."
              : response.status === 404
                ? "Ticket not found or no longer available."
                : data.message || data.error || "Unable to load this ticket."
          );
          return;
        }
        setTicket(data);
      } catch (error) {
        if (error.name !== "AbortError") setMessage("Unable to load this ticket.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadTicket();
    return () => controller.abort();
  }, [ticketId]);

  if (loading) return <div className="astrea-card p-8 text-sm font-semibold text-slate-500">Loading ticket details…</div>;

  if (!ticket) {
    return (
      <section className="astrea-card mx-auto max-w-2xl p-8 text-center">
        <ShieldAlert className="mx-auto text-amber-500" size={42} />
        <h1 className="mt-4 text-xl font-bold text-slate-900">Ticket unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <button className="astrea-button astrea-button-secondary mt-6" onClick={() => navigate(-1)}>Go back</button>
      </section>
    );
  }

  const fields = [
    ["Ticket Number", ticket.ticket_number, Ticket],
    ["Priority", ticket.priority, AlertTriangle],
    ["Status", ticket.status, CalendarClock],
    ["Assigned Technician", ticket.assigned_name, CircleUserRound],
    ["Requester", ticket.requester_name, CircleUserRound],
    ["Created Date", formatDate(ticket.created_at), CalendarClock],
    ["Branch / Department", ticket.branch_name, MapPin],
    ["SLA State", ticket.resolution_sla_status || ticket.response_sla_status, CalendarClock],
  ];

  return (
    <section className="space-y-5">
      <button className="astrea-button astrea-button-secondary" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>
      <article className="astrea-card overflow-hidden">
        <header className="border-b border-slate-200 bg-gradient-to-r from-blue-950 via-blue-800 to-cyan-600 p-6 text-white">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">Ticket details</p>
          <h1 className="mt-2 text-2xl font-bold">{valueOrFallback(ticket.title, "Untitled ticket")}</h1>
        </header>
        <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
          {fields.map(([label, value, Icon]) => (
            <div key={label} className="astrea-card-soft p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Icon size={14} /> {label}</div>
              <p className="mt-2 break-words text-sm font-semibold text-slate-900">{valueOrFallback(value)}</p>
            </div>
          ))}
        </div>
        <div className="px-6 pb-6">
          <div className="astrea-card-soft p-5">
            <h2 className="text-sm font-bold text-slate-900">Description</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{valueOrFallback(ticket.description || ticket.desc, "No description provided.")}</p>
          </div>
        </div>
      </article>
    </section>
  );
}
