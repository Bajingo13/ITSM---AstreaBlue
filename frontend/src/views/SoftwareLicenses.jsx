import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Banknote,
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  DollarSign,
  Download,
  Edit3,
  FileText,
  Layers,
  Package,
  PieChart,
  Plus,
  Search,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import PageHero from "../components/layout/PageHero";
import ExportReportModal from "../components/ExportReportModal";
import { authHeaders } from "../services/authHeaders";
import { exportRowsAsReport } from "../utils/reportExport";

const API_BASE = `${API_URL}/api/v1`;

const LICENSE_TYPES = ["Subscription", "Annual", "Perpetual"];

function getRoleName(user) {
  return String(user?.role_name || user?.role || "");
}

function isSuperAdminUser(user) {
  return getRoleName(user).trim().toLowerCase() === "superadmin";
}

function buildLicenseQuery(user, extra = {}) {
  const params = new URLSearchParams();
  const roleName = getRoleName(user);

  if (user?.user_id) params.set("current_user_id", user.user_id);
  if (roleName) params.set("role_name", roleName);
  if (user?.branch_id) params.set("current_branch_id", user.branch_id);

  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildLicensePayload(user, payload = {}) {
  return {
    ...payload,
    current_user_id: user?.user_id || null,
    role_name: getRoleName(user) || null,
    current_branch_id: user?.branch_id || null,
  };
}

/* ─────────────────────────────────────────────
   Util: format currency
   ───────────────────────────────────────────── */
function formatCurrency(value) {
  if (value == null || isNaN(value)) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/* ─────────────────────────────────────────────
   Util: format date
   ───────────────────────────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/* ─────────────────────────────────────────────
   Util: input date value for date input
   ───────────────────────────────────────────── */
function formatDateInput(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

/* ─────────────────────────────────────────────
   SummaryCard
   ───────────────────────────────────────────── */
function SummaryCard({ icon: Icon, label, value, accent = "blue" }) {
  const gradients = {
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${gradients[accent]}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400">{label}</p>
          <p className="text-xl font-black text-slate-900">{value ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   UtilizationChart — horizontal stacked bar
   ───────────────────────────────────────────── */
function UtilizationChart({ used, total }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const available = Math.max(total - used, 0);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <PieChart size={18} />
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-900">License Utilization</h3>
          <p className="text-xs text-slate-400">{used} of {total} licenses in use ({pct}%)</p>
        </div>
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-bold text-slate-400">
        <span className="text-indigo-600">{used} In Use</span>
        <span>{available} Available</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ExpiringSoonBanner
   ───────────────────────────────────────────── */
function ExpiringSoonBanner({ licenses }) {
  const [expanded, setExpanded] = useState(false);
  const expiring = useMemo(
    () => (licenses || []).filter((l) => l.status === "Expiring Soon"),
    [licenses]
  );

  if (!expiring.length) return null;

  return (
    <div className="astrea-alert-warning flex items-start gap-4 px-5 py-4">
      <div className="rounded-xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={20} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black">
          {expiring.length} license{expiring.length > 1 ? "s" : ""} expiring soon
        </p>
        <ul className="mt-3 divide-y divide-amber-200/70">
          {(expanded ? expiring : expiring.slice(0, 5)).map((l) => (
            <li key={l.license_id} className="py-2 text-xs font-semibold">
              <strong>{l.license_name}</strong> — expires {formatDate(l.expiry_date)}
              {l.branch_name ? ` (${l.branch_name})` : ""}
            </li>
          ))}
          {expiring.length > 5 && (
            <li className="py-2"><button type="button" onClick={() => setExpanded((current) => !current)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-700 transition hover:bg-amber-100">{expanded ? "Show less" : `+${expiring.length - 5} more`}</button></li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   StatBadge — status chip
   ───────────────────────────────────────────── */
function StatusBadge({ status }) {
  const classes = {
    Active: "bg-emerald-50 text-emerald-700",
    "Expiring Soon": "bg-amber-50 text-amber-700",
    Expired: "bg-rose-50 text-rose-700",
    Overused: "bg-red-100 text-red-800",
  };

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-black ${classes[status] || "bg-slate-50 text-slate-600"}`}>
      {status}
    </span>
  );
}

/* ─────────────────────────────────────────────
   AddLicenseModal
   ───────────────────────────────────────────── */
const inputClass =
  "astrea-control text-sm disabled:cursor-not-allowed disabled:opacity-60";

function Field({ label, required = false, error = "", children }) {
  return (
    <div>
      <label className="astrea-field-label">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-0.5 text-[11px] font-medium text-rose-500">{error}</p>}
    </div>
  );
}

function AddLicenseModal({ onClose, onSave, loading, error, branches = [], isSuperAdmin = false }) {
  const [form, setForm] = useState({
    license_name: "",
    vendor: "",
    license_type: "Subscription",
    total_licenses: "",
    used_licenses: "",
    expiry_date: "",
    annual_cost: "",
    branch_id: "",
  });
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!form.license_name.trim()) errs.license_name = "License name is required.";
    if (!form.vendor.trim()) errs.vendor = "Vendor is required.";
    if (!form.license_type) errs.license_type = "License type is required.";
    if (!form.expiry_date) errs.expiry_date = "Expiry date is required.";
    if (form.total_licenses === "" || isNaN(form.total_licenses)) errs.total_licenses = "Must be a number.";
    if (form.used_licenses === "" || isNaN(form.used_licenses)) errs.used_licenses = "Must be a number.";
    if (form.annual_cost !== "" && isNaN(form.annual_cost)) errs.annual_cost = "Must be numeric.";
    if (isSuperAdmin && !form.branch_id) errs.branch_id = "Branch is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      ...form,
      total_licenses: parseInt(form.total_licenses) || 0,
      used_licenses: parseInt(form.used_licenses) || 0,
      annual_cost: parseFloat(form.annual_cost) || 0,
    });
  };

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="astrea-modal-backdrop">
      <div className="astrea-modal-panel relative max-w-lg">
        <div className="astrea-modal-header">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Plus size={18} />
            </div>
            <h2 className="text-base font-black text-slate-900">Add License</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="astrea-modal-body space-y-4">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="License Name" required error={errors.license_name}>
              <input value={form.license_name} onChange={(e) => update("license_name", e.target.value)} placeholder="e.g. Microsoft 365" className={inputClass} />
            </Field>
            <Field label="Vendor" required error={errors.vendor}>
              <input value={form.vendor} onChange={(e) => update("vendor", e.target.value)} placeholder="e.g. Microsoft" className={inputClass} />
            </Field>
          </div>

          <div>
            <Field label="License Type" required error={errors.license_type}>
              <select value={form.license_type} onChange={(e) => update("license_type", e.target.value)} className={inputClass}>
                {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Total Licenses" required error={errors.total_licenses}>
              <input type="number" min="0" value={form.total_licenses} onChange={(e) => update("total_licenses", e.target.value)} placeholder="0" className={inputClass} />
            </Field>
            <Field label="Used Licenses" required error={errors.used_licenses}>
              <input type="number" min="0" value={form.used_licenses} onChange={(e) => update("used_licenses", e.target.value)} placeholder="0" className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Expiry Date" required error={errors.expiry_date}>
              <input type="date" value={form.expiry_date} onChange={(e) => update("expiry_date", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Annual Cost" error={errors.annual_cost}>
              <input type="number" min="0" step="0.01" value={form.annual_cost} onChange={(e) => update("annual_cost", e.target.value)} placeholder="0.00" className={inputClass} />
            </Field>
          </div>

          {isSuperAdmin && (
            <Field label="Branch" required error={errors.branch_id}>
              <select value={form.branch_id} onChange={(e) => update("branch_id", e.target.value)} className={inputClass}>
                <option value="">Select Branch</option>
                {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
              </select>
            </Field>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</div>
          )}

          <div className="astrea-modal-footer -mx-6 -mb-6 mt-6">
            <button type="button" onClick={onClose} className="astrea-button astrea-button-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="astrea-button astrea-button-primary">
              {loading ? "Saving..." : "Add License"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   EditLicenseModal
   ───────────────────────────────────────────── */
function EditLicenseModal({ license, onClose, onSave, loading, error, branches = [], isSuperAdmin = false }) {
  const [form, setForm] = useState({
    license_name: license?.license_name || "",
    vendor: license?.vendor || "",
    license_type: license?.license_type || "Subscription",
    total_licenses: license?.total_licenses?.toString() || "",
    used_licenses: license?.used_licenses?.toString() || "",
    expiry_date: formatDateInput(license?.expiry_date),
    annual_cost: license?.annual_cost?.toString() || "",
    branch_id: license?.branch_id?.toString() || "",
  });
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!form.license_name.trim()) errs.license_name = "License name is required.";
    if (!form.vendor.trim()) errs.vendor = "Vendor is required.";
    if (!form.license_type) errs.license_type = "License type is required.";
    if (!form.expiry_date) errs.expiry_date = "Expiry date is required.";
    if (form.total_licenses === "" || isNaN(form.total_licenses)) errs.total_licenses = "Must be a number.";
    if (form.used_licenses === "" || isNaN(form.used_licenses)) errs.used_licenses = "Must be a number.";
    if (form.annual_cost !== "" && isNaN(form.annual_cost)) errs.annual_cost = "Must be numeric.";
    if (isSuperAdmin && !form.branch_id) errs.branch_id = "Branch is required.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    onSave({
      ...form,
      total_licenses: parseInt(form.total_licenses) || 0,
      used_licenses: parseInt(form.used_licenses) || 0,
      annual_cost: parseFloat(form.annual_cost) || 0,
    });
  };

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="astrea-modal-backdrop">
      <div className="astrea-modal-panel relative max-w-lg">
        <div className="astrea-modal-header">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Edit3 size={18} />
            </div>
            <h2 className="text-base font-black text-slate-900">Edit License</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="astrea-modal-body space-y-4">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="License Name" required error={errors.license_name}>
              <input value={form.license_name} onChange={(e) => update("license_name", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Vendor" required error={errors.vendor}>
              <input value={form.vendor} onChange={(e) => update("vendor", e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div>
            <Field label="License Type" required error={errors.license_type}>
              <select value={form.license_type} onChange={(e) => update("license_type", e.target.value)} className={inputClass}>
                {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Total Licenses" required error={errors.total_licenses}>
              <input type="number" min="0" value={form.total_licenses} onChange={(e) => update("total_licenses", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Used Licenses" required error={errors.used_licenses}>
              <input type="number" min="0" value={form.used_licenses} onChange={(e) => update("used_licenses", e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Expiry Date" required error={errors.expiry_date}>
              <input type="date" value={form.expiry_date} onChange={(e) => update("expiry_date", e.target.value)} className={inputClass} />
            </Field>
            <Field label="Annual Cost" error={errors.annual_cost}>
              <input type="number" min="0" step="0.01" value={form.annual_cost} onChange={(e) => update("annual_cost", e.target.value)} className={inputClass} />
            </Field>
          </div>

          {isSuperAdmin && (
            <Field label="Branch" required error={errors.branch_id}>
              <select value={form.branch_id} onChange={(e) => update("branch_id", e.target.value)} className={inputClass}>
                <option value="">Select Branch</option>
                {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
              </select>
            </Field>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</div>
          )}

          <div className="astrea-modal-footer -mx-6 -mb-6 mt-6">
            <button type="button" onClick={onClose} className="astrea-button astrea-button-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="astrea-button astrea-button-primary">
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main SoftwareLicenses Component
   ───────────────────────────────────────────── */
export default function SoftwareLicenses() {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);

  const [licenses, setLicenses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("expiry");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("excel");

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLicense, setEditingLicense] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  /* ── Fetch branches (for filter + modal) ── */
  useEffect(() => {
    fetch(`${API_BASE}/branches`, { headers: authHeaders(), cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setBranches(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  /* ── Fetch licenses and summary ── */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const query = buildLicenseQuery(user, {
        branch_id: isSuperAdmin && branchFilter !== "all" ? branchFilter : null,
      });

      const [licensesRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}/software-licenses${query}`, { headers: authHeaders(), cache: "no-store" }),
        fetch(`${API_BASE}/software-licenses/summary${query}`, { headers: authHeaders(), cache: "no-store" }),
      ]);

      if (!licensesRes.ok) throw new Error("Failed to fetch licenses");
      if (!summaryRes.ok) throw new Error("Failed to fetch summary");

      const licensesData = await licensesRes.json();
      const summaryData = await summaryRes.json();

      setLicenses(licensesData.data || []);
      setSummary(summaryData.data || null);
    } catch (err) {
      console.error("SoftwareLicenses fetch error:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin, branchFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Filtered licenses ── */
  const filteredLicenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = licenses.filter(
      (l) =>
        (!q || (l.license_name || "").toLowerCase().includes(q) ||
        (l.vendor || "").toLowerCase().includes(q) ||
        (l.branch_name || "").toLowerCase().includes(q)) &&
        (statusFilter === "all" || l.status === statusFilter)
    );
    return [...rows].sort((left, right) => {
      if (sortMode === "name") return String(left.license_name || "").localeCompare(String(right.license_name || ""));
      if (sortMode === "utilization") return (Number(right.used_licenses) / Math.max(Number(right.total_licenses), 1)) - (Number(left.used_licenses) / Math.max(Number(left.total_licenses), 1));
      return new Date(left.expiry_date || "9999-12-31") - new Date(right.expiry_date || "9999-12-31");
    });
  }, [licenses, search, statusFilter, sortMode]);

  /* ── Derived totals for utilization ── */
  const totalUsed = licenses.reduce((s, l) => s + (l.used_licenses || 0), 0);
  const totalLicensesCount = licenses.reduce((s, l) => s + (l.total_licenses || 0), 0);
  const activeCount = licenses.filter((l) => l.status === "Active").length;
  const expiringSoonCount = licenses.filter((l) => l.status === "Expiring Soon").length;
  const expiredCount = licenses.filter((l) => l.status === "Expired").length;

  /* ── Handlers ── */
  const handleAdd = async (formData) => {
    try {
      setSaving(true);
      setSaveError("");
      const res = await fetch(`${API_BASE}/software-licenses`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(buildLicensePayload(user, formData)),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.message || data.error || "Failed to add license.");
      setShowAddModal(false);
      await fetchData();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (formData) => {
    if (!editingLicense) return;
    try {
      setSaving(true);
      setSaveError("");
      const res = await fetch(`${API_BASE}/software-licenses/${editingLicense.license_id}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(buildLicensePayload(user, formData)),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.message || data.error || "Failed to update license.");
      setEditingLicense(null);
      await fetchData();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (license) => {
    if (!window.confirm(`Delete "${license.license_name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_BASE}/software-licenses/${license.license_id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.message || data.error || "Failed to delete license.");
      await fetchData();
    } catch (err) {
      console.error("Delete error:", err.message);
      alert("Failed to delete license: " + err.message);
    }
  };

  const exportColumns = [
    { label: "License", value: (row) => row.license_name },
    { label: "Vendor", value: (row) => row.vendor },
    { label: "Branch", value: (row) => row.branch_name || "Unassigned" },
    { label: "Type", value: (row) => row.license_type },
    { label: "Used / Total", value: (row) => `${row.used_licenses || 0} / ${row.total_licenses || 0}` },
    { label: "Expiry", value: (row) => formatDate(row.expiry_date) },
    { label: "Status", value: (row) => row.status },
  ];

  const handleExport = async () => {
    if (filteredLicenses.length === 0) return;
    try {
      const scope = branchFilter === "all" ? "All branches" : branches.find((branch) => String(branch.branch_id) === String(branchFilter))?.branch_name || "Authorized branch";
      await exportRowsAsReport({ filename: `software-licenses-${new Date().toISOString().slice(0, 10)}`, title: "Software License Report", scope, format: exportFormat, columns: exportColumns, rows: filteredLicenses });
      setExportOpen(false);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export software licenses. Please try again.");
    }
  };

  /* ── Render ── */
  return (
    <div className="space-y-5">
      {/* Hero Banner */}
      <PageHero eyebrow="Asset Management" title="Software License Management" subtitle="Track entitlements, compliance, renewals, utilization, and branch assignments." actions={<>
          <span className="rounded-xl bg-white/10 px-4 py-3 text-sm font-bold">
            {totalLicensesCount} total licenses · {activeCount} active · {expiringSoonCount} expiring soon · {expiredCount} expired
          </span>
          <button
            type="button"
            onClick={() => {
              setSaveError("");
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-lg shadow-slate-900/10 transition hover:bg-slate-100"
          >
            <Plus size={18} />
            Add License
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:bg-white/20"
          >
            <Download size={18} />
            Export
          </button>
        </>} />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
          <AlertTriangle size={18} />
          {error}
          <button type="button" onClick={fetchData} className="ml-auto rounded-xl bg-rose-100 px-4 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-200">
            Retry
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={Package} label="Total Licenses" value={summary?.total_licenses ?? (loading ? "—" : 0)} accent="blue" />
        <SummaryCard icon={CheckCircle} label="In Use" value={summary?.total_in_use ?? (loading ? "—" : 0)} accent="purple" />
        <SummaryCard icon={Layers} label="Available" value={summary?.total_available ?? (loading ? "—" : 0)} accent="emerald" />
        <SummaryCard icon={DollarSign} label="Annual Cost" value={formatCurrency(summary?.total_annual_cost)} accent="amber" />
      </section>

      {/* Utilization Chart + Expiring Banner */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UtilizationChart used={totalUsed} total={totalLicensesCount} />
        <ExpiringSoonBanner licenses={licenses} />
      </div>

      {/* Search + Branch Filter + Table */}
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search size={15} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search licenses..."
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")}>
                  <X size={14} className="text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>
            {isSuperAdmin && (
              <div className="relative">
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="appearance-none rounded-xl border border-slate-200 bg-slate-50 px-9 py-2 pr-8 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="all">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            )}
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"><option value="all">All statuses</option><option value="Active">Active</option><option value="Expiring Soon">Expiring soon</option><option value="Expired">Expired</option></select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"><option value="expiry">Expiry date</option><option value="name">License name</option><option value="utilization">Highest utilization</option></select>
          </div>
          <p className="shrink-0 text-xs font-bold text-slate-400">
            {filteredLicenses.length} license{filteredLicenses.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3.5">License</th>
                <th className="px-5 py-3.5">Vendor</th>
                {isSuperAdmin && <th className="px-5 py-3.5">Branch</th>}
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Total Licenses</th>
                <th className="px-5 py-3.5">Used Licenses</th>
                <th className="px-5 py-3.5">Available Licenses</th>
                <th className="px-5 py-3.5">Utilization</th>
                <th className="px-5 py-3.5">Expiry</th>
                <th className="px-5 py-3.5">Annual Cost</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td colSpan={isSuperAdmin ? 12 : 11} className="px-5 py-4">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : filteredLicenses.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 12 : 11} className="px-5 py-10 text-center text-sm text-slate-400">
                    {search || branchFilter !== "all" ? "No licenses match your filters." : "No licenses found. Add one to get started."}
                  </td>
                </tr>
              ) : (
                filteredLicenses.map((l) => {
                  const utilPct = l.total_licenses > 0 ? Math.round((l.used_licenses / l.total_licenses) * 100) : 0;
                  return (
                    <tr key={l.license_id} className="border-b border-slate-50 transition hover:bg-slate-50/50">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <FileText size={15} />
                          </div>
                          <span className="font-bold text-slate-800">{l.license_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">{l.vendor}</td>
                      {isSuperAdmin && <td className="px-5 py-3.5 text-slate-600">{l.branch_name || "—"}</td>}
                      <td className="px-5 py-3.5 text-slate-600">{l.license_type}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">{l.total_licenses}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">{l.used_licenses}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">{Math.max(Number(l.available_licenses ?? l.total_licenses - l.used_licenses), 0)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100 sm:w-20">
                            <div
                              className={`h-full rounded-full ${
                                utilPct > 90 ? "bg-rose-500" : utilPct > 70 ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(utilPct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-slate-400">{utilPct}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">{formatDate(l.expiry_date)}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">{formatCurrency(l.annual_cost)}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={l.status} />
                        {l.is_overused && <span className="ml-2 inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-black text-red-800">Overused</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSaveError("");
                              setEditingLicense(l);
                            }}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                            title="Edit"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(l)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddLicenseModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAdd}
          loading={saving}
          error={saveError}
          branches={branches}
          isSuperAdmin={isSuperAdmin}
        />
      )}

      {editingLicense && (
        <EditLicenseModal
          license={editingLicense}
          onClose={() => setEditingLicense(null)}
          onSave={handleEdit}
          loading={saving}
          error={saveError}
          branches={branches}
          isSuperAdmin={isSuperAdmin}
        />
      )}
      {exportOpen && (
        <ExportReportModal
          title="Export Software Licenses"
          format={exportFormat}
          onFormatChange={setExportFormat}
          onClose={() => setExportOpen(false)}
          onExport={handleExport}
          branches={isSuperAdmin ? branches : []}
          branchId={branchFilter}
          onBranchChange={isSuperAdmin ? setBranchFilter : undefined}
        />
      )}
    </div>
  );
}
