import { Download, FileSpreadsheet, Image, Printer, X } from "lucide-react";

const options = [
  { value: "excel", label: "Excel / CSV", description: "Spreadsheet-ready rows", icon: FileSpreadsheet },
  { value: "jpg", label: "JPG Image", description: "AstreaBlue report image", icon: Image },
  { value: "print", label: "Print / PDF", description: "Use the browser print dialog", icon: Printer },
];

export default function ExportReportModal({
  title,
  subtitle = "Export the records matching your current filters.",
  format,
  onFormatChange,
  onClose,
  onExport,
  busy = false,
  branches = [],
  branchId = "all",
  onBranchChange,
  dateFrom = "",
  dateTo = "",
  onDateFromChange,
  onDateToChange,
  showDates = false,
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-xl overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-5">
          <div><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="mt-1 text-sm font-semibold text-slate-500">{subtitle}</p></div>
          <button type="button" aria-label="Close export" onClick={onClose} className="rounded-xl border border-blue-100 bg-white p-2 text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"><X size={19}/></button>
        </header>
        <div className="space-y-5 p-6">
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">File format</p>
            <div className="grid gap-3 sm:grid-cols-3">{options.map(({ value, label, description, icon: Icon }) => <button key={value} type="button" onClick={() => onFormatChange(value)} className={`rounded-2xl border p-4 text-left transition ${format === value ? "border-blue-500 bg-blue-50 ring-4 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/50"}`}><Icon size={20} className={format === value ? "text-blue-700" : "text-slate-500"}/><p className="mt-3 text-sm font-black text-slate-900">{label}</p><p className="mt-1 text-xs font-semibold text-slate-500">{description}</p></button>)}</div>
          </div>
          {onBranchChange && <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">Branch</span><select value={branchId} onChange={(event) => onBranchChange(event.target.value)} className="w-full rounded-xl border border-blue-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"><option value="all">All branches</option>{branches.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name}</option>)}</select></label>}
          {showDates && <div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">From date</span><input type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} className="w-full rounded-xl border border-blue-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"/></label><label><span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">To date</span><input type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} className="w-full rounded-xl border border-blue-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"/></label></div>}
        </div>
        <footer className="flex justify-end gap-3 border-t border-blue-100 bg-slate-50 px-6 py-4"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 hover:bg-slate-100">Cancel</button><button type="button" disabled={busy} onClick={onExport} className="inline-flex items-center gap-2 rounded-xl border border-blue-700 bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"><Download size={17}/>{busy ? "Preparing..." : "Continue"}</button></footer>
      </section>
    </div>
  );
}
