export function getTicketCompletionMinutes(ticket) {
  const startedAt = ticket?.in_progress_started_at;
  const completedAt = ticket?.resolved_at || ticket?.closed_at;
  if (!startedAt || !completedAt) return null;

  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;

  return Math.max(0, Math.floor((completed - started) / 60000));
}

export function formatTicketDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return "Not recorded";
  const totalMinutes = Math.max(0, Math.floor(Number(minutes)));
  if (totalMinutes < 1) return "Less than 1 min";

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hr" : "hrs"}`);
  if (mins || parts.length === 0) parts.push(`${mins} min`);
  return parts.join(" ");
}

export function getTicketCompletionLabel(ticket) {
  return formatTicketDuration(getTicketCompletionMinutes(ticket));
}
