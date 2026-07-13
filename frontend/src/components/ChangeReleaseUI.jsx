import { X } from "lucide-react";

export const panelClass = "astrea-interactive-card rounded-2xl border border-slate-100 bg-white p-5 shadow-sm";

const statusColors = {
  Draft: "bg-slate-100 text-slate-600", Submitted: "bg-blue-50 text-blue-700", "Risk Assessment": "bg-amber-50 text-amber-700",
  "CAB Review": "bg-violet-50 text-violet-700", Approved: "bg-emerald-50 text-emerald-700", Scheduled: "bg-cyan-50 text-cyan-700",
  "In Progress": "bg-blue-100 text-blue-800", Completed: "bg-emerald-100 text-emerald-800", Closed: "bg-slate-200 text-slate-700",
  Planned: "bg-slate-100 text-slate-600", Deploying: "bg-blue-100 text-blue-800", Verifying: "bg-amber-50 text-amber-700",
  Available: "bg-cyan-50 text-cyan-700", Executed: "bg-blue-100 text-blue-800", Verified: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ status }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${statusColors[status] || "bg-slate-100 text-slate-600"}`}>{status}</span>;
}

export function MetricCard({ icon: Icon, label, value, detail, tone = "bg-blue-50 text-blue-700" }) {
  return <section className={panelClass}><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon size={19}/></div><p className="mt-4 text-2xl font-black text-slate-900">{value}</p><p className="mt-1 text-sm font-bold text-slate-700">{label}</p>{detail && <p className="mt-1 text-xs text-slate-400">{detail}</p>}</section>;
}

export function ProgressBar({ value = 0 }) {
  return <div><div className="mb-1 flex justify-between text-[11px] font-bold text-slate-500"><span>Progress</span><span>{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }}/></div></div>;
}

export function Modal({ title, subtitle, onClose, children, wide = false }) {
  return <div className="astrea-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"><section className={`max-h-[92vh] w-full overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ${wide ? "max-w-5xl" : "max-w-2xl"}`}><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-black text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div><button type="button" onClick={onClose} className="astrea-icon-button rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-700" aria-label="Close"><X size={20}/></button></div><div className="mt-6">{children}</div></section></div>;
}

export function EmptyState({ title, message }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center"><p className="font-black text-slate-700">{title}</p><p className="mt-2 text-sm text-slate-400">{message}</p></div>;
}
