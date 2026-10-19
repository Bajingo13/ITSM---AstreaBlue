import { Link2 } from "lucide-react";
import { describeSlaCalendar, getSlaPolicyLabel, isConnectedSystemSla } from "../utils/ticketVisuals";

const manilaFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDue(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : manilaFormatter.format(date);
}

function basisSentence(ticket) {
  const source = ticket.origin_system || "a connected system";
  const response = describeSlaCalendar(ticket.sla_response_calendar);
  const restoration = describeSlaCalendar(ticket.sla_resolution_calendar);
  if (response === restoration) return `This ticket came from ${source}. Both its response and restoration timers count ${response}.`;
  return `This ticket came from ${source}. Its response timer counts ${response}; its restoration timer counts ${restoration}.`;
}

// Small chip for lists and cards.
export function SlaBasisBadge({ ticket }) {
  if (!isConnectedSystemSla(ticket)) return null;
  return (
    <span
      title={`${getSlaPolicyLabel(ticket)}. ${basisSentence(ticket)}`}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-700"
    >
      <Link2 size={10} />
      Partner SLA
    </span>
  );
}

// Full notice for ticket detail views.
export default function SlaBasisNotice({ ticket }) {
  if (!isConnectedSystemSla(ticket)) return null;
  return (
    <div role="note" className="rounded-2xl border-2 border-violet-200 bg-violet-50 px-5 py-4 text-sm text-violet-900 shadow-sm">
      <p className="flex items-center gap-2 font-black">
        <Link2 size={16} />
        Follows {getSlaPolicyLabel(ticket)}, not internal ITSM targets
      </p>
      <p className="mt-1 font-semibold text-violet-800">{basisSentence(ticket)}</p>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-violet-200 bg-white px-3 py-2">
          <dt className="font-black uppercase tracking-wide text-violet-500">Response due</dt>
          <dd className="mt-0.5 font-bold text-slate-800">{ticket.first_response_at ? "Responded" : formatDue(ticket.response_due_at)}</dd>
        </div>
        <div className="rounded-xl border border-violet-200 bg-white px-3 py-2">
          <dt className="font-black uppercase tracking-wide text-violet-500">Restoration due</dt>
          <dd className="mt-0.5 font-bold text-slate-800">{ticket.resolved_at ? "Restored" : formatDue(ticket.resolution_due_at)}</dd>
        </div>
      </dl>
    </div>
  );
}
