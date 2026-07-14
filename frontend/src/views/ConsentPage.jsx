import { API_URL } from "../config/api";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Lock,
  PenLine,
  RefreshCcw,
  Shield,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getAuthToken } from "../context/AuthService";

const API_BASE = `${API_URL}/api/v1`;

const MONITORING_CATEGORIES = [
  {
    id: "app_usage",
    label: "Application Usage Tracking",
    description:
      "Records which applications are actively used during work hours to support software licensing and productivity analysis.",
    required: false,
  },
  {
    id: "idle_time",
    label: "Idle Time Detection",
    description:
      "Detects periods of inactivity to help assess workload and optimize shift schedules.",
    required: false,
  },
  {
    id: "network_domains",
    label: "Network Domain Logging",
    description:
      "Logs visited website domains (not full URLs or content) for security compliance and DLP enforcement.",
    required: false,
  },
  {
    id: "window_title",
    label: "Active Window Title",
    description:
      "Captures the title of the active window (e.g., application name) to support activity reporting.",
    required: false,
  },
  {
    id: "screenshot",
    label: "Periodic Screenshots",
    description:
      "Captures periodic screenshots for security audits. Requires explicit consent and is fully optional.",
    required: false,
  },
  {
    id: "usb_monitoring",
    label: "USB Device Monitoring",
    description:
      "Detects and logs USB device connections and disconnections for data loss prevention (DLP) and security compliance. Logs device type only — no file contents are captured.",
    required: false,
  },
  {
    id: "website_monitoring",
    label: "Website & URL Monitoring",
    description:
      "Monitors visited website URLs (domain-level only, not page content or search terms) for acceptable use policy and security enforcement.",
    required: false,
  },
  {
    id: "location_tracking",
    label: "Location Tracking",
    description:
      "Allows an approved endpoint policy to collect device location information for asset recovery and security response.",
    required: false,
  },
  {
    id: "productivity_analytics",
    label: "Productivity Analytics",
    description:
      "Uses approved activity signals to produce work-pattern and utilization analytics without changing baseline device operations.",
    required: false,
  },
  {
    id: "activity_alerts",
    label: "Employee Activity-Based Alerts",
    description:
      "Allows approved activity events to create security or policy alerts when the effective endpoint policy also enables them.",
    required: false,
  },
];

const LEGAL_STATEMENT = `
I, the undersigned employee, hereby acknowledge and consent to the collection and processing of my personal data by AstreaBlue as described in this consent document, pursuant to Republic Act No. 10173 (Data Privacy Act of 2012) and its Implementing Rules and Regulations.

I understand that the monitoring activities listed herein are conducted solely for legitimate business purposes including IT security, asset management, and operational efficiency. I have been informed of my rights under RA 10173, including the right to access, correct, and withdraw consent (subject to company policy and applicable procedures).

This consent document is legally binding and constitutes my informed agreement to the processing activities described above.
`.trim();

const approvedStatuses = ["approved", "signed"];
const terminalStatuses = ["withdrawn", "superseded", "rejected", "expired"];
const pendingReviewStatuses = ["pending_approval", "submitted"];
const statusLabel = (status) => String(status || "draft").replaceAll("_", " ");

function getToken() {
  return getAuthToken();
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

// ─── Signature Pad ─────────────────────────────────────────────────────────────
function SignaturePad({ onSigned, disabled }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (e) => {
    if (disabled) return;
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  };

  const draw = (e) => {
    if (!drawing.current || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  };

  const stop = () => {
    drawing.current = false;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onSigned(dataUrl);
  };

  const clear = () => {
    if (disabled) return;
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onSigned(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={560}
          height={160}
          className="w-full touch-none"
          style={{ cursor: disabled ? "default" : "crosshair" }}
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={stop}
        />
        {!disabled && (
          <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-semibold text-slate-400 pointer-events-none select-none">
            Draw your signature above
          </p>
        )}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={clear}
          className="text-xs font-bold text-slate-500 hover:text-red-600 flex items-center gap-1"
        >
          <RefreshCcw size={12} /> Clear signature
        </button>
      )}
    </div>
  );
}

// ─── Read-only Consent View ────────────────────────────────────────────────────
function ProtectedSignature({ consent, className = "max-h-24 w-full object-contain" }) {
  const [source, setSource] = useState(() => {
    if (!consent?.e_signature_image) return "";
    return consent.e_signature_image.startsWith("data:") ? consent.e_signature_image : `${API_URL}${consent.e_signature_image}`;
  });

  useEffect(() => {
    if (!consent?.signature_object_key || !consent?.consent_id) return undefined;
    let objectUrl = "";
    fetch(`${API_BASE}/consent/${consent.consent_id}/signature`, { headers: authHeaders() })
      .then((response) => {
        if (!response.ok) throw new Error("Signature unavailable.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = window.URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => setSource(""));
    return () => { if (objectUrl) window.URL.revokeObjectURL(objectUrl); };
  }, [consent?.consent_id, consent?.signature_object_key]);

  return source ? <img src={source} alt="Employee E-Signature" className={className} /> : <p className="text-sm italic text-slate-400">Protected signature unavailable.</p>;
}

function ConsentDocumentView({ consent, onClose, onRequestChange, onLogPrint }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const { role } = useAuth();
  const isAdmin = ["superadmin", "admin", "hr"].includes(String(role || "").toLowerCase());

  useEffect(() => {
    if (!isAdmin) return;
    setAuditLoading(true);
    fetch(`${API_BASE}/consent/${consent.consent_id}/audit`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setAuditLogs(d.data || []))
      .catch(() => {})
      .finally(() => setAuditLoading(false));
  }, [consent.consent_id, isAdmin]);

  const prefs = Array.isArray(consent.monitoring_preferences)
    ? consent.monitoring_preferences
    : [];

  const signedAt = consent.signed_at
    ? new Date(consent.signed_at).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-blue-50 to-slate-50 px-7 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">{consent.form_title}</h2>
              <p className="text-xs font-semibold text-slate-500">
                Consent ID: {consent.consent_id} · Version {consent.consent_version} ·{" "}
                <span
                  className={`font-black uppercase ${
                    approvedStatuses.includes(consent.status)
                      ? "text-green-600"
                      : consent.status === "withdrawn"
                      ? "text-red-600"
                      : "text-amber-600"
                  }`}
                >
                  {statusLabel(consent.status)}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Printable body */}
        <div id="consent-printable" className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {/* Company header */}
          <div className="text-center border-b border-slate-200 pb-5">
            <p className="text-xs font-black uppercase tracking-widest text-blue-600">
              AstreaBlue Enterprise ITSM
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-900">{consent.form_title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Pursuant to Republic Act No. 10173 — Data Privacy Act of 2012
            </p>
          </div>

          {/* Employee info */}
          <section className="grid grid-cols-2 gap-4">
            {[
              ["Employee Full Name", consent.employee_full_name],
              ["Employee Email", consent.employee_email],
              ["Employee ID / Number", consent.employee_number || "—"],
              ["Branch", consent.branch_name || "—"],
              ["Hardware Asset", `${consent.asset_tag || "—"}${consent.model ? ` / ${consent.model}` : ""}`],
              ["Endpoint Hostname", consent.hostname || consent.device_name || "—"],
              ["Device UUID", consent.device_uuid || "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
              </div>
            ))}
          </section>

          {/* Monitoring categories */}
          <section>
            <h3 className="font-black text-slate-900 mb-3 flex items-center gap-2">
              <Shield size={16} className="text-blue-600" />
              Selected Monitoring Consent Categories
            </h3>
            <div className="space-y-2">
              {MONITORING_CATEGORIES.map((cat) => {
                const selected = prefs.includes(cat.id) || cat.required;
                return (
                  <div
                    key={cat.id}
                    className={`flex items-start gap-3 rounded-2xl border p-4 ${
                      selected
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-white opacity-50"
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected ? "border-blue-500 bg-blue-500 text-white" : "border-slate-300"
                      }`}
                    >
                      {selected && <CheckCircle size={12} />}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">
                        {cat.label}
                        {cat.required && (
                          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                            REQUIRED
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{cat.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Legal statement */}
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <h3 className="font-black text-blue-900 mb-2">Legal Consent Statement</h3>
            <p className="whitespace-pre-line text-sm leading-7 text-blue-900">{LEGAL_STATEMENT}</p>
          </section>

          {/* Signature block */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="font-black text-slate-900 mb-4">Employee Acknowledgement & Signature</h3>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  E-Signature
                </p>
                {consent.e_signature_image || consent.signature_object_key ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <ProtectedSignature consent={consent} />
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">Not yet signed.</p>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Printed Name
                  </p>
                  <p className="mt-1 text-lg font-black text-slate-900">
                    {consent.printed_name || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Date & Time Signed
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-700">{signedAt}</p>
                  <p className="text-xs text-slate-400">(Asia/Manila time)</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Consent Version
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-700">
                    v{consent.consent_version}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* System note */}
          <p className="text-center text-xs text-slate-400">
            Generated by AstreaBlue Enterprise ITSM · Consent Document #{consent.consent_id} ·
            This is a system-generated record.
          </p>

          {/* Audit trail (admin only) */}
          {isAdmin && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-black text-slate-900 mb-3">Audit Trail</h3>
              {auditLoading ? (
                <p className="text-sm text-slate-400">Loading...</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-slate-400">No audit events yet.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {auditLogs.map((log) => (
                    <div key={log.log_id} className="flex gap-3 items-start">
                      <span className="shrink-0 w-32 text-xs font-bold text-slate-400">
                        {new Date(log.created_at).toLocaleString("en-PH", {
                          timeZone: "Asia/Manila",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700 shrink-0">
                        {log.event_type}
                      </span>
                      <span className="text-slate-600">
                        {log.details || "—"}
                        {log.actor_name ? ` (by ${log.actor_name})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-200 bg-white/95 px-7 py-4 flex flex-wrap items-center gap-3 justify-end">
          {approvedStatuses.includes(consent.status) && (
            <>
              <button
                onClick={() => {
                  onLogPrint("print");
                  window.print();
                }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Eye size={16} /> Print
              </button>
              <button
                onClick={() => onLogPrint("download")}
                className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
              >
                <Download size={16} /> Download PDF
              </button>
            </>
          )}
          {onRequestChange && approvedStatuses.includes(consent.status) && (
            <button
              onClick={onRequestChange}
              className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-bold text-amber-800 hover:bg-amber-100"
            >
              <PenLine size={16} /> Request Consent Change
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Change Request Modal ──────────────────────────────────────────────────────
function ConsentChangeModal({ consent, onClose, onSubmitted }) {
  const [changeType, setChangeType] = useState("change");
  const [reason, setReason] = useState("");
  const [requestedChanges, setRequestedChanges] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { setError("Reason is required."); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/consent/request-change`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          consent_id: consent.consent_id,
          change_type: changeType,
          reason: reason.trim(),
          requested_changes: requestedChanges.trim(),
          current_preferences: Array.isArray(consent.monitoring_preferences)
            ? consent.monitoring_preferences
            : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to submit request.");
      onSubmitted(data.ticket_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-amber-50 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white">
              <PenLine size={18} />
            </div>
            <div>
              <h2 className="font-black text-slate-900">Request Consent Change</h2>
              <p className="text-xs font-semibold text-slate-500">
                Your request will be reviewed by an authorized HR or Admin officer.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">Request Type</label>
            <div className="flex gap-3">
              {[["change", "Preference Change"], ["withdraw", "Full Withdrawal"]].map(([val, lab]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setChangeType(val)}
                  className={`flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-bold transition ${
                    changeType === val
                      ? val === "withdraw"
                        ? "border-red-400 bg-red-50 text-red-700"
                        : "border-blue-400 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Reason <span className="text-red-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why you are requesting this change..."
              rows={3}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100 resize-none"
              required
            />
          </div>
          {changeType === "change" && (
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Requested Changes (optional)
              </label>
              <textarea
                value={requestedChanges}
                onChange={(e) => setRequestedChanges(e.target.value)}
                placeholder="Describe which monitoring categories you want to add or remove..."
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100 resize-none"
              />
            </div>
          )}
          {changeType === "withdraw" && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <strong>Note:</strong> Withdrawing consent will disable all optional monitoring
              for your device. Required telemetry (device heartbeat) may continue per company policy.
              An Admin or HR officer must approve this request.
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Consent Page ─────────────────────────────────────────────────────────
export default function ConsentPage() {
  const { user } = useAuth();
  const [consent, setConsent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1); // 1=intro, 2=categories, 3=sign, 4=review, 5=done
  const [preferences, setPreferences] = useState([]);
  const [signatureData, setSignatureData] = useState(null);
  const [printedName, setPrintedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  const [viewConsent, setViewConsent] = useState(false);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4500);
  };

  const fetchConsent = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/consent/my`, { headers: authHeaders() });
      const data = await res.json();
      const currentConsent = data.data || null;
      setConsent(currentConsent);
      if (Array.isArray(currentConsent?.monitoring_preferences)) {
        const optionalPreferenceIds = new Set(
          MONITORING_CATEGORIES.filter((category) => !category.required).map((category) => category.id)
        );
        setPreferences(currentConsent.monitoring_preferences.filter((preference) => optionalPreferenceIds.has(preference)));
      }
    } catch (err) {
      console.error("Failed to load consent:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConsent();
  }, [fetchConsent]);

  // Pre-fill printed name from user profile
  useEffect(() => {
    if (user?.full_name && !printedName) {
      setPrintedName(user.full_name);
    }
  }, [user]);

  const startWizard = async () => {
    setError("");
    try {
      const res = await fetch(`${API_BASE}/consent/draft`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ monitoring_preferences: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to start consent wizard.");
      setDraftId(data.data.consent_id);
      setStep(2);
    } catch (err) {
      setError(err.message);
    }
  };

  const togglePref = (id) => {
    setPreferences((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const reviewConsent = () => {
    setError("");
    if (!signatureData) { setError("Please draw your e-signature above."); return; }
    if (!printedName.trim()) { setError("Printed name is required."); return; }
    if (!agreed) { setError("You must agree to the consent statement."); return; }
    setStep(4);
  };

  const handleSign = async () => {
    setError("");
    setSigning(true);
    try {
      const allPrefs = [
        ...MONITORING_CATEGORIES.filter((c) => c.required).map((c) => c.id),
        ...preferences,
      ];
      const res = await fetch(`${API_BASE}/consent/${draftId}/sign`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          e_signature_image: signatureData,
          monitoring_preferences: [...new Set(allPrefs)],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to sign consent.");
      setConsent(data.data);
      setStep(5);
    } catch (err) {
      setError(err.message);
    } finally {
      setSigning(false);
    }
  };

  const logPrint = async (action) => {
    if (!consent) return;
    try {
      if (action === "download") {
        const res = await fetch(`${API_BASE}/consent/${consent.consent_id}/pdf`, { headers: authHeaders() });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Failed to download consent PDF.");
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `AstreaBlue-Consent-${consent.consent_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        return;
      }
      await fetch(`${API_BASE}/consent/${consent.consent_id}/log-print`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action }),
      });
      showToast(`Consent PDF downloaded for #${consent.consent_id}.`);
    } catch (err) {
      showToast(err.message || "Consent PDF is unavailable right now.", "error");
    }
  };

  // ── Signed state ─────────────────────────────────────────────────────────────
  if (!loading && approvedStatuses.includes(consent?.status)) {
    return (
      <div className="space-y-6">
        {/* Hero — AstreaBlue gradient */}
        <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-blue-300">
              RA 10173 — Data Privacy Act
            </p>
            <h1 className="mt-1 text-3xl font-black">Consent Document</h1>
            <p className="mt-2 text-blue-100">
              Your consent has been approved and is now legally binding.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-white/20 px-5 py-3">
              <Lock size={20} />
              <span className="font-black">Approved & Locked</span>
            </div>
        </section>

        {/* Summary card */}
        <section className="rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900">Your Approved Consent</h2>
              <p className="mt-1 text-sm text-slate-500">
                Approved on{" "}
                {new Date(consent.approved_at || consent.signed_at).toLocaleString("en-PH", {
                  timeZone: "Asia/Manila",
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-700 uppercase">
              Approved
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Consent ID", `#${consent.consent_id}`],
              ["Version", `v${consent.consent_version}`],
              ["Printed Name", consent.printed_name || "—"],
              ["Status", statusLabel(consent.status)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-black text-slate-900 capitalize">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => setViewConsent(true)}
              className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-blue-800"
            >
              <Eye size={16} /> View Consent Form
            </button>
            <button
              onClick={() => setShowChangeModal(true)}
              className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-bold text-amber-800 hover:bg-amber-100"
            >
              <PenLine size={16} /> Request Consent Change
            </button>
          </div>
        </section>

        {/* Locked notice */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
          <Lock size={16} className="shrink-0 text-slate-400" />
          Your consent document is locked. To modify your monitoring preferences or withdraw
          consent, use the "Request Consent Change" button. Your request will be reviewed by
          an authorized HR or Admin officer.
        </div>

        {viewConsent && (
          <ConsentDocumentView
            consent={consent}
            onClose={() => setViewConsent(false)}
            onRequestChange={() => { setViewConsent(false); setShowChangeModal(true); }}
            onLogPrint={logPrint}
          />
        )}
        {showChangeModal && (
          <ConsentChangeModal
            consent={consent}
            onClose={() => setShowChangeModal(false)}
            onSubmitted={(ticketId) => {
              setShowChangeModal(false);
              showToast(`Your consent change request was submitted. Ticket ID: ${ticketId}.`);
            }}
          />
        )}
        {toast && <PageToast toast={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  // ── Withdrawn / superseded state ──────────────────────────────────────────────
  if (!loading && consent && pendingReviewStatuses.includes(consent.status)) {
    return (
      <div className="space-y-6">
        <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6">
          <div className="flex items-start gap-4">
            <Lock size={24} className="shrink-0 text-blue-700 mt-0.5" />
            <div>
              <h2 className="font-black text-blue-950">Consent Pending Approval</h2>
              <p className="mt-1 text-sm text-blue-800">
                Your signed consent has been submitted. Optional monitoring stays disabled until an authorized admin approves it.
              </p>
              <button
                onClick={() => setViewConsent(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                <Eye size={16} /> View Submitted Consent
              </button>
            </div>
          </div>
        </section>
        {viewConsent && (
          <ConsentDocumentView
            consent={consent}
            onClose={() => setViewConsent(false)}
            onLogPrint={logPrint}
          />
        )}
      </div>
    );
  }

  if (!loading && consent && terminalStatuses.includes(consent.status)) {
    return (
      <div className="space-y-6">
        <section className="rounded-3xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-4">
            <AlertCircle size={24} className="shrink-0 text-red-600 mt-0.5" />
            <div>
              <h2 className="font-black text-red-900">
                Consent {statusLabel(consent.status)}
              </h2>
              <p className="mt-1 text-sm text-red-700">
                {consent.status === "withdrawn"
                  ? "Your consent has been withdrawn. Optional monitoring is disabled."
                  : "This consent is no longer active. Optional monitoring remains disabled until a new consent is approved."}
              </p>
              <button
                onClick={() => { setConsent(null); setStep(1); }}
                className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
              >
                File New Consent
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ── Wizard ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-slate-500 font-semibold">Loading consent status...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-300">
            RA 10173 — Data Privacy Act
          </p>
          <h1 className="mt-1 text-3xl font-black">Monitoring Consent</h1>
          <p className="mt-2 text-blue-100">
            {consent?.device_uuid
              ? `Device-specific agreement for ${consent.hostname || consent.device_name || consent.asset_tag || "your assigned company device"}.`
              : "Please review and sign your data privacy consent document before monitoring begins."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition ${
                step >= s ? "bg-white text-blue-800" : "bg-white/20 text-white"
              }`}
            >
              {step > s ? <CheckCircle size={16} /> : s}
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {/* Step 1: Introduction */}
      {step === 1 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
              <Shield size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-900">
              {consent?.device_uuid ? "Assigned Device Monitoring Agreement" : "Data Privacy Consent Document"}
            </h2>
            <p className="mt-3 text-slate-600">
              AstreaBlue is required by <strong>RA 10173 (Data Privacy Act of 2012)</strong> to
              obtain your informed consent before collecting any personal data through endpoint
              monitoring. This is a formal, legally binding document.
            </p>
            {consent?.device_uuid && (
              <div className="mt-5 grid gap-3 text-left sm:grid-cols-3">
                {[
                  ["Request", `Consent #${consent.consent_id}`],
                  ["Device", consent.hostname || consent.device_name || "Assigned device"],
                  ["Asset", consent.asset_tag || "Linked company asset"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-left text-sm text-blue-900">
              <p className="font-black mb-2">What you'll do:</p>
              <ul className="space-y-1 list-disc pl-5">
                <li>Review the monitoring categories that require your consent</li>
                <li>Select which optional monitoring activities you agree to</li>
                <li>Sign the document with your e-signature and printed name</li>
                <li>Receive a locked, printable consent document record</li>
              </ul>
            </div>
            <button
              onClick={startWizard}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-700 px-8 py-3.5 font-black text-white shadow-lg hover:bg-blue-800"
            >
              <ClipboardList size={18} /> Begin Consent Wizard
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Select categories */}
      {step === 2 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              Step 1 of 2 — Select Monitoring Consent Categories
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose the privacy-sensitive monitoring activities you agree to. Consent alone does not
              activate them; an assigned endpoint and an effective policy must also permit them.
            </p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-black">Baseline company-device operations</p>
            <p className="mt-1">
              Device registration, heartbeat, online/offline status, hardware and software inventory,
              asset verification, policy synchronization, agent version, and endpoint health are
              operational functions and are not optional monitoring preferences.
            </p>
          </div>
          <div className="space-y-3">
            {MONITORING_CATEGORIES.map((cat) => {
              const checked = cat.required || preferences.includes(cat.id);
              return (
                <label
                  key={cat.id}
                  className={`flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition ${
                    checked
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 hover:border-blue-200 hover:bg-blue-50/30"
                  } ${cat.required ? "cursor-default opacity-90" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={cat.required}
                    onChange={() => !cat.required && togglePref(cat.id)}
                    className="mt-1 h-5 w-5 rounded accent-blue-600 shrink-0"
                  />
                  <div>
                    <p className="font-bold text-slate-900">
                      {cat.label}
                      {cat.required && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                          REQUIRED
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-slate-500">{cat.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setStep(1)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
            >
              Continue to Signature →
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Sign */}
      {step === 3 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              Step 2 of 2 — Review & Sign Consent Document
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Read the legal statement carefully and sign below to complete your consent document.
            </p>
          </div>

          {/* Legal statement */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-7 text-blue-900 max-h-56 overflow-y-auto">
            <p className="font-black mb-2">Legal Consent Statement</p>
            <p className="whitespace-pre-line">{LEGAL_STATEMENT}</p>
          </div>

          {/* Printed name (auto-filled) */}
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Printed Name <span className="text-red-600">*</span>
            </label>
            <input
              value={printedName}
              readOnly
              className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-bold text-slate-900"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Auto-filled from your employee profile. Ask an administrator to correct your profile if this is inaccurate.
            </p>
          </div>

          {/* Signature pad */}
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              E-Signature <span className="text-red-600">*</span>
            </label>
            <SignaturePad onSigned={setSignatureData} disabled={false} />
          </div>

          {/* Agreement checkbox */}
          <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-slate-200 p-4 hover:border-blue-200">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded accent-blue-600 shrink-0"
            />
            <p className="text-sm text-slate-700">
              I have read and fully understood the legal consent statement above. I voluntarily and
              knowingly provide this consent pursuant to RA 10173 (Data Privacy Act of 2012).
            </p>
          </label>

          <div className="flex justify-end gap-3">
            <button onClick={() => setStep(2)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
              Back
            </button>
            <button
              onClick={reviewConsent}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-blue-700 disabled:opacity-60"
            >
              <FileText size={16} />
              Review Consent
            </button>
          </div>
        </section>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">Review Before Submission</h2>
            <p className="mt-1 text-sm text-slate-500">Confirm your approved and declined privacy-sensitive monitoring categories.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="font-black text-emerald-900">Approved categories</p>
              <ul className="mt-3 space-y-2 text-sm text-emerald-800">
                {MONITORING_CATEGORIES.filter((category) => category.required || preferences.includes(category.id)).map((category) => <li key={category.id}>✓ {category.label}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="font-black text-slate-900">Declined optional categories</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {MONITORING_CATEGORIES.filter((category) => !category.required && !preferences.includes(category.id)).map((category) => <li key={category.id}>— {category.label}</li>)}
              </ul>
            </div>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <p className="text-xs font-black uppercase tracking-wide text-blue-600">Employee printed name</p>
            <p className="mt-1 text-lg font-black text-blue-950">{printedName}</p>
            {signatureData && <img src={signatureData} alt="Signature preview" className="mt-4 max-h-28 rounded-xl border border-blue-200 bg-white p-2" />}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setStep(3)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">Back</button>
            <button onClick={handleSign} disabled={signing} className="rounded-xl bg-blue-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60">
              {signing ? "Submitting securely..." : "Submit for Approval"}
            </button>
          </div>
        </section>
      )}

      {/* Step 5: Success */}
      {step === 5 && (
        <section className="rounded-3xl border border-blue-200 bg-blue-50 p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <CheckCircle size={32} />
          </div>
          <h2 className="text-2xl font-black text-blue-900">Consent Submitted Successfully!</h2>
          <p className="mt-3 text-blue-800">
            Your RA 10173 consent document is awaiting admin approval. Optional monitoring remains disabled until approval.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => setViewConsent(true)}
              className="flex items-center gap-2 rounded-xl bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800"
            >
              <Eye size={16} /> View Consent Form
            </button>
          </div>
          {viewConsent && consent && (
            <ConsentDocumentView
              consent={consent}
              onClose={() => setViewConsent(false)}
              onRequestChange={() => { setViewConsent(false); setShowChangeModal(true); }}
              onLogPrint={logPrint}
            />
          )}
        </section>
      )}
    </div>
  );
}

function PageToast({ toast, onClose }) {
  const isError = toast.type === "error";
  return (
    <div className={`fixed bottom-6 right-6 z-[70] flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold shadow-2xl ${isError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      <span>{toast.message}</span>
      <button onClick={onClose} className="ml-2 text-slate-400 hover:text-slate-700">x</button>
    </div>
  );
}
