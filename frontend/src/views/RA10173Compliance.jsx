import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  CheckCircle,
  ChevronRight,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Monitor,
  MousePointerClick,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/ra-10173-compliance`;

const STEPS = [
  { label: "Introduction", icon: Shield },
  { label: "Tracking Preferences", icon: Activity },
  { label: "Digital Signature", icon: FileText },
  { label: "Confirmation", icon: CheckCircle },
  { label: "Complete", icon: Award },
];

const MONITORING_CATEGORIES = [
  { key: "application_monitoring", label: "Application Monitoring", description: "Monitor application usage and activity on company-issued devices", required: false },
  { key: "web_monitoring", label: "Web Activity Monitoring", description: "Track browsing activity and websites visited during work hours", required: false },
  { key: "location_tracking", label: "Location Tracking", description: "Track device location for security and asset management", required: false },
  { key: "device_telemetry", label: "Device Telemetry", description: "Collect device performance data, health metrics, and system information", required: true },
  { key: "email_header_monitoring", label: "Email Header Monitoring", description: "Monitor email header information for security compliance", required: false },
];

const STATUS_BADGE = {
  Consented: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  Revoked: "bg-rose-100 text-rose-800 border-rose-200",
};

const normalizeRole = (role = "") => role.toString().toLowerCase().replace(/[\s_-]/g, "");
const isSuperAdmin = (role) => normalizeRole(role) === "superadmin";
const isAdmin = (role) => normalizeRole(role) === "admin";
const isEmployee = (role) => normalizeRole(role) === "employee";
const isAdminOrSuper = (role) => isSuperAdmin(role) || isAdmin(role);

function formatDate(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" });
}

function formatDateShort(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "short", timeStyle: "short" });
}

function StepIndicator({ currentStep }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all ${
                  index < currentStep
                    ? "bg-emerald-500 text-white shadow-lg shadow-emerald-200"
                    : index === currentStep
                    ? "bg-[#2563EB] text-white shadow-lg shadow-blue-200"
                    : "border-2 border-slate-300 bg-white text-slate-400"
                }`}
              >
                {index < currentStep ? <CheckCircle size={18} /> : <step.icon size={18} />}
              </div>
              <span
                className={`mt-2 hidden text-xs font-semibold sm:block ${
                  index <= currentStep ? "text-[#2563EB]" : "text-slate-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={`mx-2 h-0.5 w-8 sm:w-16 md:w-24 ${
                  index < currentStep ? "bg-emerald-400" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 1: Introduction ──────────────────────────────────────
function StepIntro({ onContinue }) {
  return (
    <div className="space-y-6">
      <section className="astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 py-8 text-white shadow-[var(--astrea-hero-shadow)] lg:px-10 lg:py-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
        <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
        <div className="relative z-10">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100">Data Privacy</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">RA 10173 Compliance</h1>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:text-base">
            Data Privacy Act of 2012 — Consent and Monitoring Acknowledgment
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-[#2563EB]">
                <ShieldCheck size={20} />
              </div>
              <h2 className="text-lg font-black text-slate-900">Privacy Notice</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              In compliance with the Data Privacy Act of 2012 (Republic Act No. 10173), AstreaBlue
              Enterprise ITSM is committed to protecting the privacy and confidentiality of your
              personal data. This notice explains how we collect, use, and protect information
              gathered through our laptop activity monitoring system.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <FileText size={20} />
              </div>
              <h2 className="text-lg font-black text-slate-900">Data Privacy Act of 2012</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Republic Act No. 10173, also known as the Data Privacy Act, protects individual
              personal information in information and communications systems. It establishes rights
              for data subjects and obligations for data controllers and processors, ensuring
              that personal data is processed fairly, lawfully, and with appropriate security measures.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
                <UserCheck size={20} />
              </div>
              <h2 className="text-lg font-black text-slate-900">Your Rights</h2>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              {[
                "To be informed of how your personal data is collected and processed",
                "To access your personal data held by the organization",
                "To object to the processing of your personal data",
                "To rectify inaccurate or incomplete personal data",
                "To suspend, withdraw, or remove personal data from our systems",
                "To be indemnified for damages due to violation of the Data Privacy Act",
              ].map((right) => (
                <li key={right} className="flex items-start gap-2">
                  <CheckCircle size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                  <span>{right}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-bold text-amber-800">Important Notice</h3>
                <p className="mt-1 text-sm text-amber-700">
                  By proceeding, you acknowledge that you have read and understood the Data Privacy
                  Act of 2012 and consent to the monitoring activities described. Device Telemetry
                  is required and cannot be disabled. All other monitoring categories are optional.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-6 py-3 font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-[#1D4ED8]"
        >
          Continue
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Tracking Preferences ──────────────────────────────
function StepPreferences({ preferences, onToggle, onContinue }) {
  const allOptionalSelected = MONITORING_CATEGORIES
    .filter((c) => !c.required)
    .every((c) => preferences[c.key]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Monitoring Preferences</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select which monitoring activities you consent to. Required categories are mandatory.
        </p>

        <div className="mt-6 space-y-4">
          {MONITORING_CATEGORIES.map((cat) => {
            const isOn = preferences[cat.key];
            return (
              <div
                key={cat.key}
                className={`flex items-center justify-between rounded-2xl border p-4 transition ${
                  isOn ? "border-blue-200 bg-blue-50/50" : "border-slate-200"
                } ${cat.required ? "border-emerald-200 bg-emerald-50/50" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      isOn ? "bg-blue-100 text-[#2563EB]" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    <Monitor size={17} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900">{cat.label}</p>
                      {cat.required && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">{cat.description}</p>
                  </div>
                </div>

                <button
                  disabled={cat.required}
                  onClick={() => !cat.required && onToggle(cat.key)}
                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
                    cat.required ? "opacity-70" : ""
                  } ${isOn ? "bg-[#2563EB]" : "bg-slate-300"}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      isOn ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">Summary: </p>
          <p>
            {MONITORING_CATEGORIES.filter((c) => preferences[c.key]).length} of{" "}
            {MONITORING_CATEGORIES.length} categories enabled
            {allOptionalSelected && " (all optional monitoring selected)"}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onContinue}
          className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-6 py-3 font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-[#1D4ED8]"
        >
          Continue
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Digital Signature ─────────────────────────────────
function StepSignature({ signatureData, onSignatureChange, onContinue }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1E2A44";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL("image/png");
    onSignatureChange(dataUrl);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Digital Signature</h2>
        <p className="mt-1 text-sm text-slate-500">
          Please sign below to acknowledge and consent to the monitoring preferences you selected.
        </p>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Signature</p>
            {hasDrawn && (
              <button
                onClick={clearSignature}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                <RefreshCw size={13} />
                Clear Signature
              </button>
            )}
          </div>
          <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white transition focus-within:border-[#2563EB]">
            <canvas
              ref={canvasRef}
              className="h-48 w-full touch-none cursor-crosshair"
              style={{ width: "100%", height: 192 }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            {!hasDrawn && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-slate-300">
                  <MousePointerClick size={28} />
                  <p className="text-sm">Sign above — click and drag to draw your signature</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {signatureData && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle size={16} />
            <span>Signature captured</span>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          disabled={!signatureData}
          onClick={onContinue}
          className={`flex items-center gap-2 rounded-xl px-6 py-3 font-bold transition ${
            signatureData
              ? "bg-[#2563EB] text-white shadow-lg shadow-blue-200 hover:bg-[#1D4ED8]"
              : "cursor-not-allowed bg-slate-200 text-slate-400"
          }`}
        >
          Continue
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Confirmation Summary ──────────────────────────────
function StepConfirmation({ preferences, signatureData, onSubmit, submitting }) {
  const submittedAt = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "long" });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Confirmation Summary</h2>
        <p className="mt-1 text-sm text-slate-500">
          Please review your selections before submitting your consent.
        </p>

        <div className="mt-6 space-y-5">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Monitoring Preferences</h3>
            <div className="mt-3 space-y-2">
              {MONITORING_CATEGORIES.map((cat) => (
                <div key={cat.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-700">{cat.label}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      preferences[cat.key]
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {preferences[cat.key] ? "Enabled" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Signature</h3>
            {signatureData ? (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                <img
                  src={signatureData}
                  alt="Signature preview"
                  className="h-20 w-auto max-w-full object-contain"
                />
                <p className="mt-2 text-xs text-emerald-600">
                  <CheckCircle size={12} className="inline" /> Signed
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-rose-500">No signature provided</p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Timestamp</h3>
            <p className="mt-1 text-sm text-slate-600">{submittedAt}</p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <h3 className="font-bold text-amber-800">Consent Summary</h3>
                <p className="mt-1 text-sm text-amber-700">
                  By submitting this form, you consent to the monitoring of your company-issued
                  device as per the preferences selected above. This consent is given freely and
                  you may update or withdraw your preferences at any time through the Employee Portal.
                  Device Telemetry monitoring is required for operational purposes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onSubmit}
          disabled={submitting}
          className={`flex items-center gap-2 rounded-xl bg-[#2563EB] px-8 py-3 font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-[#1D4ED8] ${
            submitting ? "cursor-not-allowed opacity-60" : ""
          }`}
        >
          {submitting ? "Submitting..." : "Submit Consent"}
          {!submitting && <ShieldCheck size={18} />}
        </button>
      </div>
    </div>
  );
}

// ─── Step 5: Success Page ──────────────────────────────────────
function StepSuccess({ submittedData, onReturnDashboard, onUpdatePrefs }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center py-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
          <Award size={40} className="text-emerald-600" />
        </div>
        <h2 className="mt-5 text-2xl font-black text-slate-900">Consent Recorded Successfully</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          Your RA 10173 compliance consent has been recorded. Your monitoring preferences are now
          active based on your selections.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Monitoring Preferences</h3>
        <div className="mt-3 space-y-2">
          {MONITORING_CATEGORIES.map((cat) => (
            <div key={cat.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">{cat.label}</span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  submittedData?.preferences?.[cat.key]
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {submittedData?.preferences?.[cat.key] ? "Enabled" : "Disabled"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Signature</p>
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-600">
            <CheckCircle size={16} />
            Signed and recorded
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Submitted At</p>
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Clock size={16} />
            {submittedData?.submitted_at ? formatDate(submittedData.submitted_at) : formatDate(new Date())}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        <button
          onClick={onReturnDashboard}
          className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-6 py-3 font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-[#1D4ED8]"
        >
          Return to Dashboard
        </button>
        <button
          onClick={onUpdatePrefs}
          className="flex items-center gap-2 rounded-xl border border-[#2563EB] px-6 py-3 font-bold text-[#2563EB] transition hover:bg-blue-50"
        >
          <RefreshCw size={16} />
          Update Preferences
        </button>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ───────────────────────────────────────────
function AdminDashboard({ role, branchId }) {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [branches, setBranches] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [page, setPage] = useState(0);
  const perPage = 20;

  const userIsSuper = isSuperAdmin(role);

  // Fetch branches for superadmin filter
  useEffect(() => {
    if (!userIsSuper) return;
    fetch(`${API_URL}/api/v1/branches`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setBranches(Array.isArray(data) ? data : data?.branches || data?.data || []))
      .catch(() => {});
  }, [userIsSuper]);

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: perPage, offset: page * perPage });
      if (search) params.set("search", search);
      if (filterStatus) params.set("status", filterStatus);
      if (filterDateFrom) params.set("date_from", filterDateFrom);
      if (filterDateTo) params.set("date_to", filterDateTo);
      if (userIsSuper && filterBranch) params.set("branch_id", filterBranch);

      const [recordsRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE}?${params}`, { headers: authHeaders() }),
        fetch(`${API_BASE}/summary`, { headers: authHeaders() }),
      ]);

      const recordsData = await recordsRes.json();
      const summaryData = await summaryRes.json();

      if (recordsData.success) {
        setRecords(recordsData.data || []);
        setTotal(recordsData.total || 0);
      }
      if (summaryData.success) {
        setSummary(summaryData.data || null);
      }
    } catch (err) {
      console.error("Fetch admin records error:", err);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, filterBranch, filterDateFrom, filterDateTo, page, userIsSuper]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const totalPages = Math.ceil(total / perPage);

  const Card = ({ label, value, icon: Icon, color }) => (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p>
        <Icon size={18} className={color || "text-blue-600"} />
      </div>
      <p className="mt-3 text-2xl font-black text-slate-900">{value ?? 0}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={userIsSuper ? "Super Admin" : "Branch Admin"}
        title="RA 10173 Compliance Dashboard"
        subtitle={`${userIsSuper ? "All branches" : "Your branch"} — consent monitoring and compliance management`}
      />

      {summary && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Total Consents" value={summary.total_consents} icon={Users} color="text-blue-600" />
          <Card label="Consented" value={summary.consented} icon={CheckCircle} color="text-emerald-600" />
          <Card label="Pending" value={summary.pending} icon={Clock} color="text-amber-600" />
          <Card label="Revoked" value={summary.revoked} icon={X} color="text-rose-600" />
        </section>
      )}

      {/* Filters */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Filter size={16} className="text-slate-400" />
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search employees..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {userIsSuper && (
            <select
              value={filterBranch}
              onChange={(e) => { setFilterBranch(e.target.value); setPage(0); }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563EB]"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.branch_id || b.id} value={b.branch_id || b.id}>
                  {b.branch_name}
                </option>
              ))}
            </select>
          )}

          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563EB]"
          >
            <option value="">All Status</option>
            <option value="Consented">Consented</option>
            <option value="Pending">Pending</option>
            <option value="Revoked">Revoked</option>
          </select>

          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => { setFilterDateFrom(e.target.value); setPage(0); }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563EB]"
            title="From date"
          />

          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => { setFilterDateTo(e.target.value); setPage(0); }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563EB]"
            title="To date"
          />

          <button
            onClick={() => {
              // Export
              const params = new URLSearchParams();
              if (userIsSuper && filterBranch) params.set("branch_id", filterBranch);
              window.open(`${API_BASE}/export?${params}`, "_blank");
            }}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <Download size={15} />
            Export
          </button>
        </div>
      </div>

      {/* Records Table */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Employee</th>
                <th className="px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Branch</th>
                <th className="px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Submitted</th>
                <th className="px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">Loading records...</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No consent records found.</td></tr>
              ) : (
                records.map((rec) => (
                  <tr key={rec.id} className="border-b border-slate-50 transition hover:bg-slate-50/50">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{rec.employee_name || `Employee #${rec.user_id}`}</p>
                      <p className="text-xs text-slate-400">{rec.employee_email || ""}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{rec.branch_name || "Unassigned"}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-block rounded-full border px-3 py-1 text-xs font-bold ${STATUS_BADGE[rec.consent_status] || STATUS_BADGE.Pending}`}>
                        {rec.consent_status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {rec.submitted_at ? formatDateShort(rec.submitted_at) : "N/A"}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => setSelectedRecord(selectedRecord?.id === rec.id ? null : rec)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-[#2563EB] transition hover:bg-blue-50"
                      >
                        <Eye size={14} />
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <p className="text-xs text-slate-500">Page {page + 1} of {totalPages} ({total} total)</p>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Record Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedRecord(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Consent Record Details</h3>
              <button onClick={() => setSelectedRecord(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Employee</p>
                  <p className="font-semibold text-slate-900">{selectedRecord.employee_name || `Employee #${selectedRecord.user_id}`}</p>
                  <p className="text-sm text-slate-500">{selectedRecord.employee_email || ""}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Branch</p>
                  <p className="font-semibold text-slate-900">{selectedRecord.branch_name || "Unassigned"}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Status</p>
                <span className={`mt-1 inline-block rounded-full border px-3 py-1 text-xs font-bold ${STATUS_BADGE[selectedRecord.consent_status] || STATUS_BADGE.Pending}`}>
                  {selectedRecord.consent_status}
                </span>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Monitoring Preferences</p>
                <div className="mt-2 space-y-1.5">
                  {MONITORING_CATEGORIES.map((cat) => (
                    <div key={cat.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2">
                      <span className="text-sm text-slate-700">{cat.label}</span>
                      <span className={`text-xs font-bold ${selectedRecord[cat.key] ? "text-emerald-600" : "text-slate-400"}`}>
                        {selectedRecord[cat.key] ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedRecord.signature_image && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Signature</p>
                  <div className="mt-2 max-w-xs rounded-xl border border-slate-200 bg-white p-3">
                    <img src={selectedRecord.signature_image.startsWith("data:") ? selectedRecord.signature_image : `${API_URL}${selectedRecord.signature_image}`} alt="Signature" className="h-16 w-auto max-w-full object-contain" />
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Submitted At</p>
                  <p className="text-sm text-slate-600">{selectedRecord.submitted_at ? formatDate(selectedRecord.submitted_at) : "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Last Updated</p>
                  <p className="text-sm text-slate-600">{selectedRecord.updated_at ? formatDate(selectedRecord.updated_at) : "N/A"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Employee View ─────────────────────────────────────────────
function EmployeeView({ user }) {
  const [consent, setConsent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Wizard state (only used when no consent exists)
  const [step, setStep] = useState(0);
  const [preferences, setPreferences] = useState({
    application_monitoring: false,
    web_monitoring: false,
    location_tracking: false,
    device_telemetry: true,
    email_header_monitoring: false,
  });
  const [signatureData, setSignatureData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [wizardDone, setWizardDone] = useState(false);

  const fetchConsent = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/my-record`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setConsent(data.data);
    } catch (err) {
      console.error("Fetch consent error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConsent(); }, [fetchConsent]);

  const togglePreference = (key) => {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmitConsent = async () => {
    try {
      setSubmitting(true);
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...preferences,
          device_telemetry: true,
          signature_image: signatureData,
          consent_status: "Consented",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConsent(data.data);
        setWizardDone(true);
        setStep(4);
      } else {
        alert(data.error || "Failed to submit consent.");
      }
    } catch (err) {
      console.error("Submit consent error:", err);
      alert("Failed to submit consent. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setDownloading(true);
      const res = await fetch(`${API_BASE}/pdf-download`, { headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to generate PDF.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RA10173_Consent_Summary_${(user?.full_name || "employee").replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF download error:", err);
      alert("Failed to download consent summary. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-slate-400">Loading records...</p>
      </div>
    );
  }

  // ─── NEW EMPLOYEE: Show 5-step consent wizard ─────────────────
  if (!consent && !wizardDone) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHero
          eyebrow="Employee Portal"
          title="RA 10173 Compliance"
          subtitle="Complete the consent and monitoring preferences wizard"
        />
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <StepIndicator currentStep={step} />
          {step === 0 && <StepIntro onContinue={() => setStep(1)} />}
          {step === 1 && (
            <StepPreferences
              preferences={preferences}
              onToggle={togglePreference}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepSignature
              signatureData={signatureData}
              onSignatureChange={setSignatureData}
              onContinue={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <StepConfirmation
              preferences={preferences}
              signatureData={signatureData}
              onSubmit={handleSubmitConsent}
              submitting={submitting}
            />
          )}
          {step === 4 && (
            <StepSuccess
              submittedData={{ ...(consent || {}), preferences }}
              onReturnDashboard={() => { setWizardDone(false); fetchConsent(); }}
              onUpdatePrefs={() => setStep(1)}
            />
          )}
        </div>
      </div>
    );
  }

  // ─── CONSENT SUMMARY (for returning employees / after wizard) ──
  const record = consent || {};
  return (
    <div className="space-y-6">
      <button
        onClick={() => window.history.back()}
        className="flex items-center gap-1.5 text-sm font-semibold text-[#2563EB] transition hover:text-[#1D4ED8]"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <PageHero
        eyebrow="Employee Portal"
        title="RA 10173 Compliance"
        subtitle="Your consent and monitoring preferences"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">Status</p>
            <span className={`mt-2 inline-block rounded-full border px-3 py-1 text-xs font-bold ${STATUS_BADGE[record.consent_status] || STATUS_BADGE.Pending}`}>
              {record.consent_status}
            </span>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">Submitted Date</p>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              {record.submitted_at ? formatDate(record.submitted_at) : "Not yet submitted"}
            </p>
          </div>
          {record.signature_image && (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">Signature</p>
              <img
                src={record.signature_image.startsWith("data:") ? record.signature_image : `${API_URL}${record.signature_image}`}
                alt="Signed signature"
                className="mt-2 h-16 w-auto max-w-full rounded-lg object-contain"
              />
            </div>
          )}
          <button
            onClick={handleDownloadPdf}
            disabled={downloading}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border border-[#2563EB] px-4 py-3 font-bold text-[#2563EB] transition hover:bg-blue-50 ${
              downloading ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            <Download size={16} />
            {downloading ? "Generating PDF..." : "Download Consent Summary (PDF)"}
          </button>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Monitoring Preferences</h3>
          <div className="mt-4 space-y-3">
            {MONITORING_CATEGORIES.map((cat) => (
              <div key={cat.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${record[cat.key] ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {record[cat.key] ? <CheckCircle size={15} /> : <X size={15} />}
                  </div>
                  <span className="font-semibold text-slate-700">{cat.label}</span>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    record[cat.key] ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {record[cat.key] ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Entry ────────────────────────────────────────────────
export default function RA10173Compliance() {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role;
  const userBranchId = user?.branch_id || user?.branchId;
  const userIsEmployee = isEmployee(activeRole);

  if (userIsEmployee) {
    return <EmployeeView user={user} />;
  }

  if (isAdminOrSuper(activeRole)) {
    return <AdminDashboard role={activeRole} branchId={userBranchId} />;
  }

  return (
    <div className="flex items-center justify-center py-20">
      <p className="text-slate-500">You do not have access to this module.</p>
    </div>
  );
}
