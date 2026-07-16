import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileOutput, HardDrive, RefreshCw, ShieldCheck, TicketCheck } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

function RiskBadge({ value }) {
  const styles = value === "Critical" ? "bg-rose-100 text-rose-800" : value === "High" ? "bg-orange-100 text-orange-800" : value === "Medium" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${styles}`}>{value || "Low"}</span>;
}

export default function UsbDlpMonitoring() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [risk, setRisk] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const suffix = risk ? `?risk_level=${encodeURIComponent(risk)}` : "";
      const [statsResponse, eventsResponse] = await Promise.all([
        fetch(`${API_BASE}/usb-events/stats`, { headers: authHeaders() }),
        fetch(`${API_BASE}/usb-events${suffix}`, { headers: authHeaders() }),
      ]);
      const [statsBody, eventsBody] = await Promise.all([statsResponse.json(), eventsResponse.json()]);
      if (!statsResponse.ok || statsBody.success === false) throw new Error(statsBody.message || "Failed to load USB statistics.");
      if (!eventsResponse.ok || eventsBody.success === false) throw new Error(eventsBody.message || "Failed to load USB events.");
      setStats(statsBody.data);
      setEvents(eventsBody.data || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [risk]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const cards = [
    ["Events Today", stats?.events_today || 0, HardDrive],
    ["Files Written", stats?.transfers_today || 0, FileOutput],
    ["High Risk", stats?.high_risk_today || 0, AlertTriangle],
    ["DLP Incidents", stats?.incidents_today || 0, TicketCheck],
  ];

  return (
    <div className="space-y-6 pb-20">
      <PageHero eyebrow="Endpoint Security" title="USB & DLP Monitoring" subtitle="Consent-aware removable-media events, transfer metadata, risk scoring, and controlled incident creation." />

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><Icon size={18} className="text-blue-600" /></div><p className="mt-3 text-2xl font-black text-slate-900">{value}</p></div>)}
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
        <div className="flex gap-3"><ShieldCheck className="shrink-0 text-blue-600" /><div><p className="font-black">Privacy-controlled collection</p><p className="mt-1">AstreaBlue records removable-device connection data and metadata for files written to USB media. File contents are not uploaded. Collection stops when approved USB consent or policy permission is withdrawn.</p></div></div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div><h2 className="text-lg font-black text-slate-900">USB Event Timeline</h2><p className="text-sm text-slate-500">Device connections, removals, and files written to removable media.</p></div>
          <div className="flex gap-2"><select value={risk} onChange={(event) => setRisk(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"><option value="">All risk levels</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><button type="button" onClick={load} className="rounded-xl border border-slate-200 p-2 text-blue-600 hover:bg-blue-50" aria-label="Refresh USB events"><RefreshCw size={18} /></button></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Time", "Endpoint", "Event", "USB Device", "File Metadata", "Risk", "Action"].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="7" className="p-10 text-center text-slate-500">Loading USB events...</td></tr> : events.length === 0 ? <tr><td colSpan="7" className="p-10 text-center text-slate-500">No consent-approved USB events reported.</td></tr> : events.map((event) => (
                <tr key={event.id} className="border-t border-slate-100 align-top transition hover:bg-blue-50/40">
                  <td className="whitespace-nowrap px-5 py-4 text-slate-500">{formatDate(event.occurred_at)}</td>
                  <td className="px-5 py-4"><p className="font-bold text-slate-900">{event.hostname}</p><p className="text-xs text-slate-500">{event.assigned_user || "Unassigned"} · {event.branch_name || "No branch"}</p></td>
                  <td className="px-5 py-4 font-bold text-slate-800">{String(event.event_type).replaceAll("_", " ")}</td>
                  <td className="px-5 py-4"><p className="font-semibold text-slate-800">{event.drive_letter || "—"} {event.volume_label || "Removable media"}</p><p className="text-xs text-slate-500">{event.volume_serial || "No serial"} · {event.filesystem || "Unknown FS"}</p></td>
                  <td className="max-w-sm px-5 py-4"><p className="truncate font-semibold text-slate-800" title={event.relative_path}>{event.file_name || "—"}</p>{event.file_name && <p className="text-xs text-slate-500">{formatBytes(event.file_size_bytes)} · {event.extension || "No extension"}</p>}<p className="mt-1 text-xs text-amber-700">{(event.rule_matches || []).join("; ")}</p></td>
                  <td className="px-5 py-4"><RiskBadge value={event.risk_level} /><p className="mt-1 text-xs text-slate-500">Score {event.risk_score || 0}</p></td>
                  <td className="px-5 py-4"><p className="font-semibold text-slate-700">{String(event.dlp_action || "logged").replaceAll("_", " ")}</p>{event.ticket_id && <p className="text-xs font-bold text-blue-700">Ticket #{event.ticket_id}</p>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
