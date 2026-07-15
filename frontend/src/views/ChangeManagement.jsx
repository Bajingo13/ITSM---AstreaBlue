import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  GitPullRequest,
  List,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageHero from "../components/layout/PageHero";
import {
  ChangeTypeBadge,
  ConfirmationDialog,
  EmptyState,
  InfoRow,
  LoadingSkeleton,
  MetricCard,
  Modal,
  PriorityBadge,
  ProgressBar,
  RiskBadge,
  SectionCard,
  StatusBadge,
  panelClass,
} from "../components/ChangeReleaseUI";
import { changeReleaseApi } from "../services/changeReleaseApi";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";
import { useAuth } from "../context/AuthContext";

/* ─── helpers ─── */
const FIELDS = Object.freeze({
  BASIC: [
    { key: "title", label: "Change Title", type: "text", wide: true, required: true },
    { key: "branch_id", label: "Branch", type: "branch_select", required: true },
    { key: "description", label: "Description", type: "textarea", wide: true },
    { key: "business_justification", label: "Business Justification", type: "textarea", wide: true },
    { key: "change_type", label: "Change Type", type: "select", options: ["Standard", "Normal", "Emergency"] },
    { key: "category", label: "Category", type: "select", options: ["Infrastructure", "Application", "Network", "Configuration", "Security", "Other"] },
    { key: "priority", label: "Priority", type: "select", options: ["Low", "Medium", "High", "Critical"] },
    { key: "planned_start", label: "Scheduled Start", type: "datetime-local" },
    { key: "planned_end", label: "Scheduled End", type: "datetime-local" },
  ],
  TECHNICAL: [
    { key: "affected_services", label: "Affected Services", type: "textarea", wide: true, placeholder: "Comma-separated service names" },
    { key: "affected_assets", label: "Affected Assets / CIs", type: "textarea", wide: true, placeholder: "Comma-separated asset or CI identifiers" },
    { key: "expected_downtime", label: "Expected Downtime", type: "text", placeholder: "e.g. 30 minutes" },
    { key: "dependencies", label: "Dependencies", type: "textarea", wide: true, placeholder: "Comma-separated dependency names" },
    { key: "implementation_plan", label: "Implementation Plan", type: "textarea", wide: true },
    { key: "testing_plan", label: "Testing & Validation Plan", type: "textarea", wide: true },
    { key: "backout_plan", label: "Rollback Plan", type: "textarea", wide: true },
    { key: "post_implementation_verification", label: "Post-Implementation Verification", type: "textarea", wide: true },
    { key: "assigned_technician_id", label: "Assigned Technician", type: "user_select" },
  ],
  RISK: [
    { key: "impact_level", label: "Impact Level", type: "select", options: ["Low", "Medium", "High", "Critical"] },
    { key: "risk_level", label: "Risk Level", type: "select", options: ["Low", "Medium", "High", "Critical"] },
    { key: "risk_score", label: "Risk Score", type: "number" },
    { key: "security_impact", label: "Security Impact", type: "select", options: ["None", "Low", "Medium", "High", "Critical"] },
    { key: "compliance_impact", label: "Compliance Impact", type: "select", options: ["None", "Low", "Medium", "High", "Critical"] },
    { key: "data_loss_risk", label: "Data Loss Risk", type: "select", options: ["None", "Low", "Medium", "High", "Critical"] },
    { key: "operational_risk", label: "Operational Risk", type: "select", options: ["None", "Low", "Medium", "High", "Critical"] },
  ],
});

const STATUS_OPTIONS = [
  "Draft","Submitted","Under Assessment","Pending Manager Approval","Pending CAB Review",
  "Approved","Rejected","Scheduled","In Progress","Implemented",
  "Validation Pending","Completed","Failed","Rolled Back","Cancelled",
];

const ALL_CHANGE_TYPES = ["Standard", "Normal", "Emergency"];
const RISK_LEVELS = ["", "Low", "Medium", "High", "Critical"];
const analyticsCardClass = "astrea-premium-card rounded-[24px] border border-blue-100 bg-white p-5 shadow-[0_12px_35px_rgba(30,64,175,0.08)]";

/* ─── Multi-section new/edit form ─── */
function ChangeForm({ branches, technicians, user, editItem, onClose, onSaved }) {
  const isEdit = Boolean(editItem);
  const blank = useMemo(() => ({
    title: "", description: "", business_justification: "",
    change_type: "Normal", category: "Infrastructure", priority: "Medium",
    branch_id: "", planned_start: "", planned_end: "",
    impact_level: "Medium", risk_level: "Medium", risk_score: 0,
    security_impact: "None", compliance_impact: "None", data_loss_risk: "None", operational_risk: "None",
    implementation_plan: "", testing_plan: "", backout_plan: "", post_implementation_verification: "",
    affected_services: "", affected_assets: "", expected_downtime: "", dependencies: "",
    assigned_technician_id: "",
  }), []);

  const [form, setForm] = useState(() => {
    if (editItem) {
      return {
        ...blank,
        ...editItem,
        branch_id: editItem.branch_id || user?.branch_id || "",
        assigned_technician_id: editItem.assigned_technician_id || "",
      };
    }
    return { ...blank, branch_id: user?.branch_id || "" };
  });

  const [tab, setTab] = useState("basic");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key) => (e) => {
    const val = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((cur) => ({ ...cur, [key]: val }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const missingFields = [];
    if (!form.title?.trim()) missingFields.push("change title");
    if (!form.branch_id) missingFields.push("branch");
    if (missingFields.length) {
      setTab("basic");
      setError(`Please provide the required ${missingFields.join(" and ")} before creating the change.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        linked_services: (form.affected_services || "").split(",").map((s) => s.trim()).filter(Boolean),
        linked_cis: (form.affected_assets || "").split(",").map((s) => s.trim()).filter(Boolean),
        dependencies: (form.dependencies || "").split(",").map((s) => s.trim()).filter(Boolean),
        affected_services: undefined,
        affected_assets: undefined,
      };
      if (isEdit) {
        await changeReleaseApi.updateChange(editItem.id, payload);
      } else {
        await changeReleaseApi.createChange(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isSuperAdmin = String(user?.role_name || user?.role || "").toLowerCase() === "superadmin";

  const tabs = [
    { id: "basic", label: "Basic Info" },
    { id: "technical", label: "Technical" },
    { id: "risk", label: "Risk Assessment" },
  ];

  return (
    <Modal
      wide
      title={isEdit ? "Edit Change Request" : "New Change Request"}
      subtitle="Fill in the required details across all sections."
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        {/* Tab navigation */}
        <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
                tab === t.id
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-blue-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "basic" && (
          <div className="grid gap-4 md:grid-cols-2">
            {FIELDS.BASIC.map((f) => (
              <div key={f.key} className={f.wide ? "md:col-span-2" : ""}>
                <label className="astrea-field-label">
                  {f.label}
                  {f.key === "branch_id" ? (
                    <select
                      required
                      className="astrea-control mt-2 w-full"
                      value={form.branch_id}
                      onChange={update("branch_id")}
                      disabled={!isSuperAdmin || isEdit}
                    >
                      <option value="">Select branch</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>
                          {b.branch_name}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "select" ? (
                    <select
                      className="astrea-control mt-2 w-full"
                      value={form[f.key]}
                      onChange={update(f.key)}
                    >
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea
                      rows={3}
                      className="astrea-control mt-2 w-full"
                      value={form[f.key] || ""}
                      onChange={update(f.key)}
                    />
                  ) : (
                    <input
                      type={f.type || "text"}
                      required={f.required}
                      className="astrea-control mt-2 w-full"
                      value={form[f.key] || ""}
                      onChange={update(f.key)}
                    />
                  )}
                </label>
              </div>
            ))}
          </div>
        )}

        {tab === "technical" && (
          <div className="grid gap-4 md:grid-cols-2">
            {FIELDS.TECHNICAL.map((f) => (
              <div key={f.key} className={f.wide ? "md:col-span-2" : ""}>
                <label className="astrea-field-label">
                  {f.label}
                  {f.key === "assigned_technician_id" ? (
                    <select
                      className="astrea-control mt-2 w-full"
                      value={form.assigned_technician_id}
                      onChange={update("assigned_technician_id")}
                    >
                      <option value="">Select technician</option>
                      {technicians.map((t) => (
                        <option key={t.user_id} value={t.user_id}>
                          {t.full_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      rows={f.type === "textarea" ? 3 : 2}
                      className="astrea-control mt-2 w-full"
                      value={form[f.key] || ""}
                      onChange={update(f.key)}
                      placeholder={f.placeholder || ""}
                    />
                  )}
                </label>
              </div>
            ))}
          </div>
        )}

        {tab === "risk" && (
          <div className="grid gap-4 md:grid-cols-2">
            {FIELDS.RISK.map((f) => (
              <div key={f.key}>
                <label className="astrea-field-label">
                  {f.label}
                  {f.type === "select" ? (
                    <select
                      className="astrea-control mt-2 w-full"
                      value={form[f.key] || ""}
                      onChange={update(f.key)}
                    >
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="astrea-control mt-2 w-full"
                      value={form[f.key]}
                      onChange={update(f.key)}
                    />
                  )}
                </label>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="astrea-button astrea-button-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="astrea-button astrea-button-primary">
            {saving ? "Saving..." : isEdit ? "Update Change" : "Create Change"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Action button with confirmation ─── */
function WorkflowAction({ action, changeId, onDone, onError, user }) {
  const [confirming, setConfirming] = useState(false);
  const [comment, setComment] = useState("");

  const needsComment = ["Rejected", "Cancelled", "Failed", "Rolled Back"].includes(action.action);

  const execute = async () => {
    try {
      const payload = { status: action.action };
      if (needsComment && comment.trim()) payload.comment = comment.trim();
      if (action.action === "Rejected") payload.rejection_reason = comment.trim();
      if (action.action === "Cancelled") payload.cancellation_reason = comment.trim();
      if (action.action === "Failed") payload.failure_reason = comment.trim();
      if (action.action === "Rolled Back") payload.rollback_reason = comment.trim();
      await changeReleaseApi.transitionStatus(changeId, action.action, payload);
      setConfirming(false);
      onDone();
    } catch (err) {
      onError(err.message);
      setConfirming(false);
    }
  };

  return (
    <>
      <button
        onClick={() => (needsComment ? setConfirming(true) : execute())}
        className="astrea-button astrea-button-primary text-xs"
        title={action.description || ""}
      >
        {action.label || action.action}
        <ChevronRight size={14} />
      </button>

      {confirming && (
        <ConfirmationDialog
          title={action.action}
          message={`Are you sure you want to move this change to "${action.action}"?`}
          confirmLabel={`Move to ${action.action}`}
          danger={["Cancelled", "Failed", "Rolled Back", "Rejected"].includes(action.action)}
          onConfirm={execute}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

/* ─── Change detail view ─── */
function ChangeDetail({ id, onClose, onChanged, user, branches, technicians }) {
  const [item, setItem] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("overview");
  const [comment, setComment] = useState("");
  const [cabComment, setCabComment] = useState("");
  const [cabDecision, setCabDecision] = useState("Approved");
  const [implNote, setImplNote] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [technicianList, setTechnicianList] = useState(technicians || []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [changeData, allowedActions] = await Promise.all([
        changeReleaseApi.getChange(id),
        changeReleaseApi.getActions(id).catch(() => []),
      ]);
      setItem(changeData);
      setActions(allowedActions);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!technicianList.length) {
      fetch(`${API_URL}/api/v1/technicians`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (d.data) setTechnicianList(d.data);
          else if (Array.isArray(d)) setTechnicianList(d);
        })
        .catch(() => {});
    }
  }, []);

  const addComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setSaving(true);
    try {
      await changeReleaseApi.addComment(id, comment);
      setComment("");
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (e) => {
    if (!e.target.files?.length) return;
    setSaving(true);
    try {
      await changeReleaseApi.uploadAttachments(id, e.target.files);
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
    e.target.value = "";
  };

  const handleActionDone = async () => {
    setActionError("");
    await load();
    onChanged();
  };

  const addCabDecision = async () => {
    if (!cabComment.trim()) return;
    setSaving(true);
    try {
      await changeReleaseApi.addApproval(id, cabDecision, cabComment);
      setCabComment("");
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addCabMember = async (userId) => {
    if (!userId) return;
    setSaving(true);
    try {
      await changeReleaseApi.addCabMember(id, Number(userId));
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeCabMember = async (memberId) => {
    setSaving(true);
    try {
      await changeReleaseApi.removeCabMember(id, memberId);
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addImplUpdate = async () => {
    if (!implNote.trim()) return;
    setSaving(true);
    try {
      await changeReleaseApi.addImplementationUpdate(id, { action: "Update", notes: implNote });
      setImplNote("");
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleDate) return;
    setSaving(true);
    try {
      await changeReleaseApi.transitionStatus(id, "Scheduled", {
        scheduled_date: scheduleDate,
      });
      setScheduleDate("");
      await load();
      onChanged();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "risk", label: "Risk Assessment" },
    { id: "cis", label: "Affected CIs" },
    { id: "planning", label: "Implementation Plan" },
    { id: "testing", label: "Testing Plan" },
    { id: "rollback", label: "Rollback Procedure" },
    { id: "approval", label: "Approval Workflow" },
    { id: "cab", label: "CAB Review" },
    { id: "schedule", label: "Schedule" },
    { id: "impl_updates", label: "Implementation" },
    { id: "pir", label: "Post-Implementation Review" },
    { id: "attachments", label: "Attachments" },
    { id: "timeline", label: "Activity Timeline" },
  ];

  if (loading) return <Modal wide title="Change Request" onClose={onClose}><LoadingSkeleton rows={4} /></Modal>;
  if (!item)
    return (
      <Modal wide title="Change Request" onClose={onClose}>
        <EmptyState title="Unable to load change" message={error} />
      </Modal>
    );

  const canManageCAB = ["superadmin", "admin"].includes(String(user?.role_name).toLowerCase());
  const isSuperAdmin = String(user?.role_name).toLowerCase() === "superadmin";

  return (
    <Modal
      wide
      title={`${item.change_number} · ${item.title}`}
      subtitle={`${item.change_type} · ${item.branch_name || ""}`}
      onClose={onClose}
    >
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <StatusBadge status={item.status} />
        <ChangeTypeBadge type={item.change_type} />
        <RiskBadge level={item.risk_level} />
        <PriorityBadge priority={item.priority} />
        <span className="text-xs text-slate-400">{item.branch_name}</span>

        {/* Workflow actions */}
        <div className="ml-auto flex flex-wrap gap-2">
          {actions.map((action, i) => (
            <WorkflowAction
              key={`${action.action}-${i}`}
              action={action}
              changeId={id}
              onDone={handleActionDone}
              onError={setActionError}
              user={user}
            />
          ))}
        </div>
      </div>

      {actionError && (
        <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{actionError}</p>
      )}

      {/* Section tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition ${
              activeSection === s.id
                ? "bg-white text-blue-700 shadow-sm"
                : "text-slate-500 hover:text-blue-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeSection === "overview" && (
        <div className="space-y-5">
          <SectionCard title="Basic Information" icon={<FileText size={16} />}>
            <div className="grid gap-4 md:grid-cols-2">
              <InfoRow label="Change Number" value={item.change_number} />
              <InfoRow label="Title" value={item.title} />
              <InfoRow label="Description" value={item.description} />
              <InfoRow label="Business Justification" value={item.business_justification} />
              <InfoRow label="Category" value={item.category} />
              <InfoRow label="Priority" value={item.priority} />
              <InfoRow label="Requester" value={item.requester_name || item.owner_name} />
              <InfoRow label="Branch" value={item.branch_name} />
              <InfoRow label="Assigned Technician" value={item.technician_name || "Unassigned"} />
              <InfoRow label="Expected Downtime" value={item.expected_downtime} />
              <InfoRow label="User/Business Impact" value={item.user_impact} />
              <InfoRow label="Dependencies" value={item.dependencies?.join?.(", ") || "None"} />
            </div>
          </SectionCard>
          <SectionCard title="Requested Dates" icon={<CalendarDays size={16} />}>
            <div className="grid gap-4 md:grid-cols-2">
              <InfoRow label="Scheduled Start" value={item.planned_start ? new Date(item.planned_start).toLocaleString() : "—"} />
              <InfoRow label="Scheduled End" value={item.planned_end ? new Date(item.planned_end).toLocaleString() : "—"} />
              <InfoRow label="Actual Start" value={item.actual_start ? new Date(item.actual_start).toLocaleString() : "—"} />
              <InfoRow label="Actual End" value={item.actual_end ? new Date(item.actual_end).toLocaleString() : "—"} />
              <InfoRow label="Created" value={new Date(item.created_at).toLocaleString()} />
              <InfoRow label="Last Updated" value={new Date(item.updated_at).toLocaleString()} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── RISK ASSESSMENT ── */}
      {activeSection === "risk" && (
        <SectionCard title="Risk Assessment" icon={<ShieldAlert size={16} />}>
          <div className="grid gap-4 md:grid-cols-2">
            <InfoRow label="Impact Level" value={item.impact_level} />
            <InfoRow label="Risk Level" value={item.risk_level} />
            <InfoRow label="Risk Score" value={item.risk_score ?? "—"} />
            <InfoRow label="Security Impact" value={item.security_impact || "None"} />
            <InfoRow label="Compliance Impact" value={item.compliance_impact || "None"} />
            <InfoRow label="Data Loss Risk" value={item.data_loss_risk || "None"} />
            <InfoRow label="Operational Risk" value={item.operational_risk || "None"} />
          </div>
        </SectionCard>
      )}

      {/* ── AFFECTED CIS ── */}
      {activeSection === "cis" && (
        <SectionCard title="Affected Configuration Items" icon={<FileText size={16} />}>
          {item.linked_cis?.length ? (
            <div className="flex flex-wrap gap-2">
              {item.linked_cis.map((ci, i) => (
                <span key={i} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  {typeof ci === "object" ? ci.name || ci.id : ci}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No configuration items linked.</p>
          )}
        </SectionCard>
      )}

      {/* ── IMPLEMENTATION PLAN ── */}
      {activeSection === "planning" && (
        <SectionCard title="Implementation Plan" icon={<CheckCircle2 size={16} />}>
          <div className="grid gap-4">
            <InfoRow label="Implementation Plan" value={item.implementation_plan} />
            <InfoRow label="Communication Plan" value={item.communication_plan} />
          </div>
        </SectionCard>
      )}

      {/* ── TESTING PLAN ── */}
      {activeSection === "testing" && (
        <SectionCard title="Testing & Validation Plan" icon={<CheckCircle2 size={16} />}>
          <InfoRow label="Testing Plan" value={item.testing_plan} />
        </SectionCard>
      )}

      {/* ── ROLLBACK ── */}
      {activeSection === "rollback" && (
        <SectionCard title="Rollback Procedure" icon={<Clock size={16} />}>
          <InfoRow label="Rollback Plan" value={item.backout_plan} />
          {item.rollback_reason && <InfoRow label="Rollback Reason" value={item.rollback_reason} />}
        </SectionCard>
      )}

      {/* ── APPROVAL WORKFLOW ── */}
      {activeSection === "approval" && (
        <div className="space-y-5">
          <SectionCard title="Approval History" icon={<ClipboardCheck size={16} />}>
            {item.approvals?.length ? (
              <div className="space-y-3">
                {item.approvals.map((a) => (
                  <div key={a.id} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.decision} />
                      <span className="text-xs font-bold text-slate-600">{a.approver_name || "Approver"}</span>
                      {a.decided_at && (
                        <span className="text-xs text-slate-400 ml-auto">{new Date(a.decided_at).toLocaleString()}</span>
                      )}
                    </div>
                    {a.comments && <p className="mt-2 text-sm text-slate-600">{a.comments}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No approval decisions recorded yet.</p>
            )}
          </SectionCard>
          <SectionCard title="Add CAB Decision" icon={<ClipboardCheck size={16} />}>
            <div className="flex gap-2 mb-3">
              <select
                value={cabDecision}
                onChange={(e) => setCabDecision(e.target.value)}
                className="astrea-control w-40"
              >
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
            <textarea
              rows={2}
              placeholder="Decision comments..."
              className="astrea-control w-full mb-3"
              value={cabComment}
              onChange={(e) => setCabComment(e.target.value)}
            />
            <button
              onClick={addCabDecision}
              disabled={saving || !cabComment.trim()}
              className="astrea-button astrea-button-primary"
            >
              {saving ? "Recording..." : "Record Decision"}
            </button>
          </SectionCard>
        </div>
      )}

      {/* ── CAB REVIEW ── */}
      {activeSection === "cab" && (
        <div className="space-y-5">
          <SectionCard title="CAB Members" icon={<Users size={16} />}>
            {item.cab_members?.length ? (
              <div className="space-y-2">
                {item.cab_members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                    <div>
                      <p className="text-sm font-bold text-slate-700">{m.member_name || `User #${m.user_id}`}</p>
                      <p className="text-xs text-slate-400">{m.role}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={m.status} />
                      {canManageCAB && (
                        <button
                          onClick={() => removeCabMember(m.id)}
                          className="rounded-lg p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                          title="Remove member"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No CAB members assigned.</p>
            )}

            {canManageCAB && (
              <div className="mt-4 flex gap-2">
                <select
                  className="astrea-control flex-1"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addCabMember(e.target.value);
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="" disabled>Add CAB member...</option>
                  {technicianList.map((t) => (
                    <option key={t.user_id} value={t.user_id}>
                      {t.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </SectionCard>

          <SectionCard title="CAB Reviews" icon={<ClipboardCheck size={16} />}>
            {item.cab_reviews?.length ? (
              <div className="space-y-3">
                {item.cab_reviews.map((r) => (
                  <div key={r.id} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.review_status} />
                      <span className="text-xs text-slate-400">{r.meeting_ref || "No meeting ref"}</span>
                      <span className="text-xs text-slate-400 ml-auto">{r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : ""}</span>
                    </div>
                    {r.decision_notes && <p className="mt-2 text-sm text-slate-600">{r.decision_notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No CAB reviews recorded.</p>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── SCHEDULE ── */}
      {activeSection === "schedule" && (
        <div className="space-y-5">
          <SectionCard title="Schedule Change" icon={<CalendarDays size={16} />}>
            <div className="flex gap-3 items-end">
              <label className="astrea-field-label flex-1">
                Scheduled Date & Time
                <input
                  type="datetime-local"
                  className="astrea-control mt-2 w-full"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </label>
              <button
                onClick={handleSchedule}
                disabled={saving || !scheduleDate}
                className="astrea-button astrea-button-primary"
              >
                {saving ? "Saving..." : "Set Schedule"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Schedule History" icon={<Clock size={16} />}>
            {item.schedule_history?.length ? (
              <div className="space-y-3">
                {item.schedule_history.map((s) => (
                  <div key={s.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="font-bold text-slate-700">
                      {s.previous_start ? `From ${new Date(s.previous_start).toLocaleString()}` : "Not scheduled"} →{" "}
                      {new Date(s.new_start).toLocaleString()}
                    </p>
                    {s.reason && <p className="text-xs text-slate-400 mt-1">{s.reason}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No schedule changes recorded.</p>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── IMPLEMENTATION UPDATES ── */}
      {activeSection === "impl_updates" && (
        <div className="space-y-5">
          <SectionCard title="Implementation Progress" icon={<CheckCircle2 size={16} />}>
            <ProgressBar value={item.implementation_progress || 0} />
          </SectionCard>

          <SectionCard title="Add Update" icon={<MessageSquare size={16} />}>
            <textarea
              rows={2}
              placeholder="Implementation notes..."
              className="astrea-control w-full mb-3"
              value={implNote}
              onChange={(e) => setImplNote(e.target.value)}
            />
            <button
              onClick={addImplUpdate}
              disabled={saving || !implNote.trim()}
              className="astrea-button astrea-button-primary"
            >
              {saving ? "Saving..." : "Add Update"}
            </button>
          </SectionCard>

          <SectionCard title="Update History" icon={<Clock size={16} />}>
            {item.implementation_updates?.length ? (
              <div className="space-y-3">
                {item.implementation_updates.map((u) => (
                  <div key={u.id} className="rounded-xl bg-slate-50 p-3">
                    <p className="text-sm font-bold text-slate-700">{u.action}</p>
                    <p className="text-sm text-slate-600">{u.notes}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {u.performer_name || "System"} · {new Date(u.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No implementation updates yet.</p>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── PIR ── */}
      {activeSection === "pir" && (
        <SectionCard title="Post-Implementation Review" icon={<ClipboardCheck size={16} />}>
          <div className="grid gap-4">
            <InfoRow label="Post-Implementation Verification Plan" value={item.post_implementation_verification} />
            <InfoRow label="Review Notes" value={item.review_notes} />
            <InfoRow label="Reviewed At" value={item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : "—"} />
            {item.failure_reason && <InfoRow label="Failure Reason" value={item.failure_reason} />}
            {item.rollback_reason && <InfoRow label="Rollback Reason" value={item.rollback_reason} />}
            {item.cancellation_reason && <InfoRow label="Cancellation Reason" value={item.cancellation_reason} />}
            {item.rejection_reason && <InfoRow label="Rejection Reason" value={item.rejection_reason} />}
          </div>
        </SectionCard>
      )}

      {/* ── ATTACHMENTS ── */}
      {activeSection === "attachments" && (
        <SectionCard
          title="Attachments"
          icon={<Paperclip size={16} />}
          action={
            <label className="astrea-button astrea-button-secondary cursor-pointer text-xs">
              <Paperclip size={14} />
              Upload
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={upload}
                className="hidden"
              />
            </label>
          }
        >
          {item.attachments?.length ? (
            <div className="space-y-2">
              {item.attachments.map((att) => (
                <a
                  key={att.id}
                  href={`${API_URL}${att.file_path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50 hover:translate-x-1"
                >
                  <FileText size={17} />
                  <span className="truncate">{att.file_name}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {att.file_size ? `${(att.file_size / 1024).toFixed(1)} KB` : ""}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No attachments uploaded yet.</p>
          )}
        </SectionCard>
      )}

      {/* ── ACTIVITY TIMELINE ── */}
      {activeSection === "timeline" && (
        <div className="space-y-5">
          <SectionCard title="Add Comment" icon={<MessageSquare size={16} />}>
            <form onSubmit={addComment} className="flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment..."
                className="astrea-control min-w-0 flex-1"
              />
              <button
                type="submit"
                disabled={saving || !comment.trim()}
                className="astrea-button astrea-button-primary"
              >
                {saving ? "..." : "Add"}
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Activity Timeline" icon={<Clock size={16} />}>
            {item.activities?.length ? (
              <div className="max-h-96 space-y-1 overflow-y-auto">
                {item.activities.map((activity) => (
                  <div key={activity.id} className="relative border-l-2 border-blue-100 pl-4 pb-4">
                    <i className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-500" />
                    <p className="text-sm font-bold text-slate-700">{activity.message}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {activity.actor_name || "System"} ·{" "}
                      {new Date(activity.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No activity recorded yet.</p>
            )}
          </SectionCard>
        </div>
      )}
    </Modal>
  );
}

function ChangeAnalyticsOverview({ summary, loading }) {
  const trend = Array.isArray(summary?.trend) ? summary.trend : [];
  const success = Number(summary?.deployment_success_pct || 0);
  const readiness = Number(summary?.rollback_readiness_pct || 0);
  const workflow = [
    ["Open", Number(summary?.open_changes || 0), "bg-blue-600"],
    ["CAB Review", Number(summary?.cab_queue_count ?? summary?.cab_queue ?? 0), "bg-violet-500"],
    ["Emergency", Number(summary?.emergency_changes || 0), "bg-rose-500"],
    ["Scheduled", Number(summary?.scheduled || 0), "bg-cyan-500"],
  ];
  const maxWorkflow = Math.max(1, ...workflow.map((item) => item[1]));

  if (loading) {
    return <div className="grid animate-pulse gap-4 lg:grid-cols-3"><div className="h-80 rounded-3xl bg-slate-100 lg:col-span-2" /><div className="h-80 rounded-3xl bg-slate-100" /></div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className={`${analyticsCardClass} astrea-dashboard-enter lg:col-span-2`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Change volume</p><h2 className="mt-1 text-lg font-black text-slate-900">Six-month workflow trend</h2><p className="text-xs font-semibold text-slate-400">Created versus successfully completed changes</p></div>
          <div className="flex gap-2"><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700">Total changes</span><span className="rounded-full bg-cyan-50 px-3 py-1 text-[11px] font-black text-cyan-700">Successful</span></div>
        </div>
        {trend.length ? <ResponsiveContainer width="100%" height={245}>
          <AreaChart data={trend} margin={{ top: 24, right: 12, left: -22, bottom: 0 }}>
            <defs><linearGradient id="changeCountFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.32} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="4 4" stroke="#dbeafe" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #dbeafe", boxShadow: "0 12px 30px rgba(30,64,175,.12)" }} />
            <Area type="monotone" dataKey="count" name="Created" stroke="#2563eb" strokeWidth={3} fill="url(#changeCountFill)" />
            <Area type="monotone" dataKey="successful" name="Successful" stroke="#06b6d4" strokeWidth={3} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer> : <div className="flex h-[245px] items-center justify-center text-sm font-semibold text-slate-400">Trend data will appear as changes are created.</div>}
      </section>

      <section className={`${analyticsCardClass} astrea-dashboard-enter`} style={{ animationDelay: "80ms" }}>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Delivery posture</p><h2 className="mt-1 text-lg font-black text-slate-900">Deployment success</h2><p className="text-xs font-semibold text-slate-400">Completed release performance</p>
        <div className="relative mx-auto mt-7 flex h-44 w-44 items-center justify-center rounded-full" style={{ background: `conic-gradient(#2563eb 0 ${success * 3.6}deg, #dbeafe ${success * 3.6}deg 360deg)` }}>
          <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-white shadow-inner"><span className="text-4xl font-black text-slate-950">{success}%</span><span className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Success rate</span></div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-center"><p className="text-xl font-black text-blue-700">{readiness}%</p><p className="text-[10px] font-black uppercase text-slate-400">Rollback ready</p></div><div className="rounded-2xl bg-cyan-50 p-3 text-center"><p className="text-xl font-black text-cyan-700">{summary?.upcoming_releases || 0}</p><p className="text-[10px] font-black uppercase text-slate-400">Upcoming</p></div></div>
      </section>

      <section className={`${analyticsCardClass} astrea-dashboard-enter lg:col-span-2`} style={{ animationDelay: "130ms" }}>
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><BarChart3 size={19} /></div><div><h2 className="font-black text-slate-900">Workflow distribution</h2><p className="text-xs font-semibold text-slate-400">Current operational queue</p></div></div>
        <div className="mt-6 space-y-4">{workflow.map(([label, value, color]) => <div key={label} className="group"><div className="mb-1.5 flex items-center justify-between text-xs font-black"><span className="text-slate-600">{label}</span><span className="text-slate-900">{value}</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color} transition-all duration-700 group-hover:brightness-110`} style={{ width: `${Math.max(value ? 8 : 0, value / maxWorkflow * 100)}%` }} /></div></div>)}</div>
      </section>

      <section className={`${analyticsCardClass} astrea-dashboard-enter`} style={{ animationDelay: "180ms" }}>
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><Clock size={19} /></div><div><h2 className="font-black text-slate-900">Recent activity</h2><p className="text-xs font-semibold text-slate-400">Latest workflow events</p></div></div>
        <div className="mt-5 space-y-2">{summary?.recent_activity?.length ? summary.recent_activity.slice(0, 4).map((activity, index) => <div key={`${activity.change_number}-${index}`} className="rounded-2xl border border-transparent bg-slate-50 p-3 transition duration-300 hover:translate-x-1 hover:border-blue-100 hover:bg-blue-50"><p className="truncate text-xs font-black text-slate-700">{activity.change_number} · {activity.event_type}</p><p className="mt-1 line-clamp-2 text-[11px] font-semibold text-slate-400">{activity.message}</p></div>) : <p className="py-12 text-center text-sm font-semibold text-slate-400">No recent activity.</p>}</div>
      </section>
    </div>
  );
}

/* ─── Main page ─── */
export default function ChangeManagement() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 25 });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filtersVisible, setFiltersVisible] = useState(false);

  const isSuperAdmin = String(user?.role_name).toLowerCase() === "superadmin";

  // Load branches & technicians
  useEffect(() => {
    const headers = authHeaders();
    const technicianParams = new URLSearchParams({
      role_name: user?.role_name || user?.role || "",
      current_user_id: String(user?.user_id || ""),
      current_branch_id: String(user?.branch_id || ""),
    });
    Promise.all([
      fetch(`${API_URL}/api/v1/branches`, { headers, cache: "no-store" }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.message || body.error || "Failed to load branches.");
        return body;
      }),
      fetch(`${API_URL}/api/v1/technicians?${technicianParams}`, { headers, cache: "no-store" }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.message || body.error || "Failed to load technicians.");
        return body;
      }),
    ]).then(([branchData, techData]) => {
      const branchRows = branchData.data || branchData || [];
      setBranches(Array.isArray(branchRows) ? branchRows : []);
      const techs = techData.data || techData || [];
      setTechnicians(Array.isArray(techs) ? techs : []);
    }).catch((loadError) => setError(loadError.message));
  }, [user]);

  // Load summary
  useEffect(() => {
    setSummaryLoading(true);
    setSummaryError("");
    changeReleaseApi
      .getSummary()
      .then(setSummary)
      .catch((summaryLoadError) => setSummaryError(summaryLoadError.message))
      .finally(() => setSummaryLoading(false));
  }, []);

  // Load changes
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        search: search || undefined,
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        risk_level: riskFilter || undefined,
        page,
        limit: 25,
      };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (isSuperAdmin && branchFilter) params.filter_branch_id = branchFilter;

      const result = await changeReleaseApi.listChanges(params);
      setItems(result.data || []);
      setMeta(result.meta || { total: 0, page: 1, limit: 25 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, riskFilter, branchFilter, dateFrom, dateTo, page, isSuperAdmin]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.limit || 25)));

  const refresh = () => {
    load();
    setCreating(false);
    setEditing(null);
    // also refresh summary
    changeReleaseApi.getSummary().then(setSummary).catch(() => {});
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setTypeFilter("");
    setRiskFilter("");
    setBranchFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters = search || statusFilter || typeFilter || riskFilter || branchFilter || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Change & Release Management"
        title="Change Request Workflow"
        subtitle="Assess, approve, schedule, implement, and audit controlled enterprise changes."
        actions={
          <div className="flex gap-2">
            <button
              onClick={load}
              className="astrea-button border border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
            <button
              onClick={() => setCreating(true)}
              className="astrea-button bg-white text-blue-700 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Plus size={16} />
              New Change
            </button>
          </div>
        }
      />

      {summaryError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-800">
          Dashboard summary unavailable: {summaryError}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={GitPullRequest}
          label="Open Changes"
          value={summaryLoading ? "..." : (summary?.open_changes ?? 0)}
          detail="Pending operational completion"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="CAB Queue"
          value={summaryLoading ? "..." : (summary?.cab_queue_count ?? summary?.cab_queue ?? 0)}
          tone="bg-violet-50 text-violet-700"
          detail="Awaiting CAB review"
        />
        <MetricCard
          icon={ShieldAlert}
          label="Emergency Changes"
          value={summaryLoading ? "..." : (summary?.emergency_changes ?? 0)}
          tone="bg-red-50 text-red-700"
          detail="Requires immediate attention"
        />
        <MetricCard
          icon={CalendarDays}
          label="Scheduled"
          value={summaryLoading ? "..." : (summary?.scheduled ?? 0)}
          tone="bg-cyan-50 text-cyan-700"
          detail="Ready for implementation"
        />
      </div>

      <ChangeAnalyticsOverview summary={summary} loading={summaryLoading} />

      {/* Filter toolbar */}
      <section className={panelClass}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-3 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search change number or title..."
                className="astrea-control w-full pl-10"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="astrea-control"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="astrea-control"
            >
              <option value="">All types</option>
              {ALL_CHANGE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <button
              onClick={() => setFiltersVisible(!filtersVisible)}
              className={`astrea-button ${filtersVisible ? "bg-blue-100 text-blue-700" : "astrea-button-secondary"}`}
            >
              <SlidersHorizontal size={15} />
              Filters
            </button>

            {hasActiveFilters && (
              <button onClick={clearFilters} className="astrea-button astrea-button-secondary text-xs">
                <X size={14} />
                Clear
              </button>
            )}

            <button onClick={load} className="astrea-button astrea-button-secondary" title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>

          {/* Collapsible advanced filters */}
          {filtersVisible && (
            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3">
              <select
                value={riskFilter}
                onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}
                className="astrea-control"
              >
                {RISK_LEVELS.map((r) => (
                  <option key={r || "all_risk"} value={r}>{r || "All risk levels"}</option>
                ))}
              </select>

              {isSuperAdmin && (
                <select
                  value={branchFilter}
                  onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
                  className="astrea-control"
                >
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
                  ))}
                </select>
              )}

              <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="astrea-control"
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="astrea-control"
                />
              </label>
            </div>
          )}
        </div>
      </section>

      {/* Error state */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-500" size={20} />
            <p className="font-bold text-red-700">{error}</p>
            <button onClick={load} className="ml-auto astrea-button bg-red-100 text-red-700 hover:bg-red-200">
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && <LoadingSkeleton rows={6} />}

      {/* Empty state */}
      {!loading && !error && !items.length && (
        <EmptyState
          title="No change requests found"
          message={
            hasActiveFilters
              ? "No requests match the current filters. Try adjusting or clearing them."
              : "Create the first controlled change to get started."
          }
        />
      )}

      {/* Table */}
      {!loading && !error && items.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-4">Change ID</th>
                  <th className="px-5 py-4">Title</th>
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Requester</th>
                  <th className="px-5 py-4">Branch</th>
                  <th className="px-5 py-4">Risk</th>
                  <th className="px-5 py-4">Priority</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Scheduled</th>
                  <th className="px-5 py-4">Technician</th>
                  <th className="px-5 py-4">Updated</th>
                  <th className="px-5 py-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/70"
                    onClick={() => setSelected(item.id)}
                  >
                    <td className="px-5 py-4">
                      <p className="font-black text-blue-700">{item.change_number}</p>
                    </td>
                    <td className="px-5 py-4 max-w-[200px]">
                      <p className="font-bold text-slate-800 truncate">{item.title}</p>
                    </td>
                    <td className="px-5 py-4">
                      <ChangeTypeBadge type={item.change_type} />
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {item.owner_name || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {item.branch_name || "—"}
                    </td>
                    <td className="px-5 py-4">
                      <RiskBadge level={item.risk_level} />
                    </td>
                    <td className="px-5 py-4">
                      <PriorityBadge priority={item.priority} />
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {item.planned_start
                        ? new Date(item.planned_start).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {item.technician_name || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-400">
                      {item.updated_at
                        ? new Date(item.updated_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(item.id); }}
                        className="rounded-lg bg-blue-50 p-2 text-blue-700 hover:bg-blue-100"
                        title="View details"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta.total > 25 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
              <p className="text-xs text-slate-400">
                Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, meta.total)} of {meta.total}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="astrea-button astrea-button-secondary text-xs disabled:opacity-40"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                        p === page ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="astrea-button astrea-button-secondary text-xs disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Create form modal */}
      {creating && (
        <ChangeForm
          branches={branches}
          technicians={technicians}
          user={user}
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}

      {/* Edit form modal */}
      {editing && (
        <ChangeForm
          branches={branches}
          technicians={technicians}
          user={user}
          editItem={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      {/* Detail modal */}
      {selected && (
        <ChangeDetail
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
          user={user}
          branches={branches}
          technicians={technicians}
        />
      )}
    </div>
  );
}
