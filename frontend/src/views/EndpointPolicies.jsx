import { useState, useEffect } from "react";
import { Shield, Plus, Edit, Trash2, Link, Save, X, Settings2, ShieldOff, AlertCircle, List } from "lucide-react";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";

export default function EndpointPolicies() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [view, setView] = useState("list"); // list, form, assign
  const [editingPolicy, setEditingPolicy] = useState(null);
  
  // Assignment form state
  const [assignForm, setAssignForm] = useState({ policy_id: "", target_type: "global", target_id: "" });
  
  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/policies`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load policies");
      setPolicies(data.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this policy?")) return;
    try {
      const res = await fetch(`${API_BASE}/policies/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Delete failed");
      }
      fetchPolicies();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleEdit = (policy) => {
    setEditingPolicy(policy);
    setView("form");
  };

  const handleCreate = () => {
    setEditingPolicy({
      policy_name: "",
      description: "",
      target_type: "global",
      priority: 1,
      features_enabled: {
        heartbeat: true,
        activity: true,
        screenshots: false,
        hardware_inventory: true,
        software_inventory: true
      },
      collection_interval_seconds: {
        heartbeat: 60,
        activity: 300,
        screenshots: 600,
        hardware_inventory: 86400,
        software_inventory: 86400
      }
    });
    setView("form");
  };

  if (view === "form") {
    return <PolicyForm policy={editingPolicy} onCancel={() => setView("list")} onSave={() => { setView("list"); fetchPolicies(); }} />;
  }

  if (view === "assign") {
    return <PolicyAssignForm 
      policies={policies} 
      form={assignForm}
      setForm={setAssignForm}
      onCancel={() => setView("list")} 
      onSave={() => { setView("list"); fetchPolicies(); }} 
    />;
  }

  if (view === "audit") {
    return <PolicyAuditLogs onCancel={() => setView("list")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Shield className="text-blue-600" /> Endpoint Policies
          </h2>
          <p className="mt-1 text-sm text-slate-500">Manage what monitoring features are enabled for specific groups.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setView("audit")} className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition">
            <List size={16} /> Audit Logs
          </button>
          <button onClick={() => {
            setAssignForm({ policy_id: policies[0]?.id || "", target_type: "global", target_id: "" });
            setView("assign");
          }} className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition">
            <Link size={16} /> Assign Policy
          </button>
          <button onClick={handleCreate} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 flex items-center gap-2 transition">
            <Plus size={16} /> Create Policy
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <p className="text-slate-500 p-4">Loading policies...</p>
        ) : policies.length === 0 ? (
          <div className="col-span-full rounded-2xl bg-slate-50 p-12 text-center text-slate-500 border border-slate-200">
            <ShieldOff className="mx-auto mb-4 text-slate-300" size={48} />
            <h3 className="mb-2 text-xl font-black text-slate-900">No Policies Found</h3>
            <p>Create a global policy to get started.</p>
          </div>
        ) : (
          policies.map(policy => (
            <div key={policy.id} className="flex flex-col rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden transition hover:shadow-md">
              <div className="p-6 border-b border-slate-100 flex-1">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="font-black text-slate-900 text-lg">{policy.policy_name}</h3>
                    <p className="mt-1 text-sm text-slate-500 line-clamp-2">{policy.description}</p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-800 shrink-0">
                    Priority {policy.priority}
                  </span>
                </div>
                
                <div className="mt-6 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Enabled Features</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(policy.features_enabled || {}).map(([key, value]) => value && (
                      <span key={key} className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                        {key.replace('_', ' ')}
                      </span>
                    ))}
                    {!Object.values(policy.features_enabled || {}).some(Boolean) && (
                      <span className="text-xs italic text-slate-400">All features disabled</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-400 font-mono">
                  v{policy.version} · Updated {formatDate(policy.updated_at)}
                </div>
              </div>
              
              <div className="bg-slate-50 p-4 flex justify-between gap-3 border-t border-slate-100">
                <button onClick={() => handleEdit(policy)} className="flex-1 flex justify-center items-center gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition">
                  <Edit size={14} /> Edit
                </button>
                <button onClick={() => handleDelete(policy.id)} className="flex-1 flex justify-center items-center gap-2 rounded-xl bg-white border border-rose-200 px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 transition">
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PolicyForm({ policy, onCancel, onSave }) {
  const [form, setForm] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  
  const handleFeatureToggle = (key) => {
    setForm(p => ({
      ...p,
      features_enabled: { ...p.features_enabled, [key]: !p.features_enabled[key] }
    }));
  };

  const handleIntervalChange = (key, value) => {
    setForm(p => ({
      ...p,
      collection_interval_seconds: { ...p.collection_interval_seconds, [key]: parseInt(value) || 0 }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const isNew = !form.id;
      const url = isNew ? `${API_BASE}/policies` : `${API_BASE}/policies/${form.id}`;
      const method = isNew ? "POST" : "PUT";
      
      const payload = { ...form };
      if (!isNew) {
        payload.target_type = undefined; // backend doesn't allow changing target_type or priority directly via PUT usually, but let's check
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save policy");
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-6 flex items-center justify-between">
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Settings2 className="text-blue-600" /> 
          {policy.id ? "Edit Policy" : "Create New Policy"}
        </h2>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 transition">
          <X size={24} />
        </button>
      </div>
      
      <form onSubmit={handleSubmit} className="p-8">
        {error && <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
        
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-5">
            <h3 className="font-black text-slate-800 border-b border-slate-100 pb-2">Basic Settings</h3>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Policy Name</label>
              <input required name="policy_name" value={form.policy_name} onChange={handleChange} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Description</label>
              <textarea name="description" value={form.description} onChange={handleChange} rows={3} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50" />
            </div>
            {!policy.id && (
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">Target Type</label>
                  <select name="target_type" value={form.target_type} onChange={handleChange} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50">
                    <option value="global">Global (Priority 1)</option>
                    <option value="branch">Branch (Priority 2)</option>
                    <option value="department">Department (Priority 3)</option>
                    <option value="employee">Employee (Priority 4)</option>
                    <option value="asset">Hardware Asset (Priority 5)</option>
                    <option value="device">Specific Device (Priority 6)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">Priority</label>
                  <input type="number" name="priority" value={form.priority} onChange={handleChange} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50" readOnly title="Determined by Target Type" />
                </div>
              </div>
            )}
            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 text-xs font-semibold text-blue-900 flex gap-3">
              <AlertCircle size={16} className="shrink-0 text-blue-600" />
              <p>Higher priority policies override lower priority ones when they target the same device. (Device = 6, Global = 1)</p>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="font-black text-slate-800 border-b border-slate-100 pb-2">Features & Intervals</h3>
            <div className="space-y-4">
              {['heartbeat', 'activity', 'hardware_inventory', 'software_inventory', 'screenshots'].map(feature => (
                <div key={feature} className="flex items-center justify-between gap-4 p-3 rounded-2xl border border-slate-100 hover:bg-slate-50 transition">
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={!!form.features_enabled[feature]} 
                        onChange={() => handleFeatureToggle(feature)}
                        className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                      />
                      <span className="font-bold text-sm text-slate-700 capitalize">{feature.replace('_', ' ')}</span>
                    </label>
                  </div>
                  {form.features_enabled[feature] && (
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" 
                        value={form.collection_interval_seconds[feature] || 60} 
                        onChange={(e) => handleIntervalChange(feature, e.target.value)}
                        className="w-20 rounded-lg border border-slate-200 p-1.5 text-sm text-center outline-none focus:border-blue-500" 
                      />
                      <span className="text-xs font-bold text-slate-500 uppercase">sec</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-100 transition">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50">
            <Save size={18} /> {saving ? "Saving..." : "Save Policy"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PolicyAssignForm({ policies, form, setForm, onCancel, onSave }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  
  const [targets, setTargets] = useState([]);
  
  useEffect(() => {
    // Basic assignment target loader based on target_type
    const loadTargets = async () => {
      try {
        let url = "";
        let idField = "id";
        let nameField = "name";
        
        switch (form.target_type) {
          case "branch": url = "/api/v1/branches"; idField="branch_id"; nameField="branch_name"; break;
          case "employee": url = "/api/v1/users"; idField="user_id"; nameField="full_name"; break;
          case "asset": url = "/api/v1/hardware-assets"; idField="asset_id"; nameField="asset_tag"; break;
          case "device": url = "/api/v1/endpoint-management/devices"; idField="device_id"; nameField="hostname"; break;
          default: setTargets([]); return;
        }
        
        const res = await fetch(`${API_URL}${url}`, { headers: authHeaders() });
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.data || []);
        
        setTargets(list.map(t => ({ id: t[idField], name: t[nameField] || t.email || `Item ${t[idField]}` })));
      } catch (e) {
        console.error("Failed to load targets", e);
      }
    };
    if (form.target_type !== "global" && form.target_type !== "department") {
      loadTargets();
    }
  }, [form.target_type]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/policies/${form.policy_id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ target_type: form.target_type, target_id: form.target_id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to assign policy");
      alert("Policy assigned successfully! Note: Agent updates its policy every 60 seconds.");
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-6 flex items-center justify-between">
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Link className="text-blue-600" /> Assign Policy
        </h2>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 transition">
          <X size={24} />
        </button>
      </div>
      
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
        
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">Select Policy</label>
          <select required value={form.policy_id} onChange={e => setForm({...form, policy_id: e.target.value})} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50 text-slate-800 font-semibold">
            {policies.map(p => (
              <option key={p.id} value={p.id}>{p.policy_name} (Priority {p.priority})</option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">Target Type</label>
            <select required value={form.target_type} onChange={e => setForm({...form, target_type: e.target.value, target_id: ""})} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50 text-slate-800">
              <option value="global">Global (All Endpoints)</option>
              <option value="branch">Branch</option>
              <option value="department">Department</option>
              <option value="employee">Employee</option>
              <option value="asset">Hardware Asset</option>
              <option value="device">Specific Device</option>
            </select>
          </div>
          
          {form.target_type === "department" ? (
             <div>
               <label className="mb-2 block text-sm font-bold text-slate-700">Department Name</label>
               <input required type="text" placeholder="e.g. Engineering" value={form.target_id} onChange={e => setForm({...form, target_id: e.target.value})} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50" />
             </div>
          ) : form.target_type !== "global" ? (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">Select Target</label>
              <select required value={form.target_id} onChange={e => setForm({...form, target_id: e.target.value})} className="w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-blue-500 bg-slate-50 text-slate-800">
                <option value="">-- Choose {form.target_type} --</option>
                {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          ) : null}
        </div>
        
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 mt-6">
          <p className="text-xs font-bold text-amber-800 flex items-center gap-2">
            <AlertCircle size={16} /> Assignment Rules
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs font-semibold text-amber-700 space-y-1">
            <li>Assigning creates an active mapping.</li>
            <li>Agents periodically recalculate their effective policy by checking all their properties (Device, Asset, Employee, Dept, Branch, Global).</li>
            <li>If consent is denied, it will override policy features regardless of priority.</li>
          </ul>
        </div>

        <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="rounded-xl px-6 py-3 font-bold text-slate-500 hover:bg-slate-100 transition">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50">
            <Link size={18} /> {saving ? "Assigning..." : "Assign Policy"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PolicyAuditLogs({ onCancel }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/audit`, { headers: authHeaders() })
      .then(res => res.json())
      .then(data => {
        if (!data.success) throw new Error(data.message || "Failed to load audit logs");
        setLogs(data.data || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50 p-6 flex items-center justify-between">
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <List className="text-blue-600" /> Policy Audit Logs
        </h2>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 transition">
          <X size={24} />
        </button>
      </div>
      
      <div className="p-6">
        {error && <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Policy ID</th>
                <th className="px-4 py-3">Changes</th>
                <th className="px-4 py-3">Performed By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">Loading audit logs...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">No audit logs found.</td></tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${log.action === "CREATED" ? "bg-emerald-100 text-emerald-800" : log.action === "DELETED" ? "bg-rose-100 text-rose-800" : "bg-blue-100 text-blue-800"}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{log.policy_id}</td>
                    <td className="px-4 py-3 max-w-md truncate text-slate-600" title={JSON.stringify(log.changes_json)}>
                      {JSON.stringify(log.changes_json)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-semibold">{log.user_name || `User ${log.user_id}`}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
