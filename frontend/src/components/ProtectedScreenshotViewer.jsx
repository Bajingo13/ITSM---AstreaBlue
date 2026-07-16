import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/endpoint-management`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Unknown time";
const clampZoom = (value) => Math.min(300, Math.max(25, value));
const iconControlClass = "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30";
const textControlClass = "h-9 rounded-lg bg-white/10 px-3 text-xs font-black text-white transition hover:bg-white/20";

export default function ProtectedScreenshotViewer({ screenshot, items = [], onSelect, onClose }) {
  const viewerRef = useRef(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("fit");
  const [zoom, setZoom] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [downloading, setDownloading] = useState(false);

  const index = useMemo(() => items.findIndex((item) => String(item.id) === String(screenshot?.id)), [items, screenshot?.id]);
  const canPrevious = index > 0;
  const canNext = index >= 0 && index < items.length - 1;

  useEffect(() => {
    if (!screenshot?.content_url) return undefined;
    let active = true;
    let objectUrl = "";
    setLoading(true);
    setError("");
    setMode("fit");
    setZoom(100);
    setDimensions({ width: 0, height: 0 });

    Promise.all([
      fetch(`${API_BASE}/screenshots/${screenshot.id}/audit-view`, { method: "POST", headers: authHeaders() }),
      fetch(`${API_URL}${screenshot.content_url}`, { headers: authHeaders() }),
    ]).then(async ([auditResponse, contentResponse]) => {
      if (!auditResponse.ok) throw new Error("Screenshot access could not be audited.");
      if (!contentResponse.ok) throw new Error("Protected screenshot could not be loaded.");
      objectUrl = URL.createObjectURL(await contentResponse.blob());
      if (active) setSource(objectUrl);
    }).catch((requestError) => {
      if (active) setError(requestError.message || "Protected screenshot could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [screenshot?.content_url, screenshot?.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canPrevious) onSelect(items[index - 1]);
      if (event.key === "ArrowRight" && canNext) onSelect(items[index + 1]);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [canNext, canPrevious, index, items, onClose, onSelect]);

  const changeZoom = (amount) => {
    setMode("actual");
    setZoom((value) => clampZoom(value + amount));
  };

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await viewerRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      setError("Browser fullscreen was blocked. Press F11 or allow fullscreen access.");
    }
  };

  const downloadScreenshot = async () => {
    if (!source || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const auditResponse = await fetch(`${API_BASE}/screenshots/${screenshot.id}/audit-download`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!auditResponse.ok) throw new Error("Screenshot download could not be audited.");
      const safeHost = String(screenshot.hostname || "managed-endpoint").replace(/[^a-z0-9_-]+/gi, "-");
      const captured = new Date(screenshot.captured_at || screenshot.capturedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
      const link = document.createElement("a");
      link.href = source;
      link.download = `astreablue-${safeHost}-${captured}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (downloadError) {
      setError(downloadError.message || "Protected screenshot could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  };

  const imageStyle = mode === "fit"
    ? { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }
    : {
        width: dimensions.width ? `${Math.round(dimensions.width * zoom / 100)}px` : "auto",
        height: dimensions.height ? `${Math.round(dimensions.height * zoom / 100)}px` : "auto",
        maxWidth: "none",
        maxHeight: "none",
      };

  return createPortal(
    <div ref={viewerRef} className="fixed inset-0 z-[200] flex h-[100dvh] w-screen flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Protected screenshot viewer">
      <header className="z-10 shrink-0 border-b border-white/10 bg-slate-950 px-3 py-3 shadow-xl sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-black">{screenshot.assigned_user || screenshot.employee || screenshot.hostname || "Protected screenshot"}</p>
            <p className="truncate text-xs text-slate-300">{screenshot.hostname || "Managed endpoint"} · {screenshot.branch_name || "Authorized scope"} · {formatDate(screenshot.captured_at || screenshot.capturedAt)}</p>
          </div>
          <nav className="flex flex-wrap items-center justify-end gap-1.5" aria-label="Screenshot controls">
            <button type="button" disabled={!canPrevious} onClick={() => onSelect(items[index - 1])} className={iconControlClass} title="Previous screenshot"><ChevronLeft size={18} /></button>
            <button type="button" disabled={!canNext} onClick={() => onSelect(items[index + 1])} className={iconControlClass} title="Next screenshot"><ChevronRight size={18} /></button>
            <span className="mx-1 h-7 w-px bg-white/15" />
            <button type="button" onClick={() => changeZoom(-25)} className={iconControlClass} title="Zoom out"><ZoomOut size={17} /></button>
            <button type="button" onClick={() => { setMode("fit"); setZoom(100); }} className={`${textControlClass} ${mode === "fit" ? "!bg-blue-600" : ""}`}>Fit</button>
            <button type="button" onClick={() => { setMode("actual"); setZoom(100); }} className={`${textControlClass} ${mode === "actual" && zoom === 100 ? "!bg-blue-600" : ""}`}>100%</button>
            <span className="w-12 text-center text-xs font-black text-slate-300">{mode === "fit" ? "Fit" : `${zoom}%`}</span>
            <button type="button" onClick={() => changeZoom(25)} className={iconControlClass} title="Zoom in"><ZoomIn size={17} /></button>
            <button type="button" onClick={enterFullscreen} className={iconControlClass} title="Enter browser fullscreen"><Maximize2 size={17} /></button>
            <button type="button" disabled={!source || downloading} onClick={downloadScreenshot} className={iconControlClass} title="Download audited copy"><Download size={17} /></button>
            <button type="button" onClick={onClose} className="ml-1 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-950 shadow-lg transition hover:scale-105 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-400/50" aria-label="Close screenshot viewer" title="Close (Esc)"><X size={24} strokeWidth={3} /></button>
          </nav>
        </div>
        {error && <p className="mt-2 rounded-lg bg-rose-500/20 px-3 py-2 text-xs font-bold text-rose-100">{error}</p>}
      </header>
      <main className={`min-h-0 flex-1 overflow-auto bg-black p-2 ${mode === "fit" ? "flex items-center justify-center" : "block"}`}>
        {loading && <div className="m-auto text-sm font-bold text-slate-400">Decrypting protected screenshot…</div>}
        {!loading && source && <img src={source} alt="Consent-approved endpoint screenshot" draggable="false" onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={imageStyle} className="select-none object-contain" />}
      </main>
    </div>,
    document.body,
  );
}
