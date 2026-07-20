import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, CheckCircle2, ClipboardCheck, Clock3,
  History, Laptop, PackageCheck, Paperclip, Plus, RefreshCw, Search, ShieldCheck,
  Wrench, X,
} from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { useAuth } from "../context/AuthContext";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";
import { replacementRequestApi } from "../services/replacementRequestApi";
import { subscribeToReplacementChanges } from "../services/realtimeTickets";

const STATUS_OPTIONS = ["", "Submitted", "Under Assessment", "Awaiting Approval", "Approved", "Replacement Reserved", "Issued", "Completed", "Repair Recommended", "In Repair", "Repaired", "Rejected", "Cancelled"];
const terminal = new Set(["Completed", "Repaired", "Rejected", "Cancelled"]);
const panel = "rounded-[24px] border border-blue-100 bg-white shadow-[0_12px_35px_rgba(30,64,175,0.08)]";
const field = "w-full rounded-xl border border-blue-200 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100";

const statusTone = {
  Submitted: "border-blue-200 bg-blue-50 text-blue-700",
  "Under Assessment": "border-cyan-200 bg-cyan-50 text-cyan-700",
  "Awaiting Approval": "border-amber-200 bg-amber-50 text-amber-700",
  Approved: "border-indigo-200 bg-indigo-50 text-indigo-700",
  "Replacement Reserved": "border-violet-200 bg-violet-50 text-violet-700",
  Issued: "border-sky-200 bg-sky-50 text-sky-700",
  Completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Repair Recommended": "border-orange-200 bg-orange-50 text-orange-700",
  "In Repair": "border-amber-200 bg-amber-50 text-amber-800",
  Repaired: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Rejected: "border-red-200 bg-red-50 text-red-700",
  Cancelled: "border-slate-200 bg-slate-100 text-slate-600",
};

function StatusBadge({ status }) {
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusTone[status] || statusTone.Cancelled}`}>{status}</span>;
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`flex max-h-[94vh] w-full flex-col overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-2xl ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
      <header className="flex items-start justify-between border-b border-blue-100 px-6 py-5">
        <div><h2 className="text-xl font-black text-slate-950">{title}</h2>{subtitle && <p className="mt-1 text-sm font-semibold text-slate-500">{subtitle}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"><X size={20}/></button>
      </header>
      <div className="overflow-y-auto bg-slate-50/70 p-6">{children}</div>
    </section>
  </div>;
}

function Metric({ icon: Icon, label, value, tone }) {
  return <article className={`${panel} group p-5 transition duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl`}>
    <div className="flex items-center justify-between"><span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}><Icon size={20}/></span><span className="text-3xl font-black text-slate-950">{value ?? 0}</span></div>
    <p className="mt-4 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
  </article>;
}

function CreateRequest({ user, employees, onClose, onCreated }) {
  const role = String(user?.role_name || "").toLowerCase();
  const employeeOnly = role === "employee";
  const [form, setForm] = useState({ employee_id: employeeOnly ? user.user_id : "", current_asset_id: "", title: "", description: "", damage_type: "Hardware failure", urgency: "Medium", source_ticket_id: "" });
  const [assets, setAssets] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm((current) => ({
    ...current,
    [key]: event.target.value,
    ...(key === "employee_id" ? { current_asset_id: "", source_ticket_id: "" } : {}),
  }));

  useEffect(() => {
    if (!form.employee_id) { setAssets([]); setTickets([]); return; }
    let active = true;
    setLoadingChoices(true);
    Promise.all([
      replacementRequestApi.currentAssets(form.employee_id),
      replacementRequestApi.linkableTickets(form.employee_id),
    ]).then(([assetRows, ticketRows]) => {
      if (!active) return;
      setAssets(assetRows);
      setTickets(ticketRows);
    }).catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoadingChoices(false));
    return () => { active = false; };
  }, [form.employee_id]);

  async function submit(event) {
    event.preventDefault();
    if (!form.employee_id || !form.current_asset_id || !form.description.trim()) { setError("Employee, assigned laptop, and problem description are required."); return; }
    setSaving(true); setError("");
    try {
      const created = await replacementRequestApi.create({ ...form, source_ticket_id: form.source_ticket_id || null });
      if (files.length) await replacementRequestApi.upload(created.id, files);
      onCreated();
    } catch (submitError) { setError(submitError.message); } finally { setSaving(false); }
  }

  return <Modal title="New Replacement Request" subtitle="Report a broken employee laptop and begin a controlled replacement." onClose={onClose}>
    <form onSubmit={submit} className="space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      {!employeeOnly && <label className="block"><span className="mb-2 block text-sm font-black text-slate-800">Employee *</span><select value={form.employee_id} onChange={set("employee_id")} className={field}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.user_id} value={employee.user_id}>{employee.full_name} {employee.branch_name ? `— ${employee.branch_name}` : ""}</option>)}</select></label>}
      <label className="block"><span className="mb-2 block text-sm font-black text-slate-800">Currently assigned laptop *</span><select value={form.current_asset_id} onChange={set("current_asset_id")} className={field}><option value="">Select assigned asset</option>{assets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.asset_tag} — {asset.asset_name || `${asset.brand || ""} ${asset.model || ""}`}</option>)}</select>{form.employee_id && !assets.length && <span className="mt-2 block text-xs font-semibold text-amber-700">No linked asset was found for this employee.</span>}</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="mb-2 block text-sm font-black text-slate-800">Damage type</span><select value={form.damage_type} onChange={set("damage_type")} className={field}>{["Hardware failure","Physical damage","Battery or power","Display","Keyboard or touchpad","Storage failure","Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span className="mb-2 block text-sm font-black text-slate-800">Urgency</span><select value={form.urgency} onChange={set("urgency")} className={field}>{["Low","Medium","High","Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <label className="block"><span className="mb-2 block text-sm font-black text-slate-800">Request title</span><input value={form.title} onChange={set("title")} className={field} placeholder="Example: Laptop no longer powers on"/></label>
      <label className="block"><span className="mb-2 block text-sm font-black text-slate-800">Problem description *</span><textarea value={form.description} onChange={set("description")} rows="5" className={field} placeholder="Describe the problem, when it started, and any troubleshooting already attempted."/></label>
      <label className="block"><span className="mb-2 block text-sm font-black text-slate-800">Related open ticket (optional)</span><select value={form.source_ticket_id} onChange={set("source_ticket_id")} disabled={!form.employee_id || loadingChoices} className={field}><option value="">{loadingChoices ? "Loading open tickets..." : "No related ticket"}</option>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.ticket_number || `Ticket ${ticket.id}`} — {ticket.title}</option>)}</select>{form.employee_id && !loadingChoices && !tickets.length && <span className="mt-2 block text-xs font-semibold text-slate-500">This employee has no tickets currently in Open Queue.</span>}</label>
      <label className="block"><span className="mb-2 flex items-center gap-2 text-sm font-black text-slate-800"><Paperclip size={16}/> Evidence (optional)</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFiles([...event.target.files])} className={`${field} file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-xs file:font-black file:text-white`}/></label>
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60">{saving && <RefreshCw size={16} className="animate-spin"/>} Submit Request</button></div>
    </form>
  </Modal>;
}

function RequestDetail({ id, user, onClose, onChanged }) {
  const role = String(user?.role_name || "").toLowerCase();
  const manager = ["admin", "superadmin"].includes(role);
  const staff = manager || role === "technician";
  const [item, setItem] = useState(null);
  const [assets, setAssets] = useState([]);
  const [form, setForm] = useState({ diagnosis: "", assessment_notes: "", recommendation: "", approval_notes: "", rejection_reason: "", replacement_asset_id: "", repair_resolution: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const detail = await replacementRequestApi.detail(id);
      setItem(detail);
      setForm({ diagnosis: detail.diagnosis || "", assessment_notes: detail.assessment_notes || "", recommendation: detail.recommendation || "", approval_notes: detail.approval_notes || "", rejection_reason: detail.rejection_reason || "", replacement_asset_id: detail.replacement_asset_id || "", repair_resolution: detail.repair_resolution || "" });
      if (staff) replacementRequestApi.availableAssets().then(setAssets).catch(() => setAssets([]));
    } catch (loadError) { setError(loadError.message); }
  }, [id, staff]);
  useEffect(() => { load(); }, [load]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function act(status) {
    setBusy(true); setError("");
    try { await replacementRequestApi.transition(id, status, form); await load(); onChanged(); }
    catch (actionError) { setError(actionError.message); } finally { setBusy(false); }
  }
  async function saveAssessment() {
    setBusy(true); setError("");
    try { await replacementRequestApi.assess(id, form); await load(); onChanged(); }
    catch (actionError) { setError(actionError.message); } finally { setBusy(false); }
  }

  if (!item) return <Modal title="Replacement Request" onClose={onClose} wide>{error ? <p className="text-red-600">{error}</p> : <div className="flex items-center justify-center py-20"><RefreshCw className="animate-spin text-blue-600"/></div>}</Modal>;
  const actionButton = (label, status, tone = "bg-blue-600 hover:bg-blue-700") => <button disabled={busy} onClick={() => act(status)} className={`rounded-xl px-4 py-2.5 text-sm font-black text-white transition disabled:opacity-50 ${tone}`}>{label}</button>;

  return <Modal title={item.request_number} subtitle={item.title} onClose={onClose} wide>
    <div className="space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      <section className={`${panel} p-5`}><div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge status={item.status}/><span className="text-sm font-bold text-slate-500">Updated {new Date(item.updated_at).toLocaleString()}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ["Employee", item.employee_name], ["Branch", item.branch_name], ["Current asset", item.current_asset_tag], ["Urgency", item.urgency],
          ["Damage type", item.damage_type || "Not specified"], ["Replacement", item.replacement_asset_tag || "Not reserved"], ["Requested by", item.requester_name], ["Related ticket", item.source_ticket_number || "None"],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4"><p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 text-sm font-black text-slate-800">{value}</p></div>)}</div>
      </section>
      <section className={`${panel} p-5`}><h3 className="font-black text-slate-900">Reported problem</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.description}</p></section>

      {staff && !terminal.has(item.status) && item.status !== "Issued" && <section className={`${panel} p-5`}><div className="flex items-center gap-2"><Wrench size={18} className="text-blue-600"/><h3 className="font-black text-slate-900">Technical assessment</h3></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2"><label><span className="mb-2 block text-sm font-black">Diagnosis</span><textarea rows="4" value={form.diagnosis} onChange={set("diagnosis")} className={field}/></label><label><span className="mb-2 block text-sm font-black">Assessment notes</span><textarea rows="4" value={form.assessment_notes} onChange={set("assessment_notes")} className={field}/></label></div>
        <label className="mt-4 block"><span className="mb-2 block text-sm font-black">Recommendation</span><textarea rows="3" value={form.recommendation} onChange={set("recommendation")} className={field}/></label>
        <button disabled={busy} onClick={saveAssessment} className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700 hover:bg-blue-100">Save Assessment</button>
      </section>}

      {manager && ["Approved", "Replacement Reserved"].includes(item.status) && <section className={`${panel} p-5`}><div className="flex items-center gap-2"><PackageCheck size={18} className="text-blue-600"/><h3 className="font-black text-slate-900">Replacement asset</h3></div><select value={form.replacement_asset_id} onChange={set("replacement_asset_id")} disabled={item.status === "Replacement Reserved"} className={`${field} mt-4`}><option value="">Select an available asset</option>{item.replacement_asset_id && <option value={item.replacement_asset_id}>{item.replacement_asset_tag} — reserved</option>}{assets.filter((asset) => Number(asset.asset_id) !== Number(item.replacement_asset_id)).map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.asset_tag} — {asset.asset_name} ({asset.branch_name || "Unassigned branch"})</option>)}</select></section>}

      {manager && item.status === "Awaiting Approval" && <section className={`${panel} p-5`}><h3 className="font-black text-slate-900">Approval decision</h3><textarea value={form.approval_notes} onChange={set("approval_notes")} rows="3" className={`${field} mt-4`} placeholder="Approval notes"/><textarea value={form.rejection_reason} onChange={set("rejection_reason")} rows="3" className={`${field} mt-3`} placeholder="Rejection reason (required when rejecting)"/></section>}

      {manager && item.status === "Repair Recommended" && <section className={`${panel} border-orange-200 bg-orange-50/40 p-5`}><h3 className="font-black text-slate-900">Repair recommendation awaiting action</h3><p className="mt-2 text-sm font-semibold leading-6 text-slate-600">The technician recommended repair. The laptop remains in its current hardware state until you send it to repair.</p><p className="mt-3 rounded-xl border border-orange-200 bg-white p-3 text-sm font-bold text-orange-800">{item.recommendation || "No recommendation details recorded."}</p></section>}
      {manager && item.status === "In Repair" && <section className={`${panel} border-amber-200 bg-amber-50/40 p-5`}><h3 className="font-black text-slate-900">Complete repair</h3><p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Record what was repaired and confirm that the laptop passed testing. An assigned laptop returns to Borrowed; an unassigned laptop returns to Available.</p><textarea value={form.repair_resolution} onChange={set("repair_resolution")} rows="4" className={`${field} mt-4`} placeholder="Required: repair performed, parts replaced, and verification results"/></section>}

      <section className={`${panel} p-5`}><div className="flex flex-wrap items-center gap-3">
        {staff && item.status === "Submitted" && actionButton("Start Assessment", "Under Assessment")}
        {staff && item.status === "Under Assessment" && <>{actionButton("Send for Approval", "Awaiting Approval")}{actionButton("Recommend Repair", "Repair Recommended", "bg-orange-500 hover:bg-orange-600")}</>}
        {manager && item.status === "Repair Recommended" && actionButton("Send to Repair", "In Repair", "bg-amber-600 hover:bg-amber-700")}
        {manager && item.status === "In Repair" && actionButton("Mark Repaired & Return to Service", "Repaired", "bg-emerald-600 hover:bg-emerald-700")}
        {manager && item.status === "Awaiting Approval" && <>{actionButton("Approve Replacement", "Approved", "bg-emerald-600 hover:bg-emerald-700")}{actionButton("Reject", "Rejected", "bg-red-600 hover:bg-red-700")}</>}
        {manager && item.status === "Approved" && actionButton("Reserve Selected Asset", "Replacement Reserved")}
        {manager && item.status === "Replacement Reserved" && actionButton("Issue Replacement", "Issued", "bg-violet-600 hover:bg-violet-700")}
        {manager && item.status === "Issued" && actionButton("Confirm Completion", "Completed", "bg-emerald-600 hover:bg-emerald-700")}
        {((role === "employee" && item.status === "Submitted") || (manager && ["Submitted","Under Assessment","Awaiting Approval","Approved","Replacement Reserved"].includes(item.status))) && actionButton("Cancel Request", "Cancelled", "bg-slate-600 hover:bg-slate-700")}
        {!terminal.has(item.status) && <p className="text-xs font-semibold text-slate-500">Actions are validated by role, branch, asset availability, and consent status.</p>}
      </div></section>

      <section className={`${panel} p-5`}><div className="flex items-center gap-2"><History size={18} className="text-blue-600"/><h3 className="font-black text-slate-900">Audit history</h3></div><div className="mt-4 space-y-3">{item.history.map((entry) => <div key={entry.id} className="relative border-l-2 border-blue-200 py-1 pl-5"><span className="absolute -left-[6px] top-2 h-2.5 w-2.5 rounded-full bg-blue-500"/><p className="text-sm font-bold text-slate-700">{entry.message}</p><p className="mt-1 text-xs font-semibold text-slate-400">{entry.changed_by_name || "System"} · {new Date(entry.created_at).toLocaleString()}</p></div>)}</div></section>
    </div>
  </Modal>;
}

export default function ReplacementRequests() {
  const { user } = useAuth();
  const role = String(user?.role_name || "").toLowerCase();
  const [summary, setSummary] = useState({});
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [summaryData, rows] = await Promise.all([replacementRequestApi.summary(), replacementRequestApi.list(filters)]);
      setSummary(summaryData || {}); setRequests(rows);
    } catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { const timer = setTimeout(load, filters.search ? 250 : 0); return () => clearTimeout(timer); }, [load, filters.search]);
  useEffect(() => subscribeToReplacementChanges(() => load()), [load]);
  useEffect(() => {
    if (role === "employee") return;
    fetch(`${API_URL}/api/v1/users`, { headers: authHeaders(), cache: "no-store" }).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.message || body.error || "Failed to load employees."); return body.data || body;
    }).then((rows) => setEmployees((Array.isArray(rows) ? rows : []).filter((row) => String(row.role_name || row.role || "").toLowerCase() === "employee" && (role === "superadmin" || Number(row.branch_id) === Number(user?.branch_id)))))
      .catch((employeeError) => setError(employeeError.message));
  }, [role, user?.branch_id]);
  const visibleEmployees = useMemo(() => employees.sort((a, b) => a.full_name.localeCompare(b.full_name)), [employees]);
  const changed = () => load();

  return <div className="astrea-module-page space-y-6">
    <PageHero eyebrow="Replacement Management" title="Laptop Replacement Requests" subtitle="Assess failed employee laptops, approve replacements, and complete a controlled asset exchange without losing endpoint history." actions={<div className="flex gap-2"><button onClick={load} className="rounded-xl border border-white/25 bg-white/10 p-3 text-white transition hover:bg-white/20" aria-label="Refresh"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/></button><button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-blue-700 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"><Plus size={17}/> New Request</button></div>}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><Metric icon={ClipboardCheck} label="All Requests" value={summary.total} tone="bg-blue-50 text-blue-700"/><Metric icon={Clock3} label="Active" value={summary.active} tone="bg-cyan-50 text-cyan-700"/><Metric icon={ShieldCheck} label="Awaiting Approval" value={summary.awaiting_approval} tone="bg-amber-50 text-amber-700"/><Metric icon={PackageCheck} label="Reserved" value={summary.reserved} tone="bg-violet-50 text-violet-700"/><Metric icon={Wrench} label="In Repair" value={summary.in_repair} tone="bg-amber-50 text-amber-800"/><Metric icon={CheckCircle2} label="Repaired" value={summary.repaired} tone="bg-emerald-50 text-emerald-700"/></div>
    <section className={`${panel} p-4`}><div className="grid gap-3 md:grid-cols-[1fr_260px]"><label className="relative"><Search size={18} className="absolute left-4 top-3.5 text-slate-400"/><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} className={`${field} pl-11`} placeholder="Search request, employee, or asset tag"/></label><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className={field}>{STATUS_OPTIONS.map((status) => <option key={status || "all"} value={status}>{status || "All statuses"}</option>)}</select></div></section>
    {error && <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700"><AlertCircle size={18} className="mr-2 inline"/>{error}</section>}
    <section className={`${panel} replacement-requests-table overflow-hidden`}>
      {loading ? <div className="flex items-center justify-center py-24 text-blue-600"><RefreshCw className="animate-spin"/></div> : !requests.length ? <div className="py-24 text-center"><Laptop size={38} className="mx-auto text-blue-300"/><h2 className="mt-4 text-lg font-black text-slate-800">No replacement requests found</h2><p className="mt-2 text-sm font-semibold text-slate-500">Create a request when an assigned employee laptop requires assessment.</p></div> : <div className="overflow-x-auto"><table className="min-w-full"><thead className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-wider text-slate-500"><tr>{["Request","Employee","Current asset","Urgency","Status","Updated",""].map((heading) => <th key={heading} className="border-b border-blue-100 px-5 py-4">{heading}</th>)}</tr></thead><tbody>{requests.map((item) => <tr key={item.id} className="group border-b border-slate-100 transition hover:bg-blue-50/50"><td className="px-5 py-4"><p className="font-black text-blue-700">{item.request_number}</p><p className="mt-1 max-w-xs truncate text-xs font-semibold text-slate-500">{item.title}</p></td><td className="px-5 py-4"><p className="font-bold text-slate-800">{item.employee_name}</p><p className="text-xs text-slate-400">{item.branch_name}</p></td><td className="px-5 py-4"><p className="font-bold text-slate-700">{item.current_asset_tag}</p><p className="text-xs text-slate-400">{item.current_asset_name}</p></td><td className="px-5 py-4 text-sm font-black text-slate-700">{item.urgency}</td><td className="px-5 py-4"><StatusBadge status={item.status}/></td><td className="px-5 py-4 text-xs font-semibold text-slate-500">{new Date(item.updated_at).toLocaleString()}</td><td className="px-5 py-4"><button onClick={() => setSelected(item.id)} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white">Open <ArrowRight size={14}/></button></td></tr>)}</tbody></table></div>}
    </section>
    {creating && <CreateRequest user={user} employees={visibleEmployees} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }}/>} 
    {selected && <RequestDetail id={selected} user={user} onClose={() => setSelected(null)} onChanged={changed}/>} 
  </div>;
}
