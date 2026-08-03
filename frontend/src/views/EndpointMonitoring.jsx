import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, Camera, CameraOff, Clock3, Monitor, Package, RefreshCw, Search, ShieldCheck, Users, X } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import ProtectedScreenshotViewer from "../components/ProtectedScreenshotViewer";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { authHeaders } from "../services/authHeaders";
import EndpointPolicies from "./EndpointPolicies";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";
const secondsSince = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)) : null;
const normalizeIdentityValue = (value) => String(value || "").trim().toLowerCase();
const normalizeSearchText = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const matchesSearch = (query, ...values) => {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const searchable = normalizeSearchText(values.join(" "));
  return tokens.every((token) => searchable.includes(token));
};
const ENDPOINT_ASSET_TYPES = new Set([
  "company device",
  "computer",
  "desktop",
  "laptop",
  "notebook",
  "pc",
  "workstation",
]);
const isEndpointAsset = (asset) => ENDPOINT_ASSET_TYPES.has(normalizeIdentityValue(asset?.asset_type));
const hasValidAssetLink = (device) => Boolean(device?.asset_id && device?.linked_asset_id);
const hasBrokenAssetLink = (device) => Boolean(device?.asset_id && !device?.linked_asset_id);
const formatDuration = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${Math.round(value)} sec`;
  if (value < 3600) return `${Math.round(value / 60)} min`;
  return `${(value / 3600).toFixed(1)} hr`;
};

async function monitoringRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    const error = new Error(body.error || body.message || "Monitoring request failed.");
    error.status = response.status;
    error.data = body.data || null;
    throw error;
  }
  return body.data || body;
}

export default function EndpointMonitoring() {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [screenshotControl, setScreenshotControl] = useState(null);
  const [screenshotControlLoading, setScreenshotControlLoading] = useState(false);
  const screenshotControlRequest = useRef(0);
  
  const activeTab = activeTabState;
  const selectedId = selectedIdState;

  const viewProtectedScreenshot = useCallback((screenshot) => setScreenshotViewer(screenshot), []);
  const closeScreenshotViewer = useCallback(() => setScreenshotViewer(null), []);

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
  const [assetLinkConflict, setAssetLinkConflict] = useState(null);
  const [assignForm, setAssignForm] = useState({ assigned_user_id: "", branch_id: "", asset_id: "", department: "", reason: "" });
  const [assignLoading, setAssignLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeBranchFilter, setEmployeeBranchFilter] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [assetBranchFilter, setAssetBranchFilter] = useState("");
  const [assetStatusFilter, setAssetStatusFilter] = useState("");

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
      if (import.meta.env.DEV) monitoringRequest("/debug").then(setDebugInfo).catch(() => setDebugInfo(null));
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
  const assetBranchId = String(selectedDevice?.branch_id || "");
  const filteredAssignmentUsers = useMemo(() => usersList
    .filter((user) => String(user.role_name || user.role || "").toLowerCase() === "employee")
    .filter((user) => user.is_active !== false && !["inactive", "disabled", "deactivated"].includes(String(user.status || "").toLowerCase()))
    .filter((user) => !employeeBranchFilter || String(user.branch_id) === String(employeeBranchFilter))
    .filter((user) => matchesSearch(employeeSearch, user.full_name, user.email, user.employee_number))
    .sort((left, right) => String(left.full_name || "").localeCompare(String(right.full_name || ""))), [usersList, employeeBranchFilter, employeeSearch]);
  const filteredLinkAssets = useMemo(() => assetsList
    .filter((asset) => !assetBranchFilter || String(asset.branch_id) === String(assetBranchFilter))
    .filter((asset) => !assetStatusFilter || String(asset.status || "") === assetStatusFilter)
    .filter((asset) => matchesSearch(assetSearch, asset.asset_tag, asset.asset_name, asset.serial_number, asset.brand, asset.manufacturer, asset.model, asset.model_name))
    .sort((left, right) => String(left.asset_tag || left.asset_name || "").localeCompare(String(right.asset_tag || right.asset_name || ""))), [assetsList, assetBranchFilter, assetStatusFilter, assetSearch]);
  const assetStatuses = useMemo(() => [...new Set(assetsList.map((asset) => String(asset.status || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right)), [assetsList]);
  const employeeBranchFilterConflicts = Boolean(employeeBranchFilter && assetBranchId && String(employeeBranchFilter) !== assetBranchId);
  const currentlyAssignedEmployee = usersList.find((user) => String(user.user_id) === String(selectedDevice?.assigned_user_id));
  const screenshotPolicyKnown =
    typeof details?.policy?.screenshot_monitoring_enabled === "boolean";
  const screenshotPolicyEnabled =
    details?.policy?.screenshot_monitoring_enabled === true;
  const screenshotPolicyReason =
    details?.policy?.features?.screenshot_monitoring_enabled?.reason ||
    details?.policy?.reasons?.screenshot_monitoring_enabled ||
    "Screenshot capture is disabled by the effective endpoint policy.";
  const screenshotBlockedByPolicy =
    screenshotPolicyKnown &&
    !screenshotPolicyEnabled &&
    !screenshotControl?.suspended;

  const loadScreenshotControl = useCallback(async (employeeId) => {
    const requestId = ++screenshotControlRequest.current;
    if (!isSuperAdmin || !employeeId) {
      setScreenshotControl(null);
      setScreenshotControlLoading(false);
      return null;
    }
    try {
      setScreenshotControlLoading(true);
      setScreenshotControl(null);
      const data = await monitoringRequest(`/employees/${encodeURIComponent(employeeId)}/screenshot-control`);
      if (requestId === screenshotControlRequest.current) setScreenshotControl(data);
      return data;
    } catch (requestError) {
      if (requestId === screenshotControlRequest.current) {
        setScreenshotControl(null);
        setError(requestError.message);
      }
      return null;
    } finally {
      if (requestId === screenshotControlRequest.current) setScreenshotControlLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadScreenshotControl(selectedDevice?.assigned_user_id);
  }, [loadScreenshotControl, selectedDevice?.assigned_user_id]);

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

  const requestScreenshotControlChange = () => {
    const employeeId = selectedDevice?.assigned_user_id;
    if (!isSuperAdmin || !employeeId || screenshotControlLoading) return;
    const suspend = !screenshotControl?.suspended;
    const employeeName = selectedDevice?.assigned_user || screenshotControl?.employee_name || `employee ${employeeId}`;
    setConfirmAction({
      title: suspend ? "Pause employee screenshots?" : "Resume employee screenshots?",
      message: suspend
        ? `This immediately blocks new screenshot permission and uploads for every managed laptop assigned to ${employeeName}. Consent, activity monitoring, heartbeat, and USB monitoring will not be changed.`
        : `This removes the SuperAdmin pause for ${employeeName}. Screenshot capture will resume only where the employee's approved consent and endpoint policy allow it.`,
      confirmLabel: suspend ? "Pause Screenshots" : "Resume Screenshots",
      tone: suspend ? "danger" : "default",
      onConfirm: async () => {
        try {
          setScreenshotControlLoading(true);
          await monitoringRequest(`/employees/${encodeURIComponent(employeeId)}/screenshot-control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              suspended: suspend,
              reason: suspend
                ? "Screenshot capture paused by SuperAdmin from Endpoint Management."
                : "Screenshot capture resumed by SuperAdmin from Endpoint Management.",
            }),
          });
          await Promise.all([
            loadScreenshotControl(employeeId),
            monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/activity`).then(setDetails),
            refreshSelectedHealth(),
            loadOverview(),
          ]);
          showToast(suspend
            ? `Screenshot capture is paused for ${employeeName}.`
            : `The SuperAdmin screenshot pause was removed for ${employeeName}.`);
        } catch (requestError) {
          showToast(requestError.message || "Screenshot control update failed.", "error");
        } finally {
          setScreenshotControlLoading(false);
        }
      },
    });
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
      setAssetLinkConflict(null);
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
        const detectedSerial = normalizeIdentityValue(details?.hardware?.serial_number);
        const allAssets = Array.isArray(aData) ? aData : aData.data || [];
        const exactSerialAsset = detectedSerial
          ? allAssets.find(
              (asset) =>
                normalizeIdentityValue(asset.serial_number) === detectedSerial
            )
          : null;
        const exactMatchIsLinkedElsewhere = exactSerialAsset
          && exactSerialAsset.monitoring_device_uuid
          && String(exactSerialAsset.asset_id) !== String(selectedDevice?.asset_id);
        setAssetLinkConflict(
          exactMatchIsLinkedElsewhere ? exactSerialAsset : null
        );
        const candidates = allAssets
          .filter((asset) => {
            const isCurrentAsset = String(asset.asset_id) === String(selectedDevice?.asset_id);
            const isAlreadyLinked = Boolean(asset.monitoring_device_uuid) && !isCurrentAsset;
            const isExactSerialMatch = detectedSerial
              && normalizeIdentityValue(asset.serial_number) === detectedSerial;
            return !isAlreadyLinked && (isEndpointAsset(asset) || isExactSerialMatch);
          })
          .sort((left, right) => {
            const leftMatches = detectedSerial
              && normalizeIdentityValue(left.serial_number) === detectedSerial;
            const rightMatches = detectedSerial
              && normalizeIdentityValue(right.serial_number) === detectedSerial;
            if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
            return String(left.asset_tag || left.asset_name || "").localeCompare(
              String(right.asset_tag || right.asset_name || "")
            );
          });
        setAssetsList(candidates);
      }
      if (!aRes.ok) setAssetLinkConflict(null);
      setAssignForm({
        assigned_user_id: selectedDevice?.assigned_user_id || "",
        branch_id: selectedDevice?.branch_id || "",
        department: selectedDevice?.department || "",
        asset_id: selectedDevice?.asset_id || "",
        reason: ""
      });
      setEmployeeSearch("");
      setEmployeeBranchFilter(String(selectedDevice?.branch_id || ""));
      setAssetSearch("");
      setAssetBranchFilter(String(selectedDevice?.branch_id || ""));
      setAssetStatusFilter("");
      if (type === 'asset') setShowLinkAssetModal(true);
      if (type === 'employee') setShowAssignEmployeeModal(true);
    } catch (e) {
      console.error(e);
      showToast("Failed to load assignment data.", "error");
    }
  };

  const submitAssign = async (overrides = {}) => {
    setAssignLoading(true);
    try {
      let payload = { ...assignForm, ...overrides };
      
      if (showLinkAssetModal && payload.asset_id) {
        const linkedAsset = assetsList.find(a => String(a.asset_id) === String(payload.asset_id));
        if (linkedAsset) {
          payload.branch_id = linkedAsset.branch_id || null;
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
      await loadOverview();
      showToast(data.message || "Endpoint assignment updated. Consent workflow and asset links were refreshed.");
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
        {hasBrokenAssetLink(device) ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">Broken Asset Link</span> : hasValidAssetLink(device) ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">Linked Asset</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">Unlinked Device</span>}
        {hasValidAssetLink(device) && device.asset_assignment_matches === false ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">Ownership Mismatch</span> : null}
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
                {hasValidAssetLink(selectedDevice) ? (
                  <>
                    <p><span className="font-bold">Asset Tag:</span> <a href="/dashboard/hardware-assets" className="text-blue-600 hover:underline">{selectedDevice?.asset_tag}</a></p>
                    <p><span className="font-bold">Asset Name:</span> {selectedDevice?.asset_name}</p>
                    {selectedDevice.asset_assignment_matches === false ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        <p className="font-black">Ownership mismatch</p>
                        <p className="mt-1">The endpoint is assigned to {selectedDevice.assigned_user || "another employee"}, while the linked asset is assigned to {selectedDevice.asset_assigned_name || "no employee"}.</p>
                      </div>
                    ) : null}
                    <p><span className="font-bold">Brand/Model:</span> {selectedDevice?.model || "—"}</p>
                    <div className="mt-3"><button onClick={() => handleOpenAssign('asset')} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Change Asset</button></div>
                  </>
                ) : (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                    <p className="text-xs font-bold text-amber-800 flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span> {hasBrokenAssetLink(selectedDevice) ? "Broken Asset Link" : "Unlinked Device"}</p>
                    {hasBrokenAssetLink(selectedDevice) ? (
                      <>
                        <p className="mt-1 text-xs text-amber-800">The referenced hardware record no longer exists. The endpoint, employee assignment, consent, and monitoring history are safe.</p>
                        <button
                          onClick={() => setConfirmAction({
                            title: "Remove stale asset link?",
                            message: "Only the invalid hardware reference will be cleared. Endpoint monitoring and employee assignment will remain unchanged.",
                            confirmLabel: "Remove Stale Link",
                            onConfirm: async () => {
                              setLoading(true);
                              try {
                                const result = await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/asset-link`, { method: "DELETE" });
                                await loadOverview();
                                showToast(result?.message || "Stale hardware-asset link removed.");
                              } catch (cleanupError) {
                                showToast(cleanupError.message || "Unable to remove the stale asset link.", "error");
                              } finally {
                                setLoading(false);
                              }
                            },
                          })}
                          className="mt-2 w-full rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
                        >
                          Remove Stale Link
                        </button>
                      </>
                    ) : null}
                    <button onClick={() => handleOpenAssign('asset')} className="mt-2 w-full rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">Link to Existing Asset</button>
                    <button 
                      onClick={async () => {
                        setConfirmAction({
                          title: "Create or Link Hardware Asset",
                          message: "Use the agent's scanned identity to link an existing Hardware Asset, or create one only when no matching asset exists?",
                          confirmLabel: "Create or Link",
                          onConfirm: async () => {
                            setLoading(true);
                            try {
                              const conversion = await monitoringRequest(`/devices/${encodeURIComponent(selectedId)}/convert-to-asset`, { method: 'POST' });
                              await loadOverview();
                              showToast(conversion?.message || "Hardware Asset created or linked from endpoint specifications.");
                            } catch (e) {
                              if (
                                isSuperAdmin
                                && e.status === 409
                                && e.data?.conflict_type === "branch_mismatch"
                              ) {
                                const assetLabel = [
                                  e.data.matching_asset_name,
                                  e.data.matching_asset_tag ? `Tag: ${e.data.matching_asset_tag}` : null,
                                  e.data.matching_asset_serial_number ? `Serial: ${e.data.matching_asset_serial_number}` : null,
                                ].filter(Boolean).join(" · ");
                                setConfirmAction({
                                  title: "Align endpoint branch and link?",
                                  message: `${assetLabel} belongs to ${e.data.matching_asset_branch_name || "another branch"}. ${e.data.endpoint_hostname || "This endpoint"} is currently under ${e.data.endpoint_branch_name || "a different branch"}. Use the asset's branch for this endpoint and link the existing records? The asset and its history will not be deleted or duplicated.`,
                                  confirmLabel: "Align & Link",
                                  onConfirm: async () => {
                                    setLoading(true);
                                    try {
                                      const conversion = await monitoringRequest(
                                        `/devices/${encodeURIComponent(selectedId)}/convert-to-asset`,
                                        {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ branch_resolution: "use_asset_branch" }),
                                        }
                                      );
                                      await loadOverview();
                                      showToast(conversion?.message || "Endpoint branch aligned and asset linked.");
                                    } catch (resolutionError) {
                                      showToast(resolutionError.message || "Unable to align and link the endpoint.", "error");
                                    } finally {
                                      setLoading(false);
                                    }
                                  },
                                });
                              } else {
                                showToast(e.message, "error");
                              }
                              setLoading(false);
                            }
                          },
                        });
                      }} 
                      disabled={loading || !details?.hardware}
                      className="mt-2 w-full rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      {loading ? "Checking..." : details?.hardware ? "Create or Link Asset from Specs" : "Hardware Scan Required"}
                    </button>
                    {!details?.hardware && <p className="mt-2 text-center text-[11px] font-semibold text-amber-700">The agent must submit hardware inventory before AstreaBlue can create an accurate asset record.</p>}
                  </div>
                )}
              </div>
            </div>

            {hasValidAssetLink(selectedDevice) && (
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
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="mb-1 font-black">Optional features not enabled</p>
                    <p className="mb-2 text-[11px] text-amber-800">This does not mean the agent is offline. Heartbeat, policy sync, and baseline inventory continue independently.</p>
                    <ul className="space-y-1">
                      {Object.entries(details.policy.reasons).map(([key, reason]) => (
                        <li key={key}><span className="font-black">{formatPolicyFeatureName(key)}:</span> {reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {isSuperAdmin && (
                  <div className="mt-4 space-y-3">
                    <button onClick={() => handleDiagnosticAction("policy")} disabled={healthLoading || !selectedDevice?.device_uuid} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Regenerate Effective Policy</button>
                    {selectedDevice?.assigned_user_id ? (
                      <div className={`rounded-2xl border p-3 ${
                        screenshotControl?.suspended
                          ? "border-rose-200 bg-rose-50"
                          : screenshotBlockedByPolicy
                            ? "border-amber-200 bg-amber-50"
                            : screenshotPolicyKnown
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-slate-200 bg-slate-50"
                      }`}>
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 rounded-xl p-2 ${
                            screenshotControl?.suspended
                              ? "bg-rose-100 text-rose-700"
                              : screenshotBlockedByPolicy
                                ? "bg-amber-100 text-amber-700"
                                : screenshotPolicyKnown
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-200 text-slate-600"
                          }`}>
                            {screenshotControl?.suspended || screenshotBlockedByPolicy ? <CameraOff size={17} /> : <Camera size={17} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-black ${
                              screenshotControl?.suspended
                                ? "text-rose-900"
                                : screenshotBlockedByPolicy
                                  ? "text-amber-900"
                                  : screenshotPolicyKnown
                                    ? "text-emerald-900"
                                    : "text-slate-700"
                            }`}>
                              {screenshotControlLoading && !screenshotControl
                                ? "Loading screenshot control..."
                                : screenshotControl?.suspended
                                  ? "Screenshots Paused by SuperAdmin"
                                  : screenshotBlockedByPolicy
                                    ? "Screenshot Capture Disabled"
                                    : screenshotPolicyKnown
                                      ? "Screenshot Capture Available"
                                      : "Checking Effective Screenshot Policy"}
                            </p>
                            <p className={`mt-1 text-[11px] leading-4 ${
                              screenshotControl?.suspended
                                ? "text-rose-700"
                                : screenshotBlockedByPolicy
                                  ? "text-amber-800"
                                  : screenshotPolicyKnown
                                    ? "text-emerald-700"
                                    : "text-slate-600"
                            }`}>
                              {screenshotBlockedByPolicy
                                ? screenshotPolicyReason
                                : `Applies to ${screenshotControl?.affected_devices ?? 1} managed ${Number(screenshotControl?.affected_devices ?? 1) === 1 ? "device" : "devices"} assigned to ${selectedDevice?.assigned_user || "this employee"}.`}
                            </p>
                            {screenshotControl?.suspended && screenshotControl?.reason && (
                              <p className="mt-1 text-[11px] text-rose-700">Reason: {screenshotControl.reason}</p>
                            )}
                            {screenshotControl?.updated_at && (
                              <p className="mt-1 text-[10px] text-slate-500">
                                Updated {formatDate(screenshotControl.updated_at)}{screenshotControl.updated_by_name ? ` by ${screenshotControl.updated_by_name}` : ""}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={requestScreenshotControlChange}
                          disabled={screenshotControlLoading || screenshotBlockedByPolicy || !screenshotPolicyKnown}
                          className={`mt-3 w-full rounded-xl px-3 py-2 text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            screenshotControl?.suspended
                              ? "bg-emerald-600 hover:bg-emerald-700"
                              : screenshotBlockedByPolicy || !screenshotPolicyKnown
                                ? "bg-slate-500"
                                : "bg-rose-600 hover:bg-rose-700"
                          }`}
                        >
                          {screenshotControlLoading
                            ? "Updating..."
                            : screenshotControl?.suspended
                              ? "Resume Screenshots for Employee"
                              : screenshotBlockedByPolicy
                                ? "Employee Consent or Policy Enablement Required"
                                : screenshotPolicyKnown
                                  ? "Pause Screenshots for Employee"
                                  : "Checking Screenshot Policy..."}
                        </button>
                        <p className="mt-2 text-[10px] leading-4 text-slate-500">
                          {screenshotBlockedByPolicy
                            ? "A SuperAdmin pause cannot enable screenshots. Capture becomes available only when approved employee consent and the endpoint policy both allow it."
                            : "Existing screenshots are retained. Consent and all other monitoring controls remain unchanged."}
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-xl bg-slate-50 p-2 text-[11px] text-slate-500">Assign an employee before using employee-level screenshot control.</p>
                    )}
                  </div>
                )}
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
                    <div key={key} className={`rounded-xl border px-3 py-2 text-sm ${getPolicyFeaturePresentation(feature).cardClass}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-700">{formatPolicyFeatureName(key)}</span>
                        <HealthBadge status={getPolicyFeaturePresentation(feature).status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Source: {feature.source_policy || "Unknown"}{feature.consent_required ? " · Optional consent required" : " · Baseline agent function"}</p>
                      {!feature.enabled && feature.reason && <p className="mt-1 text-xs font-semibold text-amber-800">{feature.reason}</p>}
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
                  <button onClick={() => handleDiagnosticAction("inventory")} disabled={healthLoading} className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Refresh Inventory Status</button>
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
                  <label className="mb-1 block text-sm font-bold text-slate-700">Search asset</label>
                  <input
                    type="search"
                    value={assetSearch}
                    onChange={(event) => setAssetSearch(event.target.value)}
                    placeholder="Asset tag, name, serial, brand, or model"
                    className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">Branch</label>
                    <select
                      value={assetBranchFilter}
                      onChange={(event) => setAssetBranchFilter(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500"
                    >
                      {isSuperAdmin && <option value="">All branches</option>}
                      {branchesList.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">Status</label>
                    <select
                      value={assetStatusFilter}
                      onChange={(event) => setAssetStatusFilter(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500"
                    >
                      <option value="">All statuses</option>
                      {assetStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">Hardware Asset (CMDB)</label>
                  <select value={assignForm.asset_id} onChange={(e) => setAssignForm(p => ({ ...p, asset_id: e.target.value }))} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500">
                    <option value="">No Linked Asset</option>
                    {filteredLinkAssets.map((a) => (
                      <option key={a.asset_id} value={a.asset_id}>
                        {a.asset_tag || a.asset_name} - {[a.brand || a.manufacturer, a.model || a.model_name].filter(Boolean).join(" ") || "Hardware asset"} ({a.status || "No status"}){a.branch_name ? ` — ${a.branch_name}` : ""}
                      </option>
                    ))}
                  </select>
                  {assetsList.length === 0 && <p className="mt-2 text-sm italic text-slate-500">No eligible endpoint assets are available.</p>}
                  {assetsList.length > 0 && filteredLinkAssets.length === 0 && <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No hardware assets match the current search and filters. Choose “No Linked Asset” only if you intend to unlink this endpoint.</p>}
                  {assetLinkConflict && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-black">Exact serial match is already linked</p>
                      <p className="mt-1">
                        {assetLinkConflict.asset_tag || assetLinkConflict.asset_name} is connected to endpoint{" "}
                        <span className="font-bold">
                          {assetLinkConflict.monitoring_hostname || assetLinkConflict.monitoring_device_uuid}
                        </span>
                        {assetLinkConflict.branch_name ? ` in ${assetLinkConflict.branch_name}` : ""}.
                      </p>
                      <p className="mt-1 text-xs font-semibold">
                        Open that endpoint and unlink or remove the stale endpoint record before linking this device.
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button onClick={() => setShowLinkAssetModal(false)} className="rounded-xl px-4 py-2 font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                  <button onClick={() => submitAssign()} disabled={assignLoading} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50">{assignLoading ? "Saving..." : "Save Link"}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAssignEmployeeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Endpoint ownership</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-950">Assign Employee</h3>
                  <p className="mt-1 text-sm text-slate-500">Choose the employee responsible for <span className="font-bold text-slate-700">{selectedDevice?.hostname}</span>.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAssignEmployeeModal(false)}
                  aria-label="Close assign employee dialog"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <X size={19} />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-bold text-slate-700">Branch</label>
                    <select
                      value={employeeBranchFilter}
                      onChange={(event) => {
                        setEmployeeBranchFilter(event.target.value);
                        setAssignForm((current) => ({ ...current, assigned_user_id: "" }));
                      }}
                      className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    >
                      {isSuperAdmin && <option value="">All branches</option>}
                      {branchesList.map((branch) => (
                        <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-bold text-slate-700">Search employee</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="search"
                        value={employeeSearch}
                        onChange={(event) => {
                          setEmployeeSearch(event.target.value);
                          setAssignForm((current) => ({ ...current, assigned_user_id: "" }));
                        }}
                        placeholder="Name, email, or employee number"
                        className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pl-10 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <label className="block text-sm font-bold text-slate-700">Select employee</label>
                      <p className="mt-0.5 text-xs text-slate-500">Only eligible employees in the asset branch can be assigned.</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{filteredAssignmentUsers.length} found</span>
                  </div>
                  {employeeBranchFilterConflicts ? (
                    <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">This hardware asset belongs to {selectedDevice?.branch_name || "another branch"}. Transfer the asset branch before assigning an employee from the selected branch.</p>
                  ) : filteredAssignmentUsers.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">No eligible employees match the current search and branch.</p>
                  ) : (
                    <div className="grid max-h-64 gap-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2">
                      {filteredAssignmentUsers.map((user) => {
                        const selected = String(assignForm.assigned_user_id) === String(user.user_id);
                        const branchName = user.branch_name || branchesList.find((branch) => String(branch.branch_id) === String(user.branch_id))?.branch_name || "No branch";
                        return (
                          <button
                            type="button"
                            key={user.user_id}
                            disabled={Boolean(assetBranchId) && String(user.branch_id) !== assetBranchId}
                            onClick={() => setAssignForm((current) => ({ ...current, assigned_user_id: user.user_id }))}
                            className={`min-h-[96px] w-full rounded-xl border p-3.5 text-left transition ${selected ? "border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-100" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm"} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0`}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="block font-black text-slate-900">{user.full_name}</span>
                              <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-blue-600 bg-blue-600 ring-2 ring-blue-100" : "border-slate-300 bg-white"}`} />
                            </span>
                            <span className="mt-1.5 block text-xs font-semibold text-slate-600">{[branchName, user.department].filter(Boolean).join(" · ")}</span>
                            <span className="mt-1 block break-all text-xs text-slate-500">{[user.email, user.employee_number].filter(Boolean).join(" · ")}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedDevice?.assigned_user_id && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-900">Current owner: {currentlyAssignedEmployee?.full_name || selectedDevice?.assigned_user_name || selectedDevice?.employee_name || "Assigned employee"}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">Removal keeps the asset linked, makes it available, and applies the safe unassigned policy.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmAction({
                        title: "Remove current owner?",
                        message: `This keeps ${selectedDevice?.hostname || "the endpoint"} linked to the same hardware asset, clears its employee ownership, marks an assigned asset as available, and switches privacy-sensitive monitoring to the safe unassigned policy. Consent records and historical monitoring data are retained.`,
                        confirmLabel: "Remove Owner",
                        tone: "danger",
                        onConfirm: () => submitAssign({ assigned_user_id: "", reason: assignForm.reason || "Owner removed by administrator" }),
                      })}
                      disabled={assignLoading}
                      className="shrink-0 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                    >
                      Remove current owner
                    </button>
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-slate-700">Assignment reason <span className="font-medium text-slate-400">(optional)</span></label>
                  <input type="text" value={assignForm.reason} onChange={(e) => setAssignForm(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. New hire or hardware replacement" className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100" />
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <button onClick={() => setShowAssignEmployeeModal(false)} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:border-slate-400 hover:bg-slate-100">Cancel</button>
                <button onClick={() => submitAssign()} disabled={assignLoading || !assignForm.assigned_user_id} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none">{assignLoading ? "Saving..." : "Save Assignment"}</button>
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
        {screenshotViewer && <ProtectedScreenshotViewer screenshot={screenshotViewer} items={details?.screenshots || []} onSelect={setScreenshotViewer} onClose={closeScreenshotViewer} />}
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
  const styles = ["healthy", "enabled"].includes(normalized) ? "bg-emerald-100 text-emerald-800" :
    normalized === "warning" ? "bg-amber-100 text-amber-800" :
    normalized === "critical" ? "bg-rose-100 text-rose-800" :
    normalized === "offline" ? "bg-slate-200 text-slate-700" :
    ["not consented", "awaiting consent", "disabled by policy"].includes(normalized) ? "bg-amber-100 text-amber-900" :
    ["not applicable", "not configured", "disabled"].includes(normalized) ? "bg-slate-200 text-slate-700" :
    normalized === "paused by superadmin" ? "bg-rose-100 text-rose-800" :
    "bg-sky-100 text-sky-800";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${styles}`}>{status || "Warning"}</span>;
}

const POLICY_FEATURE_LABELS = {
  heartbeat_enabled: "Heartbeat & connectivity",
  telemetry_enabled: "Agent telemetry",
  hardware_inventory_enabled: "Hardware inventory",
  software_inventory_enabled: "Software inventory",
  policy_sync_enabled: "Policy synchronization",
  activity_monitoring_enabled: "Application & activity monitoring",
  screenshot_monitoring_enabled: "Screenshot monitoring",
  browser_monitoring_enabled: "Browser & domain monitoring",
  usb_monitoring_enabled: "USB & DLP monitoring",
  location_tracking_enabled: "Location tracking",
  auto_incident_enabled: "Automatic incident creation",
};

function formatPolicyFeatureName(key) {
  return POLICY_FEATURE_LABELS[key] || String(key || "").replace(/_/g, " ");
}

function getPolicyFeaturePresentation(feature = {}) {
  if (feature.enabled) {
    return { status: "Enabled", cardClass: "border-emerald-100 bg-emerald-50/40" };
  }

  const reason = String(feature.reason || "").toLowerCase();
  if (reason.includes("superadmin") || reason.includes("paused")) {
    return { status: "Paused by SuperAdmin", cardClass: "border-rose-200 bg-rose-50" };
  }
  if (reason.includes("employee consent excludes")) {
    return { status: "Not Consented", cardClass: "border-amber-200 bg-amber-50" };
  }
  if (reason.includes("no active approved consent")) {
    return { status: "Awaiting Consent", cardClass: "border-amber-200 bg-amber-50" };
  }
  if (reason.includes("not assigned to an employee")) {
    return { status: "Not Applicable", cardClass: "border-slate-200 bg-slate-50" };
  }
  if (reason.includes("disabled by")) {
    return { status: "Disabled by Policy", cardClass: "border-amber-200 bg-amber-50" };
  }
  return { status: "Not Configured", cardClass: "border-slate-200 bg-slate-50" };
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
