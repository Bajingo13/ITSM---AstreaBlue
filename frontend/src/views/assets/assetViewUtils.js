export const EMPTY_DETAIL_VALUE = "-";

export const BASE_ASSET_TYPES = [
  "Laptop",
  "Desktop",
  "Monitor",
  "Printer",
  "Phone",
  "Tablet",
  "Router",
];

export const ASSET_TYPES = ["All", ...BASE_ASSET_TYPES, "Other"];

export const STATUS_OPTIONS = [
  "All",
  "Available",
  "In Use",
  "Maintenance",
  "Active",
  "In Stock",
  "Borrowed",
  "In Repair",
  "Retired",
  "Disposed",
  "Lost/Damaged",
];

export const MODAL_ASSET_TYPE_OPTIONS = [
  ...BASE_ASSET_TYPES.map((type) => ({ label: type, value: type })),
  { label: "other", value: "Other" },
];

export const MODAL_STATUS_OPTIONS = [
  { label: "available", value: "Available" },
  { label: "in use", value: "In Use" },
  { label: "maintenance", value: "Maintenance" },
  { label: "active", value: "Active" },
  { label: "in repair", value: "In Repair" },
  { label: "in stock", value: "In Stock" },
  { label: "retired", value: "Retired" },
  { label: "disposed", value: "Disposed" },
  { label: "borrowed", value: "Borrowed" },
  { label: "lost / damaged", value: "Lost/Damaged" },
];

export const SORT_OPTIONS = [
  { value: "latest", label: "Latest Hardware Assets" },
  { value: "oldest", label: "Oldest Hardware Assets" },
  { value: "updated", label: "Recently Updated" },
  { value: "alphabetical", label: "Alphabetical (A-Z)" },
];

export const STATUS_FILTER_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Borrowed", label: "Borrowed" },
  { value: "In Repair", label: "Under Repair" },
  { value: "Retired", label: "Retired" },
  { value: "Disposed", label: "Disposed" },
];

export const QUICK_FILTER_OPTIONS = [
  { value: "inStock", label: "In Stock Only" },
  { value: "assigned", label: "Assigned Only" },
  { value: "unassigned", label: "Unassigned Only" },
];

export const BRANCH_CARD_GAP = 16;

export function getBranchCode(branchName) {
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

export function getStatusClasses(status) {
  switch (status) {
    case "Available":
      return "bg-emerald-50 text-emerald-700";
    case "In Use":
      return "bg-blue-50 text-blue-700";
    case "Maintenance":
      return "bg-orange-50 text-orange-700";
    case "Lost":
    case "Damaged":
    case "Lost/Damaged":
      return "bg-red-50 text-red-700";
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

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export function formatDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function isMissingAssetValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function formatDetailDate(value) {
  if (isMissingAssetValue(value)) return EMPTY_DETAIL_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export function formatDetailDateTime(value) {
  if (isMissingAssetValue(value)) return EMPTY_DETAIL_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function getNestedAssetValue(source, path) {
  return String(path)
    .split(".")
    .reduce((current, key) => {
      if (current === null || current === undefined) return undefined;
      return current[key];
    }, source);
}

export function firstAssetValue(source, paths) {
  for (const path of paths) {
    const value = typeof path === "function" ? path(source) : getNestedAssetValue(source, path);
    if (!isMissingAssetValue(value)) return value;
  }
  return null;
}

export function joinAssetValues(values, separator = " / ") {
  const presentValues = values
    .filter((value) => !isMissingAssetValue(value))
    .map((value) => String(value).trim());
  return presentValues.length ? presentValues.join(separator) : null;
}

export function formatAssetDetailValue(value, formatter) {
  const nextValue = formatter && !isMissingAssetValue(value) ? formatter(value) : value;

  if (isMissingAssetValue(nextValue)) return EMPTY_DETAIL_VALUE;
  if (typeof nextValue === "boolean") return nextValue ? "Yes" : "No";
  if (Array.isArray(nextValue)) {
    const values = nextValue
      .map((item) => formatAssetDetailValue(item))
      .filter((item) => item !== EMPTY_DETAIL_VALUE);
    return values.length ? values.join(", ") : EMPTY_DETAIL_VALUE;
  }
  if (typeof nextValue === "object") {
    const namedValue = firstAssetValue(nextValue, [
      "name",
      "file_name",
      "full_name",
      "branch_name",
      "supplier_name",
      "label",
      "title",
    ]);
    return isMissingAssetValue(namedValue) ? JSON.stringify(nextValue) : String(namedValue);
  }

  return String(nextValue);
}

export function assetDetailItem(label, asset, paths, formatter) {
  return {
    label,
    value: formatAssetDetailValue(firstAssetValue(asset, Array.isArray(paths) ? paths : [paths]), formatter),
  };
}

export function toggleArrayValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function getAssignedAssetValue(asset) {
  return String(asset.assigned_name || asset.borrower_name || "").trim();
}

export function getSortTimestamp(asset, key) {
  const value = asset[key];
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

export function getSortOptionLabel(value) {
  return SORT_OPTIONS.find((option) => option.value === value)?.label || SORT_OPTIONS[0].label;
}

export function getStatusFilterLabel(value) {
  return STATUS_FILTER_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function getQuickFilterLabel(value) {
  return QUICK_FILTER_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function buildFilterSummary({
  sortMode,
  sortTouched,
  statusFilters,
  quickFilters,
  conditionFilters,
  typeFilter,
  manufacturerFilter,
  departmentFilter,
  assignedFilter,
}) {
  const chips = [
    ...statusFilters.map(getStatusFilterLabel),
    ...quickFilters.map(getQuickFilterLabel),
    ...conditionFilters,
  ];

  if (typeFilter !== "All") chips.push(typeFilter);
  if (manufacturerFilter !== "All") chips.push(manufacturerFilter);
  if (departmentFilter !== "All") chips.push(departmentFilter);
  if (assignedFilter !== "All") chips.push(assignedFilter);

  if (chips.length > 0) {
    return chips.length <= 2 ? chips.join(" + ") : `${chips.slice(0, 2).join(" + ")} +${chips.length - 2}`;
  }

  return sortTouched ? getSortOptionLabel(sortMode) : "Sort & Filter";
}

export function normalizeAssetType(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function getKnownAssetType(value, knownTypes = ASSET_TYPES) {
  const normalized = normalizeAssetType(value);
  return knownTypes.find((type) => type.toLowerCase() === normalized.toLowerCase()) || normalized;
}

export function getModalAssetTypeState(assetType) {
  const normalized = normalizeAssetType(assetType);
  if (!normalized) {
    return { assetType: "Laptop", customAssetType: "" };
  }
  if (normalized.toLowerCase() === "other") {
    return { assetType: "Other", customAssetType: "" };
  }

  const baseType = getKnownAssetType(normalized, BASE_ASSET_TYPES);
  if (BASE_ASSET_TYPES.includes(baseType)) {
    return { assetType: baseType, customAssetType: "" };
  }

  return { assetType: "Other", customAssetType: normalized };
}

export function getAssetFormInitialState(asset, currentBranchId) {
  const assetTypeState = getModalAssetTypeState(asset?.asset_type);

  return {
    asset_name: asset?.asset_name || "",
    asset_type: assetTypeState.assetType,
    custom_asset_type: assetTypeState.customAssetType,
    manufacturer: asset?.manufacturer || asset?.brand || "",
    brand: asset?.brand || asset?.manufacturer || "",
    model: asset?.model || "",
    serial_number: asset?.serial_number || "",
    asset_tag: asset?.asset_tag || "",
    branch_id: asset?.branch_id ? String(asset.branch_id) : String(currentBranchId || ""),
    status: asset?.status || "Active",
    color: asset?.color || "",
    purchase_date: formatDateInput(asset?.purchase_date),
    purchase_price: asset?.purchase_price ?? "",
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
    attachments: Array.isArray(asset?.attachments) ? asset.attachments : [],
    image_url: asset?.image_url || "",
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
