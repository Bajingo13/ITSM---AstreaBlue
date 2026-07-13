import { API_URL } from "../config/api";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Lock,
  PenLine,
  Search,
  Shield,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PageHero from "../components/layout/PageHero";

const API_BASE = `${API_URL}/api/v1`;

const MONITORING_CATEGORIES = [
  { id: "app_usage", label: "Application Usage Tracking", required: false },
  { id: "idle_time", label: "Idle Time Detection", required: false },
  { id: "network_domains", label: "Network Domain Logging", required: false },
  { id: "window_title", label: "Active Window Title", required: false },
  { id: "screenshot", label: "Periodic Screenshots", required: false },
  { id: "usb_monitoring", label: "USB Device Monitoring", required: false },
  { id: "website_monitoring", label: "Website & URL Monitoring", required: false },
  { id: "heartbeat", label: "Device Heartbeat & Connectivity", required: true },
];

const LEGAL_STATEMENT = `I, the undersigned employee, hereby acknowledge and consent to the collection and processing of my personal data by AstreaBlue as described in this consent document, pursuant to Republic Act No. 10173 (Data Privacy Act of 2012) and its Implementing Rules and Regulations.

I understand that the monitoring activities listed herein are conducted solely for legitimate business purposes including IT security, asset management, and operational efficiency. I have been informed of my rights under RA 10173, including the right to access, correct, and withdraw consent (subject to company policy and applicable procedures).

This consent document is legally binding and constitutes my informed agreement to the processing activities described above.`;

function getToken() {
  return (
    localStorage.getItem("astreablue_token") ||
    sessionStorage.getItem("astreablue_token") ||
    ""
  );
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

function StatusBadge({ status }) {
  const map = {
    approved: "bg-green-100 text-green-700",
    signed: "bg-green-100 text-green-700",
    pending_employee: "bg-amber-100 text-amber-700",
    pending_approval: "bg-blue-100 text-blue-700",
    revision_requested: "bg-amber-100 text-amber-700",
    pending: "bg-amber-100 text-amber-700",
    rejected: "bg-red-100 text-red-700",
    withdrawn: "bg-red-100 text-red-700",
    superseded: "bg-slate-100 text-slate-600",
    expired: "bg-slate-100 text-slate-600",
  };
  const label = String(status || "draft").replaceAll("_", " ");
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-black uppercase ${map[status] || "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

// ─── Printable Consent Modal ───────────────────────────────────────────────────
function ConsentPrintModal({ consent, onClose, onAction }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionType, setActionType] = useState("withdraw");
  const [actionNotes, setActionNotes] = useState("");
  const [approvePrefs, setApprovePrefs] = useState(null);

  const initApprovePrefs = () => {
    const cur = Array.isArray(consent.monitoring_preferences) ? consent.monitoring_preferences : [];
    setApprovePrefs(cur);
  };
  const toggleAprovePref = (id) =>
    setApprovePrefs((prev) =>
      (prev || []).includes(id) ? (prev || []).filter((p) => p !== id) : [...(prev || []), id]
    );

  useEffect(() => {
    fetch(`${API_BASE}/consent/${consent.consent_id}/audit`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setAuditLogs(d.data || []))
      .catch(() => {})
      .finally(() => setAuditLoading(false));
  }, [consent.consent_id]);

  const prefs = Array.isArray(consent.monitoring_preferences) ? consent.monitoring_preferences : [];
  const signedAt = consent.signed_at
    ? new Date(consent.signed_at).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: true,
      })
    : "—";

  const logPrint = async (action) => {
    try {
      await fetch(`${API_BASE}/consent/${consent.consent_id}/log-print`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action }),
      });
    } catch {}
  };

  const applyAction = async () => {
    setActioning(true);
    try {
      let url, body;
      if (["approve", "reject", "request_revision"].includes(actionType)) {
        url = `${API_BASE}/consent/${consent.consent_id}/review`;
        body = JSON.stringify({ action: actionType, reason: actionNotes });
      } else if (actionType === "approve_change") {
        url = `${API_BASE}/consent/${consent.consent_id}/approve-change`;
        body = JSON.stringify({ new_preferences: approvePrefs, notes: actionNotes });
      } else {
        url = `${API_BASE}/consent/${consent.consent_id}/admin-action`;
        body = JSON.stringify({ action: actionType, notes: actionNotes });
      }
      const res = await fetch(url, { method: ["approve_change", "approve", "reject", "request_revision"].includes(actionType) ? "POST" : "PUT", headers: authHeaders(), body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Action failed.");
      onAction(consent.consent_id, data.data?.status || (actionType === "approve_change" ? "approved" : data.new_status));
      onClose();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setActioning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
      <div className="flex max-h-[93vh] w-full max-w-3xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-blue-50 to-slate-50 px-7 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">{consent.form_title}</h2>
              <p className="text-xs font-semibold text-slate-500">
                Consent #{consent.consent_id} · v{consent.consent_version} ·{" "}
                <StatusBadge status={consent.status} />
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div id={`consent-print-${consent.consent_id}`} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {/* Company header */}
          <div className="text-center border-b border-slate-200 pb-5">
            <p className="text-xs font-black uppercase tracking-widest text-blue-600">AstreaBlue Enterprise ITSM</p>
            <h1 className="mt-1 text-2xl font-black text-slate-900">{consent.form_title}</h1>
            <p className="mt-1 text-sm text-slate-500">Pursuant to Republic Act No. 10173 — Data Privacy Act of 2012</p>
          </div>

          {/* Employee info */}
          <section className="grid grid-cols-2 gap-4">
            {[
              ["Employee Full Name", consent.employee_full_name],
              ["Employee Email", consent.employee_email],
              ["Employee ID / Number", consent.employee_number || "—"],
              ["Branch / Department", `${consent.branch_name || "—"} / ${consent.department || "—"}`],
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
                  <div key={cat.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${selected ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white opacity-50"}`}>
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-blue-500 bg-blue-500 text-white" : "border-slate-300"}`}>
                      {selected && <CheckCircle size={12} />}
                    </div>
                    <p className="text-sm font-bold text-slate-900">
                      {cat.label}
                      {cat.required && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">REQUIRED</span>}
                    </p>
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
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">E-Signature</p>
                {consent.e_signature_image ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <img
                      src={consent.e_signature_image.startsWith("data:") ? consent.e_signature_image : `${API_URL}${consent.e_signature_image}`}
                      alt="Employee E-Signature"
                      className="max-h-24 w-full object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">No signature on file.</p>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Printed Name</p>
                  <p className="mt-1 text-lg font-black text-slate-900">{consent.printed_name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Date & Time Signed</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">{signedAt}</p>
                  <p className="text-xs text-slate-400">(Asia/Manila time)</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Consent Version</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">v{consent.consent_version}</p>
                </div>
              </div>
            </div>
          </section>

          {/* System note */}
          <p className="text-center text-xs text-slate-400">
            Generated by AstreaBlue Enterprise ITSM · Consent Document #{consent.consent_id} · This is a system-generated record.
          </p>

          {/* Audit trail */}
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
                      {new Date(log.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700 shrink-0">{log.event_type}</span>
                    <span className="text-slate-600">{log.details || "—"}{log.actor_name ? ` (by ${log.actor_name})` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Admin action form */}
          {showActionForm && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
              <h3 className="font-black text-amber-900">Admin Action</h3>
              <div className="flex flex-wrap gap-2">
                {[
                  ["approve", "Approve Consent"],
                  ["reject", "Reject"],
                  ["request_revision", "Request Revision"],
                  ["approve_change", "Approve Change Request"],
                  ["withdraw", "Withdraw Consent"],
                  ["supersede", "Supersede"],
                ].map(([val, lab]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => { setActionType(val); if (val === "approve_change") initApprovePrefs(); }}
                    className={`rounded-xl border-2 px-3 py-2 text-xs font-bold transition ${
                      actionType === val ? "border-amber-500 bg-amber-100 text-amber-800" : "border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {lab}
                  </button>
                ))}
              </div>

              {/* Approve change: show editable preference grid */}
              {actionType === "approve_change" && approvePrefs !== null && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Set New Monitoring Preferences</p>
                  {MONITORING_CATEGORIES.map((cat) => {
                    const checked = cat.required || (approvePrefs || []).includes(cat.id);
                    return (
                      <label key={cat.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${
                        checked ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                      } ${cat.required ? "opacity-75 cursor-default" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={cat.required}
                          onChange={() => !cat.required && toggleAprovePref(cat.id)}
                          className="h-4 w-4 accent-blue-600 shrink-0"
                        />
                        <span className="text-sm font-bold text-slate-800">{cat.label}
                          {cat.required && <span className="ml-2 text-[10px] font-black text-blue-600">REQUIRED</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder={
                  actionType === "approve_change"
                    ? "Notes for this approval (included in audit trail)..."
                    : "Notes / reason for this action..."
                }
                rows={3}
                className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-amber-400 resize-none"
              />
              <div className="flex gap-3">
                <button onClick={() => setShowActionForm(false)} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-bold text-slate-600 hover:bg-white">Cancel</button>
                <button onClick={applyAction} disabled={actioning} className="flex-1 rounded-xl bg-amber-500 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">
                  {actioning ? "Applying..." : actionType === "approve_change" ? "Approve & Create New Version" : "Apply Action"}
                </button>
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-white/95 px-7 py-4 flex flex-wrap items-center gap-3 justify-end">
          {["pending_approval", "approved", "signed"].includes(consent.status) && (
            <>
              <button
                onClick={() => { logPrint("print"); window.print(); }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                <Eye size={16} /> Print
              </button>
              <button
                onClick={() => logPrint("download")}
                className="flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
              >
                <Download size={16} /> Download PDF
              </button>
              {!showActionForm && (
                <button
                  onClick={() => setShowActionForm(true)}
                  className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-bold text-amber-800 hover:bg-amber-100"
                >
                  <PenLine size={16} /> Admin Action
                </button>
              )}
            </>
          )}
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Consent Management ────────────────────────────────────────────
export default function ConsentManagement() {
  const { role } = useAuth();
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedConsent, setSelectedConsent] = useState(null);
  const [apiError, setApiError] = useState(null);

  const fetchConsents = useCallback(async () => {
    try {
      setLoading(true);
      setApiError(null);
      const res = await fetch(`${API_BASE}/consent/all`, { headers: authHeaders() });
      if (res.status === 403) {
        setApiError("You do not have permission to view Consent Management");
        return;
      }
      if (res.status === 404) {
        setApiError("Consent Management is not yet available");
        return;
      }
      const data = await res.json();
      setConsents(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      console.error("Failed to load consents:", err);
      setApiError("Failed to load consent data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConsents();
  }, [fetchConsents]);

  const filtered = consents.filter((c) => {
    const matchSearch =
      !search ||
      c.employee?.toLowerCase().includes(search.toLowerCase()) ||
      c.branch?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.consent_status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: consents.length,
    approved: consents.filter((c) => ["approved", "signed"].includes(c.consent_status)).length,
    pending: consents.filter((c) => ["pending_employee", "pending_approval", "pending"].includes(c.consent_status)).length,
    review: consents.filter((c) => c.consent_status === "pending_approval").length,
  };

  const handleAction = (consentId, newStatus) => {
    setConsents((prev) =>
      prev.map((c) => (c.consent_id === consentId ? { ...c, consent_status: newStatus } : c))
    );
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="RA 10173 Compliance"
        title="Consent Document Management"
        subtitle="View, verify, and manage all employee consent documents. Authorize consent changes and withdrawals per company policy."
      />

      {apiError ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
          <Shield className="mx-auto mb-4 text-slate-300" size={48} />
          <h3 className="mb-2 text-xl font-black text-slate-900">Access Restricted</h3>
          <p>{apiError}</p>
        </div>
      ) : (
        <>
          {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Total Consents", stats.total, "bg-slate-50 text-slate-700"],
          ["Approved", stats.approved, "bg-green-50 text-green-700"],
          ["Pending", stats.pending, "bg-amber-50 text-amber-700"],
          ["Needs Review", stats.review, "bg-blue-50 text-blue-700"],
        ].map(([label, value, cls]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className={`inline-flex items-center rounded-2xl p-3 ${cls} mb-3`}>
              <ClipboardList size={20} />
            </div>
            <p className="text-2xl font-black text-slate-900">{value}</p>
            <p className="text-sm font-semibold text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, branch..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-sm font-medium text-slate-900 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-600"
          >
            <option value="all">All Statuses</option>
            <option value="pending_employee">Pending Employee</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revision_requested">Revision Requested</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="superseded">Superseded</option>
          </select>
        </div>

        {loading ? (
          <p className="py-10 text-center text-slate-400 font-semibold">Loading consent documents...</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-slate-400 font-semibold">No consent documents found.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Branch / Dept</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Signed At</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.consent_id} className="border-t border-slate-100 hover:bg-blue-50/30 transition">
                    <td className="px-4 py-4 text-sm font-black text-blue-700">#{c.consent_id}</td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-slate-900">{c.employee}</p>
                      <p className="text-xs text-slate-500">ID: {c.employee_id}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">
                      {c.branch || "—"} / {c.department || "—"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">v{c.consent_version || "1.0"}</td>
                    <td className="px-4 py-4"><StatusBadge status={c.consent_status} /></td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      {c.submitted_at
                        ? new Date(c.submitted_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => setSelectedConsent(c)}
                        className="flex items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800"
                      >
                        <Eye size={13} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Privacy compliance note */}
      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6">
        <h2 className="flex items-center gap-2 font-black text-blue-950">
          <Shield size={20} /> Privacy & RA 10173 Compliance
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-semibold text-blue-900">
          <li>Consent documents are legally binding and cannot be edited after signing.</li>
          <li>Employees must file a Consent Change Request to modify or withdraw consent.</li>
          <li>Only Admin or HR roles may approve withdrawal or update consent status.</li>
          <li>All actions are recorded in the immutable audit trail.</li>
          <li>Monitoring policy automatically follows the latest signed consent document.</li>
          <li>Withdrawn consent disables all optional monitoring categories immediately.</li>
        </ul>
      </section>
      

      {selectedConsent && (
        <ConsentPrintModal
          consent={selectedConsent}
          onClose={() => setSelectedConsent(null)}
          onAction={handleAction}
        />
      )}
        </>
      )}
    </div>
  );
}
