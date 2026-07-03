export const priorityOptions = ["P1-Critical", "P2-High", "P3-Medium", "P4-Low"];
export const severityOptions = ["Critical", "High", "Medium", "Low"];

const badgeBaseClass =
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-black transition-colors";

const severityStyles = {
  critical: {
    badge: "border-red-700 bg-red-600 text-white",
    select:
      "border-red-700 bg-red-600 text-white hover:bg-red-700 focus:border-red-800 focus:ring-red-200",
    option: { backgroundColor: "#dc2626", color: "#ffffff" },
  },
  high: {
    badge: "border-red-200 bg-red-50 text-red-700",
    select:
      "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:border-red-500 focus:ring-red-100",
    option: { backgroundColor: "#fef2f2", color: "#b91c1c" },
  },
  medium: {
    badge: "border-yellow-200 bg-yellow-50 text-yellow-800",
    select:
      "border-yellow-200 bg-yellow-50 text-yellow-800 hover:bg-yellow-100 focus:border-yellow-500 focus:ring-yellow-100",
    option: { backgroundColor: "#fef9c3", color: "#854d0e" },
  },
  low: {
    badge: "border-green-200 bg-green-50 text-green-700",
    select:
      "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 focus:border-green-500 focus:ring-green-100",
    option: { backgroundColor: "#dcfce7", color: "#166534" },
  },
  fallback: {
    badge: "border-slate-200 bg-slate-100 text-slate-600",
    select:
      "border-slate-200 bg-slate-50 text-slate-900 hover:bg-white focus:border-blue-600 focus:bg-white focus:ring-blue-100",
    option: {},
  },
};

const statusStyles = {
  open: "border-blue-200 bg-blue-50 text-blue-700",
  progress: "border-amber-200 bg-amber-50 text-amber-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-slate-200 bg-slate-100 text-slate-600",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  fallback: "border-slate-200 bg-slate-100 text-slate-600",
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compact(value) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

export function getSeverityLevel(value) {
  const normalized = compact(value);

  if (normalized.startsWith("p1") || normalized === "critical") return "critical";
  if (normalized.startsWith("p2") || normalized === "high") return "high";
  if (normalized.startsWith("p3") || normalized === "medium") return "medium";
  if (normalized.startsWith("p4") || normalized === "low") return "low";

  return "fallback";
}

export function getPriorityBadgeClass(priority) {
  const level = getSeverityLevel(priority);
  return `${badgeBaseClass} ${severityStyles[level].badge}`;
}

export function getSeveritySelectClass(value) {
  const level = getSeverityLevel(value);
  return severityStyles[level].select;
}

export function getSeverityOptionStyle(value) {
  const level = getSeverityLevel(value);
  return severityStyles[level].option;
}

function getStatusLevel(status) {
  const normalized = compact(status);

  if (normalized === "openqueue") return "open";
  if (normalized === "inprogress") return "progress";
  if (normalized === "resolved") return "resolved";
  if (normalized === "closed") return "closed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";

  return "fallback";
}

export function getStatusBadgeClass(status) {
  const level = getStatusLevel(status);
  return `${badgeBaseClass} ${statusStyles[level]}`;
}

export function formatPriority(priority) {
  const level = getSeverityLevel(priority);
  if (level === "critical") return "P1 - Critical";
  if (level === "high") return "P2 - High";
  if (level === "medium") return "P3 - Medium";
  if (level === "low") return "P4 - Low";
  return priority || "P3 - Medium";
}
