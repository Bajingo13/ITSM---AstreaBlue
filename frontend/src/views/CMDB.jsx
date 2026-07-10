import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, Box, Building2, CheckCircle,
  ChevronDown, ChevronLeft, ChevronRight, Cpu, Database as DatabaseIcon,
  FileText, Filter, GitBranch, Globe, HardDrive, LayoutDashboard,
  Link, Loader2, Monitor, Network, Plus, Search, Server, Shield,
  Settings, Trash2, X
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { API_URL } from "../config/api";
import DependencyGraphView from "./DependencyGraphView";

const API_BASE = `${API_URL}/api/v1`;

/* ─────────────────────────────────────────────
   Helper functions
   ───────────────────────────────────────────── */
function getStatusClasses(status) {
  switch (status) {
    case "Active":      return "bg-emerald-100 text-emerald-700";
    case "Inactive":    return "bg-slate-100 text-slate-600";
    case "Maintenance": return "bg-amber-100 text-amber-700";
    case "Retired":     return "bg-rose-100 text-rose-700";
    default:            return "bg-slate-100 text-slate-600";
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return "—";
  }
}

function getBranchCode(branchName) {
  if (!branchName) return "—";
  const parts = branchName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
}

function getRiskClasses(level) {
  switch (level) {
    case "Critical": return "bg-rose-100 text-rose-700";
    case "High":     return "bg-orange-100 text-orange-700";
    case "Medium":   return "bg-amber-100 text-amber-700";
    case "Low":      return "bg-emerald-100 text-emerald-700";
    default:         return "bg-slate-100 text-slate-600";
  }
}

function getEnvironmentClasses(env) {
  switch (env) {
    case "Production":      return "bg-blue-100 text-blue-700";
    case "Staging":         return "bg-violet-100 text-violet-700";
    case "Development":     return "bg-amber-100 text-amber-700";
    case "Testing":         return "bg-cyan-100 text-cyan-700";
    case "Disaster Recovery": return "bg-rose-100 text-rose-700";
    default:                return "bg-slate-100 text-slate-600";
  }
}

/* ─────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────── */
const CI_TYPE_OPTIONS = [
  { label: "Server",             value: "Server" },
  { label: "Application",        value: "Application" },
  { label: "Network Device",     value: "Network Device" },
  { label: "Database",           value: "Database" },
  { label: "Storage",            value: "Storage" },
  { label: "Middleware",         value: "Middleware" },
  { label: "Security Appliance", value: "Security Appliance" },
  { label: "Virtualization",     value: "Virtualization" },
  { label: "Workstation",        value: "Workstation" },
  { label: "Peripheral",         value: "Peripheral" },
];

const ENVIRONMENT_OPTIONS = [
  { label: "Production",          value: "Production" },
  { label: "Staging",             value: "Staging" },
  { label: "Development",         value: "Development" },
  { label: "Testing",             value: "Testing" },
  { label: "Disaster Recovery",   value: "Disaster Recovery" },
];

const STATUS_OPTIONS = [
  { label: "Active",      value: "Active" },
  { label: "Inactive",    value: "Inactive" },
  { label: "Maintenance", value: "Maintenance" },
  { label: "Retired",     value: "Retired" },
];

/* ─────────────────────────────────────────────
   BranchSelector — searchable dropdown (same pattern as Assets.jsx)
   ───────────────────────────────────────────── */
function BranchSelector({ branches = [], value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const selected = value && value !== "All"
    ? branches.find((b) => String(b.branch_id) === String(value))
    : null;

  const filtered = useMemo(() => {
    if (!query.trim()) return branches;
    const q = query.trim().toLowerCase();
    return branches.filter((b) => (b.branch_name || "").toLowerCase().includes(q));
  }, [branches, query]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (open && wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-[220px] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-sm font-bold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      >
        <Building2 size={16} className="shrink-0 text-slate-400" />
        <span className="flex-1 truncate">{selected ? selected.branch_name : "All Branches"}</span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-[260px] rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-2">
            <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches..."
              className="w-full rounded-xl border border-slate-100 bg-slate-50 py-2 pl-8 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => { onChange("All"); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition ${
                !selected ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Building2 size={14} className="shrink-0 text-slate-400" />
              All Branches
            </button>
            {filtered.map((b) => (
              <button
                key={b.branch_id}
                type="button"
                onClick={() => { onChange(String(b.branch_id)); setOpen(false); }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition ${
                  String(b.branch_id) === String(value) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Building2 size={14} className="shrink-0 text-slate-400" />
                {b.branch_name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-400">No branches match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Styled form field helpers (same as Assets.jsx)
   ───────────────────────────────────────────── */
const ciInputClass =
  "w-full rounded-2xl border border-[#D8E5F6] bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-blue-300 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-600/15 disabled:bg-slate-100 disabled:text-slate-500";

function CiField({ label, required = false, className = "", error = "", children }) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
        {label}
        {required && <span> *</span>}
      </span>
      {children}
      {error && <span className="block text-xs font-bold text-rose-600">{error}</span>}
    </label>
  );
}

function CiInput({ value, onChange, type = "text", ...props }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      className={ciInputClass}
      {...props}
    />
  );
}

function CiSelect({ value, onChange, options, placeholder, ...props }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={ciInputClass}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/* ─────────────────────────────────────────────
   SummaryCards — dashboard-style stats
   ───────────────────────────────────────────── */
function SummaryCards({ statistics }) {
  const cards = [
    { label: "Total Servers",      count: statistics.totalServers ?? 0,        icon: Server,       color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Total Applications", count: statistics.totalApplications ?? 0,    icon: LayoutDashboard, color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Network Devices",    count: statistics.totalNetworkDevices ?? 0, icon: Network,     color: "text-cyan-600",  bg: "bg-cyan-50" },
    { label: "Active CIs",         count: statistics.totalActiveCIs ?? 0,      icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="flex items-start justify-between">
              <div className={`rounded-2xl ${card.bg} p-3`}>
                <Icon size={22} className={card.color} />
              </div>
            </div>
            <p className="mt-4 text-3xl font-black text-slate-900">{card.count}</p>
            <p className="mt-1 text-sm font-bold text-slate-500">{card.label}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ConfigItemCard — single CI display card
   ───────────────────────────────────────────── */
function ConfigItemCard({ ci, onDelete, canDelete }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Box size={16} className="shrink-0 text-blue-600" />
              <span className="text-xs font-black uppercase tracking-wider text-blue-600">{ci.ci_type || "CI"}</span>
            </div>
            <h3 className="mt-1 truncate text-lg font-black text-slate-900">{ci.ci_name || "Unnamed CI"}</h3>
            <p className="mt-0.5 text-xs text-slate-400">ID: {ci.ci_id || "—"}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getStatusClasses(ci.status)}`}>
            {ci.status || "Unknown"}
          </span>
        </div>

        <div className="mt-4 space-y-2 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <Building2 size={14} className="shrink-0 text-slate-400" />
            <span>{ci.branch_name || "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe size={14} className="shrink-0 text-slate-400" />
            <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${getEnvironmentClasses(ci.environment)}`}>
              {ci.environment || "—"}
            </span>
          </div>
          {ci.ip_address && (
            <div className="flex items-center gap-2">
              <Network size={14} className="shrink-0 text-slate-400" />
              <span>{ci.ip_address}</span>
            </div>
          )}
          {ci.operating_system && (
            <div className="flex items-center gap-2">
              <Monitor size={14} className="shrink-0 text-slate-400" />
              <span>{ci.operating_system}</span>
            </div>
          )}
          {ci.owner && (
            <div className="flex items-center gap-2">
              <Shield size={14} className="shrink-0 text-slate-400" />
              <span>{ci.owner}</span>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
          Created: {formatDate(ci.created_at)}
        </div>

        {canDelete && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => onDelete?.(ci)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────
   AddCIForm — modal for creating/editing CI
   ───────────────────────────────────────────── */
function AddCIForm({ onClose, onSubmit, user, branches, ciCategories, editingCi }) {
  const isSuperAdmin = (user?.role_name || user?.role || "") === "SuperAdmin";

  const getCategoryId = (ci) => {
    if (ci?.category_id) return String(ci.category_id);
    if (ci?.category_name && ciCategories?.length) {
      const match = ciCategories.find((c) => c.category_name === ci.category_name);
      return match ? String(match.ci_category_id) : "";
    }
    return "";
  };

  const [form, setForm] = useState(() => ({
    ci_name:          editingCi?.ci_name || "",
    ci_type:          editingCi?.ci_type || "",
    category_id:      getCategoryId(editingCi),
    description:      editingCi?.description || "",
    branch_id:        editingCi?.branch_id
      ? String(editingCi.branch_id)
      : isSuperAdmin
        ? ""
        : String(user?.branch_id || ""),
    environment:      editingCi?.environment || "",
    ip_address:       editingCi?.ip_address || "",
    operating_system: editingCi?.operating_system || "",
    owner:            editingCi?.owner || "",
    status:           editingCi?.status || "Active",
    version:          editingCi?.version || "",
    location:         editingCi?.location || "",
  }));
  const [localError, setLocalError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (localError) setLocalError("");
    if (fieldErrors[key]) {
      setFieldErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const required = [["ci_name", "CI Name"], ["ci_type", "CI Type"], ["status", "Status"]];
    if (isSuperAdmin && !form.branch_id) {
      required.push(["branch_id", "Branch"]);
    }
    const errors = {};
    for (const [key, label] of required) {
      if (!String(form[key] || "").trim()) {
        errors[key] = `${label} is required.`;
      }
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setLocalError("Please complete the required fields.");
      return;
    }

    try {
      setSaving(true);
      setLocalError("");
      await onSubmit(form, editingCi?.ci_id);
    } catch (err) {
      setLocalError(err.message || "Unable to save CI");
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = useMemo(() => {
    return (ciCategories || []).map((c) => ({
      label: c.category_name,
      value: String(c.ci_category_id),
    }));
  }, [ciCategories]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">{editingCi ? "Edit CI" : "Add CI"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {editingCi ? "Update configuration item details." : "Register a new configuration item in the CMDB."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close CI modal"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
            {localError && (
              <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {localError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
              <CiField label="CI Name" required error={fieldErrors.ci_name}>
                <CiInput
                  value={form.ci_name}
                  onChange={(v) => updateField("ci_name", v)}
                  placeholder="e.g. Web Server 01"
                  required
                />
              </CiField>

              <CiField label="CI Type" required error={fieldErrors.ci_type}>
                <CiSelect
                  value={form.ci_type}
                  onChange={(v) => updateField("ci_type", v)}
                  options={CI_TYPE_OPTIONS}
                  placeholder="Select CI type"
                  required
                />
              </CiField>

              <CiField label="Category" error={fieldErrors.category}>
                <CiSelect
                  value={form.category_id}
                  onChange={(v) => updateField("category_id", v)}
                  options={categoryOptions}
                  placeholder="Select category"
                />
              </CiField>

              <CiField label="Status" required error={fieldErrors.status}>
                <CiSelect
                  value={form.status}
                  onChange={(v) => updateField("status", v)}
                  options={STATUS_OPTIONS}
                  required
                />
              </CiField>

              <CiField label="Environment">
                <CiSelect
                  value={form.environment}
                  onChange={(v) => updateField("environment", v)}
                  options={ENVIRONMENT_OPTIONS}
                  placeholder="Select environment"
                />
              </CiField>

              {isSuperAdmin ? (
                <CiField label="Branch" required={isSuperAdmin && !form.branch_id} error={fieldErrors.branch_id}>
                  <CiSelect
                    value={form.branch_id}
                    onChange={(v) => updateField("branch_id", v)}
                    options={(branches || []).map((b) => ({ label: b.branch_name, value: String(b.branch_id) }))}
                    placeholder="Select a branch"
                    required={isSuperAdmin && !form.branch_id}
                  />
                </CiField>
              ) : (
                <CiField label="Branch">
                  <input
                    type="text"
                    value={user?.branch_name || "—"}
                    disabled
                    className={ciInputClass}
                  />
                </CiField>
              )}

              <CiField label="IP Address">
                <CiInput
                  value={form.ip_address}
                  onChange={(v) => updateField("ip_address", v)}
                  placeholder="192.168.1.1"
                />
              </CiField>

              <CiField label="Operating System">
                <CiInput
                  value={form.operating_system}
                  onChange={(v) => updateField("operating_system", v)}
                  placeholder="Ubuntu 22.04, Windows Server..."
                />
              </CiField>

              <CiField label="Owner">
                <CiInput
                  value={form.owner}
                  onChange={(v) => updateField("owner", v)}
                  placeholder="Responsible person"
                />
              </CiField>

              <CiField label="Version">
                <CiInput
                  value={form.version}
                  onChange={(v) => updateField("version", v)}
                  placeholder="v1.0.0"
                />
              </CiField>

              <CiField label="Location" className="md:col-span-2">
                <CiInput
                  value={form.location}
                  onChange={(v) => updateField("location", v)}
                  placeholder="Data center, rack, room..."
                />
              </CiField>

              <CiField label="Description" className="md:col-span-2">
                <textarea
                  value={form.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  rows={3}
                  placeholder="CI description, purpose, notes..."
                  className={ciInputClass}
                />
              </CiField>
            </div>
          </div>

          <div className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white px-7 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-6 py-3 font-black text-slate-600 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-3 font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!saving && !editingCi && <Plus size={18} />}
              {saving ? "Saving..." : editingCi ? "Save Changes" : "Add CI"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ConfigItemsPanel — main CI list view
   ───────────────────────────────────────────── */
function ConfigItemsPanel({ user, role, branches }) {
  const isSuperAdmin = role === "SuperAdmin";
  const canCreate = role === "SuperAdmin" || role === "Admin";
  const currentBranchId = user?.branch_id || null;

  const [search, setSearch] = useState("");
  // Applied filters — used for actual fetching
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [environmentFilter, setEnvironmentFilter] = useState("All");
  const [branchFilter, setBranchFilter] = useState(isSuperAdmin ? "All" : String(currentBranchId || ""));
  // Draft filters — used inside popover until Apply
  const [draftType, setDraftType] = useState("All");
  const [draftStatus, setDraftStatus] = useState("All");
  const [draftEnv, setDraftEnv] = useState("All");
  const [draftBranch, setDraftBranch] = useState(isSuperAdmin ? "All" : String(currentBranchId || ""));
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const filterPopoverRef = useRef(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [ciData, setCiData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statistics, setStatistics] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editingCi, setEditingCi] = useState(null);
  const [ciCategories, setCiCategories] = useState([]);

  const fetchCiCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/cmdb/ci-categories?current_user_id=${user?.user_id}&role_name=${role}&branch_id=${user?.branch_id}`);
      const data = await res.json();
      if (res.ok) setCiCategories(Array.isArray(data) ? data : []);
    } catch {
      // silently fail — categories are optional
    }
  }, [user, role]);

  const fetchCIs = useCallback(async (opts = {}) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const bf = opts.branch ?? branchFilter;
      const tf = opts.type ?? typeFilter;
      const sf = opts.status ?? statusFilter;
      const ef = opts.env ?? environmentFilter;
      const sq = opts.search ?? search;
      if (bf && bf !== "All") params.set("branch", bf);
      if (tf && tf !== "All") params.set("ci_type", tf);
      if (sf && sf !== "All") params.set("status", sf);
      if (ef && ef !== "All") params.set("environment", ef);
      if (sq.trim()) params.set("search", sq.trim());
      const res = await fetch(`${API_BASE}/cmdb/config-items?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to fetch CIs");
      setCiData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch CIs failed:", err);
      setCiData([]);
    } finally {
      setLoading(false);
    }
  }, [user, role]);

  const fetchStatistics = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const res = await fetch(`${API_BASE}/cmdb/statistics?${params.toString()}`);
      const data = await res.json();
      if (res.ok && typeof data === "object" && !Array.isArray(data)) {
        setStatistics({
          totalServers: data.total_servers ?? 0,
          totalApplications: data.total_applications ?? 0,
          totalNetworkDevices: data.total_network_devices ?? 0,
          totalActiveCIs: data.total_active ?? 0,
        });
      } else {
        setStatistics({});
      }
    } catch {
      // silently fail
    }
  }, [user, role]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const res = await fetch(`${API_BASE}/cmdb/filter-options?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setFilterOptions(data);
    } catch {
      // silently fail
    }
  }, [user, role]);

  useEffect(() => {
    fetchCiCategories();
  }, [fetchCiCategories]);

  useEffect(() => {
    fetchCIs();
  }, [fetchCIs]);
  useEffect(() => {
    fetchStatistics();
  }, [fetchStatistics]);
  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  /* ── Apply / Clear filter handlers ── */
  const handleApplyFilters = useCallback(() => {
    setTypeFilter(draftType);
    setStatusFilter(draftStatus);
    setEnvironmentFilter(draftEnv);
    setBranchFilter(draftBranch);
    setShowFilterPopover(false);
    fetchCIs({
      branch: draftBranch,
      type: draftType,
      status: draftStatus,
      env: draftEnv,
      search,
    });
  }, [draftType, draftStatus, draftEnv, draftBranch, search, fetchCIs]);

  const handleClearFilters = useCallback(() => {
    setDraftType("All");
    setDraftStatus("All");
    setDraftEnv("All");
    setDraftBranch(isSuperAdmin ? "All" : String(currentBranchId || ""));
  }, [isSuperAdmin, currentBranchId]);

  /* ── Immediate branch filter (no popover needed) ── */
  const handleBranchChange = useCallback((branchId) => {
    setBranchFilter(branchId);
    setDraftBranch(branchId);
    fetchCIs({ branch: branchId, type: typeFilter, status: statusFilter, env: environmentFilter, search });
  }, [typeFilter, statusFilter, environmentFilter, search, fetchCIs]);

  const handleCancelFilters = useCallback(() => {
    setDraftType(typeFilter);
    setDraftStatus(statusFilter);
    setDraftEnv(environmentFilter);
    setDraftBranch(branchFilter);
    setShowFilterPopover(false);
  }, [typeFilter, statusFilter, environmentFilter, branchFilter]);

  /* ── Toggle popover: sync draft from current filters when opening ── */
  const openFilterPopover = useCallback(() => {
    setShowFilterPopover((prev) => {
      if (!prev) {
        setDraftType(typeFilter);
        setDraftStatus(statusFilter);
        setDraftEnv(environmentFilter);
        setDraftBranch(branchFilter);
      }
      return !prev;
    });
  }, [typeFilter, statusFilter, environmentFilter, branchFilter]);

  /* ── Click outside to close popover ── */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(event.target)) {
        setShowFilterPopover(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDeleteCI = useCallback(async (ci) => {
    if (!window.confirm(`Delete "${ci.ci_name}"? This action cannot be undone.`)) return;
    try {
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const res = await fetch(`${API_BASE}/cmdb/config-items/${ci.ci_id}?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to delete CI");
      }
      await fetchCIs();
      await fetchStatistics();
    } catch (err) {
      console.error("Delete CI failed:", err);
      alert(err.message || "Unable to delete CI");
    }
  }, [user, role, fetchCIs, fetchStatistics]);

  const handleSubmitCI = useCallback(async (formData, ciId) => {
    const params = new URLSearchParams({
      current_user_id: user?.user_id || "",
      role_name: role || "",
      branch_id: user?.branch_id || "",
    });
    const res = await fetch(
      ciId ? `${API_BASE}/cmdb/config-items/${ciId}?${params.toString()}` : `${API_BASE}/cmdb/config-items?${params.toString()}`,
      {
        method: ciId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || "Unable to save CI");
    await fetchCIs();
    await fetchStatistics();
    setShowForm(false);
    setEditingCi(null);
  }, [user, role, fetchCIs, fetchStatistics]);

  const openAddCI = () => {
    setEditingCi(null);
    setShowForm(true);
  };

  const openEditCI = (ci) => {
    setEditingCi(ci);
    setShowForm(true);
  };

  /* ── Dynamic filter options from API ── */
  const typeOptions = useMemo(() => {
    return ["All", ...(filterOptions?.types || [])];
  }, [filterOptions]);
  const statusOptions = useMemo(() => {
    return ["All", ...(filterOptions?.statuses || ["Active", "Inactive", "Maintenance"])];
  }, [filterOptions]);
  const envOptions = useMemo(() => {
    return ["All", ...(filterOptions?.environments || ["Production", "Development", "Testing"])];
  }, [filterOptions]);
  const filterBranches = useMemo(() => {
    return filterOptions?.branches || branches;
  }, [filterOptions, branches]);

  /* ── Active filter count for badge ── */
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (typeFilter !== "All") count++;
    if (statusFilter !== "All") count++;
    if (environmentFilter !== "All") count++;
    if (branchFilter !== "All") count++;
    return count;
  }, [typeFilter, statusFilter, environmentFilter, branchFilter]);

  /* ── Filtered CIs (client-side for responsiveness) ── */
  const filteredCIs = useMemo(() => {
    return ciData.filter((ci) => {
      if (typeFilter !== "All" && ci.ci_type !== typeFilter) return false;
      if (statusFilter !== "All" && ci.status !== statusFilter) return false;
      if (environmentFilter !== "All" && ci.environment !== environmentFilter) return false;
      if (branchFilter !== "All" && String(ci.branch_id) !== String(branchFilter)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const fields = [ci.ci_name, ci.ci_type, ci.ip_address, ci.owner, ci.operating_system, ci.branch_name];
        if (!fields.some((f) => f && f.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [ciData, typeFilter, statusFilter, environmentFilter, branchFilter, search]);

  return (
    <div className="space-y-6">
      {/* Header — Assets-style hero */}
      <section className="astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 py-8 text-white shadow-[var(--astrea-hero-shadow)] lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
        <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-black sm:text-4xl">Configuration Items</h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:text-base">
              Manage servers, applications, network devices, databases, and all infrastructure components.
            </p>
            <p className="mt-4 text-sm text-cyan-100">
              {filteredCIs.length} CI{filteredCIs.length !== 1 ? "s" : ""} displayed
            </p>
          </div>
          {canCreate && (
            <button
              onClick={openAddCI}
              className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-lg shadow-slate-900/10 transition hover:bg-slate-100"
            >
              <Plus size={18} />
              Add CI
            </button>
          )}
        </div>
      </section>

      {/* Summary Cards */}
      <SummaryCards statistics={statistics} />

      {/* Filter Bar — search + Sort & Filter */}
      <section className="relative flex flex-wrap items-center gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex min-w-[200px] flex-1 items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search size={18} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CIs by name, type, IP..."
            className="w-full bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>

        {isSuperAdmin && (
          <BranchSelector
            branches={filterBranches}
            value={branchFilter}
            onChange={handleBranchChange}
          />
        )}

        <div ref={filterPopoverRef} className="relative">
          <button
            type="button"
            onClick={openFilterPopover}
            aria-expanded={showFilterPopover}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black shadow-sm transition ${
              showFilterPopover
                ? "border-blue-300 bg-blue-50 text-blue-700 ring-4 ring-blue-600/10"
                : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700"
            }`}
          >
            <Filter size={16} />
            <span>Filter</span>
            {activeFilterCount > 0 && (
              <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-black text-white leading-none">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown size={16} className={`shrink-0 transition-transform duration-150 ${showFilterPopover ? "rotate-180" : ""}`} />
          </button>

          <div
            className={`absolute right-0 top-full z-40 mt-2 w-[min(92vw,440px)] origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/12 transition-all duration-150 ${
              showFilterPopover ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0 pointer-events-none"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
              <h3 className="text-sm font-black text-slate-900">Filters</h3>
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs font-bold text-blue-600 transition hover:text-blue-800"
              >
                Clear Filter
              </button>
            </div>

            {/* Branch Section */}
            <div className="border-b border-slate-100 px-4 py-4">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Branch</p>
              {isSuperAdmin ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setDraftBranch("All")}
                    className={`flex w-full items-center justify-between rounded-[11px] px-3 py-2.5 text-left text-sm font-bold transition ${
                      draftBranch === "All" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-blue-50/60 hover:text-blue-700"
                    }`}
                  >
                    <span>All Branches</span>
                    {draftBranch === "All" && <CheckCircle size={16} className="text-blue-600" />}
                  </button>
                  {filterBranches.map((b) => {
                    const bId = String(b.branch_id);
                    return (
                      <button
                        key={bId}
                        type="button"
                        onClick={() => setDraftBranch(bId)}
                        className={`flex w-full items-center justify-between rounded-[11px] px-3 py-2.5 text-left text-sm font-bold transition ${
                          draftBranch === bId ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-blue-50/60 hover:text-blue-700"
                        }`}
                      >
                        <span>{b.branch_name}</span>
                        {draftBranch === bId && <CheckCircle size={16} className="text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-[11px] bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-600">
                  {user?.branch_name || "Assigned Branch"}
                </p>
              )}
            </div>

            {/* CI Type, Status, Environment Grid */}
            <div className="border-b border-slate-100 px-4 py-4">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Filters</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">CI Type</span>
                  <select
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value)}
                    className="w-full rounded-[11px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition hover:border-blue-200 hover:bg-blue-50/40 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                  >
                    {typeOptions.map((t) => (
                      <option key={t} value={t}>{t === "All" ? "All Types" : t}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Status</span>
                  <select
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value)}
                    className="w-full rounded-[11px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition hover:border-blue-200 hover:bg-blue-50/40 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>{s === "All" ? "All Status" : s}</option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Environment</span>
                  <select
                    value={draftEnv}
                    onChange={(e) => setDraftEnv(e.target.value)}
                    className="w-full rounded-[11px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition hover:border-blue-200 hover:bg-blue-50/40 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                  >
                    {envOptions.map((e) => (
                      <option key={e} value={e}>{e === "All" ? "All Environments" : e}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2.5 px-4 py-4">
              <button
                type="button"
                onClick={handleCancelFilters}
                className="flex-1 rounded-[11px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyFilters}
                className="flex-1 rounded-[11px] bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
              >
                Apply Filter
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CI Cards Grid */}
      <section>
        {loading ? (
          <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading CIs...
          </div>
        ) : filteredCIs.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
            {search || typeFilter !== "All" || statusFilter !== "All" || environmentFilter !== "All" || branchFilter !== "All"
              ? "No CIs match the current filters."
              : "No configuration items found. Add your first CI to get started."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredCIs.map((ci) => (
              <ConfigItemCard
                key={ci.ci_id}
                ci={ci}
                canDelete={canCreate}
                onDelete={handleDeleteCI}
              />
            ))}
          </div>
        )}
      </section>

      {/* CI Form Modal */}
      {showForm && (
        <AddCIForm
          onClose={() => { setShowForm(false); setEditingCi(null); }}
          onSubmit={handleSubmitCI}
          user={user}
          branches={branches}
          ciCategories={ciCategories}
          editingCi={editingCi}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   DependencyMapPanel — visual dependency hierarchy
   ───────────────────────────────────────────── */
function DependencyMapPanel({ user, role, branches }) {
  const isSuperAdmin = role === "SuperAdmin";
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterBranch, setFilterBranch] = useState(isSuperAdmin ? "All" : String(user?.branch_id || ""));

  const fetchDependencies = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      if (filterBranch && filterBranch !== "All") params.set("branch_id", filterBranch);

      const res = await fetch(`${API_BASE}/cmdb/dependencies?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to fetch dependencies");
      setDependencies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch dependencies failed:", err);
      setDependencies([]);
    } finally {
      setLoading(false);
    }
  }, [user, role, filterBranch]);

  useEffect(() => {
    fetchDependencies();
  }, [fetchDependencies]);

  /* Group dependencies by source CI type for visual hierarchy */
  const grouped = useMemo(() => {
    const map = {};
    dependencies.forEach((dep) => {
      const key = dep.source_ci_type || "Unknown";
      if (!map[key]) map[key] = [];
      map[key].push(dep);
    });
    return map;
  }, [dependencies]);

  const getTypeIcon = (type) => {
    switch (type) {
      case "Server":             return Server;
      case "Application":        return LayoutDashboard;
      case "Network Device":     return Network;
      case "Database":           return DatabaseIcon;
      case "Storage":            return HardDrive;
      case "Middleware":         return Settings;
      case "Security Appliance": return Shield;
      case "Virtualization":     return Cpu;
      case "Workstation":        return Monitor;
      default:                   return Box;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case "Server":             return "border-l-blue-500";
      case "Application":        return "border-l-violet-500";
      case "Network Device":     return "border-l-cyan-500";
      case "Database":           return "border-l-emerald-500";
      case "Storage":            return "border-l-amber-500";
      case "Middleware":         return "border-l-slate-500";
      case "Security Appliance": return "border-l-rose-500";
      case "Virtualization":     return "border-l-indigo-500";
      default:                   return "border-l-slate-400";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 py-8 text-white shadow-[var(--astrea-hero-shadow)] lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
        <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-black sm:text-4xl">Dependency Map</h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:text-base">
              Visualize relationships and dependencies between configuration items and infrastructure components.
            </p>
            <p className="mt-4 text-sm text-cyan-100">
              {dependencies.length} relationship{dependencies.length !== 1 ? "s" : ""} mapped
            </p>
          </div>
          {isSuperAdmin && (
            <BranchSelector
              branches={branches}
              value={filterBranch}
              onChange={(val) => setFilterBranch(val)}
            />
          )}
        </div>
      </section>

      {/* Legend */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs font-black uppercase tracking-wider text-slate-500">Legend</span>
          {Object.keys(grouped).map((type) => {
            const Icon = getTypeIcon(type);
            return (
              <span key={type} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700">
                <Icon size={14} className="text-slate-500" />
                {type}
              </span>
            );
          })}
        </div>
      </section>

      {/* Dependency groups */}
      <section>
        {loading ? (
          <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading dependencies...
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
            No dependencies found.
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([sourceType, deps]) => {
              const Icon = getTypeIcon(sourceType);
              return (
                <div key={sourceType} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-xl bg-blue-50 p-2.5">
                      <Icon size={20} className="text-blue-600" />
                    </div>
                    <h2 className="text-lg font-black text-slate-900">{sourceType}</h2>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                      {deps.length} relationship{deps.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {deps.map((dep, idx) => {
                      const TargetIcon = getTypeIcon(dep.target_ci_type);
                      return (
                        <div key={`${dep.dependency_id || idx}`} className={`border-l-4 bg-slate-50 pl-4 ${getTypeColor(sourceType)} rounded-r-2xl p-4 transition hover:bg-slate-100`}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                            {/* Source */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Icon size={14} className="shrink-0 text-slate-500" />
                                <span className="text-sm font-black text-slate-900">{dep.source_ci_name || dep.source_ci_id}</span>
                              </div>
                              {dep.source_branch_name && (
                                <p className="mt-0.5 text-xs text-slate-400">{dep.source_branch_name}</p>
                              )}
                            </div>

                            {/* Arrow + Relationship */}
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="rounded-xl bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-700">
                                {dep.relationship_type || "depends_on"}
                              </span>
                              <ChevronRight size={18} className="text-slate-400" />
                            </div>

                            {/* Target */}
                            <div className="min-w-0 flex-1 sm:text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-sm font-black text-slate-900">{dep.target_ci_name || dep.target_ci_id}</span>
                                <TargetIcon size={14} className="shrink-0 text-slate-500" />
                              </div>
                              {dep.target_branch_name && (
                                <p className="mt-0.5 text-xs text-slate-400">{dep.target_branch_name}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ChangeImpactPanel — impact analysis for a selected CI
   ───────────────────────────────────────────── */
function ChangeImpactPanel({ user, role, branches }) {
  const isSuperAdmin = role === "SuperAdmin";
  const [ciList, setCiList] = useState([]);
  const [selectedCI, setSelectedCI] = useState("");
  const [impactData, setImpactData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);

  const fetchCiList = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const res = await fetch(`${API_BASE}/cmdb/config-items?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to fetch CI list");
      setCiList(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch CI list failed:", err);
      setCiList([]);
    } finally {
      setLoading(false);
    }
  }, [user, role]);

  const fetchImpactData = useCallback(async (ciId) => {
    if (!ciId) return;
    try {
      setImpactLoading(true);
      setImpactData(null);
      const params = new URLSearchParams({
        current_user_id: user?.user_id || "",
        role_name: role || "",
        branch_id: user?.branch_id || "",
      });
      const res = await fetch(`${API_BASE}/cmdb/change-impact/${ciId}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to fetch impact data");
      setImpactData(data);
    } catch (err) {
      console.error("Fetch impact data failed:", err);
      setImpactData({ error: err.message });
    } finally {
      setImpactLoading(false);
    }
  }, [user, role]);

  useEffect(() => {
    fetchCiList();
  }, [fetchCiList]);

  const handleSelectCI = (ciId) => {
    setSelectedCI(ciId);
    if (ciId) fetchImpactData(ciId);
    else setImpactData(null);
  };

  const selectedCiInfo = useMemo(() => {
    if (!selectedCI) return null;
    return ciList.find((ci) => String(ci.ci_id) === String(selectedCI)) || null;
  }, [ciList, selectedCI]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 py-8 text-white shadow-[var(--astrea-hero-shadow)] lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
        <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-black sm:text-4xl">Change Impact Analysis</h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:text-base">
              Analyze potential risks and affected components before implementing changes.
            </p>
            <p className="mt-4 text-sm text-cyan-100">
              {ciList.length} CI{ciList.length !== 1 ? "s" : ""} available for analysis
            </p>
          </div>
          <button
            onClick={() => handleSelectCI("")}
            className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-lg shadow-slate-900/10 transition hover:bg-slate-100"
          >
            <Plus size={18} />
            New Analysis
          </button>
        </div>
      </section>

      {/* Step 1: Select a CI */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">
              Select a Configuration Item to Analyze
            </label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading CIs...
              </div>
            ) : (
              <select
                value={selectedCI}
                onChange={(e) => handleSelectCI(e.target.value)}
                className="w-full max-w-lg rounded-2xl border border-[#D8E5F6] bg-white px-4 py-3 text-slate-900 outline-none transition hover:border-blue-300 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-600/15"
              >
                <option value="">-- Select a CI --</option>
                {ciList.map((ci) => (
                  <option key={ci.ci_id} value={ci.ci_id}>
                    {ci.ci_name} ({ci.ci_type}){ci.branch_name ? ` - ${ci.branch_name}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </section>

      {/* Step 2: Impact Results */}
      {selectedCI && (
        <section>
          {impactLoading ? (
            <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analyzing impact...
            </div>
          ) : impactData?.error ? (
            <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
              {impactData.error}
            </div>
          ) : impactData ? (
            <div className="space-y-5">
              {/* CI Info Header */}
              {selectedCiInfo && (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Box size={18} className="text-blue-600" />
                        <span className="text-xs font-black uppercase tracking-wider text-blue-600">
                          {selectedCiInfo.ci_type || "CI"}
                        </span>
                      </div>
                      <h2 className="mt-1 text-2xl font-black text-slate-900">{selectedCiInfo.ci_name || "Unnamed"}</h2>
                      <p className="mt-1 text-sm text-slate-500">ID: {selectedCiInfo.ci_id}</p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        {selectedCiInfo.branch_name && (
                          <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                            <Building2 size={12} />
                            {selectedCiInfo.branch_name}
                          </span>
                        )}
                        {selectedCiInfo.environment && (
                          <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${getEnvironmentClasses(selectedCiInfo.environment)}`}>
                            <Globe size={12} />
                            {selectedCiInfo.environment}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${getStatusClasses(selectedCiInfo.status)}`}>
                          {selectedCiInfo.status}
                        </span>
                      </div>
                    </div>

                    {/* Risk + Impact Score */}
                    <div className="flex flex-col items-end gap-2">
                      {impactData.risk_level && (
                        <span className={`rounded-full px-4 py-2 text-sm font-black ${getRiskClasses(impactData.risk_level)}`}>
                          {impactData.risk_level} Risk
                        </span>
                      )}
                      {impactData.impact_score !== undefined && impactData.impact_score !== null && (
                        <div className="text-right">
                          <span className="text-3xl font-black text-slate-900">{impactData.impact_score}</span>
                          <span className="ml-1 text-sm font-bold text-slate-500">Impact Score</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-2">
                {/* Affected CIs (downstream) */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <AlertTriangle size={18} className="text-rose-600" />
                    <h3 className="text-base font-black text-slate-900">Affected CIs (Downstream)</h3>
                  </div>
                  {impactData.affected_cis && impactData.affected_cis.length > 0 ? (
                    <div className="space-y-2">
                      {impactData.affected_cis.map((ci, idx) => (
                        <div key={idx} className="flex items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-3">
                          <Box size={16} className="shrink-0 text-rose-600" />
                          <div>
                            <p className="text-sm font-bold text-slate-900">{ci.ci_name || ci.name || ci}</p>
                            {ci.ci_type && <p className="text-xs text-slate-500">{ci.ci_type}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No downstream CIs affected.</p>
                  )}
                </div>

                {/* Upstream Dependencies */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <Link size={18} className="text-blue-600" />
                    <h3 className="text-base font-black text-slate-900">Upstream Dependencies</h3>
                  </div>
                  {impactData.upstream_dependencies && impactData.upstream_dependencies.length > 0 ? (
                    <div className="space-y-2">
                      {impactData.upstream_dependencies.map((dep, idx) => (
                        <div key={idx} className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                          <Link size={16} className="shrink-0 text-blue-600" />
                          <div>
                            <p className="text-sm font-bold text-slate-900">{dep.ci_name || dep.name || dep}</p>
                            {dep.ci_type && <p className="text-xs text-slate-500">{dep.ci_type}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No upstream dependencies found.</p>
                  )}
                </div>
              </div>

              {/* Dependent Applications & Related Branches */}
              <div className="grid gap-5 lg:grid-cols-3">
                {/* Dependent Applications */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <LayoutDashboard size={18} className="text-violet-600" />
                    <h3 className="text-sm font-black text-slate-900">Dependent Applications</h3>
                  </div>
                  <p className="text-3xl font-black text-slate-900">
                    {impactData.dependent_applications?.length ?? 0}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">applications</p>
                </div>

                {/* Related Branches */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Building2 size={18} className="text-cyan-600" />
                    <h3 className="text-sm font-black text-slate-900">Related Branches</h3>
                  </div>
                  {impactData.related_branches && impactData.related_branches.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {impactData.related_branches.map((branch, idx) => (
                        <span key={idx} className="rounded-xl bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-700">
                          {branch.name || branch.branch_name || branch}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No related branches.</p>
                  )}
                </div>

                {/* Recommended Action */}
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Shield size={18} className="text-emerald-600" />
                    <h3 className="text-sm font-black text-slate-900">Recommended Action</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-700">
                    {impactData.recommended_action || impactData.recommendation || "No specific recommendation available."}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main CMDB export
   ───────────────────────────────────────────── */
export default function CMDB({ initialTab = "config-items" }) {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role || "";
  const isSuperAdmin = activeRole === "SuperAdmin";
  const currentBranchId = user?.branch_id || null;

  const [activeTab, setActiveTab] = useState(initialTab);
  const [branches, setBranches] = useState([]);

  const tabs = [
    { id: "config-items",  label: "Config Items",       icon: Box },
    { id: "dependency-map", label: "Dependency Map",     icon: GitBranch },
    { id: "change-impact",  label: "Change Impact",      icon: Activity },
  ];

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`);
      const data = await res.json();
      if (res.ok) setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch branches failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const visibleBranches = useMemo(() => {
    if (isSuperAdmin) return branches;
    return branches.filter((b) => Number(b.branch_id) === Number(currentBranchId));
  }, [branches, currentBranchId, isSuperAdmin]);

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <section className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-black transition ${
                isActive
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          );
        })}
      </section>

      {/* Active Panel */}
      {activeTab === "config-items" && (
        <ConfigItemsPanel user={user} role={activeRole} branches={visibleBranches} />
      )}
      {activeTab === "dependency-map" && (
        <DependencyGraphView user={user} role={activeRole} branches={visibleBranches} />
      )}
      {activeTab === "change-impact" && (
        <ChangeImpactPanel user={user} role={activeRole} branches={visibleBranches} />
      )}
    </div>
  );
}
