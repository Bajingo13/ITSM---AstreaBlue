import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Plus, Radar, Upload, X } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1`;
const empty = { hostname: "", ip_address: "", mac_address: "", serial_number: "", asset_tag: "", os_name: "", manufacturer: "", device_type: "", status: "Online", branch_id: "" };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export default function AssetDiscovery() {
  const [records, setRecords] = useState([]);
  const [assets, setAssets] = useState([]);
  const [branches, setBranches] = useState([]);
  const [history, setHistory] = useState([]);
  const [showManual, setShowManual] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const options = { headers: authHeaders(), cache: "no-store" };
      const [discoveryResponse, historyResponse, assetsResponse, branchesResponse] = await Promise.all([
        fetch(`${API_BASE}/hardware-assets/discovery`, options),
        fetch(`${API_BASE}/hardware-assets/discovery/history`, options),
        fetch(`${API_BASE}/hardware-assets`, options),
        fetch(`${API_BASE}/branches`, options),
      ]);
      const [discoveryBody, historyBody, assetsBody, branchesBody] = await Promise.all([
        discoveryResponse.json(), historyResponse.json(), assetsResponse.json(), branchesResponse.json(),
      ]);
      if (!discoveryResponse.ok || discoveryBody.success === false) throw new Error(discoveryBody.message || discoveryBody.error);
      if (!historyResponse.ok || historyBody.success === false) throw new Error(historyBody.message || historyBody.error);
      if (!assetsResponse.ok) throw new Error(assetsBody.message || assetsBody.error || "Failed to load managed assets.");
      if (!branchesResponse.ok) throw new Error(branchesBody.message || branchesBody.error || "Failed to load branches.");
      setRecords(discoveryBody.data || []);
      setHistory(historyBody.data || []);
      setAssets(Array.isArray(assetsBody) ? assetsBody : (assetsBody.data || assetsBody.assets || []));
      setBranches(Array.isArray(branchesBody) ? branchesBody : (branchesBody.data || branchesBody.branches || []));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [load]);

  const metrics = useMemo(() => ({
    matched: records.filter((record) => Boolean(record.matched_asset_id)).length,
    unmanaged: records.filter((record) => !record.matched_asset_id && ["Matched", "Unmanaged"].includes(record.reconciliation_status)).length,
    offline: records.filter((record) => record.status === "Offline" || record.reconciliation_status === "Offline").length,
    duplicate: records.filter((record) => record.reconciliation_status === "Duplicate").length,
  }), [records]);

  const scan = async () => {
    const response = await fetch(`${API_BASE}/hardware-assets/discovery/scan`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: "{}" });
    const body = await response.json();
    setMessage(body.message || body.error);
    if (body.data?.mode === "agent-required") setShowManual(true);
  };
  const link = async (id, assetId) => {
    if (!assetId) return;
    const response = await fetch(`${API_BASE}/hardware-assets/discovery/${id}/link`, { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ asset_id: Number(assetId) }) });
    const body = await response.json();
    setMessage(body.message || body.error);
    if (response.ok) load();
  };
  const createAsset = async (id, branchId) => {
    const response = await fetch(`${API_BASE}/hardware-assets/discovery/${id}/create-asset`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ branch_id: branchId || null }) });
    const body = await response.json();
    setMessage(body.message || body.error);
    if (response.ok) load();
  };
  const importCsv = async (file) => {
    if (!file) return;
    const imported = parseCsv(await file.text());
    if (!imported.length) return setMessage("The CSV is empty or invalid. Include a header row followed by at least one device record.");
    const response = await fetch(`${API_BASE}/hardware-assets/discovery/import`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ records: imported }) });
    const body = await response.json();
    setMessage(body.message || body.error);
    if (response.ok) load();
  };

  return <div className="space-y-6">
    <PageHero eyebrow="Asset Discovery" title="Asset Discovery & Inventory" subtitle="Register observed devices, reconcile them with managed hardware, and prepare agent-based network discovery." actions={<>
      <button onClick={scan} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 font-black text-blue-700"><Radar size={17}/> Scan Network</button>
      <button onClick={() => setShowManual(true)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-100 px-4 py-3 font-black text-blue-900"><Plus size={17}/> Manual Registration</button>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/40 bg-white/10 px-4 py-3 font-black text-white hover:bg-white/20"><Upload size={17}/> Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { importCsv(event.target.files?.[0]); event.target.value = ""; }}/></label>
    </>} />
    {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 font-semibold text-blue-800">{message}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm"><span className="font-black text-slate-900">Last scan or import:</span> {history[0] ? `${new Date(history[0].started_at).toLocaleString()} · ${history[0].source || history[0].status}` : "No scan or import has been recorded yet."}</section>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Matched", metrics.matched], ["Unmanaged", metrics.unmanaged], ["Offline", metrics.offline], ["Duplicates", metrics.duplicate]].map(([label, value]) => <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-900">{value}</p></div>)}</section>
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Device", "Network", "Identity", "OS / Manufacturer", "Source", "Last Seen", "Status", "Reconciliation", "Actions"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan="9" className="p-8 text-center">Loading discovery registry...</td></tr> : records.map((record) => <DiscoveryRow key={record.discovery_id} record={record} assets={assets} branches={branches} onLink={link} onCreate={createAsset}/>)}</tbody></table></div></section>
    {showManual && (
      <ManualModal branches={branches} onClose={() => setShowManual(false)} onSaved={(text) => { setShowManual(false); setMessage(text); load(); }}/>
    )}
  </div>;
}

function DiscoveryRow({ record, assets, branches, onLink, onCreate }) {
  const [assetId, setAssetId] = useState("");
  const matched = Boolean(record.matched_asset_id);
  const reconciliation = matched ? "Matched" : record.reconciliation_status === "Matched" ? "Needs Review" : record.reconciliation_status;
  return <tr className="border-t border-slate-100">
    <td className="px-4 py-4"><p className="font-black">{record.hostname}</p><p className="text-xs text-slate-500">{record.device_type || "Unknown device"}</p></td>
    <td className="px-4 py-4 text-sm">{record.ip_address || "—"}<br/>{record.mac_address || "—"}</td>
    <td className="px-4 py-4 text-sm">{record.serial_number || record.asset_tag || "—"}</td>
    <td className="px-4 py-4 text-sm">{record.os_name || "—"}<br/>{record.manufacturer || "—"}</td>
    <td className="px-4 py-4">{record.source}</td>
    <td className="px-4 py-4 text-sm">{new Date(record.last_seen).toLocaleString()}</td>
    <td className="px-4 py-4">{record.status}</td>
    <td className="px-4 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs font-black ${matched ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{reconciliation}</span></td>
    <td className="px-4 py-4">{matched
      ? <div><p className="font-bold text-emerald-700">Linked to {record.matched_asset_tag || record.asset_name || "managed asset"}</p><p className="mt-1 text-xs text-slate-500">No reconciliation action required.</p></div>
      : <div><p className="mb-2 text-xs font-semibold text-slate-500">Link this observation to an existing asset, or create a new asset.</p><div className="flex gap-2"><select value={assetId} onChange={(event) => setAssetId(event.target.value)} className="max-w-44 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"><option value="">Choose managed asset</option>{assets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.asset_tag} — {asset.asset_name}</option>)}</select><button disabled={!assetId} title="Link selected asset" onClick={() => onLink(record.discovery_id, assetId)} className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Link2 size={14}/></button><button onClick={() => onCreate(record.discovery_id, record.branch_id || branches[0]?.branch_id)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700">Create New Asset</button></div></div>}
    </td>
  </tr>;
}

function ManualModal({ branches, onClose, onSaved }) {
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_BASE}/hardware-assets/discovery`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(form) });
    const body = await response.json();
    if (!response.ok || body.success === false) return setError(body.message || body.error);
    onSaved(body.message);
  };
  return <div className="astrea-modal-backdrop"><form onSubmit={save} className="astrea-modal-panel max-w-2xl p-6"><div className="flex justify-between"><div><h2 className="text-xl font-black">Manual Discovery</h2><p className="text-sm text-slate-500">Register a real observed device for reconciliation.</p></div><button type="button" onClick={onClose}><X/></button></div>{error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2">{[["Hostname", "hostname"], ["IP Address", "ip_address"], ["MAC Address", "mac_address"], ["Serial Number", "serial_number"], ["Asset Tag", "asset_tag"], ["Operating System", "os_name"], ["Manufacturer", "manufacturer"], ["Device Type", "device_type"]].map(([label, key]) => <label key={key} className="astrea-field-label">{label}<input required={key === "hostname"} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="astrea-control mt-2"/></label>)}<label className="astrea-field-label">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="astrea-control mt-2"><option>Online</option><option>Offline</option></select></label><label className="astrea-field-label">Branch<select value={form.branch_id} onChange={(event) => setForm({ ...form, branch_id: event.target.value })} className="astrea-control mt-2"><option value="">Select branch</option>{branches.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>)}</select></label></div><button className="astrea-button astrea-button-primary mt-6 w-full">Register Discovery</button></form></div>;
}
