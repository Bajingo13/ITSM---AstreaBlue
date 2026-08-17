import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  DollarSign,
  Eye,
  History,
  KeyRound,
  Laptop,
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
import { appConfirm } from "../services/appDialog";

const STATUS_TRANSITIONS = {
  Draft: ["In Progress", "Cancelled"],
  "In Progress": ["Awaiting Employee", "Awaiting IT", "Ready for Verification", "Cancelled"],
  "Awaiting Employee": ["In Progress", "Awaiting IT", "Ready for Verification", "Cancelled"],
  "Awaiting IT": ["In Progress", "Awaiting Employee", "Ready for Verification", "Cancelled"],
  "Ready for Verification": ["In Progress", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

const STATUS_LABELS = {
  "In Progress": "Checklist in Progress",
  "Awaiting Employee": "Paused — Employee Action Required",
  "Awaiting IT": "Paused — Administrator Action Required",
  "Ready for Verification": "Ready for Authorized Final Review",
};

const STATUS_HELP = {
  "In Progress": "Required checklist work is currently being completed.",
  "Awaiting Employee": "Use this when progress is blocked until the employee activates the account, completes required consent or profile steps, or performs another requested employee action.",
  "Awaiting IT": "Use this when progress is blocked until an authorized administrator creates the invitation, approves consent, assigns an asset, verifies the endpoint, or completes another administrator-owned task.",
  "Ready for Verification": "All required checklist evidence should be complete. An authorized HR, Admin, or SuperAdmin with access to the case performs the final review before completion.",
  Cancelled: "Stops this lifecycle case without completing it. The cancellation remains in the audit history.",
  Completed: "Closes the lifecycle case after every required checklist item has evidence.",
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function workflowMessage(message) {
  return String(message || "")
    .replaceAll("Awaiting Employee", STATUS_LABELS["Awaiting Employee"])
    .replaceAll("Awaiting IT", STATUS_LABELS["Awaiting IT"])
    .replaceAll("Ready for Verification", STATUS_LABELS["Ready for Verification"])
    .replaceAll("In Progress", STATUS_LABELS["In Progress"]);
}

const OFFBOARDING_TASK_PREREQUISITES = {
  classify_assets: ["recover_assets"],
  verify_checklist: ["disable_access", "recover_assets", "audit_licenses", "secure_data", "classify_assets"],
  notify_parties: ["verify_checklist"],
  close_linked_ticket: ["notify_parties"],
};

const OFFBOARDING_EVIDENCE_GUIDANCE = {
  secure_data: "Example: Required company files were backed up and ownership was transferred to the designated custodian.",
  classify_assets: "Example: Asset AST-001 was inspected and classified as In Stock for redeployment.",
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

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
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
  const [technologyValues, setTechnologyValues] = useState({ employees: [], totals: {} });
  const [activeView, setActiveView] = useState("cases");
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
      const [summaryData, caseData, employeeData, branchData, technologyData] = await Promise.all([
        lifecycleRequest("/summary"),
        lifecycleRequest(`/cases${query ? `?${query}` : ""}`),
        lifecycleRequest("/employees"),
        lifecycleRequest("/branches"),
        lifecycleRequest("/technology-values"),
      ]);
      setSummary(summaryData || {});
      setCases(caseData || []);
      setEmployees(employeeData || []);
      setBranches(branchData || []);
      setTechnologyValues(technologyData || { employees: [], totals: {} });
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
      const caseDetails = await lifecycleRequest(`/cases/${id}`);
      setDetails(caseDetails);
      setCases((current) => current.map((item) => (
        Number(item.lifecycle_case_id) === Number(caseDetails.lifecycle_case_id)
          ? {
              ...item,
              status: caseDetails.status,
              task_count: caseDetails.task_count,
              completed_task_count: caseDetails.completed_task_count,
              required_pending_count: caseDetails.required_pending_count,
              updated_at: caseDetails.updated_at,
            }
          : item
      )));
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
    if (
      newEmployee &&
      (
        !form.subject_full_name.trim() ||
        !form.subject_contact_email.trim() ||
        !form.subject_department.trim() ||
        !form.branch_id
      )
    ) {
      return setError("Employee name, personal contact email, department, and branch are required.");
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
        }),
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setNotice(`${created.case_number} created with its required checklist${created.related_ticket_number ? ` and linked ticket ${created.related_ticket_number}` : ""}.`);
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
      await openCase(details.lifecycle_case_id, true);
      await loadWorkspace();
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
      await openCase(details.lifecycle_case_id, true);
      await loadWorkspace();
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
      await openCase(details.lifecycle_case_id);
      await loadWorkspace();
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
      setNotice(`Case status updated to ${statusLabel(status)}.`);
      await openCase(details.lifecycle_case_id);
      await loadWorkspace();
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  async function deleteCase(lifecycleCase) {
    if (!lifecycleCase || normalizedRole !== "superadmin" || lifecycleCase.status === "Completed") return;
    const confirmed = await appConfirm({
      title: "Remove lifecycle case?",
      message: `Delete ${lifecycleCase.case_number} from the lifecycle workspace?`,
      detail: "The audit record and linked Service Desk ticket will be preserved.",
      confirmLabel: "Delete case",
      tone: "danger",
    });
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
    ["Ready for Final Review", summary.ready_for_verification || 0, ClipboardCheck, "text-violet-600", "bg-violet-50"],
    ["Completed", summary.completed || 0, CheckCircle2, "text-emerald-600", "bg-emerald-50"],
  ];

  return (
    <div className="space-y-5">
      <PageHero eyebrow="People Operations" title="Employee Lifecycle Management" subtitle="Branch-scoped onboarding and offboarding checklists with verification gates and complete audit history." />

      {error && !details && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">{error}</div>}
      {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700">{notice}</div>}

      <div className="inline-flex w-full gap-1 rounded-lg border border-slate-200 bg-white p-1 sm:w-auto" role="tablist" aria-label="Employee lifecycle views">
        <button type="button" role="tab" aria-selected={activeView === "cases"} onClick={() => setActiveView("cases")} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold sm:flex-none ${activeView === "cases" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}><ClipboardCheck size={16}/> Lifecycle cases</button>
        <button type="button" role="tab" aria-selected={activeView === "technology"} onClick={() => setActiveView("technology")} className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold sm:flex-none ${activeView === "technology" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}><DollarSign size={16}/> Technology value</button>
      </div>

      {activeView === "cases" && <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="rounded-xl border border-blue-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none"><option value="">All statuses</option>{Object.keys(STATUS_TRANSITIONS).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
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
                  <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></td>
                  <td className="min-w-[150px] px-4 py-4"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }}/></div><p className="mt-1 text-xs text-slate-500">{item.completed_task_count}/{item.task_count} complete</p></td>
                  <td className="px-4 py-4 text-slate-600">{formatDate(item.target_date)}</td>
                  <td className="px-4 py-4"><div className="flex items-center gap-2"><button disabled={busy} onClick={() => void openCase(item.lifecycle_case_id)} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">Open <ArrowRight size={14}/></button>{normalizedRole === "superadmin" && item.status !== "Completed" && <button disabled={busy} onClick={() => void deleteCase(item)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100"><Trash2 size={14}/> Delete</button>}</div></td>
                </tr>;
              }) : <tr><td colSpan="7" className="px-4 py-14 text-center text-slate-500">No lifecycle cases match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section></>}

      {activeView === "technology" && <TechnologyValueWorkspace value={technologyValues} loading={loading} role={normalizedRole} onRefresh={loadWorkspace}/>}

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
        <form onSubmit={createCase} className="w-full max-w-2xl overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-blue-100 p-6"><div><h2 className="text-2xl font-black">Create lifecycle case</h2><p className="text-sm text-slate-500">The required checklist and linked internal ticket are created automatically.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X/></button></header>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-6 sm:grid-cols-2">
            <Field label="Lifecycle type"><select value={form.lifecycle_type} onChange={(event) => setForm((current) => ({ ...current, lifecycle_type: event.target.value, subject_mode: event.target.value === "Offboarding" ? "existing" : current.subject_mode }))} className="field"><option>Onboarding</option><option>Offboarding</option></select></Field>
            {form.lifecycle_type === "Onboarding" && <Field label="Employee record"><select value={form.subject_mode} onChange={(event) => setForm((current) => ({ ...current, subject_mode: event.target.value }))} className="field"><option value="new">New employee (no account yet)</option><option value="existing">Existing employee account</option></select></Field>}
            {form.subject_mode === "existing" || form.lifecycle_type === "Offboarding" ? <Field label="Existing employee"><select required value={form.employee_id} onChange={(event) => setForm((current) => ({ ...current, employee_id: event.target.value }))} className="field"><option value="">Select employee</option>{employees.map((employee) => <option key={employee.user_id} value={employee.user_id}>{employee.full_name} — {employee.branch_name}</option>)}</select></Field> : <>
              <Field label="Employee full name"><input required value={form.subject_full_name} onChange={(event) => setForm((current) => ({ ...current, subject_full_name: event.target.value }))} className="field" placeholder="Full legal name"/></Field>
              <Field label="Branch"><select required value={form.branch_id} onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))} className="field"><option value="">Select branch</option>{branches.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>)}</select></Field>
              <Field label="Personal contact email"><input type="email" required value={form.subject_contact_email} onChange={(event) => setForm((current) => ({ ...current, subject_contact_email: event.target.value }))} className="field" placeholder="Used for the onboarding invitation reminder"/></Field>
              <Field label="Employee number (optional)"><input value={form.subject_employee_number} onChange={(event) => setForm((current) => ({ ...current, subject_employee_number: event.target.value }))} className="field"/></Field>
              <Field label="Department"><input required value={form.subject_department} onChange={(event) => setForm((current) => ({ ...current, subject_department: event.target.value }))} className="field" placeholder="Required for profile and resource assignment"/></Field>
              <Field label="Job title (optional)"><input value={form.subject_job_title} onChange={(event) => setForm((current) => ({ ...current, subject_job_title: event.target.value }))} className="field" placeholder="Useful for role and equipment planning"/></Field>
              <Field label="Start date"><input type="date" value={form.subject_start_date} onChange={(event) => setForm((current) => ({ ...current, subject_start_date: event.target.value }))} className="field"/></Field>
            </>}
            <Field label="Target date"><input type="date" value={form.target_date} onChange={(event) => setForm((current) => ({ ...current, target_date: event.target.value }))} className="field"/></Field>
            <label className="sm:col-span-2"><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Notes</span><textarea rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="field resize-none" placeholder="Add relevant onboarding or offboarding context"/></label>
          </div>
          <footer className="flex justify-end gap-3 border-t border-blue-100 bg-slate-50 p-5"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-5 py-2.5 font-bold">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">{busy ? "Creating…" : "Create case"}</button></footer>
        </form>
      </div>}

      {details && <CaseDrawer key={details.lifecycle_case_id} details={details} role={normalizedRole} busy={busy} error={error} invitation={invitation} onDismissError={() => setError("")} onClose={() => { setError(""); setDetails(null); }} onTask={updateTask} onStatus={updateStatus} onDelete={deleteCase} onProvision={createAccountInvitation} onResend={resendAccountInvitation} onRefresh={async () => { await openCase(details.lifecycle_case_id); await loadWorkspace(); }}/>}
      <style>{`.field{width:100%;border:1px solid #bfdbfe;border-radius:.75rem;background:#f8fafc;padding:.75rem 1rem;font-size:.875rem;outline:none}.field:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12)}`}</style>
    </div>
  );
}

function TechnologyValueWorkspace({ value, loading, role, onRefresh }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeDetails, setEmployeeDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const employees = value?.employees || [];
  const totals = value?.totals || {};
  const visibleEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (statusFilter === "active" && employee.is_active === false) return false;
      if (statusFilter === "inactive" && employee.is_active !== false) return false;
      if (!query) return true;
      return [employee.full_name,employee.employee_number,employee.department,employee.branch_name]
        .some((field) => String(field || "").toLowerCase().includes(query));
    });
  }, [employees, search, statusFilter]);

  async function openEmployee(employee) {
    setSelectedEmployee(employee);
    setEmployeeDetails(null);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      setEmployeeDetails(await lifecycleRequest(`/technology-values/${employee.user_id}`));
    } catch (requestError) {
      setDetailsError(requestError.message);
    } finally {
      setDetailsLoading(false);
    }
  }

  return <section className="border-y border-slate-200 bg-white py-5 shadow-sm">
    <div className="px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h2 className="text-xl font-black text-slate-950">Employee Technology Value</h2><p className="mt-1 text-sm text-slate-500">Hardware currently lent to each employee plus the annual cost of their active software seats.</p></div>
        <button type="button" onClick={() => void onRefresh()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/> Refresh</button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ValueMetric icon={Laptop} label="Assigned hardware" value={formatCurrency(totals.asset_value)} detail={`${Number(totals.asset_count || 0)} assets`}/>
        <ValueMetric icon={KeyRound} label="Annual software" value={formatCurrency(totals.annual_software_cost)} detail={`${Number(totals.license_count || 0)} active seats`}/>
        <ValueMetric icon={DollarSign} label="First-year value" value={formatCurrency(totals.first_year_assigned_value)} detail="Hardware plus one software year" emphasis/>
        <ValueMetric icon={UserPlus} label="Employees tracked" value={Number(totals.employee_count || 0).toLocaleString("en-PH")} detail="Branch-scoped employee records"/>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex w-full max-w-xl items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4"><Search size={17} className="text-blue-500"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee, number, department, or branch" className="w-full bg-transparent py-3 text-sm outline-none"/></label>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Employee status filter">{[["active","Active"],["inactive","Inactive"],["all","All"]].map(([key,label]) => <button key={key} type="button" onClick={() => setStatusFilter(key)} className={`rounded-md px-3 py-2 text-xs font-black ${statusFilter === key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>)}</div>
      </div>
    </div>

    <div className="mt-5 overflow-x-auto border-y border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Employee", "Branch", "Hardware", "Active seats", "Annual software", "First-year value", ""].map((heading,index) => <th key={`${heading}-${index}`} className="px-5 py-3">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? <tr><td colSpan="7" className="px-5 py-14 text-center text-slate-500">Loading employee technology values...</td></tr> : visibleEmployees.length ? visibleEmployees.map((employee) => <tr key={employee.user_id} className="hover:bg-blue-50/40">
            <td className="px-5 py-4"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">{employee.full_name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${employee.is_active === false ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{employee.is_active === false ? "Inactive" : "Active"}</span></div><p className="text-xs text-slate-500">{employee.employee_number || "No employee number"} · {employee.department || "No department"}</p></td>
            <td className="px-5 py-4 text-slate-600">{employee.branch_name}</td>
            <td className="px-5 py-4"><p className="font-bold text-slate-900">{formatCurrency(employee.asset_value)}</p><p className="text-xs text-slate-500">{Number(employee.asset_count || 0)} assigned</p></td>
            <td className="px-5 py-4 font-bold text-slate-800">{Number(employee.license_count || 0)}</td>
            <td className="px-5 py-4 font-bold text-slate-800">{formatCurrency(employee.annual_software_cost)}</td>
            <td className="px-5 py-4 font-black text-blue-700">{formatCurrency(employee.first_year_assigned_value)}</td>
            <td className="px-5 py-4 text-right"><button type="button" onClick={() => void openEmployee(employee)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50"><Eye size={14}/> Manage</button></td>
          </tr>) : <tr><td colSpan="7" className="px-5 py-14 text-center text-slate-500">{employees.length ? "No employees match the current filters." : "No employee records are available in this local database yet."}</td></tr>}
        </tbody>
      </table>
    </div>
    {selectedEmployee && <TechnologyEmployeeDrawer
      employee={selectedEmployee}
      value={employeeDetails}
      role={role}
      loading={detailsLoading}
      error={detailsError}
      onClose={() => { setSelectedEmployee(null); setEmployeeDetails(null); setDetailsError(""); }}
      onAssigned={async (nextValue) => { setEmployeeDetails(nextValue); await onRefresh(); }}
    />}
  </section>;
}

function TechnologyEmployeeDrawer({ employee, value, role, loading, error, onClose, onAssigned }) {
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedLicenseIds, setSelectedLicenseIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const details = value || {};
  const activeAssignments = details.assignments || [];
  const history = details.assignment_history || [];
  const assets = details.assets || [];
  const availableLicenses = details.available_licenses || [];
  const canAssign = employee.is_active !== false && ["admin", "superadmin"].includes(role);

  function toggleLicense(licenseId) {
    setSelectedLicenseIds((current) => current.includes(licenseId)
      ? current.filter((id) => id !== licenseId)
      : [...current, licenseId]);
  }

  async function assignLicenses() {
    setSaving(true);
    setSaveError("");
    try {
      const nextValue = await lifecycleRequest(`/technology-values/${employee.user_id}/license-assignments`, {
        method: "POST",
        body: JSON.stringify({
          asset_id: selectedAssetId ? Number(selectedAssetId) : null,
          license_ids: selectedLicenseIds,
        }),
      });
      setSelectedLicenseIds([]);
      await onAssigned(nextValue);
    } catch (requestError) {
      setSaveError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm">
    <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-blue-100 bg-[#f7faff] shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-blue-100 bg-white p-5">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black text-slate-950">{employee.full_name}</h2><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${employee.is_active === false ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{employee.is_active === false ? "Inactive" : "Active"}</span></div><p className="mt-1 text-sm text-slate-500">{employee.branch_name} · {employee.employee_number || "No employee number"}</p></div>
        <button type="button" onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100" title="Close"><X size={18}/></button>
      </header>
      <div className="space-y-5 p-5">
        {(error || saveError) && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><AlertTriangle size={16}/>{error || saveError}</div>}
        {loading ? <p className="py-16 text-center text-sm text-slate-500">Loading employee technology records...</p> : <>
          <div className="grid gap-3 sm:grid-cols-3"><ValueMetric icon={Laptop} label="Hardware" value={formatCurrency(details.totals?.asset_value)} detail={`${assets.length} assigned`}/><ValueMetric icon={KeyRound} label="Annual software" value={formatCurrency(details.totals?.annual_software_cost)} detail={`${activeAssignments.length} active seats`}/><ValueMetric icon={DollarSign} label="First-year value" value={formatCurrency(details.totals?.first_year_assigned_value)} detail="Hardware plus one year" emphasis/></div>

          <section><h3 className="text-xs font-black uppercase text-slate-500">Active software licenses</h3><div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">License</th><th className="px-3 py-2">Linked asset</th><th className="px-3 py-2 text-right">Annual seat cost</th></tr></thead><tbody>{activeAssignments.length ? activeAssignments.map((assignment) => <tr key={assignment.assignment_id} className="border-t border-slate-100"><td className="px-3 py-2 font-bold text-slate-800">{assignment.license_name}<span className="block font-normal text-slate-500">{assignment.vendor}</span></td><td className="px-3 py-2 text-slate-600">{assignment.asset_tag || assignment.asset_name || "Employee only"}</td><td className="px-3 py-2 text-right font-bold">{formatCurrency(assignment.seat_annual_cost_snapshot || assignment.annual_seat_cost)}</td></tr>) : <tr><td colSpan="3" className="px-3 py-5 text-center text-slate-500">No active software licenses assigned.</td></tr>}</tbody></table></div></section>

          {canAssign && <section className="border-t border-blue-100 pt-5"><div className="flex items-center justify-between"><div><h3 className="font-black text-slate-900">Assign software licenses</h3><p className="mt-1 text-xs text-slate-500">Link the seat to the employee, with an optional assigned asset.</p></div><span className="text-xs font-black text-blue-700">{selectedLicenseIds.length} selected</span></div><label className="mt-4 block"><span className="mb-1 block text-xs font-black uppercase text-slate-600">Assigned asset (optional)</span><select value={selectedAssetId} onChange={(event) => setSelectedAssetId(event.target.value)} className="field"><option value="">Employee only</option>{assets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.asset_tag || asset.asset_name} - {asset.asset_name}</option>)}</select></label><div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">{availableLicenses.length ? availableLicenses.map((license) => <label key={license.license_id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 hover:bg-slate-50"><input type="checkbox" checked={selectedLicenseIds.includes(Number(license.license_id))} onChange={() => toggleLicense(Number(license.license_id))} className="h-4 w-4 accent-blue-600"/><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-800">{license.license_name}</span><span className="block text-xs text-slate-500">{license.vendor} · {license.available_licenses} available</span></span><span className="text-xs font-black">{formatCurrency(license.annual_seat_cost)}/yr</span></label>) : <p className="px-3 py-5 text-center text-xs text-slate-500">No available seats in this employee's branch.</p>}</div><div className="mt-3 flex justify-end"><button type="button" disabled={saving || !selectedLicenseIds.length} onClick={() => void assignLicenses()} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Assigning..." : "Assign selected licenses"}</button></div></section>}

          {employee.is_active === false && <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">This employee is inactive. Historical records remain visible, but new licenses cannot be assigned.</p>}

          <section><div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500"><History size={15}/> License assignment history</div><div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">License</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Assigned</th><th className="px-3 py-2">Released</th><th className="px-3 py-2">Source</th></tr></thead><tbody>{history.length ? history.map((assignment) => <tr key={assignment.assignment_id} className="border-t border-slate-100"><td className="px-3 py-2 font-bold text-slate-800">{assignment.license_name}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 font-black ${assignment.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{assignment.status}</span></td><td className="px-3 py-2 text-slate-600">{formatDate(assignment.assigned_at)}</td><td className="px-3 py-2 text-slate-600">{formatDate(assignment.released_at)}</td><td className="px-3 py-2 text-slate-600">{assignment.assignment_source}</td></tr>) : <tr><td colSpan="5" className="px-3 py-5 text-center text-slate-500">No license assignment history.</td></tr>}</tbody></table></div></section>
        </>}
      </div>
    </aside>
  </div>;
}

function ValueMetric({ icon: Icon, label, value, detail, emphasis = false }) {
  return <div className={`rounded-lg border p-4 ${emphasis ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
    <div className={`flex items-center gap-2 text-xs font-black uppercase ${emphasis ? "text-blue-700" : "text-slate-500"}`}><Icon size={15}/>{label}</div>
    <p className={`mt-2 text-lg font-black ${emphasis ? "text-blue-950" : "text-slate-950"}`}>{value}</p>
    <p className="mt-1 text-xs text-slate-500">{detail}</p>
  </div>;
}

function Field({ label, children }) {
  return <label><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">{label}</span>{children}</label>;
}

function TechnologyValuePanel({ details, role, onRefresh }) {
  const [value, setValue] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedLicenseIds, setSelectedLicenseIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState("");

  const licenseTask = details.tasks?.find((task) => task.task_key === "assign_licenses");
  const assetTask = details.tasks?.find((task) => task.task_key === "assign_asset");
  const canAssign = details.lifecycle_type === "Onboarding"
    && ["superadmin", "admin"].includes(role)
    && licenseTask?.status === "Pending"
    && !["Completed", "Cancelled"].includes(details.status);

  const loadValue = useCallback(async () => {
    setLoading(true);
    setPanelError("");
    try {
      const data = await lifecycleRequest(`/cases/${details.lifecycle_case_id}/technology-value`);
      setValue(data);
      setSelectedAssetId((current) => current || (data.assets?.length === 1 ? String(data.assets[0].asset_id) : ""));
    } catch (requestError) {
      setPanelError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [details.lifecycle_case_id]);

  useEffect(() => { void loadValue(); }, [loadValue, details.completed_task_count, details.updated_at]);

  function toggleLicense(licenseId) {
    setSelectedLicenseIds((current) => current.includes(licenseId)
      ? current.filter((id) => id !== licenseId)
      : [...current, licenseId]);
  }

  async function saveAssignments(noLicenseRequired = false) {
    setSaving(true);
    setPanelError("");
    try {
      const data = await lifecycleRequest(`/cases/${details.lifecycle_case_id}/license-assignments`, {
        method: "POST",
        body: JSON.stringify({
          asset_id: selectedAssetId ? Number(selectedAssetId) : null,
          license_ids: noLicenseRequired ? [] : selectedLicenseIds,
          no_license_required: noLicenseRequired,
        }),
      });
      setValue(data);
      setSelectedLicenseIds([]);
      await onRefresh();
    } catch (requestError) {
      setPanelError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const totals = value?.totals || {};
  const assignments = value?.assignments || [];
  const assets = value?.assets || [];
  const availableLicenses = value?.available_licenses || [];

  return <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-black text-slate-950">Employee Technology Value</h3>
        <p className="mt-1 text-sm text-slate-500">Assigned asset value and annual software-seat cost from connected records.</p>
      </div>
      <button type="button" onClick={() => void loadValue()} disabled={loading || saving} title="Refresh technology value" className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/></button>
    </div>

    {panelError && <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0"/>{panelError}</div>}

    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500"><Laptop size={15}/> Asset value</div><p className="mt-2 text-lg font-black text-slate-950">{loading ? "Loading..." : formatCurrency(totals.asset_value)}</p></div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500"><KeyRound size={15}/> Annual software</div><p className="mt-2 text-lg font-black text-slate-950">{loading ? "Loading..." : formatCurrency(totals.annual_software_cost)}</p></div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><div className="flex items-center gap-2 text-xs font-black uppercase text-blue-600"><DollarSign size={15}/> First-year value</div><p className="mt-2 text-lg font-black text-blue-950">{loading ? "Loading..." : formatCurrency(totals.first_year_assigned_value)}</p></div>
    </div>

    {!loading && <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div className="min-w-0">
        <h4 className="text-xs font-black uppercase text-slate-500">Assigned assets</h4>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Asset</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Value</th></tr></thead><tbody>{assets.length ? assets.map((asset) => <tr key={asset.asset_id} className="border-t border-slate-100"><td className="px-3 py-2 font-bold text-slate-800">{asset.asset_tag || asset.asset_name}<span className="block font-normal text-slate-500">{asset.asset_name}</span></td><td className="px-3 py-2 text-slate-600">{asset.status}</td><td className="px-3 py-2 text-right font-bold text-slate-800">{formatCurrency(asset.purchase_price)}</td></tr>) : <tr><td colSpan="3" className="px-3 py-4 text-center text-slate-500">No assigned asset found.</td></tr>}</tbody></table>
        </div>
      </div>
      <div className="min-w-0">
        <h4 className="text-xs font-black uppercase text-slate-500">Active software assignments</h4>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">License</th><th className="px-3 py-2">Asset</th><th className="px-3 py-2 text-right">Annual seat cost</th></tr></thead><tbody>{assignments.length ? assignments.map((assignment) => <tr key={assignment.assignment_id} className="border-t border-slate-100"><td className="px-3 py-2 font-bold text-slate-800">{assignment.license_name}<span className="block font-normal text-slate-500">{assignment.vendor}</span></td><td className="px-3 py-2 text-slate-600">{assignment.asset_tag || assignment.asset_name || "Employee assignment"}</td><td className="px-3 py-2 text-right font-bold text-slate-800">{formatCurrency(assignment.annual_seat_cost)}</td></tr>) : <tr><td colSpan="3" className="px-3 py-4 text-center text-slate-500">No active software assignments.</td></tr>}</tbody></table>
        </div>
      </div>
    </div>}

    {canAssign && <div className="mt-5 border-t border-blue-100 pt-5">
      <div className="flex items-center justify-between gap-3"><div><h4 className="font-black text-slate-900">Assign onboarding licenses</h4><p className="mt-1 text-xs text-slate-500">Available seats are filtered to the employee branch.</p></div><span className="text-xs font-black text-blue-700">{selectedLicenseIds.length} selected</span></div>
      {assetTask?.status !== "Completed" ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Complete managed asset assignment first.</p> : <>
        <label className="mt-4 block"><span className="mb-1 block text-xs font-black uppercase text-slate-600">Assigned asset</span><select value={selectedAssetId} onChange={(event) => setSelectedAssetId(event.target.value)} className="field"><option value="">Select assigned asset</option>{assets.map((asset) => <option key={asset.asset_id} value={asset.asset_id}>{asset.asset_tag || asset.asset_name} - {asset.asset_name}</option>)}</select></label>
        <div className="mt-4 max-h-52 overflow-y-auto rounded-lg border border-slate-200">{availableLicenses.length ? availableLicenses.map((license) => <label key={license.license_id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 hover:bg-slate-50"><input type="checkbox" checked={selectedLicenseIds.includes(Number(license.license_id))} onChange={() => toggleLicense(Number(license.license_id))} className="h-4 w-4 accent-blue-600"/><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-800">{license.license_name}</span><span className="block text-xs text-slate-500">{license.vendor} - {license.available_licenses} available</span></span><span className="text-xs font-black text-slate-700">{formatCurrency(license.annual_seat_cost)}/yr</span></label>) : <p className="px-3 py-4 text-center text-xs text-slate-500">No available license seats in this branch.</p>}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={() => void saveAssignments(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">No licenses required</button><button type="button" disabled={saving || !selectedAssetId || !selectedLicenseIds.length} onClick={() => void saveAssignments(false)} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving..." : "Assign selected licenses"}</button></div>
      </>}
    </div>}

    {details.lifecycle_type === "Offboarding" && assignments.length > 0 && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Completing Release software licenses will return all {assignments.length} active seat{assignments.length === 1 ? "" : "s"} to Software License Management automatically.</p>}
  </section>;
}

function CaseDrawer({ details, role, busy, error, invitation, onDismissError, onClose, onTask, onStatus, onDelete, onProvision, onResend, onRefresh }) {
  const [taskNotes, setTaskNotes] = useState({});
  const [accountForm, setAccountForm] = useState({
    personal_email: details.subject_contact_email || "",
    company_email: "",
    employee_number: details.subject_employee_number || "",
    department: details.subject_department || "",
  });
  const progress = details.task_count ? Math.round((details.completed_task_count / details.task_count) * 100) : 0;
  const transitions = STATUS_TRANSITIONS[details.status] || [];
  const completedTaskKeys = new Set(details.tasks?.filter((task) => task.status === "Completed").map((task) => task.task_key));
  const workflowTransitions = details.lifecycle_type === "Offboarding"
    ? transitions.filter((status) => ["Completed", "Cancelled"].includes(status))
    : transitions.filter((status) => status !== "Ready for Verification");
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm">
    <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-blue-100 bg-[#f7faff] shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b border-blue-100 bg-white p-6"><div><p className="text-xs font-black uppercase tracking-widest text-blue-600">{details.case_number}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{details.employee_name}</h2><p className="text-sm text-slate-500">{details.lifecycle_type} · {details.branch_name}</p></div><div className="flex items-center gap-2">{role === "superadmin" && details.status !== "Completed" && <button disabled={busy} onClick={() => void onDelete(details)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50"><Trash2 size={15}/> Delete</button>}<button onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"><X/></button></div></header>
      {error && <div role="alert" aria-live="assertive" className="fixed right-4 top-24 z-[60] w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-2xl sm:right-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={20}/></span>
          <div className="min-w-0 flex-1">
            <p className="font-black">Checklist action needs attention</p>
            <p className="mt-1 text-sm font-semibold leading-6">{error}</p>
            <p className="mt-1 text-xs text-amber-800">Complete the remaining required checklist evidence in this case, then try final verification again.</p>
          </div>
          <button type="button" onClick={onDismissError} aria-label="Dismiss checklist message" className="rounded-full p-1.5 text-amber-800 hover:bg-amber-100"><X size={18}/></button>
        </div>
      </div>}
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
        {details.employee_id && <TechnologyValuePanel details={details} role={role} onRefresh={onRefresh}/>}
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><h3 className="font-black text-slate-950">Required checklist</h3><p className="text-sm text-slate-500">{details.completed_task_count} of {details.task_count} tasks complete</p></div><span className="text-2xl font-black text-blue-600">{progress}%</span></div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${progress}%` }}/></div>
          <div className="mt-5 space-y-3">{details.tasks?.map((task) => {
            const completed = task.status === "Completed";
            const evidenceSynchronized = task.automation_result?.source === "onboarding_reconciliation";
            const accessBlocked = role === "hr" && String(task.assigned_role).toLowerCase() !== "hr";
            const awaitingAccount = details.lifecycle_type === "Onboarding" && !details.employee_id && task.task_key !== "confirm_employment";
            const awaitingActivation = details.lifecycle_type === "Onboarding" && details.employee_id && details.employee_is_active === false && !["confirm_employment", "create_account"].includes(task.task_key);
            const notesRequired = details.lifecycle_type === "Offboarding" && ["secure_data", "classify_assets"].includes(task.task_key);
            const structuredLicenseTask = details.lifecycle_type === "Onboarding" && task.task_key === "assign_licenses";
            const unmetPrerequisites = details.lifecycle_type === "Offboarding"
              ? (OFFBOARDING_TASK_PREREQUISITES[task.task_key] || []).filter((taskKey) => !completedTaskKeys.has(taskKey))
              : [];
            const prerequisiteLabels = unmetPrerequisites.map((taskKey) => details.tasks?.find((candidate) => candidate.task_key === taskKey)?.task_label || taskKey);
            return <article key={task.lifecycle_task_id} className={`rounded-2xl border p-4 ${completed ? "border-emerald-200 bg-emerald-50/60" : "border-blue-100 bg-slate-50"}`}>
              <div className="flex gap-3"><button disabled={busy || structuredLicenseTask || evidenceSynchronized || (completed && details.lifecycle_type === "Offboarding") || accessBlocked || awaitingAccount || awaitingActivation || unmetPrerequisites.length > 0 || ["Completed", "Cancelled"].includes(details.status) || (notesRequired && String(taskNotes[task.lifecycle_task_id] || "").trim().length < 5)} onClick={() => void onTask(task, completed ? "Pending" : "Completed", taskNotes[task.lifecycle_task_id] || "")} title={structuredLicenseTask ? "Use the Employee Technology Value panel above" : evidenceSynchronized ? "This item is synchronized from system evidence" : awaitingAccount ? "Create and link the employee account first" : awaitingActivation ? "The employee must activate the account first" : accessBlocked ? "You do not have permission to complete this checklist item" : unmetPrerequisites.length ? `Complete first: ${prerequisiteLabels.join(", ")}` : completed && details.lifecycle_type === "Offboarding" ? "The internal action is complete and cannot be reversed here" : "Update checklist task"} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-blue-300 bg-white text-transparent"} disabled:cursor-not-allowed disabled:opacity-50`}><CheckCircle2 size={16}/></button>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-slate-900">{task.task_label}</h4>{task.is_required && <span className="text-[10px] font-black uppercase text-rose-600">Required</span>}{evidenceSynchronized && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">Auto-synced</span>}</div><p className="mt-1 text-sm leading-6 text-slate-600">{task.task_description}</p>{completed && <p className="mt-2 text-xs font-semibold text-emerald-700">{evidenceSynchronized ? "Verified automatically" : `Completed by ${task.completed_by_name || "authorized user"}`} · {formatDate(task.completed_at, true)}</p>}{accessBlocked && !completed && !evidenceSynchronized && <p className="mt-2 text-xs font-semibold text-amber-700">You can track this item, but your role cannot mark it complete.</p>}</div>
              </div>
              {evidenceSynchronized && <p className={`mt-2 pl-9 text-xs font-bold ${completed ? "text-emerald-700" : "text-amber-700"}`}>{completed ? "Verified automatically from current AstreaBlue records." : "Auto-synced item; it will complete when the required evidence is available."}</p>}
              {structuredLicenseTask && !completed && <p className="mt-2 pl-9 text-xs font-bold text-blue-700">Select the assigned asset and required license seats in Employee Technology Value above.</p>}
              {!completed && unmetPrerequisites.length > 0 && <p className="mt-2 pl-9 text-xs font-semibold text-amber-700">Complete first: {prerequisiteLabels.join(", ")}.</p>}
              {notesRequired && !completed && !accessBlocked && <label className="mt-3 block pl-9"><span className="mb-1 flex items-center justify-between gap-3 text-xs font-bold text-slate-600"><span>Required completion evidence</span><span className={String(taskNotes[task.lifecycle_task_id] || "").trim().length >= 5 ? "text-emerald-600" : "text-amber-700"}>{String(taskNotes[task.lifecycle_task_id] || "").trim().length}/5 minimum</span></span><textarea rows="2" minLength={5} value={taskNotes[task.lifecycle_task_id] || ""} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.lifecycle_task_id]: event.target.value }))} className="field resize-none" placeholder="Enter at least 5 characters describing the completed action or result."/></label>}
              {notesRequired && !completed && !accessBlocked && <p className="mt-2 pl-9 text-xs leading-5 text-slate-500">{OFFBOARDING_EVIDENCE_GUIDANCE[task.task_key]}</p>}
              {task.completion_notes && (completed || evidenceSynchronized) && <p className={`mt-3 rounded-xl border bg-white px-3 py-2 text-xs text-slate-600 ${completed ? "border-emerald-200" : "border-amber-200"}`}><strong>{completed ? "Evidence" : "Waiting for evidence"}:</strong> {task.completion_notes}</p>}
              {completed && task.automation_result?.action && <p className="mt-2 pl-9 text-xs font-semibold text-emerald-700">Internal result: {String(task.automation_result.action).replaceAll("_", " ")}{Number.isFinite(Number(task.automation_result.affected)) ? ` (${task.automation_result.affected} record${Number(task.automation_result.affected) === 1 ? "" : "s"})` : ""}</p>}
            </article>;
          })}</div>
        </section>
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <h3 className="font-black">Case actions</h3>
          <p className="mt-1 text-sm text-slate-500">{details.lifecycle_type === "Offboarding" ? "Start with the checklist. The case begins automatically after the first completed action and becomes ready for final review after every required task is complete." : "Use a pause state only when work is genuinely blocked. The final verification checklist item automatically completes onboarding after all required evidence is available."}</p>
          <div className="mt-4 grid gap-2">
            {workflowTransitions.length ? workflowTransitions.map((status) => <button key={status} disabled={busy} onClick={() => void onStatus(status)} className={`rounded-xl border px-4 py-3 text-left transition ${status === "Cancelled" ? "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100" : "border-blue-200 bg-blue-50 text-blue-950 hover:border-blue-400 hover:bg-blue-100"}`}><span className="block text-sm font-black">{statusLabel(status)}</span><span className="mt-1 block text-xs font-semibold leading-5 opacity-80">{STATUS_HELP[status]}</span></button>) : <span className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-500">{details.lifecycle_type === "Offboarding" && details.status !== "Completed" ? "Complete the checklist in order to continue" : "No further actions"}</span>}
          </div>
        </section>
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><h3 className="font-black">Audit history</h3><div className="mt-4 space-y-4 border-l-2 border-blue-100 pl-5">{details.history?.map((event) => <div key={event.lifecycle_history_id} className="relative"><span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-blue-600 bg-white"/><p className="font-bold text-slate-900">{workflowMessage(event.message)}</p><p className="text-xs text-slate-500">{event.changed_by_name || "System"} · {formatDate(event.created_at, true)}</p></div>)}</div></section>
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900"><strong>Monitoring safeguard:</strong> lifecycle actions never reinstall an agent or rotate a healthy device credential. Endpoint assignment and diagnostics continue through the existing Endpoint Management workflow.</div>
      </div>
    </aside>
  </div>;
}

function Info({ label, value }) {
  return <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase text-slate-400">{label}</p><p className="mt-2 font-black text-slate-900">{value}</p></div>;
}
