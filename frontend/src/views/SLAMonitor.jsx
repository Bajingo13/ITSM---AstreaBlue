import { API_URL } from "../config/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { AlertTriangle, CheckCircle, ChevronDown, Clock, Timer, Activity, Zap, Download, FileText, Printer, Filter, CalendarDays, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";
import PageHero from "../components/layout/PageHero";

const API_BASE = `${API_URL}/api/v1`;
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const formatDateTime = (value) => {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : dateTimeFormatter.format(date);
};

const SORT_OPTIONS = [
  { value: "latest", label: "Latest SLA Tickets" },
  { value: "oldest", label: "Oldest SLA Tickets" },
  { value: "updated", label: "Recently Updated" },
  { value: "priority", label: "Highest Priority First" },
];

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

export default function SLAMonitor() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({
    activeSLA: 0,
    dueSoon: 0,
    breached: 0,
    met: 0,
    compliancePercent: 100,
    avgResponseTimeMins: 0,
    avgResolutionTimeMins: 0,
  });
  const [loading, setLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  // SLA Filter & Sort State
  const [sortMode, setSortMode] = useState("latest");
  const [slaStatusFilters, setSlaStatusFilters] = useState([]);
  const [statusFilters, setStatusFilters] = useState([]);
  const [priorityFilters, setPriorityFilters] = useState([]);
  const [dateRange, setDateRange] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const buildFilterQuery = useCallback(() => {
    const q = [];
    if (sortMode !== "latest") q.push(`sort=${sortMode}`);
    if (dateRange) q.push(`dateRange=${dateRange}`);
    if (dateFrom) q.push(`dateFrom=${encodeURIComponent(dateFrom)}`);
    if (dateTo) q.push(`dateTo=${encodeURIComponent(dateTo)}`);
    if (slaStatusFilters.length) q.push(`slaStatus=${slaStatusFilters.join(",")}`);
    if (statusFilters.length) q.push(`status=${statusFilters.map(s => encodeURIComponent(s)).join(",")}`);
    if (priorityFilters.length) q.push(`priority=${priorityFilters.map(p => encodeURIComponent(p)).join(",")}`);
    if (branchFilter !== "all") q.push(`branch=${encodeURIComponent(branchFilter)}`);
    if (technicianFilter !== "all") q.push(`technician=${technicianFilter}`);
    if (categoryFilter !== "all") q.push(`category=${encodeURIComponent(categoryFilter)}`);
    if (departmentFilter !== "all") q.push(`department=${encodeURIComponent(departmentFilter)}`);
    return q.length ? `&${q.join("&")}` : "";
  }, [sortMode, dateRange, dateFrom, dateTo, slaStatusFilters, statusFilters, priorityFilters, branchFilter, technicianFilter, categoryFilter, departmentFilter]);

  const activeFilterCount = useCallback(() => {
    let count = 0;
    if (sortMode !== "latest") count++;
    if (dateRange) count++;
    if (dateFrom || dateTo) count++;
    if (slaStatusFilters.length) count++;
    if (statusFilters.length) count++;
    if (priorityFilters.length) count++;
    if (branchFilter !== "all") count++;
    if (technicianFilter !== "all") count++;
    if (categoryFilter !== "all") count++;
    if (departmentFilter !== "all") count++;
    return count;
  }, [sortMode, dateRange, dateFrom, dateTo, slaStatusFilters, statusFilters, priorityFilters, branchFilter, technicianFilter, categoryFilter, departmentFilter]);

  const clearAllFilters = useCallback(() => {
    setSortMode("latest");
    setSlaStatusFilters([]);
    setStatusFilters([]);
    setPriorityFilters([]);
    setDateRange(null);
    setDateFrom("");
    setDateTo("");
    setBranchFilter("all");
    setTechnicianFilter("all");
    setCategoryFilter("all");
    setDepartmentFilter("all");
  }, []);

  const handleExportPdfAll = useCallback(async () => {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    setExportOpen(false);
    for (const ticket of tickets) {
      const id = ticket.id;
      try {
        const res = await fetch(`${API_BASE}/sla/reports/export/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `sla-report-${ticket.ticket_number || id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        console.error(`PDF export error for ticket ${id}:`, err);
      }
    }
  }, [tickets]);

  const handlePrintAll = useCallback(() => {
    setExportOpen(false);
    window.print();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Build filter query string
      const filterQuery = buildFilterQuery();

      // Fetch stats with filter params
      const statsRes = await fetch(`${API_BASE}/sla/dashboard${buildTicketQuery(user)}${filterQuery}`);
      const statsData = await statsRes.json();
      if (statsData.success) {
        setStats(statsData.stats);
      }

      // Fetch tickets with filter params
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}${filterQuery}`);
      const data = await res.json();
      const allTickets = Array.isArray(data) ? data : [];
      // When filters are active, show all matching results; otherwise exclude completed
      const hasFilters = activeFilterCount() > 0;
      setTickets(hasFilters ? allTickets : allTickets.filter((t) => t.status !== "Closed" && t.status !== "Cancelled"));

      // Fetch SLA history
      const histRes = await fetch(`${API_BASE}/sla/history${buildTicketQuery(user)}`);
      const histData = await histRes.json();
      setHistory(histData.history || histData.data || []);

      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error("Fetch SLA data failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user, buildFilterQuery, activeFilterCount]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const socket = io(API_URL, { transports: ["polling", "websocket"], withCredentials: true });
    const refreshForSlaUpdate = () => { void fetchData(); };
    socket.on("sla_updated", refreshForSlaUpdate);
    return () => {
      socket.off("sla_updated", refreshForSlaUpdate);
      socket.disconnect();
    };
  }, [fetchData]);

  const getSlaBadgeClass = (status) => {
    switch (status) {
      case "Met":      return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "Breached": return "bg-red-100 text-red-800 border-red-200";
      case "Due Soon": return "bg-amber-100 text-amber-800 border-amber-200";
      default:         return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  // Determine SLA state label for stats filtering
  const slaStateLabel = slaStatusFilters.length
    ? slaStatusFilters.map(s => `SLA ${s.charAt(0).toUpperCase() + s.slice(1)}`).join(", ")
    : null;

  const filterButtonLabel = activeFilterCount() > 0
    ? `Sort & Filter (${activeFilterCount()})`
    : "Sort & Filter";

  return (
    <div className="space-y-6">
      <PageHero
        icon={Timer}
        title="Service Level Management"
        subtitle="Track Service Level Agreement compliance, response times, and identify breached or at-risk tickets."
      />
      <p className="text-right text-xs font-bold text-slate-500">Latest refresh: {formatDateTime(lastRefreshedAt)}</p>

      {/* Stat Cards */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card icon={Activity}      label="Tracked Tickets"    value={stats.activeSLA}  color="blue"    />
        <Card icon={Clock}         label="Breached"           value={stats.breached}   color="red"     />
        <Card icon={AlertTriangle} label="Due within 4 hours" value={stats.dueSoon}    color="amber"   />
        <Card icon={CheckCircle}   label="Met SLA"            value={stats.met}        color="emerald" />
      </section>

      {/* Avg Time Cards */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="text-blue-500" size={24} />
            <h3 className="text-lg font-black text-slate-800">Avg Response Time</h3>
          </div>
          <p className="text-3xl font-black text-slate-900">
            {stats.avgResponseTimeMins} <span className="text-sm font-semibold text-slate-500">mins</span>
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <Timer className="text-indigo-500" size={24} />
            <h3 className="text-lg font-black text-slate-800">Avg Resolution Time</h3>
          </div>
          <p className="text-3xl font-black text-slate-900">
            {stats.avgResolutionTimeMins} <span className="text-sm font-semibold text-slate-500">mins</span>
          </p>
        </div>
      </section>

      {/* SLA Ticket Queue */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">SLA Ticket Queue</h2>
          <div className="flex items-center gap-3">
            {/* Sort & Filter Button */}
            <SortFilterDropdown
              buttonLabel={filterButtonLabel}
              sortMode={sortMode}
              onSortChange={setSortMode}
              slaStatusFilters={slaStatusFilters}
              onSlaStatusToggle={(val) =>
                setSlaStatusFilters((prev) =>
                  prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
                )
              }
              statusFilters={statusFilters}
              onStatusToggle={(val) =>
                setStatusFilters((prev) =>
                  prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
                )
              }
              priorityFilters={priorityFilters}
              onPriorityToggle={(val) =>
                setPriorityFilters((prev) =>
                  prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
                )
              }
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              dateFrom={dateFrom}
              onDateFromChange={setDateFrom}
              dateTo={dateTo}
              onDateToChange={setDateTo}
              branchFilter={branchFilter}
              onBranchFilterChange={setBranchFilter}
              technicianFilter={technicianFilter}
              onTechnicianFilterChange={setTechnicianFilter}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              departmentFilter={departmentFilter}
              onDepartmentFilterChange={setDepartmentFilter}
              onClear={clearAllFilters}
            />
            {/* Export Button */}
            <div className="relative">
              <button
                onClick={() => setExportOpen(!exportOpen)}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                <Download size={14} />
                Export
                <svg className={`h-3 w-3 transition ${exportOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
              </button>
              {exportOpen && (
                <div className="absolute right-0 z-50 mt-1 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                  <button
                    onClick={() => { setExportOpen(false); handleExportPdfAll(); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <FileText size={16} className="text-slate-400" />
                    Export PDF
                  </button>
                  <button
                    onClick={() => handlePrintAll()}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Printer size={16} className="text-slate-400" />
                    Print Report
                  </button>
                </div>
              )}
            </div>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-700">
              {tickets.length} total
            </span>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4">Ticket No.</th>
                <th className="px-6 py-4">Title</th>
                <th className="px-6 py-4">Assigned Technician</th>
                <th className="px-6 py-4">Priority</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">SLA Due</th>
                <th className="px-6 py-4">SLA State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-slate-400">
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-slate-400">
                    No active tickets.
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => {
                  const resolSla = ticket.resolution_sla_status || "Pending";
                  const resSla   = ticket.response_sla_status   || "Pending";
                  const overallSla =
                    resolSla === "Breached" || resSla === "Breached"
                      ? "Breached"
                      : resolSla === "Met"
                        ? "Met"
                        : "Active";
                  return (
                    <tr key={ticket.id} className="transition hover:bg-slate-50">
                      <td className="px-6 py-4 font-bold text-slate-900">
                        {ticket.ticket_number || `TKT-${ticket.id}`}
                      </td>
                      <td className="px-6 py-4">
                        <div className="line-clamp-1 max-w-xs text-xs text-slate-500" title={ticket.title}>
                          {ticket.title}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                            {(ticket.assigned_name || "U")[0]}
                          </span>
                          <span className="text-xs">{ticket.assigned_name || "Unassigned"}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={getPriorityBadgeClass(ticket.priority)}>
                          {formatPriority(ticket.priority)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={getStatusBadgeClass(ticket.status)}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-700">
                        {formatDateTime(ticket.resolution_due_at || ticket.sla_due_date)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${getSlaBadgeClass(overallSla)}`}>
                          {overallSla === "Active" ? "SLA Active" : `SLA ${overallSla}`}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent SLA Activity */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">Recent SLA Activity</h2>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-700">
            {history.length} total
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4">Ticket</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Old Status</th>
                <th className="px-6 py-4">New Status</th>
                <th className="px-6 py-4">Changed By</th>
                <th className="px-6 py-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-slate-400">
                    Loading history...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-slate-400">
                    No recent SLA activity.
                  </td>
                </tr>
              ) : (
                history.map((h, i) => (
                  <tr key={h.history_id || i} className="transition hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{h.ticket_number}</div>
                      <div className="mt-1 line-clamp-1 max-w-xs text-xs text-slate-500">{h.ticket_title}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide bg-blue-100 text-blue-800 border-blue-200">
                        {h.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">
                      {h.old_status || "Not set"}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">
                      {h.new_status || "Not set"}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">
                      {h.changed_by || "Not set"}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">
                      {formatDateTime(h.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ icon: Icon, label, value, color }) {
  const colorMap = {
    blue:    "bg-blue-50 text-blue-700 border-blue-100",
    red:     "bg-red-50 text-red-700 border-red-100",
    amber:   "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };

  return (
    <div className={`rounded-3xl border bg-white p-6 shadow-sm ${colorMap[color].split(" ")[2]}`}>
      <div className="flex items-center gap-4">
        <div className={`rounded-2xl p-3 ${colorMap[color].split(" ").slice(0, 2).join(" ")}`}>
          <Icon size={24} />
        </div>
        <div>
          <p className="text-3xl font-black text-slate-900">{value}</p>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mt-1">{label}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Sort & Filter Dropdown ── */
function SortFilterDropdown({
  buttonLabel,
  sortMode,
  onSortChange,
  slaStatusFilters,
  onSlaStatusToggle,
  statusFilters,
  onStatusToggle,
  priorityFilters,
  onPriorityToggle,
  dateRange,
  onDateRangeChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  branchFilter,
  onBranchFilterChange,
  technicianFilter,
  onTechnicianFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  departmentFilter,
  onDepartmentFilterChange,
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

  const branchOptions = [{ label: "All", value: "all" }, ...selectOptions(["Manila HQ", "Cebu Branch", "Clark Branch"])];
  const technicianOptions = selectOptions(["All", "Assigned", "Unassigned"]);
  const categoryOptions = selectOptions(["All", "Incident", "Service Request", "Change Request"]);
  const departmentOptions = [{ label: "All", value: "all" }, ...selectOptions(["IT", "HR", "Finance", "Operations"])];

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
        {/* Sorting */}
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

        {/* SLA Status */}
        <FilterPanelSection title="SLA Status">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "active", label: "SLA Active" },
              { key: "warning", label: "SLA Warning" },
              { key: "breached", label: "SLA Breached" },
              { key: "met", label: "SLA Met" },
            ].map((opt) => (
              <FilterChip
                key={opt.key}
                selected={slaStatusFilters.includes(opt.key)}
                onClick={() => onSlaStatusToggle(opt.key)}
              >
                {opt.label}
              </FilterChip>
            ))}
          </div>
        </FilterPanelSection>

        {/* Ticket Status */}
        <FilterPanelSection title="Ticket Status">
          <div className="flex flex-wrap gap-2">
            {["Open Queue", "In Progress", "Resolved", "Closed"].map((s) => (
              <FilterChip
                key={s}
                selected={statusFilters.includes(s)}
                onClick={() => onStatusToggle(s)}
              >
                {s}
              </FilterChip>
            ))}
          </div>
        </FilterPanelSection>

        {/* Priority */}
        <FilterPanelSection title="Priority">
          <div className="flex flex-wrap gap-2">
            {["P1-Critical", "P2-High", "P3-Medium", "P4-Low"].map((p) => (
              <FilterChip
                key={p}
                selected={priorityFilters.includes(p)}
                onClick={() => onPriorityToggle(p)}
              >
                {p}
              </FilterChip>
            ))}
          </div>
        </FilterPanelSection>

        {/* Date Range */}
        <FilterPanelSection title="Date Range">
          <div className="flex flex-wrap gap-2 mb-3">
            {[
              { value: "30days", label: "Last 30 Days" },
              { value: "6months", label: "Last 6 Months" },
            ].map((opt) => (
              <FilterChip
                key={opt.value}
                selected={dateRange === opt.value}
                onClick={() => onDateRangeChange(dateRange === opt.value ? null : opt.value)}
              >
                {opt.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <CalendarDays size={14} className="pointer-events-none absolute left-3 text-slate-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { onDateFromChange(e.target.value); onDateRangeChange(null); }}
                className="w-full min-w-[140px] rounded-[11px] border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-600/10"
                placeholder="Start date"
              />
            </div>
            <span className="text-xs text-slate-400">to</span>
            <div className="relative flex items-center">
              <CalendarDays size={14} className="pointer-events-none absolute left-3 text-slate-400" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { onDateToChange(e.target.value); onDateRangeChange(null); }}
                className="w-full min-w-[140px] rounded-[11px] border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-700 transition hover:border-blue-200 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-600/10"
                placeholder="End date"
              />
            </div>
          </div>
        </FilterPanelSection>

        {/* More Filters */}
        <FilterPanelSection title="More Filters">
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterSelect
              label="Branch"
              value={branchFilter}
              options={branchOptions.map((o) => ({ ...o, value: o.value }))}
              onChange={onBranchFilterChange}
            />
            <FilterSelect
              label="Assigned Technician"
              value={technicianFilter}
              options={[{ label: "All", value: "all" }, { label: "Assigned", value: "assigned" }, { label: "Unassigned", value: "unassigned" }]}
              onChange={onTechnicianFilterChange}
            />
            <FilterSelect
              label="Category"
              value={categoryFilter}
              options={[{ label: "All", value: "all" }, { label: "Incident", value: "Incident" }, { label: "Service Request", value: "Service Request" }, { label: "Change Request", value: "Change Request" }]}
              onChange={onCategoryFilterChange}
            />
            <FilterSelect
              label="Department"
              value={departmentFilter}
              options={[{ label: "All", value: "all" }, { label: "IT", value: "IT" }, { label: "HR", value: "HR" }, { label: "Finance", value: "Finance" }, { label: "Operations", value: "Operations" }]}
              onChange={onDepartmentFilterChange}
            />
          </div>
        </FilterPanelSection>

        {/* Reset Action */}
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
