import { X, FileText } from "lucide-react";
import { API_URL } from "../config/api";

export const panelClass = "astrea-interactive-card rounded-2xl border border-slate-100 bg-white p-5 shadow-sm";

const statusColors = {
  Draft: "bg-slate-200 text-slate-700",
  Submitted: "bg-blue-50 text-blue-700",
  "Under Assessment": "bg-amber-50 text-amber-700",
  "Pending Manager Approval": "bg-orange-50 text-orange-700",
  "Pending CAB Review": "bg-violet-50 text-violet-700",
  Approved: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-red-50 text-red-700",
  Scheduled: "bg-cyan-50 text-cyan-700",
  "In Progress": "bg-blue-100 text-blue-800",
  Implemented: "bg-teal-50 text-teal-700",
  "Validation Pending": "bg-yellow-50 text-yellow-700",
  Completed: "bg-emerald-100 text-emerald-800",
  Failed: "bg-red-100 text-red-800",
  "Rolled Back": "bg-rose-50 text-rose-700",
  Cancelled: "bg-slate-200 text-slate-500",
  Planned: "bg-slate-100 text-slate-600",
  Deploying: "bg-blue-100 text-blue-800",
  Verifying: "bg-amber-50 text-amber-700",
  Available: "bg-cyan-50 text-cyan-700",
  Executed: "bg-blue-100 text-blue-800",
  Verified: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${
        statusColors[status] || "bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

const riskColors = {
  Low: "bg-emerald-50 text-emerald-700",
  Medium: "bg-amber-50 text-amber-700",
  High: "bg-orange-50 text-orange-700",
  Critical: "bg-red-50 text-red-700",
};

export function RiskBadge({ level }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${
        riskColors[level] || "bg-slate-100 text-slate-600"
      }`}
    >
      {level}
    </span>
  );
}

const priorityColors = {
  Low: "bg-slate-100 text-slate-600",
  Medium: "bg-blue-50 text-blue-700",
  High: "bg-orange-50 text-orange-700",
  Critical: "bg-red-50 text-red-700",
};

export function PriorityBadge({ priority }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${
        priorityColors[priority] || "bg-slate-100 text-slate-600"
      }`}
    >
      {priority}
    </span>
  );
}

const changeTypeColors = {
  Standard: "bg-emerald-50 text-emerald-700",
  Normal: "bg-blue-50 text-blue-700",
  Emergency: "bg-red-50 text-red-700",
};

export function ChangeTypeBadge({ type }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${
        changeTypeColors[type] || "bg-slate-100 text-slate-600"
      }`}
    >
      {type}
    </span>
  );
}

export function MetricCard({ icon: Icon, label, value, detail, tone = "bg-blue-50 text-blue-700" }) {
  return (
    <section className={`${panelClass} astrea-premium-card astrea-dashboard-enter group`}>
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}
      >
        <Icon size={19} className="transition duration-300 group-hover:scale-110" />
      </div>
      <p className="mt-4 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-bold text-slate-700">{label}</p>
      {detail && <p className="mt-1 text-xs text-slate-400">{detail}</p>}
    </section>
  );
}

export function ProgressBar({ value = 0 }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] font-bold text-slate-500">
        <span>Progress</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="astrea-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12">
      <section
        className={`my-8 w-full rounded-3xl bg-white p-6 shadow-2xl ${
          wide ? "max-w-5xl" : "max-w-2xl"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-slate-900">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="astrea-icon-button rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}

export function EmptyState({ title, message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
      <p className="font-black text-slate-700">{title}</p>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
  );
}

export function LoadingSkeleton({ rows = 6 }) {
  return (
    <div className="grid animate-pulse gap-4 md:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-40 rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}

export function AttachmentItem({ attachment }) {
  return (
    <a
      key={attachment.id}
      href={`${API_URL}${attachment.file_path}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50 hover:translate-x-1"
    >
      <FileText size={17} />
      <span className="truncate">{attachment.file_name}</span>
      <span className="ml-auto text-xs text-slate-400">
        {attachment.file_size ? `${(attachment.file_size / 1024).toFixed(1)} KB` : ""}
      </span>
    </a>
  );
}

export function TimelineItem({ activity }) {
  return (
    <div className="relative border-l-2 border-blue-100 pl-4 pb-4">
      <i className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-500" />
      <p className="text-sm font-bold text-slate-700">{activity.message}</p>
      <p className="mt-1 text-xs text-slate-400">
        {activity.actor_name || "System"} ·{" "}
        {new Date(activity.created_at).toLocaleString()}
      </p>
    </div>
  );
}

export function ActivityTimeline({ activities }) {
  if (!activities?.length) {
    return <p className="text-sm text-slate-400">No activity recorded.</p>;
  }
  return (
    <div className="max-h-96 space-y-1 overflow-y-auto">
      {activities.map((activity) => (
        <TimelineItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

export function SectionCard({ title, icon, children, action }) {
  return (
    <section className={panelClass}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-black text-slate-900 flex items-center gap-2">
          {icon && <span className="text-blue-600">{icon}</span>}
          {title}
        </h3>
        {action && <div>{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function InfoRow({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-700">
        {value || "—"}
      </p>
    </div>
  );
}

export function ConfirmationDialog({ title, message, confirmLabel, onConfirm, onCancel, danger = false }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-black text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="astrea-button astrea-button-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            className={`astrea-button ${danger ? "bg-red-600 text-white hover:bg-red-700" : "astrea-button-primary"}`}
          >
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
