import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  Download,
  Eye,
  Filter,
  FolderOpen,
  Loader2,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Truck,
  User,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import { API_URL } from "../config/api";

const API_BASE = `${API_URL}/api/v1`;
const ASSET_TYPES = [
  "All",
  "Laptop",
  "Desktop",
  "Monitor",
  "Printer",
  "Phone",
  "Tablet",
  "Router",
  "Keyboard",
  "Mouse",
  "Other",
];
const STATUS_OPTIONS = [
  "All",
  "Active",
  "In Stock",
  "Borrowed",
  "In Repair",
  "Retired",
  "Disposed",
];
const MODAL_ASSET_TYPE_OPTIONS = [
  { label: "laptop", value: "Laptop" },
  { label: "desktop", value: "Desktop" },
  { label: "monitor", value: "Monitor" },
  { label: "printer", value: "Printer" },
  { label: "phone", value: "Phone" },
  { label: "tablet", value: "Tablet" },
  { label: "other", value: "Other" },
];
const MODAL_STATUS_OPTIONS = [
  { label: "active", value: "Active" },
  { label: "in repair", value: "In Repair" },
  { label: "in stock", value: "In Stock" },
  { label: "retired", value: "Retired" },
  { label: "disposed", value: "Disposed" },
  { label: "borrowed", value: "Borrowed" },
];
const ACTION_MODES = {
  borrow: { label: "Mark as Borrowed", status: "Borrowed", icon: User },
  return: { label: "Mark as Returned", status: "Active", icon: ShieldCheck },
  repair: { label: "Send to Repair", status: "In Repair", icon: Truck },
  retire: { label: "Retire Asset", status: "Retired", icon: AlertTriangle },
  dispose: { label: "Dispose Asset", status: "Disposed", icon: Box },
};

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

function getAssetFormInitialState(asset, currentBranchId) {
  return {
    asset_name: asset?.asset_name || "",
    asset_type: asset?.asset_type || "Laptop",
    manufacturer: asset?.manufacturer || asset?.brand || "",
    brand: asset?.brand || asset?.manufacturer || "",
    model: asset?.model || "",
    serial_number: asset?.serial_number || "",
    asset_tag: asset?.asset_tag || "",
    branch_id: asset?.branch_id ? String(asset.branch_id) : String(currentBranchId || ""),
    status: asset?.status || "Active",
    color: asset?.color || "",
    purchase_date: formatDateInput(asset?.purchase_date),
    purchase_price: asset?.purchase_price || "",
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
    attachments: [],
    attachment_names: Array.isArray(asset?.attachments)
      ? asset.attachments.map((item) => item?.name || item).filter(Boolean)
      : [],
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
  const [statusFilter, setStatusFilter] = useState("All");
  const [manufacturerFilter, setManufacturerFilter] = useState("All");
  const [conditionFilter, setConditionFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [sortLatest, setSortLatest] = useState(false);
  const [branchFilter, setBranchFilter] = useState(isSuperAdmin ? "All" : String(currentBranchId || ""));
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [actionMode, setActionMode] = useState("");
  const [actionAsset, setActionAsset] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

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
      if (statusFilter && statusFilter !== "All") {
        if (asset.status !== statusFilter) return false;
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
      if (conditionFilter && conditionFilter !== "All") {
        const cond = asset.condition_after || asset.condition_before || "";
        if (cond !== conditionFilter) return false;
      }
      // Department filter
      if (departmentFilter && departmentFilter !== "All") {
        const dept = asset.department || asset.team_department || asset.borrower_department || "";
        if (dept !== departmentFilter) return false;
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
    if (sortLatest) {
      filtered.sort((a, b) => {
        const da = new Date(a.created_at || 0).getTime();
        const db = new Date(b.created_at || 0).getTime();
        return db - da;
      });
    }
    return filtered;
  }, [assets, branchFilter, isSuperAdmin, statusFilter, typeFilter, manufacturerFilter, conditionFilter, departmentFilter, search, sortLatest]);

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

  // ── Clear all filters ────────────────────────────────────
  const clearFilters = () => {
    setBranchFilter(isSuperAdmin ? "All" : String(currentBranchId || ""));
    setStatusFilter("All");
    setTypeFilter("All");
    setManufacturerFilter("All");
    setConditionFilter("All");
    setDepartmentFilter("All");
    setSearch("");
    setSortLatest(false);
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
      const body = { ...payload, ...buildTicketPayload(user) };
      const url = assetId ? `${API_BASE}/hardware-assets/${assetId}` : `${API_BASE}/hardware-assets`;
      const method = assetId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorBody = await res.json();
        throw new Error(errorBody.error || "Unable to save asset");
      }
      await fetchAssets();
      closeAssetModal();
    } catch (err) {
      console.error(err);
      setModalError(err.message);
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

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-black">Hardware Assets</h1>
          <p className="mt-2 max-w-2xl text-slate-200">
            Track company laptops, desktops, printers, phones and hardware by branch with status monitoring, borrower history, and lifecycle controls.
          </p>
          <p className="mt-4 text-sm text-blue-100">
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
          <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-slate-900/5 px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-100">
            <Download size={18} />
            Export
          </button>
          <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-slate-900/5 px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-100">
            <Printer size={18} />
            Print
          </button>
        </div>
      </section>

      {isSuperAdmin ? (
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900">Filter by Branch</h2>
              <p className="mt-1 text-sm text-slate-500">View branch inventory and status counts across the network.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setBranchFilter("All")}
                className={`rounded-full px-4 py-2 text-sm font-black transition ${branchFilter === "All" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                All Branches
              </button>
              {visibleBranches.map((branch) => (
                <button
                  key={branch.branch_id}
                  onClick={() => setBranchFilter(String(branch.branch_id))}
                  className={`rounded-full px-4 py-2 text-sm font-black transition ${branchFilter === String(branch.branch_id) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {branch.branch_name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {branchMetrics.map((branch) => {
              const isSelected = String(branch.branch_id) === branchFilter;
              return (
                <button
                  key={branch.branch_id}
                  type="button"
                  onClick={() => setBranchFilter(isSelected ? "All" : String(branch.branch_id))}
                  className={`rounded-3xl border p-5 text-left shadow-sm transition hover:shadow-md ${isSelected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 bg-slate-50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-2xl bg-white p-3 shadow-sm">
                      <FolderOpen size={22} className="text-blue-600" />
                    </div>
                    <span className="rounded-2xl bg-slate-900 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                      {branch.branch_code}
                    </span>
                  </div>
                  <div className="mt-5">
                    <h3 className="text-lg font-black text-slate-900">{branch.branch_name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{branch.branch_location || "Branch"}</p>
                  </div>
                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-3 text-center">
                      <p className="text-2xl font-black text-slate-900">{branch.total}</p>
                      <p className="w-full truncate text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">Total</p>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-3 text-center">
                      <p className="text-2xl font-black text-emerald-600">{branch.active}</p>
                      <p className="w-full truncate text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">Active</p>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-3 text-center">
                      <p className="text-2xl font-black text-violet-600">{branch.borrowed}</p>
                      <p className="w-full truncate text-[10px] uppercase tracking-wider text-slate-400 sm:text-xs">Borrowed</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-black text-slate-900">Branch Asset Overview</h2>
              <p className="mt-1 text-sm text-slate-500">
                {visibleBranches[0]?.branch_name || "Branch"} hardware asset status distribution.
              </p>
            </div>
          </div>
          <div className="grid gap-5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {[
              { label: "Total", count: assets.length, color: "bg-slate-900" },
              { label: "Active", count: assets.filter(a => a.status === "Active").length, color: "bg-emerald-500" },
              { label: "Borrowed", count: assets.filter(a => a.status === "Borrowed").length, color: "bg-violet-500" },
              { label: "In Repair", count: assets.filter(a => a.status === "In Repair").length, color: "bg-amber-500" },
              { label: "In Stock", count: assets.filter(a => a.status === "In Stock").length, color: "bg-sky-500" },
              { label: "Retired", count: assets.filter(a => a.status === "Retired").length, color: "bg-slate-400" },
              { label: "Disposed", count: assets.filter(a => a.status === "Disposed").length, color: "bg-rose-500" },
            ].map((item) => {
              const maxCount = Math.max(1, assets.length);
              const pct = maxCount > 0 ? Math.round((item.count / maxCount) * 100) : 0;
              return (
                <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
                  <p className="text-3xl font-black text-slate-900">{item.count}</p>
                  <div className="mt-3 h-2.5 w-full rounded-full bg-slate-200">
                    <div className={`h-2.5 rounded-full ${item.color} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-4 md:grid-cols-3">
          {statusMetrics.map((item) => {
            const isActive = statusFilter === item.status;
            return (
              <button
                key={item.status}
                type="button"
                onClick={() => setStatusFilter(isActive ? "All" : item.status)}
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
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="min-w-[120px] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          <option value="All">Type: All</option>
          {ASSET_TYPES.filter((t) => t !== "All").map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-w-[120px] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          <option value="All">Status: All</option>
          {STATUS_OPTIONS.filter((s) => s !== "All").map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          value={manufacturerFilter}
          onChange={(e) => setManufacturerFilter(e.target.value)}
          className="min-w-[120px] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          <option value="All">Brand: All</option>
          {manufacturers.filter((m) => m !== "All").map((manufacturer) => (
            <option key={manufacturer} value={manufacturer}>
              {manufacturer}
            </option>
          ))}
        </select>
        <select
          value={conditionFilter}
          onChange={(e) => setConditionFilter(e.target.value)}
          className="min-w-[120px] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          <option value="All">Condition: All</option>
          {conditionOptions.filter((c) => c !== "All").map((cond) => (
            <option key={cond} value={cond}>
              {cond}
            </option>
          ))}
        </select>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="min-w-[120px] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          <option value="All">Department: All</option>
          {departmentOptions.filter((d) => d !== "All").map((dept) => (
            <option key={dept} value={dept}>
              {dept}
            </option>
          ))}
        </select>
        {isSuperAdmin && (
          <button
            onClick={() => setSortLatest((prev) => !prev)}
            className={`flex items-center gap-1 rounded-3xl border px-4 py-3 text-sm font-black transition ${sortLatest ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200" : "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
            title="Sort by newest first"
          >
            <svg className={`h-4 w-4 ${sortLatest ? "text-blue-600" : "text-slate-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
            </svg>
            Latest
          </button>
        )}
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title="Clear all filters"
        >
          <X size={16} />
          Clear
        </button>
      </section>

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
                <td colSpan="13" className="px-4 py-12 text-center text-slate-400">
                  <div className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading assets...
                  </div>
                </td>
              </tr>
            ) : visibleAssets.length === 0 ? (
              <tr>
                <td colSpan="13" className="px-4 py-12 text-center text-slate-400">
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
                        onClick={() => openEditAsset(asset)}
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
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
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
    setForm((prev) => ({ ...prev, [key]: value }));
    if (localError) setLocalError("");
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
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
              <AssetField label="Attachments" className="md:col-span-2">
                <AssetFileInput
                  files={form.attachments}
                  existingNames={form.attachment_names}
                  onChange={(files) => updateField("attachments", files)}
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
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";

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

function AssetFileInput({ files, existingNames = [], onChange }) {
  const selectedNames = files.map((file) => file.name);
  const names = selectedNames.length ? selectedNames : existingNames;

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4">
      <input
        type="file"
        multiple
        onChange={(event) => onChange(Array.from(event.target.files || []))}
        className="block w-full cursor-pointer text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-black file:text-white hover:file:bg-blue-700"
      />
      {names.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {names.map((name) => (
            <span
              key={name}
              className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm"
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
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
