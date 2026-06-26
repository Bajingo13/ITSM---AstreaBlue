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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";

const API_BASE = "http://localhost:5001/api/v1";
const ASSET_TYPES = [
  "All",
  "Laptop",
  "Desktop",
  "Monitor",
  "Printer",
  "Phone",
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
      const queryParams = {};
      if (search.trim()) queryParams.search = search.trim();
      if (typeFilter && typeFilter !== "All") queryParams.type = typeFilter;
      if (statusFilter && statusFilter !== "All") queryParams.status = statusFilter;
      if (manufacturerFilter && manufacturerFilter !== "All") queryParams.manufacturer = manufacturerFilter;
      if (isSuperAdmin && branchFilter && branchFilter !== "All") {
        queryParams.filter_branch_id = branchFilter;
      }
      const query = buildTicketQuery(user, queryParams);
      const res = await fetch(`${API_BASE}/hardware-assets${query}`);
      const data = await res.json();
      setAssets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch hardware assets failed:", err);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [user, search, typeFilter, statusFilter, manufacturerFilter, branchFilter, isSuperAdmin]);

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

  const totalAssets = assets.length;
  const totalActive = assets.filter((asset) => asset.status === "Active").length;
  const totalBorrowed = assets.filter((asset) => asset.status === "Borrowed").length;

  const statusMetrics = useMemo(
    () =>
      STATUS_OPTIONS.filter((item) => item !== "All").map((status) => ({
        status,
        count: assets.filter((asset) => asset.status === status).length,
      })),
    [assets]
  );

  const manufacturers = useMemo(() => {
    const list = assets.reduce((acc, asset) => {
      if (asset.brand) acc.add(asset.brand);
      return acc;
    }, new Set());
    return ["All", ...Array.from(list).sort()];
  }, [assets]);

  const openAddAsset = () => {
    setEditingAsset(null);
    setShowAssetModal(true);
    setModalError("");
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

      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">Filter by Branch</h2>
            <p className="mt-1 text-sm text-slate-500">View branch inventory and status counts across the network.</p>
          </div>

          {isSuperAdmin && (
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
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {branchMetrics.map((branch) => (
            <div key={branch.branch_id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
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
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl bg-white p-3 text-center">
                  <p className="text-2xl font-black text-slate-900">{branch.total}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Total</p>
                </div>
                <div className="rounded-3xl bg-white p-3 text-center">
                  <p className="text-2xl font-black text-emerald-600">{branch.active}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Active</p>
                </div>
                <div className="rounded-3xl bg-white p-3 text-center">
                  <p className="text-2xl font-black text-violet-600">{branch.borrowed}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Borrowed</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-4 md:grid-cols-3">
          {statusMetrics.map((item) => (
            <div key={item.status} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">{item.status}</span>
                <div className={`rounded-2xl px-3 py-1 text-xs font-black ${getStatusClasses(item.status)}`}>
                  {item.count}
                </div>
              </div>
            </div>
          ))}
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

      <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search size={18} className="text-slate-400" />
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
          className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          {ASSET_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          value={manufacturerFilter}
          onChange={(e) => setManufacturerFilter(e.target.value)}
          className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none"
        >
          {manufacturers.map((manufacturer) => (
            <option key={manufacturer} value={manufacturer}>
              {manufacturer}
            </option>
          ))}
        </select>
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
            ) : assets.length === 0 ? (
              <tr>
                <td colSpan="13" className="px-4 py-12 text-center text-slate-400">
                  No hardware assets found.
                </td>
              </tr>
            ) : (
              assets.map((asset) => (
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

function AssetFormModal({ asset, branches, isSuperAdmin, currentBranchId, onClose, onSave, loading, error }) {
  const [form, setForm] = useState({
    asset_name: asset?.asset_name || "",
    asset_type: asset?.asset_type || "Laptop",
    brand: asset?.brand || "",
    model: asset?.model || "",
    serial_number: asset?.serial_number || "",
    asset_tag: asset?.asset_tag || "",
    branch_id: asset?.branch_id ? String(asset.branch_id) : String(currentBranchId || ""),
    status: asset?.status || "Active",
    purchase_date: asset?.purchase_date || "",
    warranty_expiration: asset?.warranty_expiration || "",
    borrower_name: asset?.borrower_name || "",
    employee_id: asset?.employee_id || "",
    borrower_department: asset?.borrower_department || "",
    borrow_date: asset?.borrow_date || "",
    expected_return_date: asset?.expected_return_date || "",
    actual_return_date: asset?.actual_return_date || "",
    condition_before: asset?.condition_before || "",
    condition_after: asset?.condition_after || "",
    notes: asset?.notes || "",
  });

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      branch_id: asset?.branch_id ? String(asset.branch_id) : String(currentBranchId || ""),
    }));
  }, [asset, currentBranchId]);

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(form, asset?.asset_id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">{asset ? "Edit Asset" : "Add Asset"}</h2>
            <p className="mt-1 text-sm text-slate-500">Capture hardware details, branch location and lifecycle information.</p>
          </div>
          <button onClick={onClose} className="rounded-2xl bg-slate-100 px-4 py-2 text-slate-600 hover:bg-slate-200">
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Asset Name
              <input
                value={form.asset_name}
                onChange={(e) => updateField("asset_name", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                required
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Asset Type
              <select
                value={form.asset_type}
                onChange={(e) => updateField("asset_type", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                required
              >
                {ASSET_TYPES.filter((item) => item !== "All").map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Brand / Manufacturer
              <input
                value={form.brand}
                onChange={(e) => updateField("brand", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Model
              <input
                value={form.model}
                onChange={(e) => updateField("model", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Serial Number
              <input
                value={form.serial_number}
                onChange={(e) => updateField("serial_number", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Asset Tag
              <input
                value={form.asset_tag}
                onChange={(e) => updateField("asset_tag", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Branch Location
              {isSuperAdmin ? (
                <select
                  value={form.branch_id}
                  onChange={(e) => updateField("branch_id", e.target.value)}
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                  required
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.branch_id} value={String(branch.branch_id)}>
                      {branch.branch_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={branches.find((branch) => Number(branch.branch_id) === Number(currentBranchId))?.branch_name || "Assigned Branch"}
                  disabled
                  className="w-full rounded-3xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-500 outline-none"
                />
              )}
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Status
              <select
                value={form.status}
                onChange={(e) => updateField("status", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              >
                {STATUS_OPTIONS.filter((item) => item !== "All").map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Purchase Date
              <input
                type="date"
                value={form.purchase_date || ""}
                onChange={(e) => updateField("purchase_date", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Warranty Expiration
              <input
                type="date"
                value={form.warranty_expiration || ""}
                onChange={(e) => updateField("warranty_expiration", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Borrowed By / Employee ID
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  placeholder="Name"
                  value={form.borrower_name}
                  onChange={(e) => updateField("borrower_name", e.target.value)}
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                />
                <input
                  placeholder="Employee ID"
                  value={form.employee_id}
                  onChange={(e) => updateField("employee_id", e.target.value)}
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                />
              </div>
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Borrower Department
              <input
                value={form.borrower_department}
                onChange={(e) => updateField("borrower_department", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Borrow Date
              <input
                type="date"
                value={form.borrow_date}
                onChange={(e) => updateField("borrow_date", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Expected Return Date
              <input
                type="date"
                value={form.expected_return_date}
                onChange={(e) => updateField("expected_return_date", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Actual Return Date
              <input
                type="date"
                value={form.actual_return_date || ""}
                onChange={(e) => updateField("actual_return_date", e.target.value)}
                className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              Condition Before / After
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  placeholder="Before"
                  value={form.condition_before}
                  onChange={(e) => updateField("condition_before", e.target.value)}
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                />
                <input
                  placeholder="After"
                  value={form.condition_after}
                  onChange={(e) => updateField("condition_after", e.target.value)}
                  className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
                />
              </div>
            </label>
          </div>

          <label className="block space-y-2 text-sm font-semibold text-slate-700">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              rows={4}
              className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
            />
          </label>

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
              {loading ? "Saving..." : asset ? "Save Changes" : "Create Asset"}
            </button>
          </div>
        </form>
      </div>
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
