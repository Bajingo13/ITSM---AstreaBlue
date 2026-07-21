import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Search,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { API_URL } from "../config/api";
import { getAuthToken } from "../context/AuthService";
import { useAuth } from "../context/AuthContext";
import PageHero from "../components/layout/PageHero";

const STATUS_TRANSITIONS = {
  Draft: ["In Progress", "Cancelled"],
  "In Progress": ["Awaiting Employee", "Awaiting IT", "Ready for Verification", "Cancelled"],
  "Awaiting Employee": ["In Progress", "Awaiting IT", "Ready for Verification", "Cancelled"],
  "Awaiting IT": ["In Progress", "Awaiting Employee", "Ready for Verification", "Cancelled"],
  "Ready for Verification": ["In Progress", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

async function lifecycleRequest(path, options = {}) {
  const response = await fetch(`${API_URL}/api/v1/employee-lifecycle${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.message || "Lifecycle request failed.");
  return payload.data;
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function statusClass(status) {
  if (status === "Completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "Ready for Verification") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "Awaiting Employee" || status === "Awaiting IT") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

export default function EmployeeLifecycle() {
  const { role } = useAuth();
  const normalizedRole = String(role || "").toLowerCase();
  const [summary, setSummary] = useState({});
  const [cases, setCases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ type: "", status: "", search: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ lifecycle_type: "Onboarding", employee_id: "", target_date: "", related_ticket_id: "", notes: "" });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    return params.toString();
  }, [filters]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryData, caseData, employeeData] = await Promise.all([
        lifecycleRequest("/summary"),
        lifecycleRequest(`/cases${query ? `?${query}` : ""}`),
        lifecycleRequest("/employees"),
      ]);
      setSummary(summaryData || {});
      setCases(caseData || []);
      setEmployees(employeeData || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  async function openCase(id) {
    setBusy(true);
    setError("");
    try {
      setDetails(await lifecycleRequest(`/cases/${id}`));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createCase(event) {
    event.preventDefault();
    if (!form.employee_id) return setError("Select an employee.");
    setBusy(true);
    setError("");
    try {
      const created = await lifecycleRequest("/cases", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          employee_id: Number(form.employee_id),
          related_ticket_id: form.related_ticket_id ? Number(form.related_ticket_id) : null,
        }),
      });
      setShowCreate(false);
      setForm({ lifecycle_type: "Onboarding", employee_id: "", target_date: "", related_ticket_id: "", notes: "" });
      setNotice(`${created.case_number} created with its required checklist.`);
      await loadWorkspace();
      await openCase(created.lifecycle_case_id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateTask(task, status) {
    setBusy(true);
    setError("");
    try {
      await lifecycleRequest(`/cases/${details.lifecycle_case_id}/tasks/${task.lifecycle_task_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await Promise.all([openCase(details.lifecycle_case_id), loadWorkspace()]);
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  async function updateStatus(status) {
    setBusy(true);
    setError("");
    try {
      await lifecycleRequest(`/cases/${details.lifecycle_case_id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(`Case status updated to ${status}.`);
      await Promise.all([openCase(details.lifecycle_case_id), loadWorkspace()]);
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  const metrics = [
    ["Active Onboarding", summary.active_onboarding || 0, UserPlus, "text-blue-600", "bg-blue-50"],
    ["Active Offboarding", summary.active_offboarding || 0, UserMinus, "text-rose-600", "bg-rose-50"],
    ["Ready to Verify", summary.ready_for_verification || 0, ClipboardCheck, "text-violet-600", "bg-violet-50"],
    ["Completed", summary.completed || 0, CheckCircle2, "text-emerald-600", "bg-emerald-50"],
  ];

  return (
    <div className="space-y-5">
      <PageHero eyebrow="People Operations" title="Employee Lifecycle Management" subtitle="Branch-scoped onboarding and offboarding checklists with HR oversight, IT execution, verification gates, and audit history." />

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">{error}</div>}
      {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700">{notice}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon, color, background]) => (
          <article key={label} className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
            <div className="flex items-center justify-between">
              <div><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-950">{value}</p></div>
              <span className={`rounded-2xl p-3 ${background}`}><Icon className={color} size={22} /></span>
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div><h2 className="text-xl font-black text-slate-950">Lifecycle cases</h2><p className="text-sm text-slate-500">HR owns verification; assigned IT tasks remain clearly separated.</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void loadWorkspace()} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50"><RefreshCw size={16} /> Refresh</button>
            <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-blue-700"><UserPlus size={16} /> New lifecycle case</button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_190px_220px]">
          <label className="flex items-center gap-2 rounded-xl border border-blue-200 bg-slate-50 px-4"><Search size={17} className="text-blue-500"/><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search employee, email, or case number" className="w-full bg-transparent py-3 text-sm outline-none"/></label>
          <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))} className="rounded-xl border border-blue-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none"><option value="">All lifecycle types</option><option>Onboarding</option><option>Offboarding</option></select>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="rounded-xl border border-blue-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none"><option value="">All statuses</option>{Object.keys(STATUS_TRANSITIONS).map((status) => <option key={status}>{status}</option>)}</select>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-blue-100">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Case", "Employee", "Branch", "Status", "Checklist", "Target", "Action"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-blue-50">
              {loading ? <tr><td colSpan="7" className="px-4 py-14 text-center text-slate-500">Loading lifecycle cases…</td></tr> : cases.length ? cases.map((item) => {
                const progress = item.task_count ? Math.round((item.completed_task_count / item.task_count) * 100) : 0;
                return <tr key={item.lifecycle_case_id} className="hover:bg-blue-50/40">
                  <td className="px-4 py-4"><p className="font-black text-blue-700">{item.case_number}</p><p className="text-xs text-slate-500">{item.lifecycle_type}</p></td>
                  <td className="px-4 py-4"><p className="font-bold text-slate-900">{item.employee_name}</p><p className="text-xs text-slate-500">{item.employee_email}</p></td>
                  <td className="px-4 py-4 text-slate-600">{item.branch_name}</td>
                  <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusClass(item.status)}`}>{item.status}</span></td>
                  <td className="min-w-[150px] px-4 py-4"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }}/></div><p className="mt-1 text-xs text-slate-500">{item.completed_task_count}/{item.task_count} complete</p></td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(item.target_date)}</td>
                  <td className="px-4 py-4"><button disabled={busy} onClick={() => void openCase(item.lifecycle_case_id)} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">Open <ArrowRight size={14}/></button></td>
                </tr>;
              }) : <tr><td colSpan="7" className="px-4 py-14 text-center text-slate-500">No lifecycle cases match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
        <form onSubmit={createCase} className="w-full max-w-2xl overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-blue-100 p-6"><div><h2 className="text-2xl font-black">Create lifecycle case</h2><p className="text-sm text-slate-500">A complete required checklist is added automatically.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X/></button></header>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <Field label="Lifecycle type"><select value={form.lifecycle_type} onChange={(event) => setForm((current) => ({ ...current, lifecycle_type: event.target.value }))} className="field"><option>Onboarding</option><option>Offboarding</option></select></Field>
            <Field label="Employee"><select required value={form.employee_id} onChange={(event) => setForm((current) => ({ ...current, employee_id: event.target.value }))} className="field"><option value="">Select employee</option>{employees.map((employee) => <option key={employee.user_id} value={employee.user_id}>{employee.full_name} — {employee.branch_name}</option>)}</select></Field>
            <Field label="Target date"><input type="date" value={form.target_date} onChange={(event) => setForm((current) => ({ ...current, target_date: event.target.value }))} className="field"/></Field>
            <Field label="Related ticket ID (optional)"><input type="number" min="1" value={form.related_ticket_id} onChange={(event) => setForm((current) => ({ ...current, related_ticket_id: event.target.value }))} className="field" placeholder="Database ticket ID"/></Field>
            <label className="sm:col-span-2"><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Notes</span><textarea rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="field resize-none" placeholder="Context for HR and IT"/></label>
          </div>
          <footer className="flex justify-end gap-3 border-t border-blue-100 bg-slate-50 p-5"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-5 py-2.5 font-bold">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">{busy ? "Creating…" : "Create case"}</button></footer>
        </form>
      </div>}

      {details && <CaseDrawer details={details} role={normalizedRole} busy={busy} onClose={() => setDetails(null)} onTask={updateTask} onStatus={updateStatus}/>} 
      <style>{`.field{width:100%;border:1px solid #bfdbfe;border-radius:.75rem;background:#f8fafc;padding:.75rem 1rem;font-size:.875rem;outline:none}.field:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12)}`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return <label><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">{label}</span>{children}</label>;
}

function CaseDrawer({ details, role, busy, onClose, onTask, onStatus }) {
  const progress = details.task_count ? Math.round((details.completed_task_count / details.task_count) * 100) : 0;
  const transitions = STATUS_TRANSITIONS[details.status] || [];
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm">
    <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-blue-100 bg-[#f7faff] shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-blue-100 bg-white p-6"><div><p className="text-xs font-black uppercase tracking-widest text-blue-600">{details.case_number}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{details.employee_name}</h2><p className="text-sm text-slate-500">{details.lifecycle_type} · {details.branch_name}</p></div><button onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"><X/></button></header>
      <div className="space-y-5 p-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <Info label="Status" value={details.status}/><Info label="Target Date" value={formatDate(details.target_date)}/><Info label="Related Ticket" value={details.related_ticket_number || "Not linked"}/>
        </section>
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><h3 className="font-black text-slate-950">Required checklist</h3><p className="text-sm text-slate-500">{details.completed_task_count} of {details.task_count} tasks complete</p></div><span className="text-2xl font-black text-blue-600">{progress}%</span></div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${progress}%` }}/></div>
          <div className="mt-5 space-y-3">{details.tasks?.map((task) => {
            const completed = task.status === "Completed";
            const hrBlocked = role === "hr" && String(task.assigned_role).toLowerCase() !== "hr";
            return <article key={task.lifecycle_task_id} className={`rounded-2xl border p-4 ${completed ? "border-emerald-200 bg-emerald-50/60" : "border-blue-100 bg-slate-50"}`}>
              <div className="flex gap-3"><button disabled={busy || hrBlocked || ["Completed", "Cancelled"].includes(details.status)} onClick={() => void onTask(task, completed ? "Pending" : "Completed")} title={hrBlocked ? `Assigned to ${task.assigned_role}` : "Update checklist task"} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-blue-300 bg-white text-transparent"} disabled:cursor-not-allowed disabled:opacity-50`}><CheckCircle2 size={16}/></button>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-slate-900">{task.task_label}</h4><span className="rounded-full border border-blue-100 bg-white px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">{task.assigned_role}</span>{task.is_required && <span className="text-[10px] font-black uppercase text-rose-600">Required</span>}</div><p className="mt-1 text-sm leading-6 text-slate-600">{task.task_description}</p>{completed && <p className="mt-2 text-xs font-semibold text-emerald-700">Completed by {task.completed_by_name || "authorized user"} · {formatDate(task.completed_at, true)}</p>}{hrBlocked && !completed && <p className="mt-2 text-xs font-semibold text-amber-700">Visible to HR; completion is restricted to IT/Admin.</p>}</div>
              </div>
            </article>;
          })}</div>
        </section>
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h3 className="font-black">Workflow action</h3><p className="mt-1 text-sm text-slate-500">Completion is available only from Ready for Verification and after all required tasks are complete.</p><div className="mt-4 flex flex-wrap gap-2">{transitions.length ? transitions.map((status) => <button key={status} disabled={busy} onClick={() => void onStatus(status)} className={`rounded-xl border px-4 py-2.5 text-sm font-black ${status === "Cancelled" ? "border-rose-200 text-rose-700 hover:bg-rose-50" : "border-blue-200 bg-blue-600 text-white hover:bg-blue-700"}`}>{status}</button>) : <span className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-500">No further actions</span>}</div></section>
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h3 className="font-black">Audit history</h3><div className="mt-4 space-y-4 border-l-2 border-blue-100 pl-5">{details.history?.map((event) => <div key={event.lifecycle_history_id} className="relative"><span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-blue-600 bg-white"/><p className="font-bold text-slate-900">{event.message}</p><p className="text-xs text-slate-500">{event.changed_by_name || "System"} · {formatDate(event.created_at, true)}</p></div>)}</div></section>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900"><strong>Monitoring safeguard:</strong> lifecycle actions never reinstall an agent or rotate a healthy device credential. Endpoint assignment and diagnostics continue through the existing Endpoint Management workflow.</div>
      </div>
    </aside>
  </div>;
}

function Info({ label, value }) {
  return <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-400">{label}</p><p className="mt-2 font-black text-slate-900">{value}</p></div>;
}
