import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, Laptop, Monitor, ShieldCheck, Users } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/laptop-monitoring`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
const formatDuration = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${Math.round(value)} sec`;
  if (value < 3600) return `${Math.round(value / 60)} min`;
  return `${(value / 3600).toFixed(1)} hr`;
};

async function monitoringRequest(path) {
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.message || "Monitoring request failed.");
  return body.data;
}

export default function EndpointMonitoring() {
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    try {
      setError("");
      const [deviceData, summaryData] = await Promise.all([monitoringRequest("/devices"), monitoringRequest("/summary")]);
      setDevices(deviceData || []);
      setSummary(summaryData || null);
      setSelectedId((current) => current || deviceData?.[0]?.device_id || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => {
    if (!selectedId) return setDetails(null);
    monitoringRequest(`/devices/${selectedId}/activity`).then(setDetails).catch((requestError) => setError(requestError.message));
  }, [selectedId]);
  useEffect(() => {
    const timer = window.setInterval(loadOverview, 60000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const selectedDevice = devices.find((device) => String(device.device_id) === String(selectedId));
  const appUsage = useMemo(() => {
    const usage = new Map();
    for (const item of details?.activity || []) {
      const app = item.app_name || "Unknown application";
      usage.set(app, (usage.get(app) || 0) + 1);
    }
    return [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [details]);
  const cards = [
    ["Monitored Devices", summary?.total_monitored_devices || 0, Laptop],
    ["Online", summary?.online_devices || 0, Activity],
    ["Offline", summary?.offline_devices || 0, Monitor],
    ["Active Users Today", summary?.active_users_today || 0, Users],
    ["Average Idle Today", formatDuration(summary?.average_idle_seconds), Clock3],
  ];

  return <div className="space-y-6">
    <PageHero eyebrow="System Administration" title="Laptop Activity Monitoring" subtitle="Consent-aware endpoint visibility for IT and security operations—without keystroke, microphone, camera, or password collection." />
    {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><Icon size={18} className="text-blue-600" /></div><p className="mt-3 text-2xl font-black text-slate-900">{value}</p></div>)}</section>

    <section className="grid gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,2fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black text-slate-900">Monitored Devices</h2><div className="mt-4 space-y-3">{loading ? <p className="text-sm text-slate-500">Loading devices...</p> : devices.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No agent has checked in yet.</p> : devices.map((device) => <button key={device.device_id} onClick={() => setSelectedId(device.device_id)} className={`w-full rounded-2xl border p-4 text-left transition ${String(selectedId) === String(device.device_id) ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-900">{device.hostname}</p><StatusBadge status={device.status} /></div><p className="mt-2 text-sm text-slate-600">{device.assigned_user || "Unassigned / shared device"}</p><p className="text-xs text-slate-500">{device.branch_name || "No branch"} · Last seen {formatDate(device.last_seen_at)}</p><p className="mt-2 text-xs font-bold text-slate-600">Consent: {device.consent_status || "Pending"}</p></button>)}</div></div>

      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-black text-slate-900">{selectedDevice?.hostname || "Device Activity"}</h2><p className="mt-1 text-sm text-slate-500">{selectedDevice ? `${selectedDevice.assigned_user || "Unassigned"} · ${selectedDevice.branch_name || "No branch"} · Agent ${selectedDevice.agent_version || "Unknown"}` : "Select a monitored device."}</p></div>{selectedDevice && <div className="flex items-center gap-2"><StatusBadge status={selectedDevice.status} /><ConsentBadge status={selectedDevice.consent_status} /></div>}</div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2"><div><h3 className="font-black text-slate-900">Activity Timeline</h3><div className="mt-3 max-h-80 space-y-3 overflow-y-auto">{(details?.activity || []).length === 0 ? <Empty text="No activity reported." /> : details.activity.slice(0, 30).map((item) => <div key={item.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex justify-between gap-4"><p className="font-bold text-slate-900">{item.app_name || item.event_type}</p><p className="shrink-0 text-xs text-slate-500">{formatDate(item.occurred_at)}</p></div><p className="mt-1 truncate text-sm text-slate-600" title={item.window_title}>{item.window_title || "No window title"}</p><p className="mt-1 text-xs text-slate-500">Idle: {formatDuration(item.idle_seconds)}{item.url_domain ? ` · ${item.url_domain}` : ""}</p></div>)}</div></div><div><h3 className="font-black text-slate-900">Application Usage</h3><div className="mt-3 space-y-3">{appUsage.length === 0 ? <Empty text="No application data." /> : appUsage.map(([app, count]) => <div key={app} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"><span className="truncate font-bold text-slate-800">{app}</span><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-700">{count} samples</span></div>)}</div></div></div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Screenshots</h3><p className="mt-1 text-xs text-slate-500">Available only after explicit screenshot consent.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{(details?.screenshots || []).length === 0 ? <Empty text="No consent-approved screenshots." /> : details.screenshots.map((shot) => <div key={shot.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><Monitor className="text-blue-600" /><p className="mt-2 text-sm font-bold text-slate-800">{shot.reason || "Agent capture"}</p><p className="text-xs text-slate-500">{formatDate(shot.captured_at)}</p>{shot.file_url ? <a href={shot.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-black text-blue-700">View image</a> : <p className="mt-2 text-xs text-slate-500">Metadata only</p>}</div>)}</div></div><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Consent Records</h3><div className="mt-4 space-y-3">{(details?.consents || []).length === 0 ? <Empty text="No consent records." /> : details.consents.map((consent) => <div key={consent.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><div><p className="font-bold text-slate-900">{consent.consent_type}</p><p className="text-xs text-slate-500">{formatDate(consent.consented_at)}</p></div><ConsentBadge status={consent.consent_status} /></div>)}</div></div></section>
      </div>
    </section>

    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-6"><h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><AlertTriangle size={19} className="text-amber-500" /> Recent Alerts</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Device", "Severity", "Alert", "Message", "Status", "Created"].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody>{(summary?.recent_alerts || []).length === 0 ? <tr><td colSpan="6" className="p-8 text-center text-slate-500">No recent alerts.</td></tr> : summary.recent_alerts.map((alert) => <tr key={alert.id} className="border-t border-slate-100"><td className="px-5 py-4 font-bold">{alert.hostname}</td><td className="px-5 py-4">{alert.severity}</td><td className="px-5 py-4">{alert.alert_type}</td><td className="px-5 py-4 text-sm text-slate-600">{alert.message}</td><td className="px-5 py-4">{alert.status}</td><td className="px-5 py-4 text-sm text-slate-500">{formatDate(alert.created_at)}</td></tr>)}</tbody></table></div></section>

    <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6"><h2 className="flex items-center gap-2 font-black text-blue-950"><ShieldCheck size={20} /> Privacy & RA 10173 Compliance</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-semibold text-blue-900"><li>Monitoring requires informed employee consent and a documented legitimate IT/security purpose.</li><li>Screenshots require separate, explicit consent and are rejected by the API without it.</li><li>Configure and communicate an appropriate data-retention period.</li><li>Monitoring data is for authorized IT and security operations only.</li><li>This MVP does not collect keystrokes, passwords, microphone audio, or camera data.</li></ul></section>
  </div>;
}

function StatusBadge({ status = "Offline" }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${status === "Online" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{status}</span>;
}

function ConsentBadge({ status = "Pending" }) {
  const approved = ["granted", "approved", "consented"].includes(String(status).toLowerCase());
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{status || "Pending"}</span>;
}

function Empty({ text }) {
  return <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
