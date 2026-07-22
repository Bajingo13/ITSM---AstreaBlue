import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  RefreshCw,
  Search,
  Trash2,
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

const EMPTY_FORM = {
  lifecycle_type: "Onboarding",
  subject_mode: "new",
  employee_id: "",
  branch_id: "",
  subject_full_name: "",
  subject_contact_email: "",
  subject_employee_number: "",
  subject_department: "",
  subject_job_title: "",
  subject_start_date: "",
  target_date: "",
  related_ticket_id: "",
  notes: "",
};

async function lifecycleRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  if (options.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_URL}/api/v1/employee-lifecycle${path}`, {
    ...options,
    headers,
    cache: "no-store",
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
  const [branches, setBranches] = useState([]);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ type: "", status: "", search: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [invitation, setInvitation] = useState(null);

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
      const [summaryData, caseData, employeeData, branchData] = await Promise.all([
        lifecycleRequest("/summary"),
        lifecycleRequest(`/cases${query ? `?${query}` : ""}`),
        lifecycleRequest("/employees"),
        lifecycleRequest("/branches"),
      ]);
      setSummary(summaryData || {});
      setCases(caseData || []);
      setEmployees(employeeData || []);
      setBranches(branchData || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  async function openCase(id, preserveInvitation = false) {
    setBusy(true);
    setError("");
    if (!preserveInvitation) setInvitation(null);
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
    const newEmployee = form.lifecycle_type === "Onboarding" && form.subject_mode === "new";
    if (!newEmployee && !form.employee_id) return setError("Select an existing employee.");
    if (newEmployee && (!form.subject_full_name.trim() || !form.branch_id)) {
      return setError("Employee name and branch are required.");
    }
    setBusy(true);
    setError("");
    try {
      const created = await lifecycleRequest("/cases", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          employee_id: newEmployee ? null : Number(form.employee_id),
          branch_id: newEmployee ? Number(form.branch_id) : null,
          related_ticket_id: form.related_ticket_id ? Number(form.related_ticket_id) : null,
        }),
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setNotice(`${created.case_number} created with its required checklist.`);
      await loadWorkspace();
      await openCase(created.lifecycle_case_id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createAccountInvitation(values) {
    setBusy(true);
    setError("");
    try {
      const result = await lifecycleRequest(`/cases/${details.lifecycle_case_id}/account-invitation`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setInvitation(result);
      setNotice(result.email_sent
        ? `Account invitation emailed to ${result.email_recipients.join(", ")}.`
        : "Account invitation created, but email delivery was unsuccessful. Use the activation link below or correct SMTP and resend it.");
      await Promise.all([openCase(details.lifecycle_case_id, true), loadWorkspace()]);
      return result;
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
      return null;
    }
  }

  async function resendAccountInvitation() {
    setBusy(true);
    setError("");
    try {
      const result = await lifecycleRequest(`/cases/${details.lifecycle_case_id}/account-invitation/resend`, {
        method: "POST",
      });
      setInvitation(result);
      setNotice(result.email_sent
        ? `Account invitation emailed to ${result.email_recipients.join(", ")}.`
        : "A fresh activation link was created, but email delivery failed. Use the link below or correct SMTP and try again.");
      await Promise.all([openCase(details.lifecycle_case_id, true), loadWorkspace()]);
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  async function updateTask(task, status, notes = "") {
    setBusy(true);
    setError("");
    try {
      await lifecycleRequest(`/cases/${details.lifecycle_case_id}/tasks/${task.lifecycle_task_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes }),
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

  async function deleteCase(lifecycleCase) {
    if (!lifecycleCase || normalizedRole !== "superadmin" || lifecycleCase.status === "Completed") return;
    const confirmed = window.confirm(
      `Delete ${lifecycleCase.case_number} from the lifecycle workspace? The audit record and linked Service Desk ticket will be preserved.`
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await lifecycleRequest(`/cases/${lifecycleCase.lifecycle_case_id}`, { method: "DELETE" });
      setDetails(null);
      setInvitation(null);
      setNotice(`${result.case_number} was removed. Its audit record${result.linked_ticket_preserved ? " and linked ticket were" : " was"} preserved.`);
      await loadWorkspace();
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
      <PageHero eyebrow="People Operations" title="Employee Lifecycle Management" subtitle="Branch-scoped onboarding and offboarding checklists with verification gates and complete audit history." />

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
          <div><h2 className="text-xl font-black text-slate-950">Lifecycle cases</h2><p className="text-sm text-slate-500">Track every required onboarding and offboarding step in one place.</p></div>
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
                  <td className="px-4 py-4"><div className="flex items-center gap-2"><button disabled={busy} onClick={() => void openCase(item.lifecycle_case_id)} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">Open <ArrowRight size={14}/></button>{normalizedRole === "superadmin" && item.status !== "Completed" && <button disabled={busy} onClick={() => void deleteCase(item)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100"><Trash2 size={14}/> Delete</button>}</div></td>
                </tr>;
              }) : <tr><td colSpan="7" className="px-4 py-14 text-center text-slate-500">No lifecycle cases match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
        <form onSubmit={createCase} className="w-full max-w-2xl overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-blue-100 p-6"><div><h2 className="text-2xl font-black">Create lifecycle case</h2><p className="text-sm text-slate-500">A complete required checklist is added automatically.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X/></button></header>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-6 sm:grid-cols-2">
            <Field label="Lifecycle type"><select value={form.lifecycle_type} onChange={(event) => setForm((current) => ({ ...current, lifecycle_type: event.target.value, subject_mode: event.target.value === "Offboarding" ? "existing" : current.subject_mode }))} className="field"><option>Onboarding</option><option>Offboarding</option></select></Field>
            {form.lifecycle_type === "Onboarding" && <Field label="Employee record"><select value={form.subject_mode} onChange={(event) => setForm((current) => ({ ...current, subject_mode: event.target.value }))} className="field"><option value="new">New employee (no account yet)</option><option value="existing">Existing employee account</option></select></Field>}
            {form.subject_mode === "existing" || form.lifecycle_type === "Offboarding" ? <Field label="Existing employee"><select required value={form.employee_id} onChange={(event) => setForm((current) => ({ ...current, employee_id: event.target.value }))} className="field"><option value="">Select employee</option>{employees.map((employee) => <option key={employee.user_id} value={employee.user_id}>{employee.full_name} — {employee.branch_name}</option>)}</select></Field> : <>
              <Field label="Employee full name"><input required value={form.subject_full_name} onChange={(event) => setForm((current) => ({ ...current, subject_full_name: event.target.value }))} className="field" placeholder="Full legal name"/></Field>
              <Field label="Branch"><select required value={form.branch_id} onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))} className="field"><option value="">Select branch</option>{branches.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>)}</select></Field>
              <Field label="Contact email (optional)"><input type="email" value={form.subject_contact_email} onChange={(event) => setForm((current) => ({ ...current, subject_contact_email: event.target.value }))} className="field" placeholder="Personal or contact email"/></Field>
              <Field label="Employee number (optional)"><input value={form.subject_employee_number} onChange={(event) => setForm((current) => ({ ...current, subject_employee_number: event.target.value }))} className="field"/></Field>
              <Field label="Department"><input value={form.subject_department} onChange={(event) => setForm((current) => ({ ...current, subject_department: event.target.value }))} className="field"/></Field>
              <Field label="Job title"><input value={form.subject_job_title} onChange={(event) => setForm((current) => ({ ...current, subject_job_title: event.target.value }))} className="field"/></Field>
              <Field label="Start date"><input type="date" value={form.subject_start_date} onChange={(event) => setForm((current) => ({ ...current, subject_start_date: event.target.value }))} className="field"/></Field>
            </>}
            <Field label="Target date"><input type="date" value={form.target_date} onChange={(event) => setForm((current) => ({ ...current, target_date: event.target.value }))} className="field"/></Field>
            <Field label="Related ticket ID (optional)"><input type="number" min="1" value={form.related_ticket_id} onChange={(event) => setForm((current) => ({ ...current, related_ticket_id: event.target.value }))} className="field" placeholder="Database ticket ID"/></Field>
            <label className="sm:col-span-2"><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Notes</span><textarea rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="field resize-none" placeholder="Add relevant onboarding or offboarding context"/></label>
          </div>
          <footer className="flex justify-end gap-3 border-t border-blue-100 bg-slate-50 p-5"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-5 py-2.5 font-bold">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">{busy ? "Creating…" : "Create case"}</button></footer>
        </form>
      </div>}

      {details && <CaseDrawer key={details.lifecycle_case_id} details={details} role={normalizedRole} busy={busy} invitation={invitation} onClose={() => setDetails(null)} onTask={updateTask} onStatus={updateStatus} onDelete={deleteCase} onProvision={createAccountInvitation} onResend={resendAccountInvitation}/>}
      <style>{`.field{width:100%;border:1px solid #bfdbfe;border-radius:.75rem;background:#f8fafc;padding:.75rem 1rem;font-size:.875rem;outline:none}.field:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12)}`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return <label><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">{label}</span>{children}</label>;
}

function CaseDrawer({ details, role, busy, invitation, onClose, onTask, onStatus, onDelete, onProvision, onResend }) {
  const [taskNotes, setTaskNotes] = useState({});
  const [accountForm, setAccountForm] = useState({
    personal_email: details.subject_contact_email || "",
    company_email: "",
    employee_number: details.subject_employee_number || "",
    department: details.subject_department || "",
  });
  const progress = details.task_count ? Math.round((details.completed_task_count / details.task_count) * 100) : 0;
  const transitions = STATUS_TRANSITIONS[details.status] || [];
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm">
    <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-blue-100 bg-[#f7faff] shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-blue-100 bg-white p-6"><div><p className="text-xs font-black uppercase tracking-widest text-blue-600">{details.case_number}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{details.employee_name}</h2><p className="text-sm text-slate-500">{details.lifecycle_type} · {details.branch_name}</p></div><div className="flex items-center gap-2">{role === "superadmin" && details.status !== "Completed" && <button disabled={busy} onClick={() => void onDelete(details)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50"><Trash2 size={15}/> Delete</button>}<button onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"><X/></button></div></header>
      <div className="space-y-5 p-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <Info label="Status" value={details.status}/><Info label="Target Date" value={formatDate(details.target_date)}/><Info label="Related Ticket" value={details.related_ticket_number || "Not linked"}/>
        </section>
        {details.lifecycle_type === "Onboarding" && <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-slate-950">AstreaBlue employee account</h3><p className="mt-1 text-sm text-slate-500">The onboarding case can exist before the employee receives a login.</p></div><span className={`rounded-full border px-3 py-1 text-xs font-black ${details.employee_id ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{details.employee_id ? (details.employee_is_active ? "Active" : details.employee_invite_status || "Linked") : "Not created"}</span></div>
          {!details.employee_id && ["superadmin", "admin"].includes(role) && <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void onProvision(accountForm); }}>
            <Field label="Personal email (reminder)"><input type="email" required value={accountForm.personal_email} onChange={(event) => setAccountForm((current) => ({ ...current, personal_email: event.target.value }))} className="field" placeholder="employee.personal@example.com"/></Field>
            <Field label="Company/login email (activation)"><input type="email" required value={accountForm.company_email} onChange={(event) => setAccountForm((current) => ({ ...current, company_email: event.target.value }))} className="field" placeholder="employee@company.com"/></Field>
            <Field label="Employee number"><input value={accountForm.employee_number} onChange={(event) => setAccountForm((current) => ({ ...current, employee_number: event.target.value }))} className="field"/></Field>
            <Field label="Department"><input value={accountForm.department} onChange={(event) => setAccountForm((current) => ({ ...current, department: event.target.value }))} className="field"/></Field>
            <button disabled={busy || !accountForm.company_email.trim() || !(accountForm.personal_email.trim() || details.subject_contact_email)} className="sm:col-span-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Creating invitation…" : "Create account invitation"}</button>
          </form>}
          {!details.employee_id && role === "hr" && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">The onboarding case is ready. An authorized administrator can create and link the account invitation.</p>}
          {details.employee_id && !details.employee_is_active && ["superadmin", "admin"].includes(role) && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><div><p className="text-sm font-black text-blue-950">Employee activation is pending</p><p className="mt-1 text-xs text-blue-700">Generate a fresh 48-hour link and email it again.</p></div><button type="button" disabled={busy} onClick={() => void onResend()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "Sending…" : "Resend invitation"}</button></div>}
          {invitation?.invite_link && <div className={`mt-4 rounded-xl border p-4 ${invitation.email_sent ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className={`text-sm font-black ${invitation.email_sent ? "text-emerald-800" : "text-amber-900"}`}>{invitation.email_sent ? "Invitation created and emailed" : "Invitation created — email not delivered"}</p><p className={`mt-1 text-xs ${invitation.email_sent ? "text-emerald-700" : "text-amber-800"}`}>{invitation.email_sent ? `Sent to ${invitation.email_recipients.join(", ")}. The link expires in 48 hours.` : (invitation.email_warning || "Copy the one-time activation link and provide it securely to the employee.")}</p><div className="mt-3 flex flex-wrap gap-2"><input readOnly value={invitation.invite_link} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"/><a href={invitation.invite_link} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50">Open link</a><button type="button" onClick={() => navigator.clipboard?.writeText(invitation.invite_link)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50"><Copy size={14}/> Copy</button></div></div>}
        </section>}
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><h3 className="font-black text-slate-950">Required checklist</h3><p className="text-sm text-slate-500">{details.completed_task_count} of {details.task_count} tasks complete</p></div><span className="text-2xl font-black text-blue-600">{progress}%</span></div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${progress}%` }}/></div>
          <div className="mt-5 space-y-3">{details.tasks?.map((task) => {
            const completed = task.status === "Completed";
            const evidenceSynchronized = task.automation_result?.source === "onboarding_reconciliation";
            const accessBlocked = role === "hr" && String(task.assigned_role).toLowerCase() !== "hr";
            const awaitingAccount = details.lifecycle_type === "Onboarding" && !details.employee_id && task.task_key !== "confirm_employment";
            const awaitingActivation = details.lifecycle_type === "Onboarding" && details.employee_id && details.employee_is_active === false && !["confirm_employment", "create_account"].includes(task.task_key);
            const notesRequired = details.lifecycle_type === "Offboarding" && ["audit_licenses", "secure_data", "classify_assets"].includes(task.task_key);
            return <article key={task.lifecycle_task_id} className={`rounded-2xl border p-4 ${completed ? "border-emerald-200 bg-emerald-50/60" : "border-blue-100 bg-slate-50"}`}>
              <div className="flex gap-3"><button disabled={busy || evidenceSynchronized || (completed && details.lifecycle_type === "Offboarding") || accessBlocked || awaitingAccount || awaitingActivation || ["Completed", "Cancelled"].includes(details.status) || (notesRequired && String(taskNotes[task.lifecycle_task_id] || "").trim().length < 5)} onClick={() => void onTask(task, completed ? "Pending" : "Completed", taskNotes[task.lifecycle_task_id] || "")} title={evidenceSynchronized ? "This item is synchronized from system evidence" : awaitingAccount ? "Create and link the employee account first" : awaitingActivation ? "The employee must activate the account first" : accessBlocked ? "You do not have permission to complete this checklist item" : completed && details.lifecycle_type === "Offboarding" ? "The internal action is complete and cannot be reversed here" : "Update checklist task"} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-blue-300 bg-white text-transparent"} disabled:cursor-not-allowed disabled:opacity-50`}><CheckCircle2 size={16}/></button>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-slate-900">{task.task_label}</h4>{task.is_required && <span className="text-[10px] font-black uppercase text-rose-600">Required</span>}{evidenceSynchronized && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">Auto-synced</span>}</div><p className="mt-1 text-sm leading-6 text-slate-600">{task.task_description}</p>{completed && <p className="mt-2 text-xs font-semibold text-emerald-700">{evidenceSynchronized ? "Verified automatically" : `Completed by ${task.completed_by_name || "authorized user"}`} · {formatDate(task.completed_at, true)}</p>}{accessBlocked && !completed && !evidenceSynchronized && <p className="mt-2 text-xs font-semibold text-amber-700">You can track this item, but your role cannot mark it complete.</p>}</div>
              </div>
              {evidenceSynchronized && <p className={`mt-2 pl-9 text-xs font-bold ${completed ? "text-emerald-700" : "text-amber-700"}`}>{completed ? "Verified automatically from current AstreaBlue records." : "Auto-synced item; it will complete when the required evidence is available."}</p>}
              {notesRequired && !completed && !accessBlocked && <label className="mt-3 block pl-9"><span className="mb-1 block text-xs font-bold text-slate-600">Required completion evidence</span><textarea rows="2" value={taskNotes[task.lifecycle_task_id] || ""} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.lifecycle_task_id]: event.target.value }))} className="field resize-none" placeholder="Record the handover or asset inspection result before completing this task."/></label>}
              {task.completion_notes && (completed || evidenceSynchronized) && <p className={`mt-3 rounded-xl border bg-white px-3 py-2 text-xs text-slate-600 ${completed ? "border-emerald-200" : "border-amber-200"}`}><strong>{completed ? "Evidence" : "Waiting for evidence"}:</strong> {task.completion_notes}</p>}
              {completed && task.automation_result?.action && <p className="mt-2 pl-9 text-xs font-semibold text-emerald-700">Internal result: {String(task.automation_result.action).replaceAll("_", " ")}{Number.isFinite(Number(task.automation_result.affected)) ? ` (${task.automation_result.affected} record${Number(task.automation_result.affected) === 1 ? "" : "s"})` : ""}</p>}
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
