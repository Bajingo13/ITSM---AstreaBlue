import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  Copy,
  KeyRound,
  ListChecks,
  MonitorCog,
  Plug,
  RotateCcw,
  Send,
  ShieldOff,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1`;
const tabs = ["Registered Systems", "API Keys", "Integration Console", "API Logs"];
const modules = ["Attendance", "Payroll", "Leave", "Recruitment", "Reports", "Settings", "Other"];
const priorities = [
  ["P4-Low", "Low"],
  ["P3-Medium", "Medium"],
  ["P2-High", "High"],
  ["P1-Critical", "Critical"],
];
const emptySystem = { system_name: "", system_code: "", description: "", status: "Active" };
const emptyConsole = {
  integration_id: "",
  external_employee_id: "",
  requester_name: "",
  requester_email: "",
  origin_module: "Attendance",
  feature: "",
  priority: "P3-Medium",
  title: "",
  description: "",
  external_reference: "",
};

function dataOf(body) {
  return body?.data !== undefined ? body.data : body;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

export default function Integrations() {
  const { user } = useAuth();
  const role = user?.role_name || user?.role;
  const isSuperAdmin = role === "SuperAdmin";
  const [activeTab, setActiveTab] = useState(isSuperAdmin ? tabs[0] : tabs[3]);
  const [systems, setSystems] = useState([]);
  const [keysBySystem, setKeysBySystem] = useState({});
  const [logs, setLogs] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [systemForm, setSystemForm] = useState(emptySystem);
  const [editingId, setEditingId] = useState(null);
  const [selectedSystemId, setSelectedSystemId] = useState("");
  const [keyName, setKeyName] = useState("Default API Key");
  const [consoleForm, setConsoleForm] = useState(emptyConsole);
  const [revealedKeys, setRevealedKeys] = useState({});
  const [createdTicket, setCreatedTicket] = useState(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);


  const load = useCallback(async () => {
    try {
      setLoading(true);
      setMessage("");
      const loadResource = async (path) => {
        try {
          const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
          const body = await response.json();
          return { response, body };
        } catch (error) {
          return { error };
        }
      };
      const [systemsResult, dashboardResult, logsResult] = await Promise.all([
        loadResource("/integrations"),
        loadResource("/integrations/dashboard"),
        loadResource("/integrations/logs"),
      ]);

      if (systemsResult.error || !systemsResult.response?.ok || systemsResult.body?.success === false) {
        throw new Error(systemsResult.body?.message || systemsResult.error?.message || "Failed to load registered systems.");
      }

      const loadedSystems = dataOf(systemsResult.body) || [];
      setSystems(loadedSystems);
      const warnings = [];
      if (dashboardResult.response?.ok && dashboardResult.body?.success !== false) {
        setDashboard(dataOf(dashboardResult.body));
      } else {
        warnings.push(dashboardResult.body?.message || "Dashboard metrics are temporarily unavailable.");
      }
      if (logsResult.response?.ok && logsResult.body?.success !== false) {
        setLogs(dataOf(logsResult.body) || []);
      } else {
        warnings.push(logsResult.body?.message || "API logs are temporarily unavailable.");
      }
      if (warnings.length) setMessage(warnings.join(" "));
      setSelectedSystemId((current) => current || (loadedSystems[0] ? String(loadedSystems[0].integration_id) : ""));
      setConsoleForm((current) => ({ ...current, integration_id: current.integration_id || (loadedSystems[0] ? String(loadedSystems[0].integration_id) : "") }));

      if (isSuperAdmin && loadedSystems.length) {
        const keyPairs = await Promise.all(
          loadedSystems.map(async (system) => {
            const res = await fetch(`${API_BASE}/integrations/${system.integration_id}/api-keys`, { headers: authHeaders() });
            const body = await res.json();
            return [system.integration_id, res.ok && body.success !== false ? dataOf(body) || [] : []];
          })
        );
        setKeysBySystem(Object.fromEntries(keyPairs));
      }
    } catch (err) {
      setMessage(err.message || "Failed to load Integration Hub.");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSystem = async (event) => {
    event.preventDefault();
    if (!isSuperAdmin) return;
    try {
      setSaving(true);
      const url = editingId ? `${API_BASE}/integrations/${editingId}` : `${API_BASE}/integrations`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(systemForm),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || "Failed to save system.");
      setMessage(body.message || "System saved.");
      setSystemForm(emptySystem);
      setEditingId(null);
      await load();
    } catch (err) {
      setMessage(err.message || "Failed to save system.");
    } finally {
      setSaving(false);
    }
  };

  const editSystem = (system) => {
    setEditingId(system.integration_id);
    setSystemForm({
      system_name: system.system_name || "",
      system_code: system.system_code || "",
      description: system.description || "",
      status: system.status || "Active",
    });
    setActiveTab(tabs[0]);
  };

  const updateSystemStatus = async (system, status) => {
    await fetch(`${API_BASE}/integrations/${system.integration_id}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    }).then(async (res) => {
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || "Failed to update system.");
      setMessage(body.message || "System updated.");
      await load();
    }).catch((err) => setMessage(err.message || "Failed to update system."));
  };

  const generateKey = async () => {
    if (!selectedSystemId || !isSuperAdmin) return;
    try {
      const res = await fetch(`${API_BASE}/integrations/${selectedSystemId}/api-keys`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ key_name: keyName }),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || "Failed to generate API key.");
      setRevealedKeys((current) => ({ ...current, [selectedSystemId]: body.data.api_key }));
      setMessage(body.message || "API key generated.");
      await load();
    } catch (err) {
      setMessage(err.message || "Failed to generate API key.");
    }
  };

  const keyAction = async (path, options = {}) => {
    try {
      const res = await fetch(`${API_BASE}/integrations/${path}`, {
        method: options.method || "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || "API key action failed.");
      if (body.data?.api_key && selectedSystemId) {
        setRevealedKeys((current) => ({ ...current, [selectedSystemId]: body.data.api_key }));
      }
      setMessage(body.message || "API key updated.");
      setConfirmRegenerate(null);
      await load();
    } catch (err) {
      setMessage(err.message || "API key action failed.");
    }
  };

  const createTestTicket = async (event) => {
    event.preventDefault();
    const apiKey = revealedKeys[consoleForm.integration_id];
    if (!apiKey) {
      setMessage("Generate an API key for the selected system first. Keys are shown once only.");
      setActiveTab(tabs[1]);
      setSelectedSystemId(consoleForm.integration_id);
      return;
    }

    try {
      setSaving(true);
      setCreatedTicket(null);
      const system = systems.find((item) => String(item.integration_id) === String(consoleForm.integration_id));
      const payload = {
        title: consoleForm.title,
        description: consoleForm.description,
        priority: consoleForm.priority,
        external_employee_id: consoleForm.external_employee_id,
        requester_name: consoleForm.requester_name,
        requester_email: consoleForm.requester_email,
        origin_system: system?.system_name || null,
        origin_module: consoleForm.origin_module,
        external_reference: consoleForm.external_reference,
        origin_feature: consoleForm.feature || null,
      };
      const res = await fetch(`${API_BASE}/external/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || body.success === false) throw new Error(body.message || "Failed to create test ticket.");
      setCreatedTicket(body.data);
      setMessage("Ticket Created Successfully");
      await load();
    } catch (err) {
      setMessage(err.message || "Failed to create test ticket.");
    } finally {
      setSaving(false);
    }
  };

  const copyKey = async (key) => {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setMessage("API key copied.");
  };

  const cards = [
    ["Registered Systems", dashboard?.registered_systems ?? 0],
    ["Active Integrations", dashboard?.active_integrations ?? 0],
    ["API Calls Today", dashboard?.api_calls_today ?? 0],
    ["Tickets Created Today", dashboard?.tickets_created_today ?? 0],
    ["Failed Requests", dashboard?.failed_requests ?? 0],
    ["Most Active System", dashboard?.most_active_system || "None"],
  ];

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Integration Hub"
        subtitle="Central gateway for HRIS, Payroll, Accounting, E-Invoicing, mobile apps, and future systems."
        actions={
          <button onClick={() => load().catch(() => {})} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-blue-700">
            <RotateCcw size={17} /> Refresh
          </button>
        }
      />

      {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-500">{label}</p>
            <p className="mt-2 truncate text-2xl font-black text-slate-900">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const disabled = !isSuperAdmin && tab !== "API Logs";
            return (
              <button
                key={tab}
                disabled={disabled}
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-2 text-sm font-black ${activeTab === tab ? "bg-blue-600 text-white" : disabled ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-700"}`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "Registered Systems" && (
        <section className="grid gap-6 xl:grid-cols-[390px_1fr]">
          <form onSubmit={saveSystem} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><Plug size={20} /></div>
              <div>
                <h2 className="text-lg font-black text-slate-900">{editingId ? "Update System" : "Register System"}</h2>
                <p className="text-sm text-slate-500">SuperAdmin only</p>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              <label className="astrea-field-label">System Name<input required value={systemForm.system_name} onChange={(e) => setSystemForm({ ...systemForm, system_name: e.target.value })} className="astrea-control mt-2" placeholder="HRIS" /></label>
              <label className="astrea-field-label">System Code<input required disabled={Boolean(editingId)} value={systemForm.system_code} onChange={(e) => setSystemForm({ ...systemForm, system_code: e.target.value.toUpperCase() })} className="astrea-control mt-2" placeholder="PAYROLL" /></label>
              <label className="astrea-field-label">Status<select value={systemForm.status} onChange={(e) => setSystemForm({ ...systemForm, status: e.target.value })} className="astrea-control mt-2"><option>Active</option><option>Disabled</option><option>Maintenance</option></select></label>
              <label className="astrea-field-label">Description<textarea value={systemForm.description} onChange={(e) => setSystemForm({ ...systemForm, description: e.target.value })} className="astrea-control mt-2 min-h-24" /></label>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">Centralized scope: external tickets are branchless and visible only under the existing centralized Service Desk RBAC.</div>
            </div>
            <button disabled={saving} className="astrea-button astrea-button-primary mt-5 w-full">{saving ? "Saving..." : editingId ? "Update System" : "Register System"}</button>
          </form>

          <SystemsTable systems={systems} loading={loading} onEdit={editSystem} onStatus={updateSystemStatus} />
        </section>
      )}

      {activeTab === "API Keys" && (
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <label className="astrea-field-label">Registered System<select value={selectedSystemId} onChange={(e) => setSelectedSystemId(e.target.value)} className="astrea-control mt-2">{systems.map((system) => <option key={system.integration_id} value={system.integration_id}>{system.system_name}</option>)}</select></label>
              <label className="astrea-field-label">Key Name<input value={keyName} onChange={(e) => setKeyName(e.target.value)} className="astrea-control mt-2" /></label>
              <button onClick={generateKey} className="astrea-button astrea-button-primary self-end"><KeyRound size={16} /> Generate New</button>
            </div>
          </div>
          {revealedKeys[selectedSystemId] && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-black uppercase text-amber-700">Shown once only</p>
              <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="break-all font-mono text-sm font-bold text-slate-900">{revealedKeys[selectedSystemId]}</p>
                <button onClick={() => copyKey(revealedKeys[selectedSystemId])} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"><Copy size={16} /> Copy</button>
              </div>
            </div>
          )}
          <ApiKeysTable
            keys={keysBySystem[selectedSystemId] || []}
            confirmRegenerate={confirmRegenerate}
            setConfirmRegenerate={setConfirmRegenerate}
            keyAction={keyAction}
          />
        </section>
      )}

      {activeTab === "Integration Console" && (
        <section className="grid gap-6 xl:grid-cols-[440px_1fr]">
          <form onSubmit={createTestTicket} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><MonitorCog size={20} /></div>
              <div><h2 className="text-lg font-black text-slate-900">Integration Console</h2><p className="text-sm text-slate-500">Safe external-system simulation</p></div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="astrea-field-label sm:col-span-2">Registered System<select value={consoleForm.integration_id} onChange={(e) => setConsoleForm({ ...consoleForm, integration_id: e.target.value })} className="astrea-control mt-2">{systems.map((system) => <option key={system.integration_id} value={system.integration_id}>{system.system_name}</option>)}</select></label>
              <label className="astrea-field-label">External Employee ID<input required value={consoleForm.external_employee_id} onChange={(e) => setConsoleForm({ ...consoleForm, external_employee_id: e.target.value })} className="astrea-control mt-2" placeholder="INV-EMP-001" /></label>
              <label className="astrea-field-label">Requester Name<input required value={consoleForm.requester_name} onChange={(e) => setConsoleForm({ ...consoleForm, requester_name: e.target.value })} className="astrea-control mt-2" placeholder="Employee name" /></label>
              <label className="astrea-field-label sm:col-span-2">Requester Email<input required type="email" value={consoleForm.requester_email} onChange={(e) => setConsoleForm({ ...consoleForm, requester_email: e.target.value })} className="astrea-control mt-2" placeholder="employee@company.com" /></label>
              <label className="astrea-field-label">Module<select value={consoleForm.origin_module} onChange={(e) => setConsoleForm({ ...consoleForm, origin_module: e.target.value })} className="astrea-control mt-2">{modules.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="astrea-field-label">Priority<select value={consoleForm.priority} onChange={(e) => setConsoleForm({ ...consoleForm, priority: e.target.value })} className="astrea-control mt-2">{priorities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="astrea-field-label sm:col-span-2">Feature<input value={consoleForm.feature} onChange={(e) => setConsoleForm({ ...consoleForm, feature: e.target.value })} className="astrea-control mt-2" placeholder="Time In" /></label>
              <label className="astrea-field-label sm:col-span-2">Title<input required value={consoleForm.title} onChange={(e) => setConsoleForm({ ...consoleForm, title: e.target.value })} className="astrea-control mt-2" /></label>
              <label className="astrea-field-label sm:col-span-2">Description<textarea required value={consoleForm.description} onChange={(e) => setConsoleForm({ ...consoleForm, description: e.target.value })} className="astrea-control mt-2 min-h-32" /></label>
              <label className="astrea-field-label sm:col-span-2">External Reference<input required value={consoleForm.external_reference} onChange={(e) => setConsoleForm({ ...consoleForm, external_reference: e.target.value })} className="astrea-control mt-2" placeholder="INV-HELP-000145" /></label>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button disabled={saving} className="astrea-button astrea-button-primary"><Send size={16} /> Create Test Ticket</button>
              <button type="button" onClick={() => { setConsoleForm(emptyConsole); setCreatedTicket(null); }} className="astrea-button astrea-button-secondary">Reset Form</button>
            </div>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {createdTicket ? (
              <div>
                <div className="flex items-center gap-3 text-blue-700"><CheckCircle size={22} /><h2 className="text-lg font-black">Ticket Created Successfully</h2></div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {[
                    ["Ticket Number", createdTicket.ticket_number],
                    ["Origin System", createdTicket.origin_system],
                    ["Module", createdTicket.origin_module],
                    ["Priority", createdTicket.priority],
                    ["Status", createdTicket.status],
                    ["Created At", formatDate(createdTicket.created_at)],
                  ].map(([label, value]) => <InfoCell key={label} label={label} value={value || "-"} />)}
                </div>
                <p className="mt-5 text-sm font-semibold text-slate-600">Open Service Desk to view this centralized ticket using its ticket number.</p>
              </div>
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center text-center text-slate-500">
                <ListChecks size={36} />
                <p className="mt-3 font-bold">Create a test ticket to see the result card.</p>
              </div>
            )}
          </section>
        </section>
      )}

      {activeTab === "API Logs" && <LogsTable logs={logs} loading={loading} />}
    </div>
  );
}

function InfoCell({ label, value }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{value}</p></div>;
}

function SystemsTable({ systems, loading, onEdit, onStatus }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["System", "Status", "Ticket Scope", "Created", "Updated", "Last Used", "Actions"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="7" className="p-8 text-center text-slate-500">Loading systems...</td></tr> : systems.length === 0 ? <tr><td colSpan="7" className="p-8 text-center text-slate-500">No registered systems yet.</td></tr> : systems.map((system) => {
              const active = system.status === "Active";
              return (
                <tr key={system.integration_id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-4"><p className="font-black text-slate-900">{system.system_name}</p><p className="font-mono text-xs font-bold text-slate-500">{system.system_code}</p><p className="mt-1 text-xs text-slate-500">{system.description}</p></td>
                  <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{system.status}</span></td>
                  <td className="px-4 py-4 text-sm font-semibold text-slate-600">Centralized / branchless</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(system.created_at)}<br />{system.created_by_name || "-"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(system.updated_at)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(system.last_used_at)}</td>
                  <td className="px-4 py-4"><div className="flex gap-2"><button onClick={() => onEdit(system)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">Edit</button><button onClick={() => onStatus(system, active ? "Disabled" : "Active")} className="rounded-lg bg-blue-50 p-2 text-blue-700">{active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ApiKeysTable({ keys, confirmRegenerate, setConfirmRegenerate, keyAction }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Key Name", "Created", "Last Used", "Status", "Actions"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody>
            {keys.length === 0 ? <tr><td colSpan="5" className="p-8 text-center text-slate-500">No API keys for this system.</td></tr> : keys.map((key) => (
              <tr key={key.key_id} className="border-t border-slate-100">
                <td className="px-4 py-4 font-black text-slate-900">{key.key_name}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{formatDate(key.created_at)}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{formatDate(key.last_used_at)}</td>
                <td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{key.status}</span></td>
                <td className="px-4 py-4">
                  {confirmRegenerate === key.key_id ? (
                    <div className="flex flex-wrap gap-2"><span className="text-xs font-bold text-amber-700">This invalidates the previous key.</span><button onClick={() => keyAction(`api-keys/${key.key_id}/regenerate`)} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-black text-amber-800">Confirm</button><button onClick={() => setConfirmRegenerate(null)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black">Cancel</button></div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => keyAction(`api-keys/${key.key_id}`, { method: "PATCH", body: { status: key.status === "Active" ? "Disabled" : "Active" } })} className="rounded-lg bg-slate-100 p-2 text-slate-700">{key.status === "Active" ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button>
                      <button onClick={() => setConfirmRegenerate(key.key_id)} className="rounded-lg bg-blue-50 p-2 text-blue-700"><KeyRound size={16} /></button>
                      <button onClick={() => keyAction(`api-keys/${key.key_id}/revoke`)} className="rounded-lg bg-rose-50 p-2 text-rose-700"><ShieldOff size={16} /></button>
                      {key.status !== "Active" && !key.last_used_at && <button title="Delete unused key" aria-label={`Delete ${key.key_name}`} onClick={() => { if (window.confirm(`Delete unused key “${key.key_name}”?`)) keyAction(`api-keys/${key.key_id}`, { method: "DELETE" }); }} className="rounded-lg bg-rose-100 p-2 text-rose-800"><Trash2 size={16} /></button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LogsTable({ logs, loading }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1250px] text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Timestamp", "System", "Endpoint", "Method", "Status", "Duration", "Branch", "Employee", "IP Address", "Result"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="10" className="p-8 text-center text-slate-500">Loading API logs...</td></tr> : logs.length === 0 ? <tr><td colSpan="10" className="p-8 text-center text-slate-500">No Integration Gateway logs yet.</td></tr> : logs.map((log) => (
              <tr key={log.audit_id} className="border-t border-slate-100">
                <td className="px-4 py-4 text-sm text-slate-600">{formatDate(log.request_timestamp)}</td>
                <td className="px-4 py-4 font-bold text-slate-900">{log.system_name || "Unknown"}</td>
                <td className="px-4 py-4 font-mono text-xs text-slate-600">{log.endpoint}</td>
                <td className="px-4 py-4 text-sm font-black text-slate-700">{log.method}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{log.status_code || "-"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{log.duration_ms ?? "-"} ms</td>
                <td className="px-4 py-4 text-sm text-slate-600">{log.branch_name || log.branch_id || "-"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{log.employee_name || log.employee_id || "-"}</td>
                <td className="px-4 py-4 text-sm text-slate-600">{log.source_ip || "-"}</td>
                <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${log.success ? "bg-blue-50 text-blue-700" : "bg-rose-50 text-rose-700"}`}>{log.success ? "Success" : "Failure"}</span><p className="mt-1 text-xs text-slate-500">{log.event_type}</p></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
