import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, Clock3, Laptop, Monitor, ShieldCheck, Users } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/laptop-monitoring`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
const secondsSince = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)) : null;
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState(null);
  
  const [selectedIdState, setSelectedIdState] = useState(() => {
    const val = searchParams.get("deviceId");
    return (val && !val.includes("=>")) ? val : null;
  });
  const [activeTabState, setActiveTabState] = useState(searchParams.get("tab") || "overview");
  
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [debugInfo, setDebugInfo] = useState(null);
  
  const activeTab = activeTabState;
  const selectedId = selectedIdState;

  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    setSearchParams(prev => {
      prev.set("tab", tab);
      return prev;
    });
  };

  const setSelectedId = (id) => {
    setSelectedIdState(id);
    setSearchParams(prev => {
      if (id) prev.set("deviceId", id);
      else prev.delete("deviceId");
      return prev;
    });
  };

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "devices", label: "Monitored Devices" },
    { id: "activity", label: "Activity Timeline" },
    { id: "screenshots", label: "Screenshots" },
    { id: "alerts", label: "Alerts" },
    { id: "consent", label: "Consent Management" },
    { id: "policies", label: "Policies" }
  ];
  
  const [showLinkAssetModal, setShowLinkAssetModal] = useState(false);
  const [showAssignEmployeeModal, setShowAssignEmployeeModal] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [branchesList, setBranchesList] = useState([]);
  const [assetsList, setAssetsList] = useState([]);
  const [assignForm, setAssignForm] = useState({ assigned_user_id: "", branch_id: "", asset_id: "", department: "", reason: "" });
  const [assignLoading, setAssignLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      setError("");
      const [deviceData, summaryData] = await Promise.all([monitoringRequest("/devices"), monitoringRequest("/summary")]);
      setDevices(deviceData || []);
      setSummary(summaryData || null);
      const uuidFromUrl = searchParams.get("device_uuid");
      if (uuidFromUrl) {
        const found = (deviceData || []).find(d => String(d.device_uuid) === String(uuidFromUrl));
        if (found) setSelectedIdState(found.device_id);
      } else if (!selectedIdState) {
        setSelectedIdState(deviceData?.[0]?.device_id || null);
      }
      monitoringRequest("/debug").then(setDebugInfo).catch(() => setDebugInfo(null));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => {
    if (!selectedId || typeof selectedId === "function" || String(selectedId).includes("=>")) {
      return setDetails(null);
    }
    monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/activity`).then(setDetails).catch((requestError) => setError(requestError.message));
  }, [selectedId]);
  useEffect(() => {
    const timer = window.setInterval(loadOverview, 60000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const selectedDevice = devices.find((device) => String(device.device_id) === String(selectedId));
  
  const handleOpenAssign = async (type) => {
    try {
      const [uRes, bRes, aRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/users`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/v1/branches`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/v1/hardware-assets`, { headers: authHeaders() })
      ]);
      if (uRes.ok) {
        const uData = await uRes.json();
        setUsersList(Array.isArray(uData) ? uData : uData.data || []);
      }
      if (bRes.ok) {
        const bData = await bRes.json();
        setBranchesList(Array.isArray(bData) ? bData : bData.data || []);
      }
      if (aRes.ok) {
        const aData = await aRes.json();
        setAssetsList((Array.isArray(aData) ? aData : aData.data || []).filter(a => ['Laptop', 'Desktop', 'Company Device'].includes(a.asset_type) && (!a.monitoring_device_uuid || String(a.asset_id) === String(selectedDevice?.asset_id))));
      }
      setAssignForm({
        assigned_user_id: selectedDevice?.assigned_user_id || "",
        branch_id: selectedDevice?.branch_id || "",
        department: selectedDevice?.department || "",
        asset_id: selectedDevice?.asset_id || "",
        reason: ""
      });
      if (type === 'asset') setShowLinkAssetModal(true);
      if (type === 'employee') setShowAssignEmployeeModal(true);
    } catch (e) {
      console.error(e);
      alert("Failed to load assignment data.");
    }
  };

  const submitAssign = async () => {
    setAssignLoading(true);
    try {
      let payload = { ...assignForm };
      
      if (showLinkAssetModal && payload.asset_id) {
        const linkedAsset = assetsList.find(a => String(a.asset_id) === String(payload.asset_id));
        if (linkedAsset) {
          payload.branch_id = linkedAsset.branch_id || null;
          payload.department = linkedAsset.department || linkedAsset.location || null;
        }
      }

      const response = await fetch(`${API_BASE}/devices/${selectedId}/assign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to assign device");
      setShowLinkAssetModal(false);
      setShowAssignEmployeeModal(false);
      loadOverview();
    } catch (e) {
      alert("Assignment failed: " + e.message);
    } finally {
      setAssignLoading(false);
    }
  };

  const handleDeleteDevice = async () => {
    if (!window.confirm("Are you sure you want to permanently delete this device and all its monitoring logs?")) return;
    try {
      const response = await fetch(`${API_BASE}/devices/${selectedId}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete device");
      setSelectedId("");
      loadOverview();
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  };

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
    {debugInfo && <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><h2 className="font-black">SuperAdmin Monitoring Debug</h2><div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3"><p><span className="font-bold">Backend URL:</span> {API_URL}</p><p><span className="font-bold">Database source:</span> {debugInfo.backend_source}</p><p><span className="font-bold">Total devices returned:</span> {devices.length}</p><p><span className="font-bold">Device UUID:</span> {selectedDevice?.device_uuid || "Select a device"}</p><p><span className="font-bold">Hostname:</span> {selectedDevice?.hostname || "Select a device"}</p><p><span className="font-bold">Last heartbeat:</span> {formatDate(selectedDevice?.last_seen_at)}</p><p><span className="font-bold">Seconds since heartbeat:</span> {secondsSince(selectedDevice?.last_seen_at) ?? "No heartbeat"}</p><p><span className="font-bold">Online threshold:</span> {debugInfo.online_threshold_seconds} seconds</p><p><span className="font-bold">Current status:</span> {selectedDevice?.status || "Unknown"}</p></div></section>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><Icon size={18} className="text-blue-600" /></div><p className="mt-3 text-2xl font-black text-slate-900">{value}</p></div>)}</section>

    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-px">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`shrink-0 border-b-2 px-4 py-2 text-sm font-black transition ${activeTab === tab.id ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {tab.label}
        </button>
      ))}
    </div>

    {activeTab === "overview" && (
      <div className="space-y-6">
        <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6"><h2 className="flex items-center gap-2 font-black text-blue-950"><ShieldCheck size={20} /> Privacy & RA 10173 Compliance</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-semibold text-blue-900"><li>Monitoring requires informed employee consent and a documented legitimate IT/security purpose.</li><li>Screenshots require separate, explicit consent and are rejected by the API without it.</li><li>Configure and communicate an appropriate data-retention period.</li><li>Monitoring data is for authorized IT and security operations only.</li><li>This MVP does not collect keystrokes, passwords, microphone audio, or camera data.</li></ul></section>
        <p className="text-slate-600">Select a tab above to view detailed monitoring data.</p>
      </div>
    )}

    {activeTab === "devices" && (
    <section className="grid gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,2fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black text-slate-900">Monitored Devices</h2><div className="mt-4 space-y-3">{loading ? <p className="text-sm text-slate-500">Loading devices...</p> : devices.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No agent has checked in yet.</p> : devices.map((device) => <button key={device.device_id} onClick={() => setSelectedId(device.device_id)} className={`w-full rounded-2xl border p-4 text-left transition ${String(selectedId) === String(device.device_id) ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><div><p className="font-black text-slate-900">{device.device_name || device.hostname}</p><p className="text-xs text-slate-500">{device.hostname}</p></div><StatusBadge status={device.status} /></div>
      <div className="mt-2 flex flex-wrap gap-1">
        {!device.asset_id ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">Unlinked Device</span> : <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">Linked Asset</span>}
        {!device.assigned_user_id ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">Unassigned Employee</span> : null}
      </div>
      <p className="mt-2 text-sm text-slate-600">{device.assigned_user || "Unassigned / shared device"}</p><p className="text-xs text-slate-500">{device.branch_name || "No branch"} · {device.department || "No department"}</p><div className="mt-2 text-xs font-semibold text-slate-500"><p>Consent: {device.consent_status || "Pending"}</p><p>Policy Synced: {device.policy_synced_at ? formatDate(device.policy_synced_at) : "Never"}</p></div><div className="mt-2 text-[10px] text-slate-400"><p>Last Seen: {formatDate(device.last_seen_at)}</p><p>Last Activity: {device.last_activity ? formatDate(device.last_activity) : "Never"}</p><p>Last Screenshot: {device.last_screenshot ? formatDate(device.last_screenshot) : "Never"}</p></div><p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={device.device_uuid}>{device.device_uuid || "Legacy device awaiting UUID"}</p></button>)}</div></div>

      <div className="space-y-6">
        {!selectedDevice ? (
           <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-sm">
             <Laptop className="mx-auto mb-4 text-slate-300" size={48} />
             <h2 className="text-xl font-black text-slate-900">No Device Selected</h2>
             <p className="mt-2 text-slate-500">Select a device from the list to view its activity, or install the monitoring agent on a new device.</p>
           </div>
        ) : (
          <>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h2 className="text-xl font-black text-slate-900">{selectedDevice?.hostname || "Device Activity"}</h2>
            {selectedDevice && (
              <div className="flex items-center gap-2">
                <StatusBadge status={selectedDevice.status} />
                <ConsentBadge status={selectedDevice.consent_status} />
                {isSuperAdmin && (
                  <button onClick={handleDeleteDevice} className="ml-4 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 transition">
                    Delete Device
                  </button>
                )}
              </div>
            )}
          </div>
          
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider text-slate-500 mb-3">Technical Identity</h3>
              <div className="space-y-2 text-sm text-slate-600">
                <p><span className="font-bold">Device UUID:</span> <span className="font-mono text-xs">{selectedDevice?.device_uuid || "Pending"}</span></p>
                <p><span className="font-bold">Hostname:</span> {selectedDevice?.hostname}</p>
                <p><span className="font-bold">Device Name:</span> {selectedDevice?.device_name || "—"}</p>
                <p><span className="font-bold">Agent Version:</span> {selectedDevice?.agent_version || "—"}</p>
                <p><span className="font-bold">Current Logged-in User:</span> {selectedDevice?.logged_in_user || "—"}</p>
              </div>
            </div>
            
            <div>
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider text-slate-500 mb-3">Linked Hardware Asset</h3>
              <div className="space-y-2 text-sm text-slate-600">
                {selectedDevice?.asset_id ? (
                  <>
                    <p><span className="font-bold">Asset Tag:</span> <a href="/dashboard/hardware-assets" className="text-blue-600 hover:underline">{selectedDevice?.asset_tag}</a></p>
                    <p><span className="font-bold">Asset Name:</span> {selectedDevice?.asset_name}</p>
                    <p><span className="font-bold">Brand/Model:</span> {selectedDevice?.model || "—"}</p>
                    <div className="mt-3"><button onClick={() => handleOpenAssign('asset')} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Change Asset</button></div>
                  </>
                ) : (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                    <p className="text-xs font-bold text-amber-800 flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span> Unlinked Device</p>
                    <button onClick={() => handleOpenAssign('asset')} className="mt-2 w-full rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">Link to Hardware Asset</button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider text-slate-500 mb-3">Asset Ownership</h3>
              <div className="space-y-2 text-sm text-slate-600">
                {selectedDevice?.assigned_user_id ? (
                  <>
                    <p><span className="font-bold">Assigned Employee:</span> {selectedDevice?.assigned_user}</p>
                    <p><span className="font-bold">Branch:</span> {selectedDevice?.branch_name || "—"}</p>
                    <p><span className="font-bold">Department:</span> {selectedDevice?.department || "—"}</p>
                    <div className="mt-3"><button onClick={() => handleOpenAssign('employee')} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Reassign Employee</button></div>
                  </>
                ) : (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                    <p className="text-xs font-bold text-amber-800 flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span> Unassigned Employee</p>
                    {selectedDevice?.asset_id ? (
                      <button onClick={() => handleOpenAssign('employee')} className="mt-2 w-full rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">Assign Employee</button>
                    ) : (
                      <div className="mt-2 text-center">
                        <button disabled className="w-full rounded-xl bg-slate-300 px-3 py-1.5 text-xs font-bold text-slate-500 cursor-not-allowed">Assign Employee</button>
                        <p className="mt-2 text-[10px] text-amber-700">Link a hardware asset first.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider text-slate-500 mb-3">Consent / Policy</h3>
              <div className="space-y-2 text-sm text-slate-600">
                <p><span className="font-bold">Consent Status:</span> {selectedDevice?.consent_status || "Pending"}</p>
                <p><span className="font-bold">Policy Status:</span> {selectedDevice?.policy_synced_at ? "Synced" : "Pending"}</p>
                <p><span className="font-bold">Last Policy Sync:</span> {formatDate(selectedDevice?.policy_synced_at)}</p>
              </div>
            </div>
          </div>
          
          {selectedDevice && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="font-black text-slate-900 flex items-center gap-2">Setup Checklist</h4>
              <ul className="mt-3 space-y-2 text-sm font-semibold">
                <li className={`flex items-center gap-2 ${selectedDevice.asset_id ? 'text-green-600' : 'text-amber-600'}`}>
                  {selectedDevice.asset_id ? '✓ Hardware Asset Linked' : '⚠ Unlinked'}
                </li>
                <li className={`flex items-center gap-2 ${selectedDevice.assigned_user_id ? 'text-green-600' : 'text-amber-600'}`}>
                  {selectedDevice.assigned_user_id ? '✓ Employee Assigned' : '⚠ Unassigned'}
                </li>
                <li className={`flex items-center gap-2 ${selectedDevice.consent_status === 'signed' ? 'text-green-600' : 'text-amber-600'}`}>
                  {selectedDevice.consent_status === 'signed' ? '✓ Consent Confirmed' : '⚠ Consent Pending'}
                </li>
              </ul>
            </div>
          )}
        </section>
          <div className="mt-6 grid gap-6 lg:grid-cols-2"><div><h3 className="font-black text-slate-900">Activity Timeline</h3><div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
            {(()=>{
              const act = (details?.activity || []).map(a => ({ ...a, _type: a.event_type === 'system_audit' ? 'audit' : 'activity', _date: new Date(a.occurred_at) }));
              const shots = (details?.screenshots || []).map(s => ({ ...s, _type: 'screenshot', _date: new Date(s.captured_at) }));
              const reg = selectedDevice ? [{ id: 'reg', _type: 'audit', _date: new Date(selectedDevice.created_at || selectedDevice.last_seen_at), app_name: "Device registered", window_title: `Device UUID: ${selectedDevice.device_uuid || "Legacy"}` }] : [];
              const assign = (details?.assignments || []).map(a => ({ ...a, _type: 'assignment', _date: new Date(a.changed_at) }));
              const timeline = [...act, ...shots, ...assign, ...reg].sort((a, b) => b._date - a._date).slice(0, 30);
              if (timeline.length === 0) return <Empty text="No activity reported." />;
              return timeline.map((item, i) => {
                if (item._type === 'screenshot') return (
                  <div key={`shot-${item.id}-${i}`} className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><div className="flex justify-between gap-4"><p className="font-bold text-blue-900 flex items-center gap-2"><Monitor size={14}/> Screenshot Captured</p><p className="shrink-0 text-xs text-slate-500">{formatDate(item.captured_at)}</p></div><p className="mt-1 text-sm text-slate-600">Employee: {selectedDevice?.assigned_user || "Unassigned"} · Hostname: {selectedDevice?.hostname}</p>{item.file_url ? <a href={item.file_url} target="_blank" rel="noreferrer" onClick={() => fetch(`${API_URL}/api/v1/laptop-monitoring/screenshots/${item.id}/audit-view`, { method: "POST", headers: authHeaders() }).catch(console.error)} className="mt-2 inline-block rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700">Open Screenshot</a> : <p className="mt-1 text-xs text-slate-500">Metadata only</p>}</div>
                );
                if (item._type === 'assignment') return (
                  <div key={`assign-${item.id}-${i}`} className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><div className="flex justify-between gap-4"><p className="font-bold text-violet-900 flex items-center gap-2"><Users size={14}/> Device Assignment</p><p className="shrink-0 text-xs text-slate-500">{formatDate(item.changed_at)}</p></div><p className="mt-1 text-sm text-slate-700"><span className="font-semibold text-slate-500">From:</span> {item.old_user_name || "Unassigned"} → <span className="font-semibold text-slate-500">To:</span> {item.new_user_name || "Unassigned"}</p>{item.reason && <p className="mt-1 text-xs text-slate-500">Reason: {item.reason}</p>}</div>
                );
                if (item._type === 'audit') return (
                  <div key={`audit-${item.id}-${i}`} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex justify-between gap-4"><p className="font-bold text-slate-900">{item.app_name}</p><p className="shrink-0 text-xs text-slate-500">{formatDate(item._date)}</p></div><p className="mt-1 text-sm text-slate-600">{item.window_title}</p></div>
                );
                return (
                  <div key={`act-${item.id}-${i}`} className="rounded-2xl bg-slate-50 p-4"><div className="flex justify-between gap-4"><p className="font-bold text-slate-900">{item.app_name || item.event_type}</p><p className="shrink-0 text-xs text-slate-500">{formatDate(item.occurred_at)}</p></div><p className="mt-1 truncate text-sm text-slate-600" title={item.window_title}>{item.window_title || "No window title"}</p><p className="mt-1 text-xs text-slate-500">Idle: {formatDuration(item.idle_seconds)}{item.url_domain ? ` · ${item.url_domain}` : ""}</p></div>
                );
              });
            })()}
          </div></div><div><h3 className="font-black text-slate-900">Application Usage</h3><div className="mt-3 space-y-3">{appUsage.length === 0 ? <Empty text="No application data." /> : appUsage.map(([app, count]) => <div key={app} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"><span className="truncate font-bold text-slate-800">{app}</span><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-700">{count} samples</span></div>)}</div></div></div>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Hardware Inventory (Agent-Detected)</h3><div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-4">{!details?.hardware ? <Empty text="No hardware scan available." /> : <><div className="col-span-2"><p className="text-xs font-bold uppercase text-slate-500">System</p><p className="text-sm font-semibold text-slate-900">{details.hardware.manufacturer} {details.hardware.model}</p><p className="text-xs text-slate-500">Serial: {details.hardware.serial_number}</p></div><div className="col-span-2"><p className="text-xs font-bold uppercase text-slate-500">Processor & Memory</p><p className="text-sm font-semibold text-slate-900">{details.hardware.cpu_name}</p><p className="text-xs text-slate-500">{details.hardware.total_ram_gb} GB RAM</p></div><div className="col-span-2"><p className="text-xs font-bold uppercase text-slate-500">Operating System</p><p className="text-sm font-semibold text-slate-900">{details.hardware.os_name} {details.hardware.os_version}</p><p className="text-xs text-slate-500">Build {details.hardware.os_build} ({details.hardware.architecture})</p></div><div className="col-span-2"><p className="text-xs font-bold uppercase text-slate-500">Storage & Network</p><p className="text-sm font-semibold text-slate-900">{details.hardware.disk_free_gb} GB free of {details.hardware.disk_total_gb} GB</p><p className="text-xs text-slate-500">IP: {details.hardware.ip_address} A MAC: {details.hardware.mac_address}</p></div></>}</div></section>
        <section className="mt-6 grid gap-6 lg:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Screenshots</h3><p className="mt-1 text-xs text-slate-500">Available only after explicit screenshot consent.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{(details?.screenshots || []).length === 0 ? <Empty text="No consent-approved screenshots." /> : details.screenshots.map((shot) => <div key={shot.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><Monitor className="text-blue-600" /><p className="mt-2 text-sm font-bold text-slate-800">{shot.reason || "Agent capture"}</p><p className="text-xs text-slate-500">{formatDate(shot.captured_at)}</p>{shot.file_url ? <a href={shot.file_url} target="_blank" rel="noreferrer" onClick={() => fetch(`${API_URL}/api/v1/laptop-monitoring/screenshots/${shot.id}/audit-view`, { method: "POST", headers: authHeaders() }).catch(console.error)} className="mt-2 inline-block text-xs font-black text-blue-700">View image</a> : <p className="mt-2 text-xs text-slate-500">Metadata only</p>}</div>)}</div></div><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Consent Records</h3><div className="mt-4 space-y-3">{(details?.consents || []).length === 0 ? <Empty text="No consent records." /> : details.consents.map((consent) => <div key={consent.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><div><p className="font-bold text-slate-900">{consent.consent_type}</p><p className="text-xs text-slate-500">{formatDate(consent.consented_at)}</p></div><ConsentBadge status={consent.consent_status} /></div>)}</div></div></section>
          </>
        )}
      </div>
    </section>
    )}

    {activeTab === "alerts" && (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-6"><h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><AlertTriangle size={19} className="text-amber-500" /> Recent Alerts</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Device", "Severity", "Alert", "Message", "Status", "Created"].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody>{(summary?.recent_alerts || []).length === 0 ? <tr><td colSpan="6" className="p-8 text-center text-slate-500">No recent alerts.</td></tr> : summary.recent_alerts.map((alert) => <tr key={alert.id} className="border-t border-slate-100"><td className="px-5 py-4 font-bold">{alert.hostname}</td><td className="px-5 py-4">{alert.severity}</td><td className="px-5 py-4">{alert.alert_type}</td><td className="px-5 py-4 text-sm text-slate-600">{alert.message}</td><td className="px-5 py-4">{alert.status}</td><td className="px-5 py-4 text-sm text-slate-500">{formatDate(alert.created_at)}</td></tr>)}</tbody></table></div></section>
    )}

    {activeTab === "screenshots" && (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
        <Monitor className="mx-auto mb-4 text-slate-300" size={48} />
        <h3 className="mb-2 text-xl font-black text-slate-900">Screenshots</h3>
        <p>Screenshot Monitoring will appear here after device assignment, active consent, and screenshot policy are enabled.</p>
        <button onClick={() => setActiveTab('devices')} className="mt-4 rounded-xl bg-blue-600 px-6 py-2 text-sm font-bold text-white hover:bg-blue-700">Go to Devices</button>
      </div>
    )}

    {activeTab === "consent" && (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
        <ShieldCheck className="mx-auto mb-4 text-slate-300" size={48} />
        <h3 className="mb-2 text-xl font-black text-slate-900">Consent Management</h3>
        <p>Consent records and monitoring permissions will appear here after employees submit RA 10173 consent.</p>
        <button onClick={() => setActiveTab('devices')} className="mt-4 rounded-xl bg-blue-600 px-6 py-2 text-sm font-bold text-white hover:bg-blue-700">Go to Devices</button>
      </div>
    )}

    {activeTab === "policies" && (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
        <Users className="mx-auto mb-4 text-slate-300" size={48} />
        <h3 className="mb-2 text-xl font-black text-slate-900">Policies</h3>
        <p>Monitoring policies are generated from device assignment and consent records.</p>
        <button onClick={() => setActiveTab('devices')} className="mt-4 rounded-xl bg-blue-600 px-6 py-2 text-sm font-bold text-white hover:bg-blue-700">Go to Devices</button>
      </div>
    )}

    {activeTab === "activity" && (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
        <Activity className="mx-auto mb-4 text-slate-300" size={48} />
        <h3 className="mb-2 text-xl font-black text-slate-900">Activity Timeline</h3>
        <p className="font-bold text-slate-700">No activity logs yet.</p>
        <div className="mt-4 text-sm text-left max-w-sm mx-auto bg-slate-50 p-4 rounded-2xl">
          <p className="font-bold mb-2">Steps:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Make sure the agent is running.</li>
            <li>Confirm the device is online.</li>
            <li>Wait for the next activity sample.</li>
            <li>Refresh or use the Refresh button.</li>
          </ol>
        </div>
        <button onClick={() => setActiveTab('devices')} className="mt-6 rounded-xl bg-blue-600 px-6 py-2 text-sm font-bold text-white hover:bg-blue-700">Go to Devices</button>
      </div>
    )}
        
    {showLinkAssetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <h3 className="text-xl font-black text-slate-900">Link Hardware Asset</h3>
              <p className="mt-1 text-sm text-slate-500">Link {selectedDevice?.hostname} to a CMDB asset.</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">Hardware Asset (CMDB)</label>
                  {assetsList.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No matching laptop/desktop assets found.</p>
                  ) : (
                    <select value={assignForm.asset_id} onChange={(e) => setAssignForm(p => ({ ...p, asset_id: e.target.value }))} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500">
                      <option value="">No Linked Asset</option>
                      {assetsList.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} - {a.brand} {a.model} ({a.status})</option>)}
                    </select>
                  )}
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button onClick={() => setShowLinkAssetModal(false)} className="rounded-xl px-4 py-2 font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                  <button onClick={submitAssign} disabled={assignLoading} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50">{assignLoading ? "Saving..." : "Save Link"}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAssignEmployeeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <h3 className="text-xl font-black text-slate-900">Assign Employee</h3>
              <p className="mt-1 text-sm text-slate-500">Assign {selectedDevice?.hostname} to an employee.</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">Employee</label>
                  {(() => {
                    const filteredUsers = usersList.filter(u => !selectedDevice?.branch_id || String(u.branch_id) === String(selectedDevice.branch_id));
                    if (filteredUsers.length === 0) {
                      return <p className="text-sm text-slate-500 italic">No employees found for this asset's branch.</p>;
                    }
                    return (
                      <select value={assignForm.assigned_user_id} onChange={(e) => setAssignForm(p => ({ ...p, assigned_user_id: e.target.value }))} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500">
                        <option value="">Unassigned</option>
                        {filteredUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.email})</option>)}
                      </select>
                    );
                  })()}
                </div>
                {/* Branch and Department are hidden because they flow automatically from the linked hardware asset */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                  <p className="text-xs font-bold text-slate-500">Branch & Department are automatically synced from the linked Hardware Asset.</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">Assignment Reason (Optional)</label>
                  <input type="text" value={assignForm.reason} onChange={(e) => setAssignForm(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. New hire, hardware replacement" className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500" />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button onClick={() => setShowAssignEmployeeModal(false)} className="rounded-xl px-4 py-2 font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                  <button onClick={submitAssign} disabled={assignLoading} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50">{assignLoading ? "Saving..." : "Save Assignment"}</button>
                </div>
              </div>
            </div>
          </div>
        )}
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
