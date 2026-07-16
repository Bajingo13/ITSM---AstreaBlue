import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, Clock3, Monitor, Package, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { authHeaders } from "../services/authHeaders";
import EndpointPolicies from "./EndpointPolicies";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
const secondsSince = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)) : null;
const formatDuration = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${Math.round(value)} sec`;
  if (value < 3600) return `${Math.round(value / 60)} min`;
  return `${(value / 3600).toFixed(1)} hr`;
};

async function monitoringRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), ...options });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error || body.message || "Monitoring request failed.");
  return body.data || body;
}

export default function EndpointMonitoring() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isSuperAdmin = String(role || "").toLowerCase().replace(/[\s_-]/g, "") === "superadmin";

  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState(null);
  
  const [selectedIdState, setSelectedIdState] = useState(() => {
    const val = searchParams.get("deviceId");
    return (val && !val.includes("=>")) ? val : null;
  });
  const [activeTabState, setActiveTabState] = useState(searchParams.get("tab") || "overview");
  
  const [details, setDetails] = useState(null);
  const [reconciliation, setReconciliation] = useState([]);
  const [softwareInventory, setSoftwareInventory] = useState([]);
  const [softwareSummary, setSoftwareSummary] = useState(null);
  const [softwareFilters, setSoftwareFilters] = useState({ q: "", publisher: "", status: "active", device_uuid: "", employee_id: "", branch_id: "" });
  const [healthData, setHealthData] = useState(null);
  const [selectedHealth, setSelectedHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [debugInfo, setDebugInfo] = useState(null);
  const [screenshotViewer, setScreenshotViewer] = useState(null);
  
  const activeTab = activeTabState;
  const selectedId = selectedIdState;

  const viewProtectedScreenshot = useCallback(async (screenshot) => {
    try {
      setError("");
      await fetch(`${API_BASE}/screenshots/${screenshot.id}/audit-view`, { method: "POST", headers: authHeaders() });
      const response = await fetch(`${API_URL}${screenshot.content_url}`, { headers: authHeaders() });
      if (!response.ok) throw new Error("Protected screenshot could not be loaded.");
      const objectUrl = URL.createObjectURL(await response.blob());
      setScreenshotViewer((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return {
          url: objectUrl,
          capturedAt: screenshot.captured_at,
          hostname: screenshot.hostname,
          employee: screenshot.assigned_user,
        };
      });
    } catch (requestError) {
      setError(requestError.message || "Protected screenshot could not be loaded.");
    }
  }, []);

  const closeScreenshotViewer = useCallback(() => {
    setScreenshotViewer((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!screenshotViewer) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeScreenshotViewer();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeScreenshotViewer, screenshotViewer]);

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
    { id: "health", label: "Endpoint Health" },
    { id: "devices", label: "Devices" },
    { id: "activity", label: "Activity Timeline" },
    { id: "screenshots", label: "Screenshots" },
    { id: "software", label: "Software Inventory" },
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

  const loadSoftwareInventory = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(softwareFilters)) {
        if (value) params.set(key, value);
      }
      const [items, totals] = await Promise.all([
        monitoringRequest(`/software-inventory${params.toString() ? `?${params.toString()}` : ""}`),
        monitoringRequest("/software-inventory/summary"),
      ]);
      setSoftwareInventory(Array.isArray(items) ? items : []);
      setSoftwareSummary(totals || null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, [softwareFilters]);

  const loadHealth = useCallback(async () => {
    try {
      setHealthLoading(true);
      const data = await monitoringRequest("/health");
      setHealthData(data || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (activeTab === "software") loadSoftwareInventory(); }, [activeTab, loadSoftwareInventory]);
  useEffect(() => { if (activeTab === "health") loadHealth(); }, [activeTab, loadHealth]);
  useEffect(() => {
    if (!selectedId || typeof selectedId === "function" || String(selectedId).includes("=>")) {
      setReconciliation([]);
      return setDetails(null);
    }
    monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/activity`).then(setDetails).catch((requestError) => setError(requestError.message));
    monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/reconciliation`)
      .then(data => setReconciliation(Array.isArray(data) ? data : []))
      .catch(e => console.error(e));
  }, [selectedId]);
  useEffect(() => {
    const timer = window.setInterval(loadOverview, 60000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  useEffect(() => {
    const currentDevice = devices.find((device) => String(device.device_id) === String(selectedId));
    const lookup = currentDevice?.device_uuid || currentDevice?.device_id;
    if (!lookup) {
      setSelectedHealth(null);
      return;
    }
    monitoringRequest(`/devices/${encodeURIComponent(lookup)}/health`)
      .then(setSelectedHealth)
      .catch(() => setSelectedHealth(null));
  }, [devices, selectedId]);

  const selectedDevice = devices.find((device) => String(device.device_id) === String(selectedId));

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4500);
  };

  const refreshSelectedHealth = async () => {
    const lookup = selectedDevice?.device_uuid || selectedDevice?.device_id;
    if (!lookup) return null;
    const data = await monitoringRequest(`/devices/${encodeURIComponent(lookup)}/health`);
    setSelectedHealth(data);
    return data;
  };

  const handleDiagnosticAction = async (action) => {
    if (!selectedDevice) return;
    try {
      setHealthLoading(true);
      if (action === "refresh" || action === "health" || action === "inventory") {
        await refreshSelectedHealth();
      }
      if (action === "policy") {
        const generatedPolicy = await monitoringRequest(`/devices/${selectedDevice.device_uuid}/generate-policy`, { method: "POST" });
        setDetails((current) => ({ ...(current || {}), policy: generatedPolicy }));
        const [refreshedDetails] = await Promise.all([
          monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/activity`),
          refreshSelectedHealth(),
        ]);
        setDetails(refreshedDetails);
      }
      if (action === "reconcile") {
        await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/reconcile`, { method: "POST" });
        const newData = await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/reconciliation`);
        setReconciliation(Array.isArray(newData) ? newData : []);
        await refreshSelectedHealth();
      }
      await loadOverview();
      if (activeTab === "health") await loadHealth();
      if (action === "policy") showToast(`Policy regenerated successfully for ${selectedDevice.hostname}. Version is ready for synchronization.`);
      else if (action === "reconcile") showToast(`Asset reconciliation completed for ${selectedDevice.hostname}.`);
      else showToast(`Endpoint diagnostics refreshed for ${selectedDevice.hostname}.`);
    } catch (requestError) {
      showToast(requestError.message || "Endpoint action failed. Review the endpoint assignment, consent, and policy configuration.", "error");
    } finally {
      setHealthLoading(false);
    }
  };
  
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
      showToast("Failed to load assignment data.", "error");
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
      showToast("Endpoint assignment updated. Consent workflow and asset links were refreshed.");
    } catch (e) {
      showToast(`Assignment failed: ${e.message}`, "error");
    } finally {
      setAssignLoading(false);
    }
  };

  const handleDeleteDevice = async () => {
    try {
      const response = await fetch(`${API_BASE}/devices/${selectedId}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete device");
      setSelectedId("");
      loadOverview();
      showToast("Endpoint device and monitoring logs were deleted.");
    } catch (e) {
      showToast(`Delete failed: ${e.message}`, "error");
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
    ["Managed Endpoints", summary?.total_monitored_devices || 0, Monitor],
    ["Online", summary?.online_devices || 0, Activity],
    ["Offline", summary?.offline_devices || 0, Monitor],
    ["Active Users Today", summary?.active_users_today || 0, Users],
    ["Average Idle Today", formatDuration(summary?.average_idle_seconds), Clock3],
    ["Software Records", summary?.total_installed_software_records || 0, Package],
  ];

  return <div className="space-y-6">
    <PageHero eyebrow="Endpoint Management" title="Endpoint Management" subtitle="Endpoint registration, inventory, policies, monitoring, security, and compliance for company-managed devices." />
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

    {activeTab === "health" && (
      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Registered Endpoints", healthData?.summary?.registered_endpoints || 0],
            ["Online Endpoints", healthData?.summary?.online_endpoints || 0],
            ["Offline Endpoints", healthData?.summary?.offline_endpoints || 0],
            ["Heartbeat Healthy", healthData?.summary?.heartbeat_healthy || 0],
            ["Activity Healthy", healthData?.summary?.activity_healthy || 0],
            ["Hardware Healthy", healthData?.summary?.hardware_inventory_healthy || 0],
            ["Software Healthy", healthData?.summary?.software_inventory_healthy || 0],
            ["Policy Sync Healthy", healthData?.summary?.policy_sync_healthy || 0],
            ["Consent Active", healthData?.summary?.consent_active || 0],
            ["Requires Attention", healthData?.summary?.endpoints_requiring_attention || 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><Activity size={18} className="text-blue-600" /></div>
              <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-6">
            <h2 className="text-lg font-black text-slate-900">Endpoint Health</h2>
            <button onClick={loadHealth} disabled={healthLoading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{["Endpoint", "Health", "Heartbeat", "Activity", "Hardware", "Software", "Policy", "Consent", "Last Communication"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {healthLoading && !healthData ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading endpoint health...</td></tr>
                ) : (healthData?.endpoints || []).length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No endpoint health data available.</td></tr>
                ) : healthData.endpoints.map((endpoint) => (
                  <tr key={endpoint.device_id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <button onClick={() => { setSelectedId(endpoint.device_id); setActiveTab("devices"); }} className="text-left font-bold text-blue-700 hover:underline">{endpoint.device_name || endpoint.hostname}</button>
                      <p className="text-xs text-slate-500">{endpoint.assigned_employee || "Unassigned"} · {endpoint.branch_name || "No branch"}</p>
                    </td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.overall_health} /></td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.heartbeat.status} /></td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.activity.status} /></td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.hardware_inventory.status} /></td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.software_inventory.status} /></td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.policy.status} /></td>
                    <td className="px-4 py-3"><HealthBadge status={endpoint.consent.status} /></td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(endpoint.agent_sync?.last_communication_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )}

    {activeTab === "devices" && (
    <section className="grid gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,2fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black text-slate-900">Managed Endpoints</h2><div className="mt-4 space-y-3">{loading ? <p className="text-sm text-slate-500">Loading endpoints...</p> : devices.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No endpoint agent has checked in yet.</p> : devices.map((device) => <button key={device.device_id} onClick={() => setSelectedId(device.device_id)} className={`w-full rounded-2xl border p-4 text-left transition ${String(selectedId) === String(device.device_id) ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><div><p className="font-black text-slate-900">{device.device_name || device.hostname}</p><p className="text-xs text-slate-500">{device.hostname}</p></div><StatusBadge status={device.status} /></div>
      <div className="mt-2 flex flex-wrap gap-1">
        {!device.asset_id ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">Unlinked Device</span> : <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">Linked Asset</span>}
        {!device.assigned_user_id ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">Unassigned Employee</span> : null}
      </div>
      <p className="mt-2 text-sm text-slate-600">{device.assigned_user || "Unassigned / shared device"}</p><p className="text-xs text-slate-500">{device.branch_name || "No branch"} · {device.department || "No department"}</p><div className="mt-2 text-xs font-semibold text-slate-500"><p>Consent: {device.consent_status || "Pending"}</p><p>Policy Synced: {device.policy_synced_at ? formatDate(device.policy_synced_at) : "Never"}</p></div><div className="mt-2 text-[10px] text-slate-400"><p>Last Seen: {formatDate(device.last_seen_at)}</p><p>Last Activity: {device.last_activity ? formatDate(device.last_activity) : "Never"}</p><p>Last Screenshot: {device.last_screenshot ? formatDate(device.last_screenshot) : "Never"}</p></div><p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={device.device_uuid}>{device.device_uuid || "Legacy device awaiting UUID"}</p></button>)}</div></div>

      <div className="space-y-6">
        {!selectedDevice ? (
           <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-sm">
             <Monitor className="mx-auto mb-4 text-slate-300" size={48} />
             <h2 className="text-xl font-black text-slate-900">No Endpoint Selected</h2>
             <p className="mt-2 text-slate-500">Select an endpoint from the list to view inventory, activity, policy, and health details.</p>
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
                <button onClick={() => setConfirmAction({ title: "Delete Endpoint", message: `Delete ${selectedDevice.hostname} and all monitoring logs? This cannot be undone.`, confirmLabel: "Delete Endpoint", tone: "danger", onConfirm: handleDeleteDevice })} className="ml-4 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 transition">
                  Delete Device
                </button>
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
                    <button onClick={() => handleOpenAssign('asset')} className="mt-2 w-full rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">Link to Existing Asset</button>
                    <button 
                      onClick={async () => {
                        setConfirmAction({
                          title: "Create Hardware Asset",
                          message: "Create a new Hardware Asset from the agent's scanned specifications and link it to this endpoint?",
                          confirmLabel: "Create Asset",
                          onConfirm: async () => {
                            setLoading(true);
                            try {
                              await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/convert-to-asset`, { method: 'POST' });
                              await loadOverview();
                              showToast("Hardware Asset created from endpoint specifications.");
                            } catch (e) {
                              showToast(e.message, "error");
                              setLoading(false);
                            }
                          },
                        });
                      }} 
                      disabled={loading}
                      className="mt-2 w-full rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      {loading ? "Creating..." : "Create Asset from Specs"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {selectedDevice?.asset_id && (
              <div>
                <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider text-slate-500 mb-3">Linked Asset Verification</h3>
                <div className="space-y-2 text-sm text-slate-600">
                  <p><span className="font-bold">Asset Tag:</span> {selectedDevice?.asset_tag}</p>
                  {reconciliation.length > 0 ? (
                    <>
                      <p><span className="font-bold">Verification Status:</span> {
                        reconciliation.some(r => r.severity === 'Critical') ? <span className="text-rose-600 font-bold">Critical Mismatches</span> :
                        reconciliation.some(r => r.status === 'Mismatch') ? <span className="text-amber-600 font-bold">Mismatches Found</span> :
                        reconciliation.every(r => r.status === 'Unknown') ? <span className="text-amber-600 font-bold">Pending Scan</span> :
                        <span className="text-emerald-600 font-bold">Verified</span>
                      }</p>
                      <p><span className="font-bold">Mismatches:</span> {reconciliation.filter(r => r.status === 'Mismatch').length}</p>
                      {reconciliation.filter(r => r.status === 'Mismatch').length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-rose-600 text-xs font-semibold">
                          {reconciliation.filter(r => r.status === 'Mismatch').map((m, i) => (
                            <li key={i}>{m.field_name}: Asset says "{m.asset_value || 'N/A'}", Agent says "{m.detected_value || 'N/A'}"</li>
                          ))}
                        </ul>
                      )}
                      <p><span className="font-bold">Last Reconciled:</span> {new Date(reconciliation[0].checked_at).toLocaleString()}</p>
                    </>
                  ) : (
                    <p className="text-slate-500 italic">No verification data available.</p>
                  )}
                  <div className="mt-3">
                    <button 
                      onClick={async () => {
                        setReconciling(true);
                        try {
                          await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/reconcile`, { method: 'POST' });
                          const newData = await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/reconciliation`);
                          setReconciliation(Array.isArray(newData) ? newData : []);
                        } catch (e) {
                          console.error(e);
                        } finally {
                          setReconciling(false);
                        }
                      }}
                      disabled={reconciling}
                      className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {reconciling ? 'Running...' : 'Run Reconciliation'}
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                <p><span className="font-bold">Effective Policy:</span> {details?.policy?.policy_name || "Unknown"}</p>
                <p><span className="font-bold">Policy Version:</span> {details?.policy?.policy_version || "Unknown"}</p>
                <p><span className="font-bold">Last Generated:</span> {details?.policy?.generated_at ? formatDate(details?.policy?.generated_at) : "Never"}</p>
                <p><span className="font-bold">Last Downloaded:</span> {selectedDevice?.policy_synced_at ? formatDate(selectedDevice?.policy_synced_at) : "Never"}</p>
                {details?.policy?.reasons && Object.keys(details.policy.reasons).length > 0 && (
                  <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700">
                    <p className="font-bold mb-1">Disabled Features:</p>
                    <ul className="list-disc pl-4">
                      {Object.entries(details.policy.reasons).map(([k,v]) => <li key={k}>{v}</li>)}
                    </ul>
                  </div>
                )}
                {isSuperAdmin && <div className="mt-3">
              <button onClick={() => handleDiagnosticAction("policy")} disabled={healthLoading || !selectedDevice?.device_uuid} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Regenerate Effective Policy</button>
                </div>}
              </div>
            </div>
          </div>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-black text-slate-900">Endpoint Diagnostics</h3>
              <HealthBadge status={selectedHealth?.overall_health || "Warning"} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DiagnosticRow label="Last Heartbeat" value={formatDate(selectedHealth?.heartbeat?.last_seen_at || selectedDevice?.last_seen_at)} status={selectedHealth?.heartbeat?.status} />
              <DiagnosticRow label="Last Activity" value={formatDate(selectedHealth?.activity?.last_seen_at || selectedDevice?.last_activity)} status={selectedHealth?.activity?.status} />
              <DiagnosticRow label="Last Idle Detection" value={formatDate(selectedHealth?.idle_detection?.last_seen_at)} status={selectedHealth?.idle_detection?.status} />
              <DiagnosticRow label="Last Hardware Inventory" value={formatDate(selectedHealth?.hardware_inventory?.last_seen_at || details?.hardware?.scanned_at)} status={selectedHealth?.hardware_inventory?.status} />
              <DiagnosticRow label="Last Software Inventory" value={formatDate(selectedHealth?.software_inventory?.last_seen_at)} status={selectedHealth?.software_inventory?.status} />
              <DiagnosticRow label="Last Policy Download" value={formatDate(selectedHealth?.policy?.last_seen_at || selectedDevice?.policy_synced_at)} status={selectedHealth?.policy?.status} />
              <DiagnosticRow label="Current Policy Version" value={selectedHealth?.policy?.current_policy_version || details?.policy?.policy_version || "Unknown"} status={selectedHealth?.policy?.status} />
              <DiagnosticRow label="Consent Status" value={selectedHealth?.consent?.consent_status || selectedDevice?.consent_status || "Pending"} status={selectedHealth?.consent?.status} />
              <DiagnosticRow label="Agent Version" value={selectedDevice?.agent_version || "Unknown"} status="Healthy" />
              <DiagnosticRow label="Windows Version" value={selectedHealth?.debug?.windows_version || details?.hardware?.os_name || "Unknown"} status={selectedHealth?.hardware_inventory?.status} />
              <DiagnosticRow label="Endpoint Status" value={selectedHealth?.endpoint_status || selectedDevice?.status || "Unknown"} status={selectedHealth?.overall_health} />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-black uppercase text-slate-500">Communication Timeline</h4>
                <div className="mt-3 space-y-2">
                  {(selectedHealth?.timeline || []).map((item) => (
                    <div key={item.event_type} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
                      <span className="font-bold text-slate-700">{item.event_type}</span>
                      <span className="text-xs text-slate-500">{formatDate(item.occurred_at)}</span>
                      <HealthBadge status={item.status} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-black uppercase text-slate-500">Failure Reasons</h4>
                <div className="mt-3 space-y-2">
                  {(selectedHealth?.failure_reasons || []).length === 0 ? <Empty text="No diagnostic failures." /> : selectedHealth.failure_reasons.map((item, index) => (
                    <div key={`${item.area}-${index}`} className="rounded-xl bg-white px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3"><span className="font-bold text-slate-800">{item.area}</span><HealthBadge status={item.severity} /></div>
                      <p className="mt-1 text-xs text-slate-500">{item.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-black uppercase text-slate-500">Onboarding Checklist</h4>
                <div className="mt-3 space-y-2">
                  {(selectedHealth?.checklist || []).map((item) => (
                    <div key={item.step} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
                      <span className="font-bold text-slate-700">{item.step}</span>
                      <ChecklistBadge status={item.status} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-black uppercase text-slate-500">Effective Policy Permissions</h4>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  {Object.entries(selectedHealth?.policy?.feature_permissions || {}).length === 0 ? <Empty text="No effective policy permissions generated yet." /> : Object.entries(selectedHealth.policy.feature_permissions).map(([key, feature]) => (
                    <div key={key} className="rounded-xl bg-white px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-700">{key.replace(/_/g, " ")}</span>
                        <HealthBadge status={feature.enabled ? "Healthy" : "Offline"} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Source: {feature.source_policy || "Unknown"}{feature.consent_required ? " · Consent required" : ""}</p>
                      {!feature.enabled && feature.reason && <p className="mt-1 text-xs font-semibold text-amber-700">{feature.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {isSuperAdmin && (
              <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <h4 className="font-black text-sky-950">SuperAdmin Diagnostic Actions</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => handleDiagnosticAction("refresh")} disabled={healthLoading} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Refresh Endpoint Status</button>
                  <button onClick={() => handleDiagnosticAction("health")} disabled={healthLoading} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Run Health Check</button>
                  <button onClick={() => handleDiagnosticAction("policy")} disabled={healthLoading || !selectedDevice?.device_uuid} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Regenerate Effective Policy</button>
                  <button onClick={() => handleDiagnosticAction("inventory")} disabled={healthLoading} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Recalculate Inventory Status</button>
                  <button onClick={() => handleDiagnosticAction("reconcile")} disabled={healthLoading || reconciling} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Re-run Asset Reconciliation</button>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-sky-950 md:grid-cols-2 xl:grid-cols-3">
                  <p><span className="font-bold">Device UUID:</span> {selectedHealth?.debug?.device_uuid || selectedDevice?.device_uuid || "Unknown"}</p>
                  <p><span className="font-bold">Asset ID:</span> {selectedHealth?.debug?.asset_id || selectedDevice?.asset_id || "Unlinked"}</p>
                  <p><span className="font-bold">Employee:</span> {selectedHealth?.debug?.employee || selectedDevice?.assigned_user || "Unassigned"}</p>
                  <p><span className="font-bold">Branch:</span> {selectedHealth?.debug?.branch || selectedDevice?.branch_name || "Unknown"}</p>
                  <p><span className="font-bold">Department:</span> {selectedHealth?.debug?.department || selectedDevice?.department || "Unknown"}</p>
                  <p><span className="font-bold">Policy Version:</span> {selectedHealth?.debug?.policy_version || "Unknown"}</p>
                  <p><span className="font-bold">Consent Version:</span> {selectedHealth?.debug?.consent_version || "Unknown"}</p>
                  <p><span className="font-bold">Last API Response:</span> {selectedHealth?.debug?.last_api_response || "Not tracked"}</p>
                  <p><span className="font-bold">Last Error:</span> {selectedHealth?.debug?.last_error || "None tracked"}</p>
                  <p><span className="font-bold">Last Sync Time:</span> {formatDate(selectedHealth?.debug?.last_sync_time)}</p>
                  <p><span className="font-bold">Agent Version:</span> {selectedHealth?.debug?.agent_version || selectedDevice?.agent_version || "Unknown"}</p>
                  <p><span className="font-bold">OS Build:</span> {selectedHealth?.debug?.os_build || "Unknown"}</p>
                </div>
              </div>
            )}
          </section>
          
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
                  <div key={`shot-${item.id}-${i}`} className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><div className="flex justify-between gap-4"><p className="font-bold text-blue-900 flex items-center gap-2"><Monitor size={14}/> Screenshot Captured</p><p className="shrink-0 text-xs text-slate-500">{formatDate(item.captured_at)}</p></div><p className="mt-1 text-sm text-slate-600">Employee: {selectedDevice?.assigned_user || "Unassigned"} · Hostname: {selectedDevice?.hostname}</p>{item.content_url ? <button type="button" onClick={() => viewProtectedScreenshot(item)} className="mt-2 inline-block rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700">Open protected screenshot</button> : <p className="mt-1 text-xs text-slate-500">Legacy metadata record</p>}</div>
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
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-black text-slate-900"><Package size={18} className="text-blue-600" /> Installed Software</h3>
            <button onClick={() => setActiveTab("software")} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">View All Software</button>
          </div>
          <div className="mt-4 overflow-x-auto">
            {(details?.software || []).length === 0 ? <Empty text="No software inventory scan available." /> : (
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>{["Software", "Version", "Publisher", "Install Date", "Last Seen", "Status"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {(details?.software || []).slice(0, 25).map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-bold text-slate-900">{item.software_name}</td>
                      <td className="px-4 py-3 text-slate-600">{item.version || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{item.publisher || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{item.install_date || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(item.last_seen_at)}</td>
                      <td className="px-4 py-3"><SoftwareStatus status={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <section className="mt-6 grid gap-6 lg:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Screenshots</h3><p className="mt-1 text-xs text-slate-500">Available only after explicit screenshot consent.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{(details?.screenshots || []).length === 0 ? <Empty text="No consent-approved screenshots." /> : details.screenshots.map((shot) => <div key={shot.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><Monitor className="text-blue-600" /><p className="mt-2 text-sm font-bold text-slate-800">{shot.reason || "Agent capture"}</p><p className="text-xs text-slate-500">{formatDate(shot.captured_at)}</p>{shot.content_url ? <button type="button" onClick={() => viewProtectedScreenshot(shot)} className="mt-2 inline-block text-xs font-black text-blue-700 hover:text-blue-900">View protected image</button> : <p className="mt-2 text-xs text-slate-500">Legacy metadata record</p>}</div>)}</div></div><div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-black text-slate-900">Consent Records</h3><div className="mt-4 space-y-3">{(details?.consents || []).length === 0 ? <Empty text="No consent records." /> : details.consents.map((consent) => <div key={consent.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><div><p className="font-bold text-slate-900">{consent.consent_type}</p><p className="text-xs text-slate-500">{formatDate(consent.consented_at)}</p></div><ConsentBadge status={consent.consent_status} /></div>)}</div></div></section>
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

    {activeTab === "software" && (
      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Total Records", softwareSummary?.total_installed_software_records || summary?.total_installed_software_records || 0],
            ["Unique Apps", softwareSummary?.unique_applications || summary?.unique_applications || 0],
            ["Reporting Devices", softwareSummary?.devices_reporting_software || summary?.devices_reporting_software || 0],
            ["Recently Installed", softwareSummary?.recently_installed || summary?.recently_installed || 0],
            ["Removed / Missing", softwareSummary?.removed_missing_software || summary?.removed_missing_software || 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><Package size={18} className="text-blue-600" /></div>
              <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 grid gap-3 md:grid-cols-3 xl:grid-cols-7">
            <div className="relative md:col-span-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={softwareFilters.q} onChange={(e) => setSoftwareFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Search software name" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-sm font-medium outline-none focus:border-blue-600" />
            </div>
            <input value={softwareFilters.publisher} onChange={(e) => setSoftwareFilters((p) => ({ ...p, publisher: e.target.value }))} placeholder="Publisher" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-600" />
            <select value={softwareFilters.device_uuid} onChange={(e) => setSoftwareFilters((p) => ({ ...p, device_uuid: e.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-600">
              <option value="">All Devices</option>
              {devices.filter((d) => d.device_uuid).map((d) => <option key={d.device_uuid} value={d.device_uuid}>{d.hostname || d.device_name}</option>)}
            </select>
            <select value={softwareFilters.employee_id} onChange={(e) => setSoftwareFilters((p) => ({ ...p, employee_id: e.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-600">
              <option value="">All Employees</option>
              {[...new Map(devices.filter((d) => d.assigned_user_id).map((d) => [d.assigned_user_id, d.assigned_user || `User ${d.assigned_user_id}`])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={softwareFilters.branch_id} onChange={(e) => setSoftwareFilters((p) => ({ ...p, branch_id: e.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-600">
              <option value="">All Branches</option>
              {[...new Map(devices.filter((d) => d.branch_id).map((d) => [d.branch_id, d.branch_name || `Branch ${d.branch_id}`])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={softwareFilters.status} onChange={(e) => setSoftwareFilters((p) => ({ ...p, status: e.target.value }))} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-600">
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="removed">Removed / Missing</option>
            </select>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{["Software Name", "Version", "Publisher", "Install Date", "Device", "Assigned Employee", "Branch", "Last Seen", "Status"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {softwareInventory.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No software inventory records found.</td></tr>
                ) : softwareInventory.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-bold text-slate-900">{item.software_name}</td>
                    <td className="px-4 py-3 text-slate-600">{item.version || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{item.publisher || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{item.install_date || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{item.hostname || item.device_name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{item.assigned_employee || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{item.branch_name || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(item.last_seen_at)}</td>
                    <td className="px-4 py-3"><SoftwareStatus status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
                    <p className="text-sm text-slate-500 italic">No matching endpoint assets found.</p>
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
        {confirmAction && (
          <ConfirmModal
            {...confirmAction}
            onCancel={() => setConfirmAction(null)}
            onConfirm={async () => {
              const run = confirmAction.onConfirm;
              setConfirmAction(null);
              await run?.();
            }}
          />
        )}
        {screenshotViewer && (
          <div className="fixed inset-0 z-[120] flex h-[100dvh] w-screen bg-black" role="dialog" aria-modal="true" aria-label="Protected screenshot viewer">
            <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-900 px-4 py-3 text-white sm:px-5">
                <div className="min-w-0"><p className="truncate font-black">{screenshotViewer.employee || screenshotViewer.hostname || "Protected screenshot"}</p><p className="truncate text-xs text-slate-300">{screenshotViewer.hostname || "Managed endpoint"} · {formatDate(screenshotViewer.capturedAt)}</p></div>
                <button type="button" onClick={closeScreenshotViewer} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-slate-950 shadow-lg transition hover:scale-105 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-400/50" aria-label="Close screenshot viewer" title="Close (Esc)"><X size={24} strokeWidth={3} /></button>
              </div>
              <div className="min-h-0 flex flex-1 items-center justify-center overflow-auto bg-black p-2"><img src={screenshotViewer.url} alt="Consent-approved endpoint screenshot" className="h-full w-full object-contain" /></div>
            </div>
          </div>
        )}
        {toast && <PageToast toast={toast} onClose={() => setToast(null)} />}
  </div>;
}

function StatusBadge({ status = "Offline" }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${status === "Online" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{status}</span>;
}

function ConsentBadge({ status = "Pending" }) {
  const approved = ["granted", "approved", "consented"].includes(String(status).toLowerCase());
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{status || "Pending"}</span>;
}

function SoftwareStatus({ status = "active" }) {
  const active = String(status).toLowerCase() === "active";
  return <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{status}</span>;
}

function HealthBadge({ status = "Warning" }) {
  const normalized = String(status || "Warning").toLowerCase();
  const styles = normalized === "healthy" ? "bg-emerald-100 text-emerald-800" :
    normalized === "warning" ? "bg-amber-100 text-amber-800" :
    normalized === "critical" ? "bg-rose-100 text-rose-800" :
    normalized === "offline" ? "bg-slate-200 text-slate-700" :
    "bg-sky-100 text-sky-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${styles}`}>{status || "Warning"}</span>;
}

function DiagnosticRow({ label, value, status = "Warning" }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase text-slate-500">{label}</p>
        <HealthBadge status={status} />
      </div>
      <p className="mt-2 break-words text-sm font-bold text-slate-900">{value || "Unknown"}</p>
    </div>
  );
}

function ChecklistBadge({ status = "Pending" }) {
  const normalized = String(status || "Pending").toLowerCase();
  const styles = normalized === "complete" ? "bg-emerald-100 text-emerald-800" :
    normalized === "failed" ? "bg-rose-100 text-rose-800" :
    normalized === "not applicable" ? "bg-slate-200 text-slate-700" :
    "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${styles}`}>{status}</span>;
}

function PageToast({ toast, onClose }) {
  const isError = toast.type === "error";
  return (
    <div className={`fixed bottom-6 right-6 z-[70] flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold shadow-2xl ${isError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      <span>{toast.message}</span>
      <button onClick={onClose} className="ml-2 text-slate-400 hover:text-slate-700">x</button>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = "Confirm", tone = "default", onCancel, onConfirm }) {
  const danger = tone === "danger";
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-black text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
