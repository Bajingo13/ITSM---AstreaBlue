import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Info, Pencil, X } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders, getAuthToken } from "../services/authHeaders";
import { logoutUser } from "../context/AuthService";

const API_BASE = `${API_URL}/api/v1/hardware-assets`;
const money = (value) => Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "PHP" });
const depreciationHelp = {
  "Monthly Expense": "Total monthly depreciation across all tracked assets. Monthly depreciation = (Purchase Cost - Salvage Value) / Useful Life in Months. The summary is the sum for every tracked asset. Example: ₱131,000 over 60 months is ₱2,183.33 per month.",
  "Fully Depreciated": "Book value has reached salvage value or remaining useful life is 0 months.",
  "Near End of Life": "Remaining useful life is 6 months or less, or the asset has reached at least 90% of its useful life.",
};
let redirectingToLogin = false;

function expireSession() {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  logoutUser();
  window.location.replace("/login");
}

async function financialRequest(path, options = {}) {
  if (!getAuthToken()) {
    expireSession();
    throw new Error("Your session has expired. Please sign in again.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  if (response.status === 401) {
    expireSession();
    throw new Error("Your session has expired. Please sign in again.");
  }

  return response;
}

export default function AssetFinancials() {
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [assetsRes, summaryRes] = await Promise.all([
        financialRequest("/financial/assets"),
        financialRequest("/financial/summary"),
      ]);
      const assetsBody = await assetsRes.json();
      const summaryBody = await summaryRes.json();
      if (!assetsRes.ok || assetsBody.success === false) throw new Error(assetsBody.message || assetsBody.error);
      if (!summaryRes.ok || summaryBody.success === false) throw new Error(summaryBody.message || summaryBody.error);
      setAssets(assetsBody.data || []);
      setSummary(summaryBody.data || null);
    } catch (err) {
      setError(err.message || "Failed to load financial tracking.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const refresh = () => loadData();
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [loadData]);

  const cards = useMemo(() => summary ? [
    ["Total Asset Value", money(summary.total_asset_value)],
    ["Current Book Value", money(summary.current_book_value)],
    ["Accumulated Depreciation", money(summary.accumulated_depreciation)],
    ["Monthly Expense", money(summary.monthly_depreciation_expense)],
    ["Fully Depreciated", summary.fully_depreciated_assets],
    ["Near End of Life", summary.assets_near_end_of_life],
  ] : [], [summary]);

  const exportReport = async () => {
    try {
      const res = await financialRequest("/financial/reports/depreciation");
      const body = await res.json();
      if (!res.ok || body.success === false) return setError(body.message || body.error);
      const rows = body.data.assets || [];
      const headers = ["Asset Tag","Asset Name","Purchase Cost","Useful Life Years","Salvage Value","Method","Accumulated Depreciation","Book Value","Remaining Months"];
      const csv = [headers, ...rows.map((a) => [a.asset_tag,a.asset_name,a.purchase_cost,a.useful_life_years,a.salvage_value,a.depreciation_method,a.accumulated_depreciation,a.current_book_value,a.remaining_useful_life_months])]
        .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const link = document.createElement("a"); link.href = url; link.download = `depreciation-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || "Failed to export depreciation report.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Asset Financial Management" title="Depreciation & Financial Tracking" subtitle="Calculate straight-line depreciation from real hardware acquisition data and asset-specific finance settings." actions={<button onClick={exportReport} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700"><Download size={17}/> Export Report</button>} />
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">{error}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label,value]) => <div key={label} title={depreciationHelp[label] || ""} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-500">{label}{label === "Monthly Expense" && <Info size={14} aria-label="Monthly Expense calculation" />}</p><p className="mt-2 text-xl font-black text-slate-900">{value}</p>{depreciationHelp[label] && <p className="mt-2 text-xs leading-5 text-slate-500">{depreciationHelp[label]}</p>}</div>)}</section>
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[1300px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Asset","Purchase Cost","Useful Life","Salvage","Method","Accumulated Depreciation","Book Value","Remaining Useful Life","Depreciation Status","Actions"].map((h)=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>
          {loading ? <tr><td colSpan="10" className="p-8 text-center text-slate-500">Loading financial records...</td></tr> : assets.map((asset) => <tr key={asset.asset_id} className="border-t border-slate-100"><td className="px-4 py-4"><p className="font-black text-slate-900">{asset.asset_tag}</p><p className="text-xs text-slate-500">{asset.asset_name}</p></td><td className="px-4 py-4">{money(asset.purchase_cost)}</td><td className="px-4 py-4">{asset.useful_life_years} years</td><td className="px-4 py-4">{money(asset.salvage_value)}</td><td className="px-4 py-4">{asset.depreciation_method}</td><td className="px-4 py-4">{money(asset.accumulated_depreciation)}</td><td className="px-4 py-4 font-bold">{money(asset.current_book_value)}</td><td className="px-4 py-4">{asset.remaining_useful_life_months} months</td><td className="px-4 py-4"><DepreciationStatus status={asset.depreciation_status} /></td><td className="px-4 py-4"><button onClick={() => setEditing(asset)} className="rounded-xl bg-blue-50 p-2 text-blue-700"><Pencil size={15}/></button></td></tr>)}
        </tbody></table></div>
      </section>
      {editing && <FinanceModal asset={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadData(); }} />}
    </div>
  );
}

function DepreciationStatus({ status = "Active" }) {
  const classes = status === "Fully Depreciated" ? "bg-slate-200 text-slate-800" : status === "Near End of Life" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  return <span title={depreciationHelp[status] || "Asset is within its active useful life."} className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${classes}`}>{status}</span>;
}

function FinanceModal({ asset, onClose, onSaved }) {
  const [form, setForm] = useState({ useful_life_years: asset.useful_life_years || 5, salvage_value: asset.salvage_value || 0, depreciation_method: "Straight-Line", depreciation_start_date: String(asset.depreciation_start_date || asset.purchase_date || "").slice(0,10), disposal_value: asset.disposal_value || "", notes: asset.financial_notes || "" });
  const [error, setError] = useState("");
  const save = async (event) => { event.preventDefault(); try { const res = await financialRequest(`/${asset.asset_id}/financial`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(form) }); const body=await res.json(); if(!res.ok||body.success===false)return setError(body.message||body.error); onSaved(); } catch (requestError) { setError(requestError.message || "Failed to update finance settings."); } };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={save} className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-slate-900">Finance Settings</h2><p className="text-sm text-slate-500">{asset.asset_tag} · {asset.asset_name}</p></div><button type="button" onClick={onClose}><X/></button></div>{error&&<p className="mt-4 rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2">{[["Useful Life (Years)","useful_life_years","number"],["Salvage Value","salvage_value","number"],["Depreciation Start","depreciation_start_date","date"],["Disposal Value","disposal_value","number"]].map(([label,key,type])=><label key={key} className="text-sm font-bold text-slate-700">{label}<input type={type} min="0" step="0.01" value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})} className="mt-2 w-full rounded-xl border px-3 py-2"/></label>)}<label className="sm:col-span-2 text-sm font-bold text-slate-700">Method<select value={form.depreciation_method} onChange={(e)=>setForm({...form,depreciation_method:e.target.value})} className="mt-2 w-full rounded-xl border px-3 py-2"><option>Straight-Line</option></select></label><label className="sm:col-span-2 text-sm font-bold text-slate-700">Notes<textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} className="mt-2 w-full rounded-xl border px-3 py-2"/></label></div><button className="mt-6 w-full rounded-xl bg-blue-700 px-4 py-3 font-black text-white">Save Finance Settings</button></form></div>;
}
