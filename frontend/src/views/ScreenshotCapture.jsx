import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronLeft, ChevronRight, HardDrive, MonitorPlay, Maximize2, X, ShieldCheck } from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const PAGE_SIZE = 12;

const formatDate = (value) => value ? new Date(value).toLocaleString() : "Never";

function ProtectedScreenshot({ screenshot, className, onClick }) {
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const load = async () => {
      try {
        const response = await fetch(`${API_URL}${screenshot.content_url}`, { headers: authHeaders() });
        if (!response.ok) throw new Error("Protected screenshot is unavailable.");
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setSource(objectUrl);
      } catch {
        if (active) setSource("");
      }
    };
    load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [screenshot.content_url]);

  if (!source) return <div className={`${className} flex items-center justify-center bg-slate-100 text-xs font-semibold text-slate-400`}>Protected image</div>;
  return <img src={source} alt="Consent-approved endpoint screenshot" className={className} onClick={onClick} />;
}

export default function ScreenshotCapture() {
  const [stats, setStats] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullImage, setFullImage] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, total_pages: 1 });

  const loadData = useCallback(async () => {
    try {
      setError("");
      const [statsRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/screenshots/stats`, { headers: authHeaders() }),
        fetch(`${API_BASE}/screenshots?page=${page}&limit=${PAGE_SIZE}`, { headers: authHeaders() })
      ]);
      const statsBody = await statsRes.json();
      const listBody = await listRes.json();

      if (!statsRes.ok || statsBody.success === false) throw new Error(statsBody.message || "Failed to load stats");
      if (!listRes.ok || listBody.success === false) throw new Error(listBody.message || "Failed to load screenshots");

      setStats(statsBody.data);
      setScreenshots(listBody.data);
      setPagination(listBody.pagination || { page, total: listBody.data.length, total_pages: 1 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 60000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (!fullImage) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setFullImage(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fullImage]);

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
          <div>
            <h2 className="text-xl font-black text-slate-900">Screenshot Gallery</h2>
            <p className="mt-1 text-sm text-slate-500">{pagination.total} protected screenshot{pagination.total === 1 ? "" : "s"} · 12 per page</p>
          </div>
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
                  className="relative aspect-video w-full cursor-pointer overflow-hidden bg-slate-200"
                  onClick={() => {
                    setFullImage(s);
                    fetch(`${API_BASE}/screenshots/${s.id}/audit-view`, { method: "POST", headers: authHeaders() }).catch(console.error);
                  }}
                >
                  <ProtectedScreenshot screenshot={s} className="h-full w-full object-cover" />
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

        {!loading && pagination.total_pages > 1 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-sm font-semibold text-slate-500">Page {pagination.page} of {pagination.total_pages}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={16} /> Previous</button>
              <button type="button" onClick={() => setPage((value) => Math.min(pagination.total_pages, value + 1))} disabled={page >= pagination.total_pages} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">Next <ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </section>

      {fullImage && createPortal((
        <div className="fixed inset-0 z-[120] flex h-[100dvh] w-screen bg-black" role="dialog" aria-modal="true" aria-label="Protected screenshot viewer">
          <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-900 px-4 py-3 text-white sm:px-5">
              <div className="min-w-0">
                <h3 className="truncate font-black">{fullImage.assigned_user || fullImage.hostname}</h3>
                <p className="truncate text-xs text-slate-300">{fullImage.hostname} · {fullImage.branch_name || "Unassigned"} · {formatDate(fullImage.captured_at)}</p>
              </div>
              <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-slate-950 shadow-lg transition hover:scale-105 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-400/50" onClick={() => setFullImage(null)} aria-label="Close screenshot viewer" title="Close (Esc)">
                <X size={24} strokeWidth={3} />
              </button>
            </div>
            <div className="min-h-0 flex flex-1 items-center justify-center overflow-auto bg-black p-2">
              <ProtectedScreenshot screenshot={fullImage} className="h-full w-full object-contain" />
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
