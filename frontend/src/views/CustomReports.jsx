import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, RotateCcw, Search } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const initial = {
  date_from: "",
  date_to: "",
  branch_id: "",
  department: "",
  priority: "",
  category_id: "",
  status: "",
  technician_id: "",
};

const emptyOptions = {
  branches: [],
  departments: [],
  department_options: [],
  priorities: [],
  categories: [],
  statuses: [],
  technicians: [],
};

function SelectFilter({ label, value, onChange, options, valueKey = "value", labelKey = "label", emptyLabel = "All" }) {
  return (
    <label className="text-xs font-bold text-slate-600">
      {label}
      <select
        value={value}
        onChange={onChange}
        className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => {
          const primitive = typeof option === "string";
          const optionValue = primitive ? option : option[valueKey];
          return <option key={`${optionValue}-${primitive ? "" : option.branch_id || ""}`} value={optionValue}>{primitive ? option : option[labelKey]}</option>;
        })}
      </select>
    </label>
  );
}

function normalizeOptions(data) {
  return { ...emptyOptions, ...(data || {}) };
}

export default function CustomReports() {
  const [filters, setFilters] = useState(initial);
  const [options, setOptions] = useState(emptyOptions);
  const [rows, setRows] = useState([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const query = useCallback((format) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    if (format) params.set("format", format);
    return params.toString();
  }, [filters]);

  const filteredDepartments = useMemo(() => {
    const structured = options.department_options || [];
    if (!structured.length) return options.departments || [];
    const matching = filters.branch_id
      ? structured.filter((option) => String(option.branch_id) === String(filters.branch_id))
      : structured;
    return [...new Set(matching.map((option) => option.value))].sort((a, b) => a.localeCompare(b));
  }, [filters.branch_id, options.department_options, options.departments]);

  const filteredTechnicians = useMemo(() => options.technicians
    .filter((technician) => !filters.branch_id || String(technician.branch_id) === String(filters.branch_id))
    .filter((technician) => !filters.department || String(technician.department || "").toLowerCase() === filters.department.toLowerCase())
    .map((technician) => ({
      ...technician,
      display_name: [
        technician.full_name,
        !filters.branch_id && technician.branch_name,
        technician.department,
      ].filter(Boolean).join(" - "),
    })), [filters.branch_id, filters.department, options.technicians]);

  const changeFilter = (key, value) => {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "branch_id") {
        const technician = options.technicians.find((item) => String(item.user_id) === String(current.technician_id));
        if (technician && value && String(technician.branch_id) !== String(value)) next.technician_id = "";
        const allowedDepartments = (options.department_options || [])
          .filter((item) => !value || String(item.branch_id) === String(value))
          .map((item) => String(item.value).toLowerCase());
        if (next.department && allowedDepartments.length && !allowedDepartments.includes(next.department.toLowerCase())) next.department = "";
      }
      if (key === "department") {
        const technician = options.technicians.find((item) => String(item.user_id) === String(current.technician_id));
        if (technician && value && String(technician.department || "").toLowerCase() !== value.toLowerCase()) next.technician_id = "";
      }
      return next;
    });
    setRows([]);
    setHasGenerated(false);
    setError("");
    setMessage("");
  };

  const update = (key) => (event) => changeFilter(key, event.target.value);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/api/v1/analytics/report-options`, { headers: authHeaders() })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Failed to load report filters.");
        if (active) setOptions(normalizeOptions(body.data));
      })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, []);

  const validateDates = () => {
    if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) {
      setError("The From date cannot be later than the To date.");
      return false;
    }
    return true;
  };

  const generate = async () => {
    if (!validateDates()) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/analytics/custom-report?${query()}`, { headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Failed to generate report.");
      setRows(Array.isArray(body.data) ? body.data : []);
      setHasGenerated(true);
      setMessage(body.message || "Report generated.");
    } catch (requestError) {
      setRows([]);
      setHasGenerated(false);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const exportFile = async (format) => {
    if (!validateDates()) return;
    setError("");
    setMessage("");
    setExporting(format);
    try {
      const response = await fetch(`${API_URL}/api/v1/analytics/custom-report/export?${query(format)}`, { headers: authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Failed to export ${format.toUpperCase()}.`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `astreablue-custom-report.${format === "excel" ? "xlsx" : format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`${format === "excel" ? "Excel" : format.toUpperCase()} report exported using the current filters.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExporting("");
    }
  };

  const reset = () => {
    setFilters(initial);
    setRows([]);
    setHasGenerated(false);
    setError("");
    setMessage("");
  };

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Reporting & Analytics" title="Custom Reports" subtitle="Build branch-aware Service Desk reports and export the results in standard enterprise formats." />
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-600">From<input type="date" value={filters.date_from} onChange={update("date_from")} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
          <label className="text-xs font-bold text-slate-600">To<input type="date" value={filters.date_to} onChange={update("date_to")} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
          <SelectFilter label="Branch" value={filters.branch_id} onChange={update("branch_id")} options={options.branches} valueKey="branch_id" labelKey="branch_name" emptyLabel="All branches" />
          <SelectFilter label="Department" value={filters.department} onChange={update("department")} options={filteredDepartments} emptyLabel="All departments" />
          <SelectFilter label="Priority" value={filters.priority} onChange={update("priority")} options={options.priorities} emptyLabel="All priorities" />
          <SelectFilter label="Category" value={filters.category_id} onChange={update("category_id")} options={options.categories} valueKey="category_id" labelKey="category_name" emptyLabel="All categories" />
          <SelectFilter label="Status" value={filters.status} onChange={update("status")} options={options.statuses} emptyLabel="All statuses" />
          <SelectFilter label="Technician" value={filters.technician_id} onChange={update("technician_id")} options={filteredTechnicians} valueKey="user_id" labelKey="display_name" emptyLabel={filteredTechnicians.length ? "All technicians" : "No matching technicians"} />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button disabled={loading || Boolean(exporting)} onClick={generate} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"><Search size={15} className="mr-2 inline" />{loading ? "Generating..." : "Generate Report"}</button>
          {["excel", "txt", "pdf"].map((format) => <button disabled={loading || Boolean(exporting)} key={format} onClick={() => exportFile(format)} className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm font-bold uppercase text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 disabled:opacity-60"><Download size={15} className="mr-2 inline" />{exporting === format ? "Preparing..." : format}</button>)}
          <button disabled={loading || Boolean(exporting)} onClick={reset} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"><RotateCcw size={15} className="mr-2 inline" />Reset</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Generate previews the selected records. Excel, TXT, and PDF export the same current filter combination.</p>
        {message && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 p-5"><FileSpreadsheet className="text-blue-600" /><div><h2 className="font-black text-slate-900">Report Results</h2><p className="text-xs text-slate-500">{rows.length} records</p></div></div>
        <div className="max-h-[34rem] overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600"><tr>{["Ticket", "Title", "Priority", "Status", "Category", "Branch", "Technician", "Created"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {rows.length ? rows.slice(0, 200).map((row) => <tr key={row.ticket_number} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="px-4 py-3 font-bold text-blue-700">{row.ticket_number}</td><td className="max-w-xs truncate px-4 py-3">{row.title}</td><td className="px-4 py-3">{row.priority}</td><td className="px-4 py-3">{row.status}</td><td className="px-4 py-3">{row.category}</td><td className="px-4 py-3">{row.branch}</td><td className="px-4 py-3">{row.technician}</td><td className="px-4 py-3">{new Date(row.created_at).toLocaleDateString("en-PH")}</td></tr>) : <tr><td colSpan="8" className="px-4 py-14 text-center text-slate-500">{hasGenerated ? "No records match the selected filters." : "Choose filters and generate a report to view live results."}</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length > 200 && <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">Showing the first 200 records on screen. Exports include all {rows.length} matching records.</p>}
      </section>
    </div>
  );
}
