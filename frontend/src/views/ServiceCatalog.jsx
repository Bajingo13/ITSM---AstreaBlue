import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle,
  ChevronRight,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  Mail,
  Monitor,
  Search,
  Shield,
  Star,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import apiService from "../services/api";
import PageHero from "../components/layout/PageHero";

/* ─── Category config ──────────────────────────────────────────────────────── */
const CATEGORIES = [
  {
    key: "All Services",
    label: "All Services",
    icon: Layers,
    description: "Browse all service requests submitted by users.",
  },
  {
    key: "Access",
    label: "Access",
    icon: KeyRound,
    description: "Account access, role changes, and permissions.",
  },
  {
    key: "Email",
    label: "Email",
    icon: Mail,
    description: "Mailbox issues, access, and email configuration.",
  },
  {
    key: "Hardware",
    label: "Hardware",
    icon: HardDrive,
    description: "Devices, repairs, peripherals, and upgrades.",
  },
  {
    key: "Network",
    label: "Network",
    icon: Globe,
    description: "Connectivity, VPN, WiFi, and network issues.",
  },
  {
    key: "Security",
    label: "Security",
    icon: Shield,
    description: "Security incidents, antivirus, and access control.",
  },
  {
    key: "Software",
    label: "Software",
    icon: Monitor,
    description: "Installations, licenses, and software issues.",
  },
  {
    key: "Uncategorized",
    label: "Uncategorized",
    icon: Box,
    description: "Requests without a matched service category.",
  },
];

const CATEGORY_ICON_MAP = Object.fromEntries(
  CATEGORIES.map((c) => [c.key.toLowerCase(), c.icon])
);

function getCategoryIcon(name) {
  return CATEGORY_ICON_MAP[(name || "").toLowerCase()] || Box;
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function formatDate(val) {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function StatusBadge({ status }) {
  const s = (status || "").toLowerCase();
  const map = {
    open: "border-blue-200 bg-blue-50 text-blue-700",
    "open queue": "border-blue-200 bg-blue-50 text-blue-700",
    "in progress": "border-amber-200 bg-amber-50 text-amber-700",
    resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    closed: "border-slate-200 bg-slate-100 text-slate-600",
    cancelled: "border-red-200 bg-red-50 text-red-700",
    canceled: "border-red-200 bg-red-50 text-red-700",
  };
  const cls = map[s] || "border-slate-200 bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {status || "—"}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const p = (priority || "").toLowerCase();
  const map = {
    critical: "border-red-200 bg-red-100 text-red-800",
    "p1-critical": "border-red-200 bg-red-100 text-red-800",
    high: "border-pink-200 bg-pink-50 text-pink-700",
    "p2-high": "border-pink-200 bg-pink-50 text-pink-700",
    medium: "border-yellow-200 bg-yellow-50 text-yellow-800",
    "p3-medium": "border-yellow-200 bg-yellow-50 text-yellow-800",
    low: "border-green-200 bg-green-50 text-green-700",
    "p4-low": "border-green-200 bg-green-50 text-green-700",
  };
  const cls = map[p] || "border-slate-200 bg-slate-100 text-slate-600";
  if (!priority) return null;
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {priority}
    </span>
  );
}

/* ─── View Request Modal ───────────────────────────────────────────────────── */
function RequestModal({ requestId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) return;
    setLoading(true);
    setError("");
    setDetail(null);

    apiService
      .fetchRequestById(requestId)
      .then((res) => setDetail(res.data || res))
      .catch((err) => setError(err.message || "Unable to load request details."))
      .finally(() => setLoading(false));
  }, [requestId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl border border-blue-200 bg-slate-50 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-5 border-b border-blue-700 bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 px-7 py-6 text-white">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200">
              Request Details
            </p>
            <p className="mt-2 text-sm font-bold text-blue-200">
              {loading ? "Loading…" : detail?.ticket_number || `#${requestId}`}
            </p>
            {!loading && detail?.title && (
              <h2 className="mt-1 break-words text-2xl font-black leading-tight text-white">
                {detail.title}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close request details"
            className="shrink-0 rounded-xl border border-white/20 bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-7 py-6">
          {loading && (
            <p className="text-center text-slate-500">Loading request details…</p>
          )}

          {error && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
              <AlertCircle size={18} />
              <span className="text-sm font-semibold">{error}</span>
            </div>
          )}

          {!loading && !error && detail && (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { label: "Ticket Number", value: detail.ticket_number },
                {
                  label: "Service Category",
                  value: detail.service_category || detail.category || "—",
                },
                {
                  label: "Status",
                  value: <StatusBadge status={detail.status} />,
                },
                {
                  label: "Priority",
                  value: detail.priority ? (
                    <PriorityBadge priority={detail.priority} />
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Branch / Location",
                  value:
                    detail.branch_name ||
                    detail.branch_location ||
                    detail.branchName ||
                    "—",
                },
                {
                  label: "Requester",
                  value: (
                    <span>
                      {detail.requester_name || detail.requesterName || "—"}{" "}
                      {detail.requester_email && (
                        <span className="text-slate-400">
                          ({detail.requester_email})
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  label: "Assigned Technician",
                  value: detail.assigned_technician || "Unassigned",
                },
                {
                  label: "Created",
                  value: formatDate(detail.created_at),
                },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                  <dt className="text-xs font-black uppercase tracking-wider text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd>
                </div>
              ))}

              {/* Full-width description */}
              <div className="col-span-full rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <dt className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Description
                </dt>
                <dd className="mt-2 text-sm leading-7 text-slate-700 whitespace-pre-wrap">
                  {detail.description || "No description provided."}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="border-t border-blue-100 bg-white px-7 py-4 text-right">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ───────────────────────────────────────────────────────── */
export default function ServiceCatalog() {
  const { user } = useAuth();

  const [requests, setRequests] = useState([]);
  const [popularServices, setPopularServices] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All Services");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [popularError, setPopularError] = useState("");

  const [viewId, setViewId] = useState(null);

  /* ── Derive role label shown in header ── */
  const roleName = user?.role_name || user?.role || "";
  const branchLabel = user?.branch_name || "";

  /* ── Count map from popular services (used for category cards) ── */
  const countMap = useMemo(() => {
    const map = {};
    let total = 0;
    popularServices.forEach((s) => {
      if (s.service_category) {
        map[s.service_category] = Number(s.count) || 0;
        total += Number(s.count) || 0;
      }
    });
    map["All Services"] = total;
    return map;
  }, [popularServices]);

  /* ── Fetch popular services (branch-scoped by backend) ── */
  const loadPopular = useCallback(async () => {
    try {
      setLoadingPopular(true);
      setPopularError("");
      const res = await apiService.fetchPopularServices();
      setPopularServices(res.data || []);
    } catch (err) {
      console.error("[popular] failed:", err.message);
      setPopularError("Unable to load popular services.");
    } finally {
      setLoadingPopular(false);
    }
  }, []);

  /* ── Fetch filtered requests ── */
  const loadRequests = useCallback(async (category, searchTerm) => {
    try {
      setLoadingRequests(true);
      setRequestError("");
      const res = await apiService.fetchRequests({
        category: category || "All Services",
        search: searchTerm || "",
      });
      setRequests(res.data || []);
    } catch (err) {
      console.error("[requests] failed:", err.message);
      setRequestError("Unable to load service requests.");
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    loadPopular();
  }, [loadPopular]);

  useEffect(() => {
    loadRequests(selectedCategory, search);
  }, [selectedCategory, search, loadRequests]);

  const handleCategoryClick = (cat) => {
    setSelectedCategory(cat);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleSearchClear = () => {
    setSearchInput("");
    setSearch("");
  };

  /* ── Top 3 for Popular Services cards ── */
  const topPopular = useMemo(
    () =>
      [...popularServices]
        .filter((s) => s.service_category)
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, 3),
    [popularServices]
  );

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <PageHero eyebrow="Service Operations" title={branchLabel ? "Branch Service Request Management" : "Service Request Management"} subtitle={branchLabel ? `Review and manage requests for the ${branchLabel} branch.` : "Coordinate service requests across branches, categories, and operational teams."} actions={roleName && (
            <span className="inline-flex self-start items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-white sm:self-auto">
              <Lock size={14} />
              {roleName}
            </span>
          )} />

      {/* ── Service Category Cards ── */}
      <section className="rounded-3xl bg-white p-7 shadow-sm border border-slate-200">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">Service Categories</h2>
            <p className="mt-1 text-sm text-slate-500">
              Click a category to filter requests.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const count = countMap[cat.key] ?? 0;
            const active = selectedCategory === cat.key;

            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => handleCategoryClick(cat.key)}
                className={`group flex flex-col gap-3 overflow-hidden rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? "border-blue-500 bg-blue-50 shadow-md shadow-blue-100"
                    : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50"
                }`}
              >
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-xl transition ${
                    active ? "bg-blue-600 text-white" : "bg-slate-100 text-blue-700 group-hover:bg-blue-100"
                  }`}
                >
                  <Icon size={20} />
                </div>
                <div>
                  <p className={`text-sm font-bold ${active ? "text-blue-800" : "text-slate-800"}`}>
                    {cat.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {count} request{count !== 1 ? "s" : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Popular Services ── */}
      <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">Popular Services</h2>
            <p className="mt-1 text-sm text-slate-500">
              Most requested service categories from users
              {branchLabel ? ` in ${branchLabel}` : " across all branches"}.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-200">
            Total: {countMap["All Services"] ?? 0} requests
          </div>
        </div>

        {loadingPopular ? (
          <div className="py-8 text-center text-sm text-slate-400">Loading popular services…</div>
        ) : popularError ? (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            <AlertCircle size={18} />
            <span className="text-sm font-semibold">{popularError}</span>
          </div>
        ) : topPopular.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No service requests recorded yet.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {topPopular.map((service, idx) => {
              const Icon = getCategoryIcon(service.service_category);
              const catDef = CATEGORIES.find(
                (c) => c.key.toLowerCase() === (service.service_category || "").toLowerCase()
              );
              return (
                <button
                  key={service.service_category}
                  type="button"
                  onClick={() => handleCategoryClick(service.service_category)}
                  className="group rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-white p-3 text-blue-700 shadow-sm group-hover:bg-blue-100">
                      <Icon size={20} />
                    </div>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
                      {idx + 1}
                    </span>
                  </div>
                  <p className="font-black text-slate-900">{service.service_category}</p>
                  <p className="mt-1 text-sm text-slate-500">{service.count} requests</p>
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    {catDef?.description || "Review and manage the most requested services."}
                  </p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-bold text-blue-600">
                    View requests <ChevronRight size={14} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── User Requests Table ── */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Table header row */}
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">User Requests</h2>
            <p className="mt-1 text-sm text-slate-500">
              {selectedCategory === "All Services"
                ? "All service requests"
                : `${selectedCategory} requests`}
              {branchLabel ? ` — ${branchLabel} branch` : ""}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-600">
            <Star size={15} className="text-amber-500" />
            Showing {requests.length} request{requests.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearchSubmit} className="mb-5">
          <label className="relative flex w-full items-center rounded-2xl border border-slate-200 bg-slate-50 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
            <Search className="pointer-events-none absolute left-4 h-5 w-5 text-slate-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by ticket, requester, category, or status…"
              className="w-full rounded-2xl border-none bg-transparent py-3 pl-12 pr-24 text-slate-900 outline-none placeholder:text-slate-400"
            />
            <div className="absolute right-2 flex gap-1">
              {searchInput && (
                <button
                  type="button"
                  onClick={handleSearchClear}
                  className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
              >
                Search
              </button>
            </div>
          </label>
        </form>

        {/* Table */}
        {loadingRequests ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 py-12 text-center text-slate-400">
            Loading service requests…
          </div>
        ) : requestError ? (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            <AlertCircle size={18} />
            <span className="text-sm font-semibold">{requestError}</span>
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 py-12 text-center text-slate-400">
            No requests found. Try a different category or search term.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-4 font-semibold">Ticket</th>
                    <th className="px-5 py-4 font-semibold">Service</th>
                    <th className="px-5 py-4 font-semibold">Requester</th>
                    <th className="px-5 py-4 font-semibold">Branch</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold">Created</th>
                    <th className="px-5 py-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {requests.map((req) => (
                    <tr
                      key={req.id}
                      className="border-t border-slate-100 hover:bg-slate-50 transition"
                    >
                      <td className="px-5 py-4">
                        <p className="font-bold text-blue-700">{req.ticket_number || "—"}</p>
                        <p className="mt-0.5 max-w-[160px] truncate text-xs text-slate-400">
                          {req.title}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {req.service_category || req.category || "Uncategorized"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">
                          {req.requester_name || "—"}
                        </p>
                        <p className="text-xs text-slate-400">{req.requester_email || ""}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {req.branch_name || req.branch_location || "—"}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="px-5 py-4 text-slate-500">
                        {formatDate(req.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => setViewId(req.id)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition"
                        >
                          View <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── View Request Modal ── */}
      {viewId !== null && (
        <RequestModal requestId={viewId} onClose={() => setViewId(null)} />
      )}
    </div>
  );
}
