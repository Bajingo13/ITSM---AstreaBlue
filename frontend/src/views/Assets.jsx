import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Building2,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Eye,
  Filter,
  FolderOpen,
  Grid3X3,
  History,
  List,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  User,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { API_URL } from "../config/api";

import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1`;
const EMPTY_DETAIL_VALUE = "-";
const BASE_ASSET_TYPES = [
  "Laptop",
  "Desktop",
  "Monitor",
  "Printer",
  "Phone",
  "Tablet",
  "Router",
];
const ASSET_TYPES = ["All", ...BASE_ASSET_TYPES, "Other"];
const STATUS_OPTIONS = [
  "All",
  "Available",
  "In Use",
  "Maintenance",
  "Active",
  "In Stock",
  "Borrowed",
  "In Repair",
  "Retired",
  "Disposed",
  "Lost/Damaged",
];
const MODAL_ASSET_TYPE_OPTIONS = [
  ...BASE_ASSET_TYPES.map((type) => ({ label: type, value: type })),
  { label: "other", value: "Other" },
];
const MODAL_STATUS_OPTIONS = [
  { label: "available", value: "Available" },
  { label: "in use", value: "In Use" },
  { label: "maintenance", value: "Maintenance" },
  { label: "active", value: "Active" },
  { label: "in repair", value: "In Repair" },
  { label: "in stock", value: "In Stock" },
  { label: "retired", value: "Retired" },
  { label: "disposed", value: "Disposed" },
  { label: "borrowed", value: "Borrowed" },
  { label: "lost / damaged", value: "Lost/Damaged" },
];
const ACTION_MODES = {
  borrow: { label: "Mark as Borrowed", status: "Borrowed", icon: User },
  return: { label: "Mark as Returned", status: "Active", icon: ShieldCheck },
  repair: { label: "Send to Repair", status: "In Repair", icon: Truck },
  retire: { label: "Retire Asset", status: "Retired", icon: AlertTriangle },
  dispose: { label: "Dispose Asset", status: "Disposed", icon: Box },
};
const SORT_OPTIONS = [
  { value: "latest", label: "Latest Hardware Assets" },
  { value: "oldest", label: "Oldest Hardware Assets" },
  { value: "updated", label: "Recently Updated" },
  { value: "alphabetical", label: "Alphabetical (A-Z)" },
];
const STATUS_FILTER_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Borrowed", label: "Borrowed" },
  { value: "In Repair", label: "Under Repair" },
  { value: "Retired", label: "Retired" },
  { value: "Disposed", label: "Disposed" },
];
const QUICK_FILTER_OPTIONS = [
  { value: "inStock", label: "In Stock Only" },
  { value: "assigned", label: "Assigned Only" },
  { value: "unassigned", label: "Unassigned Only" },
];
const BRANCH_CARD_GAP = 16;

function getBranchCode(branchName) {
  if (!branchName) return "UNK";
  const lower = branchName.toLowerCase();
  if (lower.includes("manila")) return "MNL";
  if (lower.includes("cebu")) return "CEB";
  if (lower.includes("clark")) return "CLA";
  if (lower.includes("davao")) return "DVO";
  if (lower.includes("iloilo")) return "ILO";
  const words = branchName.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map((word) => word[0]).join("").toUpperCase().slice(0, 3);
  }
  return branchName.slice(0, 3).toUpperCase();
}

function getStatusClasses(status) {
  switch (status) {
    case "Available":
      return "bg-emerald-50 text-emerald-700";
    case "In Use":
      return "bg-blue-50 text-blue-700";
    case "Maintenance":
      return "bg-orange-50 text-orange-700";
    case "Lost":
    case "Damaged":
    case "Lost/Damaged":
      return "bg-red-50 text-red-700";
    case "Active":
      return "bg-emerald-50 text-emerald-700";
    case "In Stock":
      return "bg-sky-50 text-sky-700";
    case "Borrowed":
      return "bg-violet-50 text-violet-700";
    case "In Repair":
      return "bg-amber-50 text-amber-700";
    case "Retired":
      return "bg-slate-100 text-slate-700";
    case "Disposed":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function isMissingAssetValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function formatDetailDate(value) {
  if (isMissingAssetValue(value)) return EMPTY_DETAIL_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatDetailDateTime(value) {
  if (isMissingAssetValue(value)) return EMPTY_DETAIL_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getNestedAssetValue(source, path) {
  return String(path)
    .split(".")
    .reduce((current, key) => {
      if (current === null || current === undefined) return undefined;
      return current[key];
    }, source);
}

function firstAssetValue(source, paths) {
  for (const path of paths) {
    const value = typeof path === "function" ? path(source) : getNestedAssetValue(source, path);
    if (!isMissingAssetValue(value)) return value;
  }
  return null;
}

function joinAssetValues(values, separator = " / ") {
  const presentValues = values
    .filter((value) => !isMissingAssetValue(value))
    .map((value) => String(value).trim());
  return presentValues.length ? presentValues.join(separator) : null;
}

function formatAssetDetailValue(value, formatter) {
  const nextValue = formatter && !isMissingAssetValue(value) ? formatter(value) : value;

  if (isMissingAssetValue(nextValue)) return EMPTY_DETAIL_VALUE;
  if (typeof nextValue === "boolean") return nextValue ? "Yes" : "No";
  if (Array.isArray(nextValue)) {
    const values = nextValue
      .map((item) => formatAssetDetailValue(item))
      .filter((item) => item !== EMPTY_DETAIL_VALUE);
    return values.length ? values.join(", ") : EMPTY_DETAIL_VALUE;
  }
  if (typeof nextValue === "object") {
    const namedValue = firstAssetValue(nextValue, [
      "name",
      "file_name",
      "full_name",
      "branch_name",
      "supplier_name",
      "label",
      "title",
    ]);
    return isMissingAssetValue(namedValue) ? JSON.stringify(nextValue) : String(namedValue);
  }

  return String(nextValue);
}

function assetDetailItem(label, asset, paths, formatter) {
  return {
    label,
    value: formatAssetDetailValue(firstAssetValue(asset, Array.isArray(paths) ? paths : [paths]), formatter),
  };
}

function toggleArrayValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function getAssignedAssetValue(asset) {
  return String(asset.assigned_name || asset.borrower_name || "").trim();
}

function getSortTimestamp(asset, key) {
  const value = asset[key];
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function getSortOptionLabel(value) {
  return SORT_OPTIONS.find((option) => option.value === value)?.label || SORT_OPTIONS[0].label;
}

function getStatusFilterLabel(value) {
  return STATUS_FILTER_OPTIONS.find((option) => option.value === value)?.label || value;
}

function getQuickFilterLabel(value) {
  return QUICK_FILTER_OPTIONS.find((option) => option.value === value)?.label || value;
}

function buildFilterSummary({
  sortMode,
  sortTouched,
  statusFilters,
  quickFilters,
  conditionFilters,
  typeFilter,
  manufacturerFilter,
  departmentFilter,
  assignedFilter,
}) {
  const chips = [
    ...statusFilters.map(getStatusFilterLabel),
    ...quickFilters.map(getQuickFilterLabel),
    ...conditionFilters,
  ];

  if (typeFilter !== "All") chips.push(typeFilter);
  if (manufacturerFilter !== "All") chips.push(manufacturerFilter);
  if (departmentFilter !== "All") chips.push(departmentFilter);
  if (assignedFilter !== "All") chips.push(assignedFilter);

  if (chips.length > 0) {
    return chips.length <= 2 ? chips.join(" + ") : `${chips.slice(0, 2).join(" + ")} +${chips.length - 2}`;
  }

  return sortTouched ? getSortOptionLabel(sortMode) : "Sort & Filter";
}

function normalizeAssetType(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function getKnownAssetType(value, knownTypes = ASSET_TYPES) {
  const normalized = normalizeAssetType(value);
  return knownTypes.find((type) => type.toLowerCase() === normalized.toLowerCase()) || normalized;
}

function getModalAssetTypeState(assetType) {
  const normalized = normalizeAssetType(assetType);
  if (!normalized) {
    return { assetType: "Laptop", customAssetType: "" };
  }
  if (normalized.toLowerCase() === "other") {
    return { assetType: "Other", customAssetType: "" };
  }

  const baseType = getKnownAssetType(normalized, BASE_ASSET_TYPES);
  if (BASE_ASSET_TYPES.includes(baseType)) {
    return { assetType: baseType, customAssetType: "" };
  }

  return { assetType: "Other", customAssetType: normalized };
}

function getAssetFormInitialState(asset, currentBranchId) {
  const assetTypeState = getModalAssetTypeState(asset?.asset_type);

  return {
    asset_name: asset?.asset_name || "",
    asset_type: assetTypeState.assetType,
    custom_asset_type: assetTypeState.customAssetType,
    manufacturer: asset?.manufacturer || asset?.brand || "",
    brand: asset?.brand || asset?.manufacturer || "",
    model: asset?.model || "",
    serial_number: asset?.serial_number || "",
    asset_tag: asset?.asset_tag || "",
    branch_id: asset?.branch_id ? String(asset.branch_id) : String(currentBranchId || ""),
    status: asset?.status || "Active",
    color: asset?.color || "",
    purchase_date: formatDateInput(asset?.purchase_date),
    purchase_price: asset?.purchase_price ?? "",
    supplier: asset?.supplier || "",
    assigned_name: asset?.assigned_name || asset?.borrower_name || "",
    returned_name: asset?.returned_name || "",
    warranty: formatDateInput(asset?.warranty_expiration || asset?.warranty),
    condition_notes: asset?.condition_notes || asset?.notes || "",
    team_department: asset?.team_department || asset?.department || "",
    assigned_date: formatDateInput(asset?.assigned_date || asset?.borrow_date),
    returned_date: formatDateInput(asset?.returned_date || asset?.actual_return_date),
    accessories: asset?.accessories || "",
    processor: asset?.processor || "",
    ram: asset?.ram || "",
    storage: asset?.storage || "",
    signature_link: asset?.signature_link || "",
    returned_name_forms: asset?.returned_name_forms || "",
    attachments: Array.isArray(asset?.attachments) ? asset.attachments : [],
    image_url: asset?.image_url || "",
    location: asset?.location || "",
    department: asset?.department || "",
    warranty_expiration: formatDateInput(asset?.warranty_expiration),
    borrower_name: asset?.borrower_name || "",
    borrower_email: asset?.borrower_email || "",
    employee_id: asset?.employee_id || "",
    borrower_department: asset?.borrower_department || "",
    borrow_date: formatDateInput(asset?.borrow_date),
    expected_return_date: formatDateInput(asset?.expected_return_date),
    actual_return_date: formatDateInput(asset?.actual_return_date),
    condition_before: asset?.condition_before || "",
    condition_after: asset?.condition_after || "",
    notes: asset?.notes || "",
  };
}

/* ─────────────────────────────────────────────
   SearchableBranchDropdown — compact branch filter
   ───────────────────────────────────────────── */
function SearchableBranchDropdown({ branches = [], value, onChange }) {
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
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
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

function FilterPanelSection({ title, children }) {
  return (
    <div className="border-b border-slate-100 px-4 py-4 last:border-b-0">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function FilterChip({ selected, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[11px] border px-3 py-2 text-xs font-black transition ${
        selected
          ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-600/10"
          : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700"
      }`}
    >
      {children}
    </button>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[11px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none transition hover:border-blue-200 hover:bg-blue-50/40 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortFilterDropdown({
  buttonLabel,
  sortMode,
  onSortChange,
  statusFilters,
  onStatusToggle,
  quickFilters,
  onQuickToggle,
  conditionFilters,
  conditionOptions,
  onConditionToggle,
  typeFilter,
  assetTypeOptions,
  onTypeChange,
  manufacturerFilter,
  manufacturerOptions,
  onManufacturerChange,
  departmentFilter,
  departmentOptions,
  onDepartmentChange,
  assignedFilter,
  assignedOptions,
  onAssignedChange,
  onClear,
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectOptions = (items) => items.map((item) => ({ label: item, value: item }));

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black shadow-sm transition ${
          open
            ? "border-blue-300 bg-blue-50 text-blue-700 ring-4 ring-blue-600/10"
            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700"
        }`}
      >
        <Filter size={16} />
        <span className="max-w-[230px] truncate">{buttonLabel}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      <div
        className={`absolute right-0 top-full z-40 mt-2 w-[min(92vw,440px)] origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/12 transition-all duration-150 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0 pointer-events-none"
        }`}
      >
        <FilterPanelSection title="Sorting">
          <div className="space-y-1">
            {SORT_OPTIONS.map((option) => {
              const selected = sortMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSortChange(option.value)}
                  className={`flex w-full items-center justify-between rounded-[11px] px-3 py-2.5 text-left text-sm font-bold transition ${
                    selected ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-blue-50/60 hover:text-blue-700"
                  }`}
                >
                  <span>{option.label}</span>
                  {selected && <CheckCircle size={16} className="text-blue-600" />}
                </button>
              );
            })}
          </div>
        </FilterPanelSection>

        <FilterPanelSection title="Status Filter">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTER_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                selected={statusFilters.includes(option.value)}
                onClick={() => onStatusToggle(option.value)}
              >
                {option.label}
              </FilterChip>
            ))}
          </div>
        </FilterPanelSection>

        <FilterPanelSection title="Quick Filter Toggles">
          <div className="flex flex-wrap gap-2">
            {QUICK_FILTER_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                selected={quickFilters.includes(option.value)}
                onClick={() => onQuickToggle(option.value)}
              >
                {option.label}
              </FilterChip>
            ))}
          </div>

          {conditionOptions.filter((item) => item !== "All").length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Condition</p>
              <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                {conditionOptions.filter((item) => item !== "All").map((condition) => (
                  <FilterChip
                    key={condition}
                    selected={conditionFilters.includes(condition)}
                    onClick={() => onConditionToggle(condition)}
                  >
                    {condition}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}
        </FilterPanelSection>

        <FilterPanelSection title="More Filters">
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterSelect
              label="Type"
              value={typeFilter}
              options={selectOptions(assetTypeOptions)}
              onChange={onTypeChange}
            />
            <FilterSelect
              label="Brand"
              value={manufacturerFilter}
              options={selectOptions(manufacturerOptions)}
              onChange={onManufacturerChange}
            />
            <FilterSelect
              label="Department"
              value={departmentFilter}
              options={selectOptions(departmentOptions)}
              onChange={onDepartmentChange}
            />
            <FilterSelect
              label="Assigned"
              value={assignedFilter}
              options={selectOptions(assignedOptions)}
              onChange={onAssignedChange}
            />
          </div>
        </FilterPanelSection>

        <FilterPanelSection title="Reset Action">
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] border border-rose-200 bg-white px-4 py-2.5 text-sm font-black text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
          >
            <X size={16} />
            Clear All Filters
          </button>
        </FilterPanelSection>
      </div>
    </div>
  );
}
export default function Assets() {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role || "";
  const isSuperAdmin = activeRole === "SuperAdmin";
  const currentBranchId = user?.branch_id || null;

  const [branches, setBranches] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilters, setStatusFilters] = useState([]);
  const [manufacturerFilter, setManufacturerFilter] = useState("All");
  const [conditionFilters, setConditionFilters] = useState([]);
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [assignedFilter, setAssignedFilter] = useState("All");
  const [quickFilters, setQuickFilters] = useState([]);
  const [sortMode, setSortMode] = useState("latest");
  const [sortTouched, setSortTouched] = useState(false);
  const [branchFilter, setBranchFilter] = useState(isSuperAdmin ? "All" : String(currentBranchId || ""));
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [actionMode, setActionMode] = useState("");
  const [actionAsset, setActionAsset] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("hardwareAssetsView") || "grid");
  const [viewingAsset, setViewingAsset] = useState(null);
  const [historyAsset, setHistoryAsset] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState(null);
  const [toast, setToast] = useState(null); // { message, type } where type is "success" | "error"
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem("hardwareAssetsView", mode);
  };

  const openHistory = async (asset) => {
    try {
      setHistoryAsset(asset);
      setHistoryLoading(true);
      const res = await fetch(`${API_BASE}/hardware-assets/${asset.asset_id}/history`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load asset history");
      setHistoryRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch asset history failed:", err);
      setHistoryRecords([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`);
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch branches failed:", err);
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      setLoading(true);
      const query = buildTicketQuery(user, {});
      const res = await fetch(`${API_BASE}/hardware-assets${query}`);
      const data = await res.json();
      setAssets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch hardware assets failed:", err);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin]);



  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const visibleBranches = useMemo(() => {
    if (isSuperAdmin) return branches;
    return branches.filter((branch) => Number(branch.branch_id) === Number(currentBranchId));
  }, [branches, currentBranchId, isSuperAdmin]);
  const openAddAsset = () => {
    setEditingAsset(null);
    setShowAssetModal(true);
    setModalError("");
  };

  // ── Combined frontend filtering ──────────────────────────
  const visibleAssets = useMemo(() => {
    const filtered = assets.filter((asset) => {
      // Branch filter
      if (isSuperAdmin && branchFilter && branchFilter !== "All") {
        if (String(asset.branch_id) !== String(branchFilter)) return false;
      }
      // Status filter
      if (statusFilters.length > 0) {
        if (!statusFilters.includes(asset.status)) return false;
      }
      // Type filter
      if (typeFilter && typeFilter !== "All") {
        if (asset.asset_type !== typeFilter) return false;
      }
      // Manufacturer filter
      if (manufacturerFilter && manufacturerFilter !== "All") {
        if ((asset.brand || "") !== manufacturerFilter) return false;
      }
      // Condition filter
      if (conditionFilters.length > 0) {
        const cond = asset.condition_after || asset.condition_before || "";
        if (!conditionFilters.includes(cond)) return false;
      }
      // Department filter
      if (departmentFilter && departmentFilter !== "All") {
        const dept = asset.department || asset.team_department || asset.borrower_department || "";
        if (dept !== departmentFilter) return false;
      }
      if (assignedFilter && assignedFilter !== "All") {
        const assigned = getAssignedAssetValue(asset);
        if (assigned !== assignedFilter) return false;
      }
      if (quickFilters.includes("inStock") && asset.status !== "In Stock") {
        return false;
      }
      if (quickFilters.includes("assigned") && !getAssignedAssetValue(asset)) {
        return false;
      }
      if (quickFilters.includes("unassigned") && getAssignedAssetValue(asset)) {
        return false;
      }
      // Search filter
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const fields = [
          asset.asset_tag,
          asset.asset_name,
          asset.asset_type,
          `${asset.brand || ""} ${asset.model || ""}`,
          asset.serial_number,
          asset.borrower_name,
          asset.borrower_department,
          asset.team_department,
          asset.department,
          asset.branch_name,
          asset.status,
        ];
        if (!fields.some((f) => f && f.toLowerCase().includes(q))) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      if (sortMode === "oldest") {
        return getSortTimestamp(a, "created_at") - getSortTimestamp(b, "created_at");
      }
      if (sortMode === "updated") {
        return getSortTimestamp(b, "updated_at") - getSortTimestamp(a, "updated_at");
      }
      if (sortMode === "alphabetical") {
        const aName = (a.asset_name || `${a.brand || ""} ${a.model || ""}`.trim() || a.asset_tag || "").toLowerCase();
        const bName = (b.asset_name || `${b.brand || ""} ${b.model || ""}`.trim() || b.asset_tag || "").toLowerCase();
        return aName.localeCompare(bName);
      }
      return getSortTimestamp(b, "created_at") - getSortTimestamp(a, "created_at");
    });
    return filtered;
  }, [
    assets,
    branchFilter,
    isSuperAdmin,
    statusFilters,
    typeFilter,
    manufacturerFilter,
    conditionFilters,
    departmentFilter,
    assignedFilter,
    quickFilters,
    search,
    sortMode,
  ]);

  const branchMetrics = useMemo(() => {
    return visibleBranches.map((branch) => {
      const branchAssets = assets.filter((asset) => Number(asset.branch_id) === Number(branch.branch_id));
      const activeCount = branchAssets.filter((asset) => asset.status === "Active").length;
      const borrowedCount = branchAssets.filter((asset) => asset.status === "Borrowed").length;
      return {
        ...branch,
        branch_code: getBranchCode(branch.branch_name),
        total: branchAssets.length,
        active: activeCount,
        borrowed: borrowedCount,
      };
    });
  }, [assets, visibleBranches]);

  const totalAssets = visibleAssets.length;
  const totalActive = visibleAssets.filter((asset) => asset.status === "Active").length;
  const totalBorrowed = visibleAssets.filter((asset) => asset.status === "Borrowed").length;

  const verifiedAssets = visibleAssets.filter(a => a.monitoring_device_id && a.agent_serial_number && String(a.serial_number).trim().toLowerCase() === String(a.agent_serial_number).trim().toLowerCase()).length;
  const mismatchedAssets = visibleAssets.filter(a => a.monitoring_device_id && a.agent_serial_number && String(a.serial_number).trim().toLowerCase() !== String(a.agent_serial_number).trim().toLowerCase()).length;
  const pendingAssets = visibleAssets.filter(a => a.monitoring_device_id && !a.agent_serial_number).length;
  const offlineDevices = visibleAssets.filter(a => a.monitoring_device_id && a.monitoring_status === "Offline").length;

  /* Branch carousel scroll state */
  const carouselRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const getCarouselMeasurements = useCallback((el) => {
    const card = el.querySelector(".branch-card");
    if (!card) return null;

    const cardWidth = card.offsetWidth;
    const slideBy = Math.max(1, Math.floor((el.clientWidth + BRANCH_CARD_GAP) / (cardWidth + BRANCH_CARD_GAP)));
    const pageWidth = slideBy * (cardWidth + BRANCH_CARD_GAP);

    return { slideBy, pageWidth };
  }, []);

  const getCarouselPageOffset = useCallback((el, page, pageWidth) => {
    const maxScroll = Math.max(el.scrollWidth - el.clientWidth, 0);
    return Math.min(page * pageWidth, maxScroll);
  }, []);

  const updateCarouselState = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;

    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);

    const measurements = getCarouselMeasurements(el);
    if (!measurements) {
      setCurrentPage(0);
      setTotalPages(1);
      return;
    }

    const pages = Math.ceil(branchMetrics.length / measurements.slideBy) || 1;
    setTotalPages(pages);

    const pageOffsets = Array.from({ length: pages }, (_, index) =>
      getCarouselPageOffset(el, index, measurements.pageWidth)
    );
    const page = pageOffsets.reduce((closestIndex, offset, index) => {
      const closestDistance = Math.abs(el.scrollLeft - pageOffsets[closestIndex]);
      const distance = Math.abs(el.scrollLeft - offset);
      return distance < closestDistance ? index : closestIndex;
    }, 0);
    setCurrentPage(page);
  }, [branchMetrics.length, getCarouselMeasurements, getCarouselPageOffset]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateCarouselState);
    return () => window.cancelAnimationFrame(frame);
  }, [branchMetrics, updateCarouselState]);

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    const handler = () => updateCarouselState();
    el.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    return () => {
      el.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [updateCarouselState]);

  const scrollCarousel = (direction) => {
    const el = carouselRef.current;
    if (!el) return;
    const measurements = getCarouselMeasurements(el);
    if (!measurements) return;
    const amount = measurements.pageWidth * (direction === "prev" ? -1 : 1);
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  const scrollCarouselToPage = (page) => {
    const el = carouselRef.current;
    if (!el) return;
    const measurements = getCarouselMeasurements(el);
    if (!measurements) return;
    el.scrollTo({
      left: getCarouselPageOffset(el, page, measurements.pageWidth),
      behavior: "smooth",
    });
  };

  const statusMetrics = useMemo(
    () =>
      STATUS_OPTIONS.filter((item) => item !== "All").map((status) => ({
        status,
        count: visibleAssets.filter((asset) => asset.status === status).length,
      })),
    [visibleAssets]
  );

  const manufacturers = useMemo(() => {
    const list = assets.reduce((acc, asset) => {
      if (asset.brand) acc.add(asset.brand);
      return acc;
    }, new Set());
    return ["All", ...Array.from(list).sort()];
  }, [assets]);

  const conditionOptions = useMemo(() => {
    const set = new Set();
    assets.forEach((a) => {
      const c = a.condition_after || a.condition_before;
      if (c) set.add(c);
    });
    return ["All", ...Array.from(set).sort()];
  }, [assets]);

  const departmentOptions = useMemo(() => {
    const set = new Set();
    assets.forEach((a) => {
      const d = a.department || a.team_department || a.borrower_department;
      if (d) set.add(d);
    });
    return ["All", ...Array.from(set).sort()];
  }, [assets]);

  const assignedOptions = useMemo(() => {
    const set = new Set();
    assets.forEach((asset) => {
      const assigned = asset.assigned_name || asset.borrower_name;
      if (assigned) set.add(assigned);
    });
    return ["All", ...Array.from(set).sort()];
  }, [assets]);

  // ── Clear all filters ────────────────────────────────────
  const assetTypeFilterOptions = useMemo(() => {
    const customTypes = new Map();

    assets.forEach((asset) => {
      const normalized = normalizeAssetType(asset.asset_type);
      if (!normalized) return;

      const knownType = getKnownAssetType(normalized, BASE_ASSET_TYPES);
      if (BASE_ASSET_TYPES.includes(knownType) || knownType.toLowerCase() === "other") return;

      const key = knownType.toLowerCase();
      if (!customTypes.has(key)) {
        customTypes.set(key, knownType);
      }
    });

    return [
      "All",
      ...BASE_ASSET_TYPES,
      ...Array.from(customTypes.values()).sort((a, b) => a.localeCompare(b)),
      "Other",
    ];
  }, [assets]);

  const sortFilterButtonLabel = useMemo(
    () =>
      buildFilterSummary({
        sortMode,
        sortTouched,
        statusFilters,
        quickFilters,
        conditionFilters,
        typeFilter,
        manufacturerFilter,
        departmentFilter,
        assignedFilter,
      }),
    [
      sortMode,
      sortTouched,
      statusFilters,
      quickFilters,
      conditionFilters,
      typeFilter,
      manufacturerFilter,
      departmentFilter,
      assignedFilter,
    ]
  );

  const toggleQuickFilter = (value) => {
    setQuickFilters((prev) => {
      const next = toggleArrayValue(prev, value);
      if (value === "assigned" && next.includes("assigned")) {
        return next.filter((item) => item !== "unassigned");
      }
      if (value === "unassigned" && next.includes("unassigned")) {
        return next.filter((item) => item !== "assigned");
      }
      return next;
    });
  };

  const clearFilters = () => {
    setBranchFilter(isSuperAdmin ? "All" : String(currentBranchId || ""));
    setStatusFilters([]);
    setTypeFilter("All");
    setManufacturerFilter("All");
    setConditionFilters([]);
    setDepartmentFilter("All");
    setAssignedFilter("All");
    setQuickFilters([]);
    setSearch("");
    setSortMode("latest");
    setSortTouched(false);
  };


  const openEditAsset = (asset) => {
    setEditingAsset(asset);
    setShowAssetModal(true);
    setModalError("");
  };

  const closeAssetModal = () => {
    setEditingAsset(null);
    setShowAssetModal(false);
    setModalError("");
  };

  const handleSaveAsset = async (payload, assetId) => {
    try {
      setSaving(true);
      setModalError("");
      const assetType = getKnownAssetType(payload.asset_type, assetTypeFilterOptions);
      const body = buildTicketPayload(user, { ...payload, asset_type: assetType });

      const res = await fetch(
        assetId ? `${API_BASE}/hardware-assets/${assetId}` : `${API_BASE}/hardware-assets`,
        {
          method: assetId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || data.message || "Unable to save asset");
      }

      await fetchAssets();
      closeAssetModal();
    } catch (err) {
      console.error("Save hardware asset failed:", err);
      setModalError(err.message || "Unable to save asset");
    } finally {
      setSaving(false);
    }
  };


  const openAction = (asset, mode) => {
    setActionAsset(asset);
    setActionMode(mode);
    setModalError("");
  };

  const closeAction = () => {
    setActionAsset(null);
    setActionMode("");
    setModalError("");
  };

  const handleActionSubmit = async (payload) => {
    if (!actionAsset || !actionMode) return;
    try {
      setSaving(true);
      const body = { ...payload, ...buildTicketPayload(user) };
      const res = await fetch(`${API_BASE}/hardware-assets/${actionAsset.asset_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorBody = await res.json();
        throw new Error(errorBody.error || "Unable to update asset status");
      }
      await fetchAssets();
      closeAction();
    } catch (err) {
      console.error(err);
      setModalError(err.message);
    } finally {
      setSaving(false);
    }
  };


  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleDelete = async () => {
    if (!deletingAsset) return;
    try {
      const res = await fetch(`${API_BASE}/hardware-assets/${deletingAsset.asset_id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to delete hardware asset");
      }
      setDeletingAsset(null);
      showToast("Hardware asset deleted successfully.", "success");
      await fetchAssets();
    } catch (err) {
      console.error("Delete hardware asset failed:", err);
      setDeletingAsset(null);
      showToast(err.message || "Failed to delete hardware asset. Please try again.", "error");
    } finally {
      setDeleteConfirmed(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteConfirmed(true);
    // Small delay so the button visually transitions before deletion proceeds
    setTimeout(() => handleDelete(), 200);
  };

  /* ── Export ───────────────────────────────────── */
  const handleExport = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({ t: Date.now() });
      if (exportDateFrom) params.set("start_date", exportDateFrom);
      if (exportDateTo) params.set("end_date", exportDateTo);

      const res = await fetch(`${API_BASE}/hardware-assets/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token") || ""}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        alert(err.message || err.error || "No hardware assets found for the selected date range.");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : "hardware-assets-export.xlsx";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export hardware assets. Please try again.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="space-y-6">
      <section className="astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 py-8 text-white shadow-[var(--astrea-hero-shadow)] lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
        <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-black sm:text-4xl">Hardware Assets</h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:text-base">
              Track company laptops, desktops, printers, phones and hardware by branch with status monitoring, borrower history, and lifecycle controls.
            </p>
            <p className="mt-4 text-sm text-cyan-100">
              {totalAssets} total assets · {totalActive} active · {totalBorrowed} borrowed
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={openAddAsset}
              className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-900 shadow-lg shadow-slate-900/10 transition hover:bg-slate-100"
            >
              <Plus size={18} />
              Add Asset
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-black text-white shadow-sm backdrop-blur-sm transition hover:bg-white/20"
            >
              <Download size={18} />
              Export
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Verified Assets</p>
          <p className="mt-3 text-2xl font-black text-emerald-600">{verifiedAssets}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Mismatched Assets</p>
          <p className="mt-3 text-2xl font-black text-rose-600">{mismatchedAssets}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Pending Verification</p>
          <p className="mt-3 text-2xl font-black text-amber-600">{pendingAssets}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Offline Devices</p>
          <p className="mt-3 text-2xl font-black text-slate-900">{offlineDevices}</p>
        </div>
      </section>

      {/* Branch Filter — compact searchable dropdown */}
      {isSuperAdmin && (
        <section className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2">
              <Building2 size={18} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">Branch Summary</h2>
              <p className="text-xs text-slate-500">
                {branchFilter === "All"
                  ? `${visibleBranches.length} branch${visibleBranches.length === 1 ? "" : "es"}`
                  : `${branches.find((b) => String(b.branch_id) === String(branchFilter))?.branch_name || "Branch"}`}
              </p>
            </div>
          </div>
          <SearchableBranchDropdown
            branches={visibleBranches}
            value={branchFilter}
            onChange={(val) => setBranchFilter(val)}
          />
        </section>
      )}

      {/* Branch Summary Carousel */}
      <section>
        <div className="relative px-10 sm:px-14">
          {/* Left arrow */}
          <button
            type="button"
            onClick={() => scrollCarousel("prev")}
            disabled={!canScrollLeft}
            className={`absolute left-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg transition sm:flex ${
              canScrollLeft
                ? "hover:-translate-x-0.5 hover:bg-slate-50 hover:text-blue-700 hover:shadow-xl"
                : "cursor-default text-slate-300 opacity-40"
            }`}
            aria-label="Previous branches"
          >
            <ChevronLeft size={20} />
          </button>

          <div
            ref={carouselRef}
            className="astrea-no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-1"
          >
            {branchMetrics.length === 0 ? (
              <div className="flex w-full items-center justify-center rounded-3xl border border-slate-200 bg-white py-12 text-sm text-slate-400 shadow-sm">
                No branches available.
              </div>
            ) : (
              branchMetrics.map((branch) => {
                const isSelected = String(branch.branch_id) === branchFilter;
                return (
                  <button
                    key={branch.branch_id}
                    type="button"
                    onClick={() => setBranchFilter(isSelected ? "All" : String(branch.branch_id))}
                    className={`branch-card w-[85vw] shrink-0 snap-start rounded-3xl border p-4 text-left shadow-sm transition-all hover:shadow-md sm:w-[300px] lg:w-[340px] xl:w-[360px] ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="rounded-2xl bg-white p-2 shadow-sm">
                        <FolderOpen size={22} className="text-blue-600" />
                      </div>
                      <span className="rounded-2xl bg-slate-900 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                        {branch.branch_code}
                      </span>
                    </div>
                    <div className="mt-3">
                      <h3 className="text-base font-black text-slate-900">{branch.branch_name}</h3>
                      <p className="mt-1 text-sm text-slate-500">{branch.branch_location || "Branch"}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-2 text-center">
                        <p className="text-2xl font-black text-slate-900">{branch.total}</p>
                        <p className="w-full truncate text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">Total</p>
                      </div>
                      <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-2 text-center">
                        <p className="text-2xl font-black text-emerald-600">{branch.active}</p>
                        <p className="w-full truncate text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">Active</p>
                      </div>
                      <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-2 text-center">
                        <p className="text-2xl font-black text-violet-600">{branch.borrowed}</p>
                        <p className="w-full truncate text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">Borrowed</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right arrow */}
          <button
            type="button"
            onClick={() => scrollCarousel("next")}
            disabled={!canScrollRight}
            className={`absolute right-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg transition sm:flex ${
              canScrollRight
                ? "hover:translate-x-0.5 hover:bg-slate-50 hover:text-blue-700 hover:shadow-xl"
                : "cursor-default text-slate-300 opacity-40"
            }`}
            aria-label="Next branches"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Pagination dots */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollCarouselToPage(i)}
                className={`block h-2 rounded-full transition-all ${
                  i === currentPage
                    ? "w-6 bg-blue-600"
                    : "w-2 bg-slate-300 hover:bg-slate-400"
                }`}
                aria-label={`Go to branch slide ${i + 1}`}
                aria-current={i === currentPage ? "true" : undefined}
              />
            ))}
          </div>
        )}
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-4 md:grid-cols-3">
          {statusMetrics.map((item) => {
            const isActive = statusFilters.includes(item.status);
            return (
              <button
                key={item.status}
                type="button"
                onClick={() => setStatusFilters((prev) => toggleArrayValue(prev, item.status))}
                className={`rounded-3xl border p-5 text-left shadow-sm transition hover:shadow-md ${isActive ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 bg-white"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-sm font-black uppercase tracking-[0.18em] ${isActive ? "text-blue-700" : "text-slate-500"}`}>{item.status}</span>
                  <div className={`rounded-2xl px-3 py-1 text-xs font-black ${getStatusClasses(item.status)}`}>
                    {item.count}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Filter size={20} className="text-slate-500" />
            <div>
              <p className="text-sm font-black text-slate-900">Branch Status Summary</p>
              <p className="text-sm text-slate-500">Review current hardware status for each branch at a glance.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex min-w-[180px] flex-1 items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
        <SortFilterDropdown
          buttonLabel={sortFilterButtonLabel}
          sortMode={sortMode}
          onSortChange={(value) => {
            setSortMode(value);
            setSortTouched(true);
          }}
          statusFilters={statusFilters}
          onStatusToggle={(value) => setStatusFilters((prev) => toggleArrayValue(prev, value))}
          quickFilters={quickFilters}
          onQuickToggle={toggleQuickFilter}
          conditionFilters={conditionFilters}
          conditionOptions={conditionOptions}
          onConditionToggle={(value) => setConditionFilters((prev) => toggleArrayValue(prev, value))}
          typeFilter={typeFilter}
          assetTypeOptions={assetTypeFilterOptions}
          onTypeChange={setTypeFilter}
          manufacturerFilter={manufacturerFilter}
          manufacturerOptions={manufacturers}
          onManufacturerChange={setManufacturerFilter}
          departmentFilter={departmentFilter}
          departmentOptions={departmentOptions}
          onDepartmentChange={setDepartmentFilter}
          assignedFilter={assignedFilter}
          assignedOptions={assignedOptions}
          onAssignedChange={setAssignedFilter}
          onClear={clearFilters}
        />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-bold text-slate-500">
          Showing {visibleAssets.length} hardware asset{visibleAssets.length === 1 ? "" : "s"}
        </p>
        <div className="inline-flex w-fit rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" onClick={() => changeViewMode("grid")} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${viewMode === "grid" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            <Grid3X3 size={16} /> Grid
          </button>
          <button type="button" onClick={() => changeViewMode("table")} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${viewMode === "table" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            <List size={16} /> Table
          </button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <section>
          {loading ? (
            <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading assets...
            </div>
          ) : visibleAssets.length === 0 ? (
            <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-400 shadow-sm">No hardware assets found.</div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleAssets.map((asset) => (
                <AssetCard
                  key={asset.asset_id}
                  asset={asset}
                  onView={() => setViewingAsset(asset)}
                  onEdit={() => openEditAsset(asset)}
                  onHistory={() => openHistory(asset)}
                  onDelete={() => setDeletingAsset(asset)}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
      <section className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Asset Tag</th>
              <th className="px-4 py-3">Asset Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Brand / Model</th>
              <th className="px-4 py-3">Serial Number</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Purchase Date</th>
              <th className="px-4 py-3">Warranty</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Borrowed By</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Borrow Date</th>
              <th className="px-4 py-3">Expected Return</th>
              <th className="px-4 py-3">Condition</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="16" className="px-4 py-12 text-center text-slate-400">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading assets...
                  </div>
                </td>
              </tr>
            ) : visibleAssets.length === 0 ? (
              <tr>
                <td colSpan="16" className="px-4 py-12 text-center text-slate-400">
                  No hardware assets found.
                </td>
              </tr>
            ) : (
              visibleAssets.map((asset) => (
                <tr key={asset.asset_id} className="border-t border-slate-200">
                  <td className="px-4 py-4 font-bold text-slate-900">{asset.asset_tag || "—"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.asset_name}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.asset_type}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.brand || "—"} / {asset.model || "—"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.serial_number}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.branch_name}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.location || asset.department || asset.team_department || "—"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(asset.purchase_date)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(asset.warranty_expiration || asset.warranty)}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${getStatusClasses(asset.status)}`}>
                      {asset.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.borrower_name || "—"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.borrower_department || "—"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(asset.borrow_date)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{formatDate(asset.expected_return_date)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{asset.condition_after || asset.condition_before || "—"}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setViewingAsset(asset)}
                        className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => openEditAsset(asset)}
                        className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => openHistory(asset)}
                        className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-100"
                      >
                        History
                      </button>
                      {asset.status !== "Borrowed" && (
                        <button
                          onClick={() => openAction(asset, "borrow")}
                          className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-100"
                        >
                          Borrow
                        </button>
                      )}
                      {asset.status === "Borrowed" && (
                        <button
                          onClick={() => openAction(asset, "return")}
                          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"
                        >
                          Return
                        </button>
                      )}
                      <button
                        onClick={() => openAction(asset, "repair")}
                        className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100"
                      >
                        Repair
                      </button>
                      <button
                        onClick={() => openAction(asset, "retire")}
                        className="rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200"
                      >
                        Retire
                      </button>
                      <button
                        onClick={() => openAction(asset, "dispose")}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100"
                      >
                        Dispose
                      </button>
                      {(activeRole === "SuperAdmin" || activeRole === "Admin") && (
                        <button
                          onClick={() => setDeletingAsset(asset)}
                          className="inline-flex items-center gap-1 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      )}
      {showAssetModal && (
        <AssetFormModal
          asset={editingAsset}
          branches={visibleBranches}
          isSuperAdmin={isSuperAdmin}
          currentBranchId={currentBranchId}
          selectedBranch={branchFilter}
          onClose={closeAssetModal}
          onSave={handleSaveAsset}
          loading={saving}
          error={modalError}
        />
      )}

      {actionAsset && actionMode && (
        <AssetActionModal
          asset={actionAsset}
          mode={actionMode}
          onClose={closeAction}
          onSubmit={handleActionSubmit}
          loading={saving}
          error={modalError}
        />
      )}
      {viewingAsset && <AssetDetailsModal asset={viewingAsset} onClose={() => setViewingAsset(null)} />}
      {historyAsset && (
        <AssetHistoryModal asset={historyAsset} records={historyRecords} loading={historyLoading} onClose={() => setHistoryAsset(null)} />
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-black text-slate-900">Export Hardware Assets</h2>
              <p className="mt-1 text-sm text-slate-500">
                Select a date range for the export.
              </p>
            </div>
            <div className="space-y-5 px-6 py-6">
              <label className="block space-y-1.5">
                <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">From Date</span>
                <input
                  type="date"
                  value={exportDateFrom}
                  onChange={(e) => setExportDateFrom(e.target.value)}
                  className="w-full rounded-2xl border border-[#D8E5F6] bg-white px-4 py-3 text-sm text-slate-900 outline-none transition hover:border-blue-300 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-600/15"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">To Date</span>
                <input
                  type="date"
                  value={exportDateTo}
                  onChange={(e) => setExportDateTo(e.target.value)}
                  className="w-full rounded-2xl border border-[#D8E5F6] bg-white px-4 py-3 text-sm text-slate-900 outline-none transition hover:border-blue-300 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-600/15"
                />
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => { setShowExportModal(false); setExportDateFrom(""); setExportDateTo(""); }}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exporting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Export Excel
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-black text-slate-900">Delete Hardware Asset</h2>
              <p className="mt-1 text-sm text-slate-500">
                Are you sure you want to delete this hardware asset? This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-600">
                <span className="font-bold">Asset:</span> {deletingAsset.asset_name || `${deletingAsset.brand || ""} ${deletingAsset.model || ""}`.trim() || "Unknown"}
              </p>
              {deletingAsset.serial_number && (
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-bold">Serial:</span> {deletingAsset.serial_number}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => { setDeletingAsset(null); setDeleteConfirmed(false); }}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={deleteConfirmed}
                className={`inline-flex items-center gap-2 rounded-2xl border px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
                  deleteConfirmed
                    ? "border-red-600 bg-red-600 text-white hover:bg-red-700 hover:border-red-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Trash2 size={16} className={`transition-all duration-200 ${deleteConfirmed ? "text-white" : "text-slate-400"}`} />
                {deleteConfirmed ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 rounded-2xl px-5 py-3 shadow-2xl transition-all ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle size={18} />
          ) : (
            <AlertTriangle size={18} />
          )}
          <span className="text-sm font-bold">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 rounded-full p-0.5 hover:bg-white/20">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset, onView, onEdit, onHistory, onDelete }) {
  const { role } = useAuth();
  const activeRole = role || "Employee";
  const canDelete = activeRole === "SuperAdmin" || activeRole === "Admin";
  const location = asset.location || asset.branch_name || asset.department || asset.team_department || "Unassigned";
  const assignedTo = asset.assigned_name || asset.borrower_name || "Unassigned";

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex h-44 max-h-[180px] items-center justify-center overflow-hidden bg-slate-100 p-4">
        {asset.image_url ? (
          <img src={asset.image_url} alt={asset.asset_name || asset.model} className="h-full w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400"><Box size={36} /><span className="text-sm font-bold">No Image</span></div>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-blue-600">{asset.asset_type || "Hardware"}</p>
            <h3 className="mt-1 truncate text-lg font-black text-slate-900">{asset.asset_name || `${asset.brand || ""} ${asset.model || ""}`.trim()}</h3>
            <p className="mt-1 truncate text-sm text-slate-500">{asset.serial_number || "No serial number"}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getStatusClasses(asset.status)}`}>{asset.status}</span>
        </div>
        <div className="mt-4 space-y-2 text-sm text-slate-600">
          <p><span className="font-bold text-slate-800">Location:</span> {location}</p>
          <p><span className="font-bold text-slate-800">Assigned:</span> {assignedTo}</p>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2 border-t border-slate-100 pt-4">
          <button onClick={onView} className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100"><Eye size={14} /> View</button>
          <button onClick={onEdit} className="inline-flex items-center justify-center gap-1 rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"><Pencil size={14} /> Edit</button>
          <button onClick={onHistory} className="inline-flex items-center justify-center gap-1 rounded-xl bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-100"><History size={14} /> History</button>
          {canDelete && (
            <button onClick={onDelete} className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"><Trash2 size={14} /> Delete</button>
          )}
        </div>
      </div>
    </article>
  );
}


function AssetDetailsModal({ asset, onClose }) {
  const [hardware, setHardware] = useState(null);
  
  useEffect(() => {
    if (asset?.asset_id) {
      fetch(`${API_URL}/api/v1/laptop-monitoring/hardware-inventory-by-asset/${asset.asset_id}`, { headers: authHeaders() })
        .then(r => r.json())
        .then(d => { if (d.success) setHardware(d.data); })
        .catch(console.error);
    }
  }, [asset?.asset_id]);

  const assetName = formatAssetDetailValue(firstAssetValue(asset, [
    "asset_name",
    (item) => joinAssetValues([
      firstAssetValue(item, ["manufacturer", "brand", "manufacturer.name", "brand.name"]),
      firstAssetValue(item, ["model", "model_name", "model.name"]),
    ], " "),
    "asset_tag",
  ]));
  const brandModel = formatAssetDetailValue(joinAssetValues([
    firstAssetValue(asset, ["brand", "manufacturer", "brand.name", "manufacturer.name"]),
    firstAssetValue(asset, ["model", "model_name", "model.name"]),
  ]));

  const detailSections = [
    {
      title: "Basic Information",
      items: [
        assetDetailItem("Asset Tag", asset, ["asset_tag"]),
        { label: "Asset Name", value: assetName },
        assetDetailItem("Serial Number", asset, ["serial_number"]),
        assetDetailItem("Asset Type", asset, ["asset_type"]),
        { label: "Brand / Model", value: brandModel },
        assetDetailItem("Manufacturer", asset, ["manufacturer", "brand", "manufacturer.name", "brand.name"]),
        assetDetailItem("Branch", asset, ["branch_name", "branch.branch_name", "branch.name"]),
        assetDetailItem("Location", asset, [
          "location",
          "branch_location",
          "branch.branch_location",
          "branch.location",
          "department",
          "team_department",
        ]),
      ],
    },
    {
      title: "Assignment Information",
      items: [
        assetDetailItem("Assigned Name", asset, ["assigned_name", "borrower_name"]),
        assetDetailItem("Borrowed By", asset, ["borrower_name", "assigned_name"]),
        assetDetailItem("Borrower Email", asset, ["borrower_email"]),
        assetDetailItem("Employee ID", asset, ["employee_id"]),
        assetDetailItem("Department", asset, ["borrower_department", "team_department", "department"]),
        assetDetailItem("Assigned Date", asset, ["assigned_date", "borrow_date"], formatDetailDate),
        assetDetailItem("Borrow Date", asset, ["borrow_date", "assigned_date"], formatDetailDate),
        assetDetailItem("Expected Return Date", asset, ["expected_return_date"], formatDetailDate),
        assetDetailItem("Returned Name", asset, ["returned_name", "returned_name_forms"]),
        assetDetailItem("Returned Name (Forms)", asset, ["returned_name_forms", "returned_name"]),
        assetDetailItem("Returned Date", asset, ["returned_date", "actual_return_date"], formatDetailDate),
        assetDetailItem("Actual Return Date", asset, ["actual_return_date", "returned_date"], formatDetailDate),
      ],
    },
    {
      title: "Purchase Information",
      items: [
        assetDetailItem("Purchase Date", asset, ["purchase_date"], formatDetailDate),
        assetDetailItem("Purchase Price", asset, ["purchase_price"]),
        assetDetailItem("Supplier", asset, ["supplier", "supplier.name", "supplier.supplier_name"]),
        assetDetailItem("Warranty", asset, ["warranty_expiration", "warranty"], formatDetailDate),
      ],
    },
    {
      title: "Technical Specifications",
      items: [
        assetDetailItem("Processor", asset, ["processor"]),
        assetDetailItem("RAM", asset, ["ram"]),
        assetDetailItem("Storage", asset, ["storage"]),
        assetDetailItem("Accessories", asset, ["accessories"]),
        assetDetailItem("Signature Link", asset, ["signature_link"]),
        assetDetailItem("Attachments", asset, ["attachments"]),
      ],
    },
    {
      title: "Status & Condition",
      items: [
        assetDetailItem("Status", asset, ["status"]),
        assetDetailItem("Condition Notes", asset, ["condition_notes", "notes"]),
        assetDetailItem("Condition Before", asset, ["condition_before"]),
        assetDetailItem("Condition After", asset, ["condition_after"]),
        assetDetailItem("Notes", asset, ["notes", "condition_notes"]),
        assetDetailItem("Created At", asset, ["created_at"], formatDetailDateTime),
        assetDetailItem("Updated At", asset, ["updated_at"], formatDetailDateTime),
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-6">
          <div>
            <h2 className="text-xl font-black text-slate-900">Asset Details</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">{assetName}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          <div className="mb-6 flex aspect-[16/7] items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
            {asset.image_url ? (
              <img
                src={asset.image_url}
                alt={assetName === EMPTY_DETAIL_VALUE ? "Asset photo" : assetName}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="font-bold text-slate-400">No Image</span>
            )}
          </div>
          <div className="space-y-6">
            {detailSections.map((section) => (
              <AssetDetailSection key={section.title} title={section.title} items={section.items} />
            ))}

            {hardware && (
              <section className="mt-8 rounded-3xl border border-blue-200 bg-blue-50/50 p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-black uppercase tracking-[0.16em] text-blue-800">Agent-Detected Hardware</h3>
                {String(asset.serial_number||'').trim().toLowerCase() !== String(hardware.serial_number||'').trim().toLowerCase() && (
                  <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <p className="text-sm font-black text-rose-700 uppercase tracking-wide">Action Recommended</p>
                    <p className="mt-1 text-sm font-semibold text-rose-900">Serial number mismatch. Verify whether the physical device was replaced.</p>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <p className="text-xs font-bold text-slate-500">Serial Number</p>
                    <p className="text-sm font-semibold text-slate-900">
                      Asset: {asset.serial_number || 'N/A'}<br/>
                      Agent: {hardware.serial_number}
                    </p>
                    <p className={`text-xs mt-1 font-bold ${String(asset.serial_number||'').trim().toLowerCase() === String(hardware.serial_number||'').trim().toLowerCase() ? 'text-emerald-600' : 'text-rose-600'}`}>
                      <span className="mr-1">●</span>
                      {String(asset.serial_number||'').trim().toLowerCase() === String(hardware.serial_number||'').trim().toLowerCase() ? 'Match' : 'Mismatch'}
                    </p>
                  </div>
                  <div><p className="text-xs font-bold text-slate-500">Processor</p><p className="text-sm font-semibold text-slate-900">{hardware.cpu_name}</p></div>
                  <div><p className="text-xs font-bold text-slate-500">Memory (RAM)</p><p className="text-sm font-semibold text-slate-900">{hardware.total_ram_gb} GB</p></div>
                  <div><p className="text-xs font-bold text-slate-500">Operating System</p><p className="text-sm font-semibold text-slate-900">{hardware.os_name} {hardware.os_version}</p></div>
                  <div><p className="text-xs font-bold text-slate-500">IP / MAC Address</p><p className="text-sm font-semibold text-slate-900">{hardware.ip_address} <br/> {hardware.mac_address}</p></div>
                  <div><p className="text-xs font-bold text-slate-500">Last Scan</p><p className="text-sm font-semibold text-slate-900">{new Date(hardware.scanned_at).toLocaleString()}</p></div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetDetailSection({ title, items }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-black uppercase tracking-[0.16em] text-slate-500">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-400">{item.label}</p>
            <p className="mt-1 whitespace-pre-wrap break-words font-bold text-slate-800">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LegacyAssetDetailsModal({ asset, onClose }) {
  const details = [
    ["Asset Tag", asset.asset_tag], ["Type", asset.asset_type], ["Brand / Model", `${asset.brand || "—"} / ${asset.model || "—"}`],
    ["Serial Number", asset.serial_number], ["Status", asset.status], ["Branch", asset.branch_name],
    ["Location", asset.location || asset.department || asset.team_department], ["Assigned To", asset.assigned_name || asset.borrower_name],
    ["Purchase Date", formatDate(asset.purchase_date)], ["Warranty", formatDate(asset.warranty_expiration || asset.warranty)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-6"><h2 className="text-xl font-black text-slate-900">Asset Details</h2><button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
        <div className="p-6">
          <div className="mb-6 flex aspect-[16/7] items-center justify-center overflow-hidden rounded-2xl bg-slate-100">{asset.image_url ? <img src={asset.image_url} alt={asset.asset_name} className="h-full w-full object-contain" /> : <span className="font-bold text-slate-400">No Image</span>}</div>
          <h3 className="text-2xl font-black text-slate-900">{asset.asset_name}</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 font-bold text-slate-800">{value || "—"}</p></div>)}</div>
        </div>
      </div>
    </div>
  );
}

function AssetHistoryModal({ asset, records, loading, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-6"><div><h2 className="text-xl font-black text-slate-900">Asset History</h2><p className="text-sm text-slate-500">{asset.asset_name}</p></div><button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
        <div className="space-y-3 p-6">{loading ? <p className="text-slate-500">Loading history...</p> : records.length === 0 ? <p className="text-slate-500">No history records found.</p> : records.map((record) => <div key={record.history_id} className="rounded-2xl border border-slate-200 p-4"><div className="flex justify-between gap-4"><p className="font-black text-slate-900">{record.event_type}</p><p className="text-xs text-slate-500">{new Date(record.created_at).toLocaleString()}</p></div>{record.event_data && <p className="mt-2 text-sm text-slate-600">{Object.entries(record.event_data).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>}</div>)}</div>
      </div>
    </div>
  );
}

function AssetFormModal({ asset, currentBranchId, onClose, onSave, loading, error, branches = [], isSuperAdmin = false, selectedBranch = "All" }) {
  const effectiveBranchId = !isSuperAdmin
    ? String(currentBranchId || "")
    : selectedBranch && selectedBranch !== "All"
      ? String(selectedBranch)
      : "";
  const [form, setForm] = useState(() => getAssetFormInitialState(asset, effectiveBranchId));
  const [localError, setLocalError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    const initBranch = !isSuperAdmin
      ? String(currentBranchId || "")
      : selectedBranch && selectedBranch !== "All"
        ? String(selectedBranch)
        : (form?.branch_id || "");
    setForm(getAssetFormInitialState(asset, initBranch));
    setLocalError("");
    setFieldErrors({});
  }, [asset, currentBranchId, isSuperAdmin, selectedBranch]);


  const updateField = (key, value) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "asset_type" && value !== "Other" ? { custom_asset_type: "" } : {}),
    }));
    if (localError) setLocalError("");
    if (fieldErrors[key] || (key === "asset_type" && fieldErrors.custom_asset_type)) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        if (key === "asset_type") delete next.custom_asset_type;
        return next;
      });
    }
  };

  const handleImageChange = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLocalError("Asset photo must be an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLocalError("Asset photo must be 2 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => updateField("image_url", String(reader.result || ""));
    reader.onerror = () => setLocalError("Unable to preview the selected image.");
    reader.readAsDataURL(file);
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const requiredFields = [
      ["asset_tag", "Asset Tag"],
      ["status", "Status"],
      ["manufacturer", "Manufacturer"],
      ["model", "Model"],
      ["asset_type", "Asset Type"],
      ["serial_number", "Serial Number"],
    ];
    if (isSuperAdmin && selectedBranch === "All") {
      requiredFields.push(["branch_id", "Branch"]);
    }
    const nextFieldErrors = requiredFields.reduce((acc, [key, label]) => {
      if (!String(form[key] || "").trim()) {
        acc[key] = `${label} is required.`;
      }
      return acc;
    }, {});
    const effectiveAssetType =
      form.asset_type === "Other" ? normalizeAssetType(form.custom_asset_type) : normalizeAssetType(form.asset_type);

    if (form.asset_type === "Other") {
      if (!effectiveAssetType) {
        nextFieldErrors.custom_asset_type = "Specify Other Asset Type is required.";
      } else if (effectiveAssetType.toLowerCase() === "other") {
        nextFieldErrors.custom_asset_type = "Enter the actual asset type.";
      }
    }

    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setLocalError("Please complete the required fields.");
      return;
    }

    const manufacturer = form.manufacturer.trim();
    const model = form.model.trim();
    const attachments = form.attachments.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    }));

    onSave(
      {
        ...form,
        asset_name: `${manufacturer} ${model}`.trim() || form.asset_tag,
        asset_type: effectiveAssetType,
        custom_asset_type: undefined,
        brand: manufacturer,
        manufacturer,
        model,
        warranty_expiration: form.warranty || null,
        department: form.team_department || null,
        borrower_name: form.assigned_name || null,
        borrow_date: form.assigned_date || null,
        actual_return_date: form.returned_date || null,
        notes: form.condition_notes || null,
        attachments,
      },
      asset?.asset_id
    );
  };

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">{asset ? "Edit Asset" : "Add Asset"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Capture hardware asset details, assignment information, specifications, and attachments.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close asset modal"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
            {displayError && (
              <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {displayError}
              </div>
            )}

            <div className="mb-6 grid gap-4 rounded-3xl border border-[#D8E5F6] bg-blue-50/30 p-5 sm:grid-cols-[180px_1fr] sm:items-center">
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-[#D8E5F6] bg-white">
                {form.image_url ? <img src={form.image_url} alt="Asset preview" className="h-full w-full object-cover" /> : <span className="text-sm font-bold text-slate-400">No Image</span>}
              </div>
              <div>
                <p className="text-sm font-black text-slate-800">Asset Image / Photo</p>
                <p className="mt-1 text-xs text-slate-500">PNG, JPG, or WEBP up to 2 MB. A preview appears before saving.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-700">
                    Choose Image
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => handleImageChange(event.target.files?.[0])} />
                  </label>
                  {form.image_url && <button type="button" onClick={() => updateField("image_url", "")} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-100">Remove</button>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
              <AssetField label="Asset Tag" required error={fieldErrors.asset_tag}>
                <AssetInput
                  value={form.asset_tag}
                  onChange={(value) => updateField("asset_tag", value)}
                  placeholder="AST-..."
                  required
                />
              </AssetField>
              <AssetField label="Status" required error={fieldErrors.status}>
                <AssetSelect
                  value={form.status}
                  onChange={(value) => updateField("status", value)}
                  options={MODAL_STATUS_OPTIONS}
                  required
                />
              </AssetField>
              <AssetField label="Manufacturer" required error={fieldErrors.manufacturer}>
                <AssetInput
                  value={form.manufacturer}
                  onChange={(value) => updateField("manufacturer", value)}
                  placeholder="Dell, Apple, Lenovo..."
                  required
                />
              </AssetField>
              <AssetField label="Model" required error={fieldErrors.model}>
                <AssetInput
                  value={form.model}
                  onChange={(value) => updateField("model", value)}
                  placeholder="Model name..."
                  required
                />
              </AssetField>
              <AssetField label="Asset Type" required error={fieldErrors.asset_type}>
                <AssetSelect
                  value={form.asset_type}
                  onChange={(value) => updateField("asset_type", value)}
                  options={MODAL_ASSET_TYPE_OPTIONS}
                  required
                />
              </AssetField>
              {form.asset_type === "Other" && (
                <AssetField label="Specify Other Asset Type" required error={fieldErrors.custom_asset_type}>
                  <AssetInput
                    value={form.custom_asset_type}
                    onChange={(value) => updateField("custom_asset_type", value)}
                    placeholder="Router"
                    required
                  />
                </AssetField>
              )}
              <AssetField label="Serial Number" required error={fieldErrors.serial_number}>
                <AssetInput
                  value={form.serial_number}
                  onChange={(value) => updateField("serial_number", value)}
                  placeholder="SN..."
                  required
                />
              </AssetField>
              {isSuperAdmin && selectedBranch === "All" ? (
                <AssetField label="Branch" required error={fieldErrors.branch_id}>
                  <AssetSelect
                    value={form.branch_id}
                    onChange={(value) => updateField("branch_id", value)}
                    options={branches.map((b) => ({ label: b.branch_name, value: String(b.branch_id) }))}
                    placeholder="Select a branch"
                    required
                  />
                </AssetField>
              ) : (
                <input type="hidden" name="branch_id" value={form.branch_id} />
              )}
              <AssetField label="Color">
                <AssetInput
                  value={form.color}
                  onChange={(value) => updateField("color", value)}
                  placeholder="Black, silver, etc."
                />
              </AssetField>
              <AssetField label="Purchase Date">
                <AssetInput
                  type="date"
                  value={form.purchase_date}
                  onChange={(value) => updateField("purchase_date", value)}
                />
              </AssetField>
              <AssetField label="Purchase Price">
                <AssetInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.purchase_price}
                  onChange={(value) => updateField("purchase_price", value)}
                  placeholder="0.00"
                />
              </AssetField>
              <AssetField label="Supplier">
                <AssetInput
                  value={form.supplier}
                  onChange={(value) => updateField("supplier", value)}
                  placeholder="Supplier name..."
                />
              </AssetField>
              <AssetField label="Assigned Name">
                <AssetInput
                  value={form.assigned_name}
                  onChange={(value) => updateField("assigned_name", value)}
                  placeholder="Enter a name or email"
                />
              </AssetField>
              <AssetField label="Returned Name">
                <AssetInput
                  value={form.returned_name}
                  onChange={(value) => updateField("returned_name", value)}
                  placeholder="Enter a name or email"
                />
              </AssetField>
              <AssetField label="Warranty">
                <AssetInput
                  type="date"
                  value={form.warranty}
                  onChange={(value) => updateField("warranty", value)}
                />
              </AssetField>
              <AssetField label="Team Department">
                <AssetInput
                  value={form.team_department}
                  onChange={(value) => updateField("team_department", value)}
                  placeholder="IT, HR, Finance..."
                />
              </AssetField>
              <AssetField label="Assigned Date">
                <AssetInput
                  type="date"
                  value={form.assigned_date}
                  onChange={(value) => updateField("assigned_date", value)}
                />
              </AssetField>
              <AssetField label="Returned Date">
                <AssetInput
                  type="date"
                  value={form.returned_date}
                  onChange={(value) => updateField("returned_date", value)}
                />
              </AssetField>
              <AssetField label="Accessories">
                <AssetInput
                  value={form.accessories}
                  onChange={(value) => updateField("accessories", value)}
                  placeholder="Charger, bag, mouse..."
                />
              </AssetField>
              <AssetField label="Processor">
                <AssetInput
                  value={form.processor}
                  onChange={(value) => updateField("processor", value)}
                  placeholder="Intel i7, M3, Ryzen..."
                />
              </AssetField>
              <AssetField label="RAM">
                <AssetInput
                  value={form.ram}
                  onChange={(value) => updateField("ram", value)}
                  placeholder="16GB"
                />
              </AssetField>
              <AssetField label="Storage">
                <AssetInput
                  value={form.storage}
                  onChange={(value) => updateField("storage", value)}
                  placeholder="512GB SSD"
                />
              </AssetField>
              <AssetField label="Signature Link">
                <AssetInput
                  type="url"
                  value={form.signature_link}
                  onChange={(value) => updateField("signature_link", value)}
                  placeholder="https://..."
                />
              </AssetField>
              <AssetField label="Returned Name (Forms)">
                <AssetInput
                  value={form.returned_name_forms}
                  onChange={(value) => updateField("returned_name_forms", value)}
                  placeholder="Enter a name or email"
                />
              </AssetField>
              <AssetField label="Condition Notes" className="md:col-span-2">
                <textarea
                  value={form.condition_notes}
                  onChange={(event) => updateField("condition_notes", event.target.value)}
                  rows={4}
                  placeholder="Condition, issues, or handoff notes..."
                  className={assetInputClass}
                />
              </AssetField>
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
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-3 font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!loading && !asset && <Plus size={18} />}
              {loading ? "Saving..." : asset ? "Save Changes" : "Add Asset"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const assetInputClass =
  "w-full rounded-2xl border border-[#D8E5F6] bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-blue-300 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-600/15 disabled:bg-slate-100 disabled:text-slate-500";

function AssetField({ label, required = false, className = "", error = "", children }) {
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

function AssetInput({ value, onChange, type = "text", ...props }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      className={assetInputClass}
      {...props}
    />
  );
}

function AssetSelect({ value, onChange, options, placeholder, ...props }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={assetInputClass}
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

function AssetActionModal({ asset, mode, onClose, onSubmit, loading, error }) {
  const [form, setForm] = useState({
    status: ACTION_MODES[mode]?.status || "Active",
    borrower_name: asset.borrower_name || "",
    employee_id: asset.employee_id || "",
    borrower_department: asset.borrower_department || "",
    borrow_date: asset.borrow_date || "",
    expected_return_date: asset.expected_return_date || "",
    actual_return_date: asset.actual_return_date || "",
    condition_before: asset.condition_before || "",
    condition_after: asset.condition_after || "",
    notes: "",
  });
  const [returnStatus, setReturnStatus] = useState("Active");

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    const payload = { ...form };
    if (mode === "return") {
      payload.status = returnStatus;
    }
    if (mode === "borrow") {
      payload.status = "Borrowed";
    }
    if (mode === "repair") payload.status = "In Repair";
    if (mode === "retire") payload.status = "Retired";
    if (mode === "dispose") payload.status = "Disposed";
    onSubmit(payload);
  };

  const modeLabel = ACTION_MODES[mode]?.label || "Update Asset";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <div className="w-full max-w-2xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">{modeLabel}</h2>
            <p className="mt-1 text-sm text-slate-500">Update status and borrower details for {asset.asset_name}.</p>
          </div>
          <button onClick={onClose} className="rounded-2xl bg-slate-100 px-4 py-2 text-slate-600 hover:bg-slate-200">
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {mode === "borrow" && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Borrower Name
                  <input
                    value={form.borrower_name}
                    onChange={(e) => updateField("borrower_name", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Employee ID
                  <input
                    value={form.employee_id}
                    onChange={(e) => updateField("employee_id", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Department
                  <input
                    value={form.borrower_department}
                    onChange={(e) => updateField("borrower_department", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Borrow Date
                  <input
                    type="date"
                    value={form.borrow_date}
                    onChange={(e) => updateField("borrow_date", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Expected Return Date
                  <input
                    type="date"
                    value={form.expected_return_date}
                    onChange={(e) => updateField("expected_return_date", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Condition Before Borrowing
                  <textarea
                    rows={2}
                    value={form.condition_before}
                    onChange={(e) => updateField("condition_before", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                  />
                </label>
              </div>
            </>
          )}

          {mode === "return" && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Returned Status
                  <select
                    value={returnStatus}
                    onChange={(e) => setReturnStatus(e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                  >
                    <option value="Active">Active</option>
                    <option value="In Stock">In Stock</option>
                  </select>
                </label>
                <label className="block space-y-2 text-sm font-semibold text-slate-700">
                  Actual Return Date
                  <input
                    type="date"
                    value={form.actual_return_date}
                    onChange={(e) => updateField("actual_return_date", e.target.value)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                    required
                  />
                </label>
              </div>
              <label className="block space-y-2 text-sm font-semibold text-slate-700">
                Condition After Returning
                <textarea
                  rows={3}
                  value={form.condition_after}
                  onChange={(e) => updateField("condition_after", e.target.value)}
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                  required
                />
              </label>
            </>
          )}

          {mode === "repair" && (
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Repair Notes
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
          )}

          {mode === "retire" && (
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Retirement Notes
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
          )}

          {mode === "dispose" && (
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Disposal Notes
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
          )}

          {error && <div className="rounded-3xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-3xl border border-slate-200 bg-slate-100 px-6 py-3 font-black text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-3xl bg-blue-600 px-6 py-3 font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : modeLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
