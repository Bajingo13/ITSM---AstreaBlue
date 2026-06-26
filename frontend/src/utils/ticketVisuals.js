export const priorityOptions = ["P1-Critical", "P2-High", "P3-Medium", "P4-Low"];
export const severityOptions = ["Critical", "High", "Medium", "Low"];

const badgeBaseClass =
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-black transition-colors";

const severityStyles = {
  critical: {
    badge: "border-red-200 bg-red-100 text-red-800",
    select:
      "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 focus:border-red-500 focus:ring-red-100",
    option: { backgroundColor: "#fee2e2", color: "#991b1b" },
  },
  high: {
    badge: "border-pink-200 bg-pink-50 text-pink-700",
    select:
      "border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100 focus:border-pink-500 focus:ring-pink-100",
    option: { backgroundColor: "#fce7f3", color: "#9d174d" },
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
