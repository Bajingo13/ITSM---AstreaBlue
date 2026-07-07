import { useCallback, useEffect, useState } from "react";
import { Camera, HardDrive, MonitorPlay, Maximize2, X, ShieldCheck } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/laptop-monitoring`;

const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";

export default function ScreenshotCapture() {
  const [stats, setStats] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullImage, setFullImage] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setError("");
      const [statsRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/screenshots/stats`, { headers: authHeaders() }),
        fetch(`${API_BASE}/screenshots`, { headers: authHeaders() })
      ]);
      const statsBody = await statsRes.json();
      const listBody = await listRes.json();

      if (!statsRes.ok || statsBody.success === false) throw new Error(statsBody.message || "Failed to load stats");
      if (!listRes.ok || listBody.success === false) throw new Error(listBody.message || "Failed to load screenshots");

      setStats(statsBody.data);
      setScreenshots(listBody.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 60000);
    return () => clearInterval(timer);
  }, [loadData]);

  const cards = [
    ["Today's Screenshots", stats?.todays_screenshots || 0, Camera],
    ["Devices Reporting", stats?.devices_reporting || 0, MonitorPlay],
    ["Storage Used", `${stats?.storage_used_mb || 0} MB`, HardDrive],
  ];

  return (
    <div className="space-y-6 pb-20">
      <PageHero 
        eyebrow="System Administration" 
        title="Enterprise Screenshot Monitoring" 
        subtitle="Visual activity logs with strict RA 10173 consent enforcement and auto-redaction."
      />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p>
              <Icon size={18} className="text-blue-600" />
            </div>
            <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
          </div>
        ))}
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
           <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-wider text-blue-700">Last Screenshot</p>
              <Camera size={18} className="text-blue-600" />
            </div>
            <p className="mt-3 text-sm font-black text-blue-900 truncate">
              {stats?.last_screenshot ? formatDate(stats.last_screenshot) : "None"}
            </p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-black text-slate-900">Screenshot Gallery</h2>
          <div className="flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-bold text-blue-700">
            <ShieldCheck size={14} /> Captured under active RA 10173 consent.
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading gallery...</p>
        ) : screenshots.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 p-10 text-center">
            <MonitorPlay size={40} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-bold text-slate-500">No screenshots have been captured yet.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {screenshots.map((s) => (
              <div key={s.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 hover:shadow-lg transition">
                <div 
                  className="aspect-video w-full cursor-pointer bg-slate-200 bg-cover bg-center"
                  style={{ backgroundImage: `url(${s.thumbnail_url || s.file_url || ""})` }}
                  onClick={() => {
                    setFullImage(s);
                    fetch(`${API_BASE}/screenshots/${s.id}/audit-view`, { method: "POST", headers: authHeaders() }).catch(console.error);
                  }}
                >
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-transparent transition group-hover:bg-slate-900/40 group-hover:text-white">
                    <Maximize2 size={24} />
                  </div>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-bold text-slate-900" title={s.assigned_user || s.hostname}>
                    {s.assigned_user || s.hostname}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {s.branch_name || "Unassigned"} · {s.department || "No Dept"}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {formatDate(s.captured_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {fullImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 sm:p-10">
          <button 
            className="absolute right-6 top-6 text-white hover:text-slate-300"
            onClick={() => setFullImage(null)}
          >
            <X size={32} />
          </button>
          <div className="flex h-full w-full flex-col">
            <div className="mb-4 text-white">
              <h3 className="text-xl font-black">{fullImage.assigned_user || fullImage.hostname}</h3>
              <p className="text-sm text-slate-300">
                {fullImage.hostname} · {fullImage.branch_name || "Unassigned"} · {formatDate(fullImage.captured_at)}
              </p>
            </div>
            <div className="flex-1 overflow-hidden rounded-xl bg-black">
              {fullImage.file_url ? (
                <img 
                  src={fullImage.file_url} 
                  alt="Screenshot" 
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-500">Image file not available (Metadata only)</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
