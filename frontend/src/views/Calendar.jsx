import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Filter, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketQuery } from "../utils/ticketAccess";
import { getPriorityBadgeClass, formatPriority, getStatusBadgeClass } from "../utils/ticketVisuals";
import { API_URL } from "../config/api";
import PageHero from "../components/layout/PageHero";

const API_BASE = `${API_URL}/api/v1`;

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const STATUS_COLORS = {
  "Open Queue":   "bg-blue-100 text-blue-800 border-blue-300",
  "In Progress":  "bg-amber-100 text-amber-800 border-amber-300",
  "Resolved":     "bg-emerald-100 text-emerald-800 border-emerald-300",
  "Closed":       "bg-slate-100 text-slate-800 border-slate-300",
  "Cancelled":    "bg-red-100 text-red-800 border-red-300",
};

function formatDate(val) {
  if (!val) return "";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(val) {
  if (!val) return "";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getSlaBadge(sla) {
  if (!sla || sla === "Pending") return "border-slate-200 text-slate-500 bg-slate-50";
  if (sla === "Breached") return "border-red-200 text-red-700 bg-red-50";
  if (sla === "Met") return "border-emerald-200 text-emerald-700 bg-emerald-50";
  return "border-blue-200 text-blue-700 bg-blue-50";
}

/* ── Calendar Day Cell ── */
function DayCell({ date, events, isCurrentMonth, isToday, onEventClick, onShowAll }) {
  return (
    <div className={`min-h-[100px] border-b border-r border-slate-100 p-1 ${isCurrentMonth ? "bg-white" : "bg-slate-50/50"}`}>
      <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
        isToday ? "bg-blue-600 text-white" : isCurrentMonth ? "text-slate-700" : "text-slate-400"
      }`}>
        {date.getDate()}
      </div>
      <div className="space-y-0.5">
        {events.slice(0, 3).map((ev) => (
          <button
            key={ev.ticket_id}
            onClick={() => onEventClick?.(ev)}
            className="w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[10px] font-bold leading-tight transition hover:shadow-sm"
            style={{ borderColor: ev.priority?.startsWith("P1") ? "#ef4444" : ev.priority?.startsWith("P2") ? "#f97316" : "#cbd5e1" }}
          >
            <span className="text-slate-500">{ev.ticket_number}</span>
            {" "}
            <span className="text-slate-800">{ev.title}</span>
          </button>
        ))}
        {events.length > 3 && (
          <button onClick={() => onShowAll?.(date, events)} className="text-[10px] font-bold text-blue-600 transition hover:text-blue-800 hover:underline">
            +{events.length - 3} more
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Event Detail Popover ── */
function EventPopover({ event, onClose }) {
  if (!event) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-slate-900">{event.ticket_number}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        <h4 className="text-sm font-bold text-slate-700 mb-4">{event.title}</h4>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between"><span className="font-bold text-slate-500">Priority</span><span className={getPriorityBadgeClass(event.priority)}>{formatPriority(event.priority)}</span></div>
          <div className="flex justify-between"><span className="font-bold text-slate-500">Status</span><span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_COLORS[event.status] || "bg-slate-100 text-slate-700"}`}>{event.status}</span></div>
          <div className="flex justify-between"><span className="font-bold text-slate-500">Assigned</span><span className="font-semibold text-slate-700">{event.assigned_name}</span></div>
          <div className="flex justify-between"><span className="font-bold text-slate-500">Branch</span><span className="font-semibold text-slate-700">{event.branch_name}</span></div>
          {event.created_at && <div className="flex justify-between"><span className="font-bold text-slate-500">Created</span><span className="font-semibold text-slate-700">{formatDate(event.created_at)}</span></div>}
          {event.start_time && <div className="flex justify-between"><span className="font-bold text-slate-500">Started</span><span className="font-semibold text-slate-700">{formatDate(event.start_time)}</span></div>}
          <div className="flex justify-between"><span className="font-bold text-slate-500">SLA</span><span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${getSlaBadge(event.sla_status)}`}>{event.sla_status}</span></div>
        </div>
      </div>
    </div>
  );
}

/* ── Tickets by Date Modal ── */
function TicketsByDateModal({ date, events, onClose, onEventClick, branches }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const filtered = useMemo(() => {
    let list = events;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((ev) =>
        ev.ticket_number?.toLowerCase().includes(q) ||
        ev.title?.toLowerCase().includes(q) ||
        ev.assigned_name?.toLowerCase().includes(q)
      );
    }
    if (statusFilter) list = list.filter((ev) => ev.status === statusFilter);
    if (priorityFilter) list = list.filter((ev) => ev.priority === priorityFilter);
    if (technicianFilter === "assigned") list = list.filter((ev) => ev.assigned_name && ev.assigned_name !== "Unassigned");
    else if (technicianFilter === "unassigned") list = list.filter((ev) => !ev.assigned_name || ev.assigned_name === "Unassigned");
    if (branchFilter) list = list.filter((ev) => ev.branch_name === branchFilter);
    return list;
  }, [events, search, statusFilter, priorityFilter, technicianFilter, branchFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/20 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">Scheduled Tickets</h3>
            <p className="text-xs font-bold text-slate-500">{formatDate(date)} &middot; {events.length} ticket{events.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets..."
            className="min-w-[180px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All Statuses</option>
            <option value="Open Queue">Open Queue</option>
            <option value="In Progress">In Progress</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All Priorities</option>
            <option value="P1-Critical">P1 - Critical</option>
            <option value="P2-High">P2 - High</option>
            <option value="P3-Medium">P3 - Medium</option>
            <option value="P4-Low">P4 - Low</option>
          </select>
          <select value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All Technicians</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
            <option value="">All Branches</option>
            {branches.filter((b) => b.is_active !== false).map((b) => (
              <option key={b.branch_id} value={b.branch_name}>{b.branch_name}</option>
            ))}
          </select>
          {(search || statusFilter || priorityFilter || technicianFilter || branchFilter) && (
            <button onClick={() => { setSearch(""); setStatusFilter(""); setPriorityFilter(""); setTechnicianFilter(""); setBranchFilter(""); }}
              className="flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50">
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-3">Ticket ID</th>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Branch</th>
                <th className="px-6 py-3">Technician</th>
                <th className="px-6 py-3">Priority</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Schedule Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-sm text-slate-400">No matching tickets found.</td>
                </tr>
              ) : (
                filtered.map((ev) => (
                  <tr key={ev.ticket_id}
                    onClick={() => { onEventClick(ev); onClose(); }}
                    className="cursor-pointer transition hover:bg-slate-50">
                    <td className="px-6 py-3 font-bold text-slate-900">{ev.ticket_number}</td>
                    <td className="px-6 py-3">
                      <div className="line-clamp-1 max-w-[200px] text-xs text-slate-600" title={ev.title}>{ev.title}</div>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-700">{ev.branch_name}</td>
                    <td className="px-6 py-3 text-xs text-slate-700">{ev.assigned_name}</td>
                    <td className="px-6 py-3">
                      <span className={getPriorityBadgeClass(ev.priority)}>{formatPriority(ev.priority)}</span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${STATUS_COLORS[ev.status] || "bg-slate-100 text-slate-700"}`}>{ev.status}</span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-700">{formatTime(ev.start_time || ev.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-3 text-right text-xs font-bold text-slate-400">
          Showing {filtered.length} of {events.length} tickets
        </div>
      </div>
    </div>
  );
}

/* ── Main Calendar Component ── */
export default function CalendarPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("month");
  const [today] = useState(new Date());
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedDateEvents, setSelectedDateEvents] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

  const handleShowAll = useCallback((date, evts) => {
    setSelectedDateEvents({ date, events: evts });
  }, []);

  const handleEventClick = useCallback((ev) => {
    setSelectedEvent(ev);
  }, []);
  // Filters
  const [branchFilter, setBranchFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const buildQuery = useCallback(() => {
    const q = [];
    if (branchFilter !== "all") q.push(`branch=${encodeURIComponent(branchFilter)}`);
    if (technicianFilter !== "all") q.push(`technician=${technicianFilter}`);
    if (priorityFilter) q.push(`priority=${encodeURIComponent(priorityFilter)}`);
    if (statusFilter) q.push(`status=${encodeURIComponent(statusFilter)}`);
    return q.length ? `&${q.join("&")}` : "";
  }, [branchFilter, technicianFilter, priorityFilter, statusFilter]);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const filterQuery = buildQuery();
      const res = await fetch(`${API_BASE}/calendar/events${buildTicketQuery(user)}${filterQuery}`);
      const data = await res.json();
      setEvents(data.success ? data.events : []);
    } catch (err) {
      console.error("[Calendar] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, buildQuery]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  // Fetch branches
  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    fetch(`${API_BASE}/branches`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const activeBranches = (Array.isArray(data) ? data : data?.branches || []).filter((b) => b.is_active !== false);
        setBranches(activeBranches);
        setBranchesLoading(false);
        // Auto-set branch filter for non-SuperAdmin users
        const role = String(user?.role || user?.role_name || "").toLowerCase();
        if (role !== "superadmin" && user?.branch_id && branchFilter === "all") {
          const userBranch = activeBranches.find((b) => b.branch_id === user.branch_id);
          if (userBranch) setBranchFilter(userBranch.branch_name);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[Calendar] Failed to fetch branches:", err);
          setBranchesLoading(false);
        }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Month navigation
  const goPrev = () => {
    const d = new Date(currentDate);
    if (view === "month") d.setMonth(d.getMonth() - 1);
    else if (view === "week") d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };
  const goNext = () => {
    const d = new Date(currentDate);
    if (view === "month") d.setMonth(d.getMonth() + 1);
    else if (view === "week") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };
  const goToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setView("month");
  };

  // Group events by date for month view
  const eventsByDate = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const dt = ev.start_time ? new Date(ev.start_time) : ev.created_at ? new Date(ev.created_at) : null;
      if (!dt || Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [events]);

  // Build month grid
  const monthGrid = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const day = i - startPad + 1;
      const date = new Date(year, month, day);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const isToday = date.toDateString() === today.toDateString();
      const isCurrentMonth = date.getMonth() === month;
      cells.push({ date, events: eventsByDate[key] || [], isCurrentMonth, isToday });
    }
    return cells;
  }, [currentDate, eventsByDate, today]);

  // Week view: 7 days
  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [currentDate]);
  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  // Week/day events
  const dayEvents = useCallback((date) => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return eventsByDate[key] || [];
  }, [eventsByDate]);

  const headerLabel = view === "month"
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : view === "week"
      ? `${formatDate(weekDays[0])} - ${formatDate(weekDays[6])}`
      : formatDate(currentDate);

  return (
    <div className="space-y-6">
      <PageHero
        icon={CalendarDays}
        title="Ticket Schedule Calendar"
        subtitle="View ticket activities, assignments, and schedules in calendar format."
      />

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"><ChevronLeft size={18} /></button>
          <button onClick={goToday} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">Today</button>
          <button onClick={goNext} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"><ChevronRight size={18} /></button>
          <h2 className="ml-2 text-base font-black text-slate-900">{headerLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          {["month", "week", "day"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-xl border px-3.5 py-1.5 text-xs font-bold transition ${
                view === v
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Filter size={16} className="text-slate-400" />
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
          <option value="all">All Branches</option>
            {branches.filter((b) => b.is_active !== false).map((b) => (
              <option key={b.branch_id} value={b.branch_name}>{b.branch_name}</option>
            ))}
          </select>
          <select value={technicianFilter} onChange={(e) => setTechnicianFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
          <option value="all">All Technicians</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
          <option value="">All Priorities</option>
          <option value="P1-Critical">P1 - Critical</option>
          <option value="P2-High">P2 - High</option>
          <option value="P3-Medium">P3 - Medium</option>
          <option value="P4-Low">P4 - Low</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10">
          <option value="">All Statuses</option>
          <option value="Open Queue">Open Queue</option>
          <option value="In Progress">In Progress</option>
          <option value="Resolved">Resolved</option>
          <option value="Closed">Closed</option>
        </select>
        {(branchFilter !== "all" || technicianFilter !== "all" || priorityFilter || statusFilter) && (
          <button onClick={() => { setBranchFilter("all"); setTechnicianFilter("all"); setPriorityFilter(""); setStatusFilter(""); }}
            className="flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-50">
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Calendar Grid */}
      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-sm font-bold text-slate-500">Loading calendar events…</div>
      ) : (
        <>
          {view === "month" && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {DAYS_SHORT.map((d) => (
                  <div key={d} className="px-3 py-2 text-center text-xs font-black uppercase tracking-wider text-slate-500">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthGrid.map((cell, i) => (
                  <DayCell key={i} {...cell} onEventClick={handleEventClick} onShowAll={handleShowAll} />
                ))}
              </div>
            </div>
          )}

          {view === "week" && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {weekDays.map((d) => {
                  const isToday = d.toDateString() === today.toDateString();
                  return (
                    <div key={d.toISOString()} className="px-3 py-2 text-center">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{DAYS_SHORT[d.getDay()]}</p>
                      <p className={`text-sm font-black ${isToday ? "text-blue-600" : "text-slate-900"}`}>{d.getDate()}</p>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-7">
                {weekDays.map((d) => {
                  const evs = dayEvents(d);
                  const isToday = d.toDateString() === today.toDateString();
                  return (
                    <div key={d.toISOString()} className={`min-h-[300px] border-r border-slate-100 p-2 ${isToday ? "bg-blue-50/30" : "bg-white"}`}>
                      {evs.length === 0 && <p className="text-[10px] text-slate-300">No events</p>}
                      {evs.slice(0, 5).map((ev) => (
                        <button key={ev.ticket_id} onClick={() => setSelectedEvent(ev)}
                          className="mb-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-left text-[10px] shadow-sm transition hover:shadow-md">
                          <p className="font-bold text-slate-900">{ev.ticket_number}</p>
                          <p className="truncate text-slate-500">{ev.title}</p>
                          <p className="text-slate-400">{ev.assigned_name}</p>
                        </button>
                      ))}
                      {evs.length > 5 && (
                        <button onClick={() => handleShowAll(d, evs)} className="text-[10px] font-bold text-blue-600 transition hover:text-blue-800 hover:underline">
                          +{evs.length - 5} more
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view === "day" && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-sm font-black text-slate-900">{formatDate(currentDate)}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {dayEvents(currentDate).length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-400">No ticket events scheduled for this day.</p>
                )}
                {dayEvents(currentDate).map((ev) => (
                  <button key={ev.ticket_id} onClick={() => setSelectedEvent(ev)}
                    className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-slate-50">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-xs font-black text-blue-600">
                      {ev.ticket_number?.replace("TKT-", "").slice(-3) || ev.ticket_id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900">{ev.ticket_number} — {ev.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px]">
                        <span className="font-semibold text-slate-500">{ev.assigned_name}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_COLORS[ev.status] || "bg-slate-100 text-slate-700"}`}>{ev.status}</span>
                        <span className={getPriorityBadgeClass(ev.priority)}>{formatPriority(ev.priority)}</span>
                        {ev.start_time && <span className="text-slate-400"><Clock size={10} className="inline" /> {formatTime(ev.start_time)}</span>}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Event Detail Popover */}
      <EventPopover event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      {/* Tickets by Date Modal */}
      {selectedDateEvents && (
        <TicketsByDateModal
          date={selectedDateEvents.date}
          events={selectedDateEvents.events}
          branches={branches}
          onClose={() => setSelectedDateEvents(null)}
          onEventClick={handleEventClick}
        />
      )}
    </div>
  );
}
