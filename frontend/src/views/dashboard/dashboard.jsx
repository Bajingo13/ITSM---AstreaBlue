import { API_URL } from "../../config/api";
import { useState, useEffect, useCallback } from "react";

// ─── Constants & Configuration ────────────────────────────────────────────────
const API_BASE = `${API_URL}/api/v1`;

const COLUMNS = [
  { id: "Open Queue",   label: "Open Queue",   accent: "border-sky-500",     dot: "bg-sky-400",    count_bg: "bg-sky-900/40 text-sky-300" },
  { id: "In Progress",  label: "In Progress",  accent: "border-amber-500",   dot: "bg-amber-400",  count_bg: "bg-amber-900/40 text-amber-300" },
  { id: "Resolved",     label: "Resolved",     accent: "border-emerald-500", dot: "bg-emerald-400", count_bg: "bg-emerald-900/40 text-emerald-300" },
];

const PRIORITY_META = {
  CRITICAL: { label: "CRITICAL", classes: "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" },
  HIGH:     { label: "HIGH",     classes: "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/40" },
  MEDIUM:   { label: "MEDIUM",   classes: "bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/40" },
  LOW:      { label: "LOW",      classes: "bg-slate-500/20 text-slate-400 ring-1 ring-slate-500/40" },
};

const AVAILABLE_AGENTS = ["James Reyes", "Maria Santos", "Carlo Reyes", "Unassigned"];
const EMPTY_FORM = { title: "", desc: "", priority: "MEDIUM", status: "Open Queue", asset_id: "", client_name: "", raised_by: "" };

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }) {
  const meta = PRIORITY_META[priority?.toUpperCase()] ?? PRIORITY_META.LOW;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest font-mono ${meta.classes}`}>
      {meta.label}
    </span>
  );
}

function SLATag({ sla }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-mono">
      <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {sla || "24h remaining"}
    </span>
  );
}

function TicketCard({ ticket, onStatusChange, onDelete, onEdit, onAssignTech }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const otherStatuses = COLUMNS.filter(c => c.id !== ticket.status).map(c => c.id);

  return (
    <div className="group relative bg-slate-900/60 hover:bg-slate-900 border border-white/10 hover:border-cyan-500/30 rounded-xl p-4 shadow-lg shadow-slate-950/20 transition-all duration-150 hover:shadow-cyan-500/10">
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-[11px] font-mono font-semibold text-cyan-400/70 px-2 py-1 rounded-lg bg-cyan-500/10">INC#{ticket.id}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(ticket)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors" title="Edit">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
          </button>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors" title="Move">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-20 w-40 bg-slate-950/95 border border-white/10 rounded-lg shadow-2xl py-1 text-xs">
                {otherStatuses.map(s => (
                  <button key={s} onClick={() => { onStatusChange(ticket.id, s); setMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 text-slate-300 transition-colors font-medium">
                    → {s}
                  </button>
                ))}
                <div className="border-t border-white/5 mt-1 pt-1">
                  <button onClick={() => { onDelete(ticket.id); setMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-red-500/20 text-red-400 transition-colors font-medium">Delete</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <h3 className="text-sm font-bold text-slate-100 leading-snug mb-2">{ticket.title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mb-3">{ticket.desc}</p>
      <div className="mb-3 space-y-2">
        <label className="block text-[9px] font-mono tracking-wider text-slate-500 uppercase">Technician</label>
        <select value={ticket.agent || "Unassigned"} onChange={(e) => onAssignTech(ticket.id, e.target.value)} className="w-full bg-slate-950/80 border border-white/10 hover:border-cyan-500/30 rounded-lg px-3 py-2 text-xs text-slate-100 font-medium focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all">
          {AVAILABLE_AGENTS.map(agent => <option key={agent} value={agent}>{agent}</option>)}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3">
        <PriorityBadge priority={formatPriority(ticket.priority)} />
        <SLATag sla={ticket.sla} />
      </div>
    </div>
  );
}

function KanbanColumn({ column, tickets, onStatusChange, onDelete, onEdit, onAssignTech }) {
  return (
    <div className="flex flex-col min-h-0 bg-slate-900/40 hover:bg-slate-900/50 border border-white/5 hover:border-white/10 rounded-xl p-4 transition-all">
      <div className={`flex items-center justify-between mb-4 pb-3 border-b-2 ${column.accent}`}>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${column.dot}`}></span>
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">{column.label}</h2>
        </div>
        <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full ${column.count_bg}`}>{tickets.length}</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto pr-1 flex-1 max-h-[65vh]">
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600 text-xs text-center gap-2 border border-dashed border-white/10 rounded-lg bg-slate-950/40">
            <svg className="w-5 h-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            <span className="font-medium">All clear</span>
          </div>
        ) : (
          tickets.map(t => <TicketCard key={t.id} ticket={t} onStatusChange={onStatusChange} onDelete={onDelete} onEdit={onEdit} onAssignTech={onAssignTech} />)
        )}
      </div>
    </div>
  );
}

function TicketModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isEdit = !!initial?.id;
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    try {
      const url = isEdit ? `${API_BASE}/tickets/${initial.id}` : `${API_BASE}/tickets`;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, asset_id: form.asset_id ? parseInt(form.asset_id, 10) : null }),
      });
      if (!res.ok) throw new Error(`Gateway returned: ${res.status}`);
      onSave(await res.json(), isEdit);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-100 tracking-tight font-mono">{isEdit ? `MODIFY INCIDENT #${initial.id}` : "DISPATCH NEW HARDWARE INCIDENT"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 font-mono">{error}</p>}
          <div><label className="block text-xs font-semibold text-slate-400 mb-1">Incident Title *</label><input type="text" value={form.title} onChange={e => set("title", e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" placeholder="e.g. Swollen Battery" /></div>
          <div><label className="block text-xs font-semibold text-slate-400 mb-1">Detailed Technical Log</label><textarea rows={3} value={form.desc} onChange={e => set("desc", e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 resize-none" placeholder="Describe behavior..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">System Priority</label><select value={form.priority} onChange={e => set("priority", e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500">{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><label className="block text-xs font-semibold text-slate-400 mb-1">Workflow Status</label><select value={form.status} onChange={e => set("status", e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500">{COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">{saving ? "Saving..." : isEdit ? "Commit" : "Deploy"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StrategicOverview({ tickets, onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-xl">
        <h1 className="text-2xl font-extrabold text-slate-100 tracking-tight">Welcome to AstreaBlue Command Suite</h1>
        <div className="mt-5 flex gap-3"><button onClick={() => onNavigate("kanban")} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold">LAUNCH SERVICE DESK</button></div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalTicket, setModalTicket] = useState(null);
  const [activeView, setActiveView] = useState("overview");

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tickets`);
      if (res.ok) setTickets(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const metrics = {
    total: tickets.length,
    critical: tickets.filter(t => t.priority === 'CRITICAL').length,
    inProgress: tickets.filter(t => t.status === 'In Progress').length,
    resolved: tickets.filter(t => t.status === 'Resolved').length,
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950 text-slate-300">
      <header className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-lg font-black text-white">A</span>
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest text-cyan-400/70 uppercase">AstreaBlue</p>
            <p className="text-sm font-bold text-white">Service Desk</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-950/60 border border-white/10 rounded-lg p-1 gap-0.5">
            {[{ id: "overview", label: "Overview" }, { id: "kanban", label: "Service Desk" }].map(tab => (
              <button key={tab.id} onClick={() => setActiveView(tab.id)} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeView === tab.id ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/30" : "text-slate-400 hover:text-slate-200"}`}>{tab.label}</button>
            ))}
          </div>
          <button onClick={() => setModalTicket(false)} className="px-4 py-2 bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-600 hover:from-cyan-400 hover:via-sky-400 hover:to-indigo-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-cyan-500/20 transition-all">+ New Ticket</button>
        </div>
      </header>

      {activeView === "kanban" && (
        <div className="shrink-0 flex items-center gap-4 px-6 py-4 border-b border-white/5 overflow-x-auto">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900/50 border border-white/10">
            <span className="text-2xl font-bold text-white">{metrics.total}</span>
            <span className="text-xs text-slate-400 uppercase tracking-wider">Total</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <span className="text-2xl font-bold text-red-400">{metrics.critical}</span>
            <span className="text-xs text-red-300 uppercase tracking-wider">Critical</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <span className="text-2xl font-bold text-amber-400">{metrics.inProgress}</span>
            <span className="text-xs text-amber-300 uppercase tracking-wider">In Progress</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-2xl font-bold text-emerald-400">{metrics.resolved}</span>
            <span className="text-xs text-emerald-300 uppercase tracking-wider">Resolved</span>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-auto px-6 py-5">
        {activeView === "overview" && <StrategicOverview tickets={tickets} onNavigate={setActiveView} />}
        {activeView === "kanban" && (
          <div className="grid grid-cols-3 gap-5 h-full" style={{ minHeight: '0' }}>
            {COLUMNS.map(col => <KanbanColumn key={col.id} column={col} tickets={tickets.filter(t => t.status === col.id)} onStatusChange={() => {}} onDelete={() => {}} onEdit={setModalTicket} onAssignTech={() => {}} />)}
          </div>
        )}
      </main>
      {modalTicket !== null && <TicketModal initial={modalTicket || null} onClose={() => setModalTicket(null)} onSave={() => { setModalTicket(null); fetchTickets(); }} />}
    </div>
  );
}
