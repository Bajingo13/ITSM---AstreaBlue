import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarClock, CircleUserRound, CheckCircle2, Clock, MapPin, ShieldAlert, Ticket } from "lucide-react";
import { API_URL } from "../config/api";
import { getTicketCompletionLabel, getTicketCompletionMinutes } from "../utils/ticketDuration";

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

/* ── SLA Progress Visualization ── */
const STEPS = [
  { key: "created",     label: "Created" },
  { key: "assigned",    label: "Assigned" },
  { key: "inProgress",  label: "In Progress" },
  { key: "resolved",    label: "Resolved" },
];

const STATUS_STEP_MAP = {
  "Open Queue":      "created",
  "In Progress":     "inProgress",
  "Resolved":        "resolved",
  "Closed":          "resolved",
};

function SlaProgressBar({ status, assignedAt }) {
  const currentStep = STATUS_STEP_MAP[status] || "created";
  const effectiveStep = assignedAt && currentStep === "created" ? "assigned" : currentStep;
  const activeIdx = STEPS.findIndex((s) => s.key === effectiveStep);

  return (
    <div className="astrea-card-soft p-5">
      <h3 className="mb-4 text-sm font-bold text-slate-900">SLA Progress</h3>
      <div className="relative">
        {STEPS.length > 1 && (
          <div className="absolute left-[15px] top-3 h-[calc(100%-12px)] w-0.5 bg-slate-200" />
        )}
        <div className="space-y-0">
          {STEPS.map((step, i) => {
            const isCompleted = i <= activeIdx;
            const isCurrent = i === activeIdx;
            return (
              <div key={step.key} className="relative flex items-center gap-4 pb-5 last:pb-0">
                <div
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                    isCompleted
                      ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                      : isCurrent
                        ? "border-blue-500 bg-blue-50 text-blue-600 ring-2 ring-blue-200"
                        : "border-slate-300 bg-white text-slate-400"
                  }`}
                >
                  {isCompleted ? <CheckCircle2 size={14} /> : isCurrent ? "●" : "○"}
                </div>
                <span
                  className={`text-sm font-bold ${
                    isCompleted ? "text-emerald-700" : isCurrent ? "text-blue-700" : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── SLA Timeline Tracker ── */
function SlaTimeline({ ticket }) {
  const duration = useMemo(
    () => getTicketCompletionMinutes(ticket),
    [ticket]
  );

  const entries = [
    { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600", label: "Ticket Created", time: ticket.created_at, extra: null },
    { icon: CircleUserRound, color: "bg-blue-100 text-blue-600", label: "Assigned Technician", time: ticket.assigned_at, extra: ticket.assigned_name },
    { icon: Clock, color: "bg-amber-100 text-amber-600", label: "Work Started", time: ticket.in_progress_started_at, extra: null },
    { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600", label: ticket.status === "Closed" ? "Ticket Closed" : "Ticket Resolved", time: ticket.resolved_at || ticket.closed_at, extra: null },
  ];

  const relevantEntries = [];
  for (const entry of entries) {
    relevantEntries.push(entry);
    if (!entry.time && entry !== entries[0]) break;
  }

  return (
    <div className="astrea-card-soft p-5">
      <h3 className="mb-4 text-sm font-bold text-slate-900">SLA Activity Timeline</h3>
      <div className="relative">
        {relevantEntries.length > 1 && (
          <div className="absolute left-[15px] top-3 h-[calc(100%-24px)] w-0.5 bg-slate-200" />
        )}
        <div className="space-y-0">
          {relevantEntries.map((entry, i) => {
            const isActive = !!entry.time;
            return (
              <div key={entry.label} className="relative flex gap-4 pb-4">
                <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isActive ? entry.color : "bg-slate-100 text-slate-300"}`}>
                  <entry.icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${isActive ? "text-slate-900" : "text-slate-400"}`}>
                    {isActive ? "✓ " : "○ "}{entry.label}
                  </p>
                  {entry.extra && isActive && (
                    <p className="text-xs font-medium text-slate-600">{entry.extra}</p>
                  )}
                  {isActive && (
                    <p className="text-xs text-slate-500">{formatDate(entry.time)}</p>
                  )}
                  {!isActive && (
                    <p className="text-xs italic text-slate-400">Pending</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {duration !== null && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Completion Time</p>
          <p className="mt-1 text-lg font-black text-emerald-800">{getTicketCompletionLabel(ticket)}</p>
          <p className="mt-0.5 text-[10px] text-emerald-600">Resolved Time — In Progress Start Time</p>
        </div>
      )}
    </div>
  );
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

      {/* SLA Progress & Timeline Side-by-Side */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SlaProgressBar status={ticket.status} assignedAt={ticket.assigned_at} />
        <SlaTimeline ticket={ticket} />
      </div>
    </section>
  );
}
