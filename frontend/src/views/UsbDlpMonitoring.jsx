import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileOutput,
  HardDrive,
  RefreshCw,
  Search,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const PAGE_SIZE = 25;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

function RiskBadge({ value }) {
  const styles = value === "Critical"
    ? "border-rose-200 bg-rose-100 text-rose-800"
    : value === "High"
      ? "border-orange-200 bg-orange-100 text-orange-800"
      : value === "Medium"
        ? "border-amber-200 bg-amber-100 text-amber-800"
        : "border-emerald-200 bg-emerald-100 text-emerald-800";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${styles}`}>{value || "Low"}</span>;
}

const emptyFilters = {
  risk_level: "",
  event_type: "",
  device_uuid: "",
  search: "",
  date_from: "",
  date_to: "",
};

export default function UsbDlpMonitoring() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [options, setOptions] = useState({ devices: [], event_types: [], risk_levels: [] });
  const [rules, setRules] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || "").trim()) params.set(key, String(value).trim());
    });
    return params.toString();
  }, [filters, page]);

  const load = useCallback(async () => {
    try {
      setError("");
      const [statsResponse, eventsResponse, optionsResponse, rulesResponse] = await Promise.all([
        fetch(`${API_BASE}/usb-events/stats`, { headers: authHeaders() }),
        fetch(`${API_BASE}/usb-events?${query}`, { headers: authHeaders() }),
        fetch(`${API_BASE}/usb-events/options`, { headers: authHeaders() }),
        fetch(`${API_BASE}/dlp-rules`, { headers: authHeaders() }),
      ]);
      const [statsBody, eventsBody, optionsBody, rulesBody] = await Promise.all([
        statsResponse.json(),
        eventsResponse.json(),
        optionsResponse.json(),
        rulesResponse.json(),
      ]);
      if (!statsResponse.ok || statsBody.success === false) throw new Error(statsBody.message || "Failed to load USB statistics.");
      if (!eventsResponse.ok || eventsBody.success === false) throw new Error(eventsBody.message || "Failed to load USB events.");
      if (!optionsResponse.ok || optionsBody.success === false) throw new Error(optionsBody.message || "Failed to load USB filter options.");
      if (!rulesResponse.ok || rulesBody.success === false) throw new Error(rulesBody.message || "Failed to load DLP rules.");
      setStats(statsBody.data);
      setEvents(eventsBody.data || []);
      setPagination(eventsBody.pagination || { page, page_size: PAGE_SIZE, total: eventsBody.data?.length || 0, total_pages: 1 });
      setOptions(optionsBody.data || { devices: [], event_types: [], risk_levels: [] });
      setRules(rulesBody.data || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const cards = [
    ["Events Today", stats?.events_today || 0, HardDrive],
    ["Files Written", stats?.transfers_today || 0, FileOutput],
    ["High Risk", stats?.high_risk_today || 0, AlertTriangle],
    ["DLP Incidents", stats?.incidents_today || 0, TicketCheck],
  ];

  return (
    <div className="space-y-6 pb-20">
      <PageHero
        eyebrow="Endpoint Security"
        title="USB & DLP Monitoring"
        subtitle="Consent-aware removable-media events, transfer metadata, server-side risk scoring, and controlled incident creation."
      />

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p>
              <Icon size={18} className="text-blue-600" />
            </div>
            <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
          <div className="flex gap-3">
            <ShieldCheck className="shrink-0 text-blue-600" />
            <div>
              <p className="font-black">Privacy-controlled metadata collection</p>
              <p className="mt-1">AstreaBlue records removable-device details and metadata for files written to USB media. File contents are never uploaded. Collection stops when approved USB consent or policy permission is withdrawn.</p>
              <p className="mt-2 font-bold">Mode: detect, record, alert, and optionally create an incident. Transfers are not blocked.</p>
            </div>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-900">Active risk scoring guide</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-2"><strong>+55</strong><br />Risk extension</div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2"><strong>+35</strong><br />Sensitive name</div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-2"><strong>+25</strong><br />Large transfer</div>
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-600">
            Medium {rules?.thresholds?.medium ?? 25}+ · High {rules?.thresholds?.high ?? 50}+ · Critical {rules?.thresholds?.critical ?? 70}+
          </p>
          <p className="mt-1 text-xs text-slate-500">Current large-transfer threshold: {rules?.largeTransferMb ?? 100} MB. Device-specific policies may override it.</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">USB Event Timeline</h2>
              <p className="text-sm text-slate-600">{pagination.total} matching events · 25 per page</p>
            </div>
            <button type="button" onClick={load} className="rounded-xl border border-blue-200 bg-blue-50 p-2 text-blue-700 hover:bg-blue-100" aria-label="Refresh USB events">
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="relative xl:col-span-2">
              <Search className="absolute left-3 top-3 text-slate-400" size={17} />
              <input
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Search endpoint, employee, USB, or file"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500"
              />
            </label>
            <select value={filters.risk_level} onChange={(event) => updateFilter("risk_level", event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <option value="">All risk levels</option>
              {options.risk_levels.map((value) => <option key={value}>{value}</option>)}
            </select>
            <select value={filters.event_type} onChange={(event) => updateFilter("event_type", event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <option value="">All event types</option>
              {options.event_types.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select>
            <select value={filters.device_uuid} onChange={(event) => updateFilter("device_uuid", event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 xl:col-span-2">
              <option value="">All endpoints</option>
              {options.devices.map((device) => <option key={device.device_uuid} value={device.device_uuid}>{device.hostname || device.device_name}</option>)}
            </select>
            <label className="text-xs font-black uppercase tracking-wide text-slate-500">
              From date
              <input type="date" value={filters.date_from} onChange={(event) => updateFilter("date_from", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700" />
            </label>
            <label className="text-xs font-black uppercase tracking-wide text-slate-500">
              To date
              <input type="date" value={filters.date_to} onChange={(event) => updateFilter("date_to", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700" />
            </label>
            <button type="button" onClick={() => { setFilters(emptyFilters); setPage(1); }} className="self-end rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
              Clear filters
            </button>
          </div>
        </div>

        <div className="max-h-[620px] overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600">
              <tr>{["Time", "Endpoint", "Event", "USB Device", "File Metadata", "Risk", "Action"].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="p-10 text-center text-slate-600">Loading USB events...</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan="7" className="p-10 text-center text-slate-600">No consent-approved USB events match these filters.</td></tr>
              ) : events.map((event) => (
                <tr key={event.id} className="border-t border-slate-100 align-top transition hover:bg-blue-50/50">
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(event.occurred_at)}</td>
                  <td className="px-5 py-4"><p className="font-bold text-slate-900">{event.hostname}</p><p className="text-xs text-slate-600">{event.assigned_user || "Unassigned"} · {event.branch_name || "No branch"}</p></td>
                  <td className="px-5 py-4 font-bold capitalize text-slate-800">{String(event.event_type).replaceAll("_", " ")}</td>
                  <td className="px-5 py-4"><p className="font-semibold text-slate-800">{event.drive_letter || "—"} {event.volume_label || "Removable media"}</p><p className="text-xs text-slate-600">{event.volume_serial || "No serial"} · {event.filesystem || "Unknown FS"}</p></td>
                  <td className="max-w-sm px-5 py-4"><p className="truncate font-semibold text-slate-800" title={event.relative_path}>{event.file_name || "—"}</p>{event.file_name && <p className="text-xs text-slate-600">{formatBytes(event.file_size_bytes)} · {event.extension || "No extension"}</p>}<p className="mt-1 text-xs font-semibold text-amber-700">{(event.rule_matches || []).join("; ")}</p></td>
                  <td className="px-5 py-4"><RiskBadge value={event.risk_level} /><p className="mt-1 text-xs text-slate-600">Score {event.risk_score || 0}</p></td>
                  <td className="px-5 py-4"><p className="font-semibold capitalize text-slate-700">{String(event.dlp_action || "logged").replaceAll("_", " ")}</p>{event.ticket_id && <p className="text-xs font-bold text-blue-700">Ticket #{event.ticket_id}</p>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-4">
          <p className="text-sm font-semibold text-slate-600">Page {pagination.page} of {pagination.total_pages}</p>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={18} /></button>
            <button type="button" disabled={page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight size={18} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}
