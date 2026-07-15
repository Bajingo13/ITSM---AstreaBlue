import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CheckCircle,
  Clock3,
  Cloud,
  ExternalLink,
  Eye,
  FileText,
  GitBranch,
  GitMerge,
  History,
  Mail,
  MessageSquare,
  Monitor,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  ShieldOff,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  ThumbsUp,
  Trash2,
  Users,
  X,
  XCircle,
  Edit3,
  Ban,
  SkipForward,
  User,
  Check,
} from "lucide-react";
import PageHero from "../components/layout/PageHero";
import {
  ConfirmationDialog,
  EmptyState,
  InfoRow,
  LoadingSkeleton,
  MetricCard,
  Modal,
  ProgressBar,
  RiskBadge,
  SectionCard,
  StatusBadge,
  ActivityTimeline,
  panelClass,
} from "../components/ChangeReleaseUI";
import { changeReleaseApi } from "../services/changeReleaseApi";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";
import { useAuth } from "../context/AuthContext";

// ── Constants ──────────────────────────────────────────────

const RELEASE_STATUSES = [
  "Draft",
  "Planned",
  "Scheduled",
  "Ready for Deployment",
  "Deploying",
  "Validation",
  "Completed",
  "Failed",
  "Rolled Back",
  "Cancelled",
];

const VALID_TRANSITIONS = {
  Draft: ["Planned", "Cancelled"],
  Planned: ["Scheduled", "Cancelled"],
  Scheduled: ["Ready for Deployment", "Cancelled"],
  "Ready for Deployment": ["Deploying", "Cancelled"],
  Deploying: ["Validation", "Failed"],
  Validation: ["Completed", "Failed", "Rolled Back"],
};

const RELEASE_TYPES = ["Major", "Minor", "Patch", "Emergency", "Infrastructure"];
const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];
const ENVIRONMENTS = [
  "Development",
  "Testing",
  "Staging",
  "UAT",
  "Production",
  "Disaster Recovery",
];
const DEPLOYMENT_PRIORITIES = ["Low", "Normal", "High", "Critical"];
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const STEP_COLORS = [
  "bg-blue-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
];

// ── Helpers ────────────────────────────────────────────────

function filterMetrics(items) {
  return {
    upcoming: items.filter(
      (i) =>
        i.status !== "Completed" &&
        i.status !== "Failed" &&
        i.status !== "Rolled Back" &&
        i.status !== "Cancelled" &&
        i.scheduled_start &&
        new Date(i.scheduled_start) > new Date()
    ).length,
    deploying: items.filter((i) => i.status === "Deploying" || i.status === "Validation").length,
    production: items.filter((i) => {
      const env = String(i.environment || "").toLowerCase();
      return env === "production" || env === "disaster recovery";
    }).length,
    completed: items.filter((i) => i.status === "Completed").length,
  };
}

function ownerName(item) {
  if (!item) return "—";
  return item.release_manager || item.assigned_to_name || item.owner_name || "—";
}

// ── Status Timeline ────────────────────────────────────────

function StatusTimeline({ currentStatus, compact }) {
  const mainFlow = ["Draft", "Planned", "Scheduled", "Ready for Deployment", "Deploying", "Validation", "Completed"];
  const idx = mainFlow.indexOf(currentStatus);
  const exceptional = ["Failed", "Rolled Back", "Cancelled"];

  return (
    <div className={compact ? "" : "space-y-3"}>
      {!compact && <h4 className="text-sm font-black text-slate-700">Release Progress</h4>}
      <div className="flex flex-wrap items-center gap-1">
        {mainFlow.map((s, i) => {
          const isDone = idx >= i;
          const isCurrent = s === currentStatus;
          return (
            <div key={s} className="flex items-center gap-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black leading-none transition ${
                  isCurrent
                    ? "bg-blue-600 text-white shadow-sm"
                    : isDone
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {isDone ? <Check size={10} /> : null}
                {s}
              </span>
              {i < mainFlow.length - 1 && (
                <ChevronRight size={12} className={isDone ? "text-emerald-400" : "text-slate-300"} />
              )}
            </div>
          );
        })}
      </div>
      {exceptional.includes(currentStatus) && (
        <div className="mt-2">
          <StatusBadge status={currentStatus} />
        </div>
      )}
    </div>
  );
}

// ── Permission helper ──────────────────────────────────────

function canPlanRelease(user) {
  if (!user) return false;
  const role = String(user.role_name || "").toLowerCase();
  return role === "superadmin" || role === "admin";
}

function canEditRelease(user) {
  if (!user) return false;
  const role = String(user.role_name || "").toLowerCase();
  return role === "superadmin" || role === "admin";
}

function canAdvanceRelease(user, status) {
  if (!user) return false;
  const role = String(user.role_name || "").toLowerCase();
  if (role === "employee") return false;
  if (role === "technician" && (status === "Deploying" || status === "Validation")) return true;
  return role === "superadmin" || role === "admin";
}

// ── Release Form (Plan / Edit) ─────────────────────────────

function ReleaseForm({ branches, changes, rollbacks, release, user, onClose, onSaved }) {
  const isEdit = !!release;
  const [form, setForm] = useState(() => {
    if (release) {
      return {
        title: release.title || "",
        release_version: release.release_version || "",
        description: release.description || "",
        release_type: release.release_type || "Minor",
        release_manager: release.release_manager || "",
        branch_id: release.branch_id || user?.branch_id || "",
        risk_level: release.risk_level || "Medium",
        change_ids: release.change_ids || release.change_requests?.map((c) => c.id) || [],
        environment: release.environment || "Development",
        scheduled_start: release.scheduled_start ? release.scheduled_start.slice(0, 16) : "",
        scheduled_end: release.scheduled_end ? release.scheduled_end.slice(0, 16) : "",
        maintenance_window: release.maintenance_window || "",
        timezone: release.timezone || "UTC",
        deployment_priority: release.deployment_priority || "Normal",
        environments: release.environments || [],
        dependencies: release.dependencies || [],
        deployment_steps: release.deployment_steps || [],
        validation_tasks: release.validation_tasks || [],
        rollback_procedure_id: release.rollback_procedure_id || "",
        rollback_plan: release.rollback_plan || "",
        rollback_trigger: release.rollback_trigger || "",
        rollback_owner: release.rollback_owner || "",
        rollback_duration: release.rollback_duration || "",
        recovery_validation: release.recovery_validation || "",
        communication_plan: release.communication_plan || { audience: "", owner: "", schedule: "", deployment_notice: "", completion_notice: "", failure_notice: "" },
        release_notes: release.release_notes || "",
        packages: release.packages || [],
        branch: release.branch || release.branch_name || "",
        scope: release.scope || "",
      };
    }
    return {
      title: "",
      release_version: "",
      description: "",
      release_type: "Minor",
      release_manager: user?.full_name || user?.name || "",
      branch_id: user?.branch_id || "",
      risk_level: "Medium",
      change_ids: [],
      environment: "Development",
      scheduled_start: "",
      scheduled_end: "",
      maintenance_window: "",
      timezone: "UTC",
      deployment_priority: "Normal",
      environments: [],
      dependencies: [],
      deployment_steps: [],
      validation_tasks: [],
      rollback_procedure_id: "",
      rollback_plan: "",
      rollback_trigger: "",
      rollback_owner: "",
      rollback_duration: "",
      recovery_validation: "",
      communication_plan: { audience: "", owner: "", schedule: "", deployment_notice: "", completion_notice: "", failure_notice: "" },
      release_notes: "",
      packages: [],
      branch: "",
      scope: "",
    };
  });
  const [tab, setTab] = useState("basic");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isSuperAdmin = String(user?.role_name).toLowerCase() === "superadmin";

  const update = (key) => (e) => {
    const val = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((cur) => ({ ...cur, [key]: val }));
  };

  const updateNested = (parent, key) => (e) => {
    const val = e.target.value;
    setForm((cur) => ({ ...cur, [parent]: { ...cur[parent], [key]: val } }));
  };

  const toggleChange = (id) => {
    setForm((cur) => ({
      ...cur,
      change_ids: cur.change_ids.includes(id)
        ? cur.change_ids.filter((c) => c !== id)
        : [...cur.change_ids, id],
    }));
  };

  const addEnvironment = () => {
    setForm((cur) => ({
      ...cur,
      environments: [
        ...cur.environments,
        {
          id: Date.now(),
          name: "",
          deployment_order: cur.environments.length + 1,
          owner: "",
          planned_start: "",
          planned_completion: "",
          status: "Pending",
        },
      ],
    }));
  };

  const updateEnvironment = (idx, key, value) => {
    setForm((cur) => {
      const envs = [...cur.environments];
      envs[idx] = { ...envs[idx], [key]: value };
      return { ...cur, environments: envs };
    });
  };

  const removeEnvironment = (idx) => {
    setForm((cur) => ({
      ...cur,
      environments: cur.environments.filter((_, i) => i !== idx),
    }));
  };

  const addDependency = (type) => () => {
    setForm((cur) => ({
      ...cur,
      dependencies: [
        ...cur.dependencies,
        { id: Date.now(), type, name: "", version: "", status: "Pending" },
      ],
    }));
  };

  const updateDependency = (idx, key, value) => {
    setForm((cur) => {
      const deps = [...cur.dependencies];
      deps[idx] = { ...deps[idx], [key]: value };
      return { ...cur, dependencies: deps };
    });
  };

  const removeDependency = (idx) => {
    setForm((cur) => ({
      ...cur,
      dependencies: cur.dependencies.filter((_, i) => i !== idx),
    }));
  };

  const addStep = () => {
    setForm((cur) => ({
      ...cur,
      deployment_steps: [
        ...cur.deployment_steps,
        { id: Date.now(), step: "", owner: "", order: cur.deployment_steps.length + 1, duration: "", evidence: "", status: "Pending" },
      ],
    }));
  };

  const updateStep = (idx, key, value) => {
    setForm((cur) => {
      const steps = [...cur.deployment_steps];
      steps[idx] = { ...steps[idx], [key]: value };
      return { ...cur, deployment_steps: steps };
    });
  };

  const removeStep = (idx) => {
    setForm((cur) => ({
      ...cur,
      deployment_steps: cur.deployment_steps.filter((_, i) => i !== idx),
    }));
  };

  const moveStep = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= form.deployment_steps.length) return;
    setForm((cur) => {
      const steps = [...cur.deployment_steps];
      const temp = steps[idx];
      steps[idx] = steps[target];
      steps[target] = temp;
      return {
        ...cur,
        deployment_steps: steps.map((s, i) => ({ ...s, order: i + 1 })),
      };
    });
  };

  const addValidationTask = () => {
    setForm((cur) => ({
      ...cur,
      validation_tasks: [
        ...cur.validation_tasks,
        { id: Date.now(), task: "", expected_result: "", validator: "", environment: "", evidence_required: false, status: "Pending" },
      ],
    }));
  };

  const updateValidationTask = (idx, key, value) => {
    setForm((cur) => {
      const tasks = [...cur.validation_tasks];
      tasks[idx] = { ...tasks[idx], [key]: value };
      return { ...cur, validation_tasks: tasks };
    });
  };

  const removeValidationTask = (idx) => {
    setForm((cur) => ({
      ...cur,
      validation_tasks: cur.validation_tasks.filter((_, i) => i !== idx),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title?.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        packages: form.packages,
        dependencies: form.dependencies,
        deployment_steps: form.deployment_steps,
        validation_tasks: form.validation_tasks,
        environments: form.environments,
        communication_plan: form.communication_plan,
        packages_text: Array.isArray(form.packages) ? form.packages.join("\n") : form.packages,
      };
      if (isEdit) {
        await changeReleaseApi.updateRelease(release.id, payload);
      } else {
        await changeReleaseApi.createRelease(payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: "basic", label: "Basic Info" },
    { id: "changes", label: "Change Requests" },
    { id: "schedule", label: "Schedule" },
    { id: "environments", label: "Environments" },
    { id: "dependencies", label: "Dependencies" },
    { id: "deployment", label: "Deployment" },
    { id: "validation", label: "Validation" },
    { id: "rollback", label: "Rollback" },
    { id: "communication", label: "Communication" },
  ];

  return (
    <Modal
      wide
      title={isEdit ? "Edit Release Plan" : "Plan Release"}
      subtitle={
        isEdit
          ? "Update the release plan details, schedule, environments, and deployment steps."
          : "Define a new release package with approved changes, schedule, environments, and deployment plan."
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                tab === t.id
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-500 hover:text-blue-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Basic Info */}
        {tab === "basic" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="astrea-field-label md:col-span-2">
              Release title
              <input required value={form.title} onChange={update("title")} className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Release version
              <input value={form.release_version} onChange={update("release_version")} placeholder="e.g. 2.1.0" className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Release type
              <select value={form.release_type} onChange={update("release_type")} className="astrea-control mt-2 w-full">
                {RELEASE_TYPES.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="astrea-field-label">
              Release manager
              <input value={form.release_manager} onChange={update("release_manager")} className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Risk level
              <select value={form.risk_level} onChange={update("risk_level")} className="astrea-control mt-2 w-full">
                {RISK_LEVELS.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="astrea-field-label">
              Branch
              <select required value={form.branch_id} onChange={update("branch_id")} disabled={!isSuperAdmin} className="astrea-control mt-2 w-full">
                <option value="">Select branch</option>
                {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
              </select>
            </label>
            <label className="astrea-field-label">
              Scope / Branch reference
              <input value={form.scope} onChange={update("scope")} placeholder="e.g. main, release/v2" className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label md:col-span-2">
              Description
              <textarea rows="3" value={form.description} onChange={update("description")} className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label md:col-span-2">
              Release notes
              <textarea rows="4" value={form.release_notes} onChange={update("release_notes")} className="astrea-control mt-2 w-full" />
            </label>
          </div>
        )}

        {/* Tab: Change Requests */}
        {tab === "changes" && (
          <div>
            <p className="mb-4 text-sm font-bold text-slate-500">
              Link approved change requests to this release. Only changes in "Approved" or "Implementation Ready" status are shown.
            </p>
            {changes.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {changes.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                      form.change_ids.includes(c.id)
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.change_ids.includes(c.id)}
                      onChange={() => toggleChange(c.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-blue-700">{c.change_number || `CR-${c.id}`}</p>
                      <p className="mt-1 text-sm font-bold text-slate-800 truncate">{c.title}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <RiskBadge level={c.risk_level || c.risk} />
                        <span className="text-[10px] font-bold text-slate-400">{c.category || c.change_type || "Standard"}</span>
                        <span className="text-[10px] font-bold text-slate-400">{c.owner_name || "—"}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-700">
                No approved change requests available. Please ensure changes are approved before linking.
              </p>
            )}
          </div>
        )}

        {/* Tab: Schedule */}
        {tab === "schedule" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="astrea-field-label">
              Planned deployment date & time
              <input type="datetime-local" value={form.scheduled_start} onChange={update("scheduled_start")} className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Expected completion
              <input type="datetime-local" value={form.scheduled_end} onChange={update("scheduled_end")} className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Maintenance window
              <input value={form.maintenance_window} onChange={update("maintenance_window")} placeholder="e.g. Sunday 02:00-06:00" className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Time zone
              <select value={form.timezone} onChange={update("timezone")} className="astrea-control mt-2 w-full">
                {TIMEZONES.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="astrea-field-label">
              Deployment priority
              <select value={form.deployment_priority} onChange={update("deployment_priority")} className="astrea-control mt-2 w-full">
                {DEPLOYMENT_PRIORITIES.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* Tab: Environments */}
        {tab === "environments" && (
          <div>
            <p className="mb-4 text-sm font-bold text-slate-500">Define deployment environments and their progression order.</p>
            {form.environments.length === 0 && (
              <p className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-400">
                No environments configured. Add at least one target environment.
              </p>
            )}
            <div className="space-y-3">
              {form.environments.map((env, idx) => (
                <div key={env.id || idx} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="grid flex-1 gap-3 md:grid-cols-3">
                      <label className="astrea-field-label text-xs">
                        Environment
                        <select
                          value={env.name}
                          onChange={(e) => updateEnvironment(idx, "name", e.target.value)}
                          className="astrea-control mt-1 w-full text-sm"
                        >
                          <option value="">Select...</option>
                          {ENVIRONMENTS.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </label>
                      <label className="astrea-field-label text-xs">
                        Deployment order
                        <input
                          type="number"
                          value={env.deployment_order}
                          onChange={(e) => updateEnvironment(idx, "deployment_order", Number(e.target.value))}
                          className="astrea-control mt-1 w-full text-sm"
                        />
                      </label>
                      <label className="astrea-field-label text-xs">
                        Owner
                        <input
                          value={env.owner}
                          onChange={(e) => updateEnvironment(idx, "owner", e.target.value)}
                          className="astrea-control mt-1 w-full text-sm"
                        />
                      </label>
                      <label className="astrea-field-label text-xs">
                        Planned start
                        <input
                          type="datetime-local"
                          value={env.planned_start}
                          onChange={(e) => updateEnvironment(idx, "planned_start", e.target.value)}
                          className="astrea-control mt-1 w-full text-sm"
                        />
                      </label>
                      <label className="astrea-field-label text-xs">
                        Planned completion
                        <input
                          type="datetime-local"
                          value={env.planned_completion}
                          onChange={(e) => updateEnvironment(idx, "planned_completion", e.target.value)}
                          className="astrea-control mt-1 w-full text-sm"
                        />
                      </label>
                    </div>
                    <button type="button" onClick={() => removeEnvironment(idx)} className="astrea-icon-button rounded-xl p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addEnvironment} className="mt-4 astrea-button astrea-button-secondary">
              <Plus size={15} /> Add Environment
            </button>
          </div>
        )}

        {/* Tab: Dependencies */}
        {tab === "dependencies" && (
          <div>
            <p className="mb-4 text-sm font-bold text-slate-500">Define related systems, applications, and infrastructure dependencies.</p>
            {form.dependencies.length === 0 && (
              <p className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-400">
                No dependencies defined. Add systems, services, or CIs this release depends on.
              </p>
            )}
            <div className="space-y-3">
              {form.dependencies.map((dep, idx) => (
                <div key={dep.id || idx} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid flex-1 gap-3 md:grid-cols-4">
                    <label className="astrea-field-label text-xs">
                      Type
                      <select value={dep.type} onChange={(e) => updateDependency(idx, "type", e.target.value)} className="astrea-control mt-1 w-full text-sm">
                        <option value="system">System</option>
                        <option value="application">Application</option>
                        <option value="service">Service</option>
                        <option value="infrastructure">Infrastructure</option>
                        <option value="vendor">Vendor</option>
                        <option value="ci">Configuration Item</option>
                      </select>
                    </label>
                    <label className="astrea-field-label text-xs">
                      Name
                      <input value={dep.name} onChange={(e) => updateDependency(idx, "name", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                    </label>
                    <label className="astrea-field-label text-xs">
                      Version / Reference
                      <input value={dep.version || ""} onChange={(e) => updateDependency(idx, "version", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                    </label>
                    <label className="astrea-field-label text-xs">
                      Status
                      <select value={dep.status} onChange={(e) => updateDependency(idx, "status", e.target.value)} className="astrea-control mt-1 w-full text-sm">
                        <option value="Pending">Pending</option>
                        <option value="Ready">Ready</option>
                        <option value="Blocked">Blocked</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                    </label>
                  </div>
                  <button type="button" onClick={() => removeDependency(idx)} className="astrea-icon-button rounded-xl p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={addDependency("system")} className="astrea-button astrea-button-secondary text-xs">
                <Plus size={14} /> System
              </button>
              <button type="button" onClick={addDependency("application")} className="astrea-button astrea-button-secondary text-xs">
                <Plus size={14} /> Application
              </button>
              <button type="button" onClick={addDependency("infrastructure")} className="astrea-button astrea-button-secondary text-xs">
                <Plus size={14} /> Infrastructure
              </button>
              <button type="button" onClick={addDependency("vendor")} className="astrea-button astrea-button-secondary text-xs">
                <Plus size={14} /> Vendor
              </button>
            </div>
          </div>
        )}

        {/* Tab: Deployment */}
        {tab === "deployment" && (
          <div>
            <p className="mb-4 text-sm font-bold text-slate-500">Define deployment steps with owners, order, and evidence requirements.</p>
            {form.deployment_steps.length === 0 && (
              <p className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-400">
                No deployment steps defined. Add the steps required to complete this deployment.
              </p>
            )}
            <div className="space-y-3">
              {form.deployment_steps.map((step, idx) => (
                <div key={step.id || idx} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white" style={{ backgroundColor: STEP_COLORS[idx % STEP_COLORS.length] }}>
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="astrea-field-label md:col-span-2">
                        Step description
                        <textarea rows={2} value={step.step} onChange={(e) => updateStep(idx, "step", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                      </label>
                      <label className="astrea-field-label">
                        Owner
                        <input value={step.owner} onChange={(e) => updateStep(idx, "owner", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                      </label>
                      <label className="astrea-field-label">
                        Expected duration
                        <input value={step.duration} onChange={(e) => updateStep(idx, "duration", e.target.value)} placeholder="e.g. 15 min" className="astrea-control mt-1 w-full text-sm" />
                      </label>
                      <label className="astrea-field-label md:col-span-2">
                        Required evidence
                        <input value={step.evidence} onChange={(e) => updateStep(idx, "evidence", e.target.value)} placeholder="e.g. Screenshot, log output" className="astrea-control mt-1 w-full text-sm" />
                      </label>
                      <label className="astrea-field-label">
                        Status
                        <select value={step.status} onChange={(e) => updateStep(idx, "status", e.target.value)} className="astrea-control mt-1 w-full text-sm">
                          <option value="Pending">Pending</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="Failed">Failed</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="text-xs font-bold text-slate-400 hover:text-blue-600 disabled:opacity-30">
                        ▲ Up
                      </button>
                      <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === form.deployment_steps.length - 1} className="text-xs font-bold text-slate-400 hover:text-blue-600 disabled:opacity-30">
                        ▼ Down
                      </button>
                    </div>
                  </div>
                  <button type="button" onClick={() => removeStep(idx)} className="astrea-icon-button rounded-xl p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addStep} className="mt-4 astrea-button astrea-button-secondary">
              <Plus size={15} /> Add Step
            </button>
          </div>
        )}

        {/* Tab: Validation */}
        {tab === "validation" && (
          <div>
            <p className="mb-4 text-sm font-bold text-slate-500">Define validation tasks, expected results, and assigned validators.</p>
            {form.validation_tasks.length === 0 && (
              <p className="mb-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-400">
                No validation tasks defined. Add tasks to verify the deployment succeeded.
              </p>
            )}
            <div className="space-y-3">
              {form.validation_tasks.map((task, idx) => (
                <div key={task.id || idx} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="astrea-field-label md:col-span-2">
                      Validation task
                      <input value={task.task} onChange={(e) => updateValidationTask(idx, "task", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                    </label>
                    <label className="astrea-field-label">
                      Environment
                      <select value={task.environment} onChange={(e) => updateValidationTask(idx, "environment", e.target.value)} className="astrea-control mt-1 w-full text-sm">
                        <option value="">Select...</option>
                        {ENVIRONMENTS.map((v) => <option key={v}>{v}</option>)}
                      </select>
                    </label>
                    <label className="astrea-field-label md:col-span-2">
                      Expected result
                      <input value={task.expected_result} onChange={(e) => updateValidationTask(idx, "expected_result", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                    </label>
                    <label className="astrea-field-label">
                      Assigned validator
                      <input value={task.validator} onChange={(e) => updateValidationTask(idx, "validator", e.target.value)} className="astrea-control mt-1 w-full text-sm" />
                    </label>
                    <label className="astrea-field-label flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={task.evidence_required}
                        onChange={(e) => updateValidationTask(idx, "evidence_required", e.target.checked)}
                      />
                      Evidence required
                    </label>
                    <div className="flex items-end justify-end">
                      <button type="button" onClick={() => removeValidationTask(idx)} className="astrea-icon-button rounded-xl p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addValidationTask} className="mt-4 astrea-button astrea-button-secondary">
              <Plus size={15} /> Add Validation Task
            </button>
          </div>
        )}

        {/* Tab: Rollback */}
        {tab === "rollback" && (
          <div className="grid gap-4 md:grid-cols-2">
            <p className="text-sm font-bold text-slate-500 md:col-span-2">
              Define rollback readiness. If a Rollback Procedure already exists, link it instead of duplicating.
            </p>
            {rollbacks.length > 0 && (
              <label className="astrea-field-label md:col-span-2">
                Link existing rollback procedure
                <select value={form.rollback_procedure_id} onChange={update("rollback_procedure_id")} className="astrea-control mt-2 w-full">
                  <option value="">— None (define manually below) —</option>
                  {rollbacks.map((r) => <option key={r.id} value={r.id}>{r.rollback_number || `RB-${r.id}`} — {r.title}</option>)}
                </select>
              </label>
            )}
            <label className="astrea-field-label">
              Rollback plan reference
              <input value={form.rollback_plan} onChange={update("rollback_plan")} placeholder="Plan ID or description" className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Rollback trigger
              <input value={form.rollback_trigger} onChange={update("rollback_trigger")} placeholder="e.g. Validation failure > 15%" className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Rollback owner
              <input value={form.rollback_owner} onChange={update("rollback_owner")} className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label">
              Estimated rollback duration
              <input value={form.rollback_duration} onChange={update("rollback_duration")} placeholder="e.g. 30 min" className="astrea-control mt-2 w-full" />
            </label>
            <label className="astrea-field-label md:col-span-2">
              Recovery validation steps
              <textarea rows="3" value={form.recovery_validation} onChange={update("recovery_validation")} className="astrea-control mt-2 w-full" />
            </label>
          </div>
        )}

        {/* Tab: Communication */}
        {tab === "communication" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="astrea-field-label">
              Target audience
              <input
                value={form.communication_plan.audience}
                onChange={updateNested("communication_plan", "audience")}
                placeholder="e.g. All stakeholders, IT team"
                className="astrea-control mt-2 w-full"
              />
            </label>
            <label className="astrea-field-label">
              Communication owner
              <input
                value={form.communication_plan.owner}
                onChange={updateNested("communication_plan", "owner")}
                className="astrea-control mt-2 w-full"
              />
            </label>
            <label className="astrea-field-label">
              Notification schedule
              <input
                value={form.communication_plan.schedule}
                onChange={updateNested("communication_plan", "schedule")}
                placeholder="e.g. 24h before, 1h before"
                className="astrea-control mt-2 w-full"
              />
            </label>
            <label className="astrea-field-label">
              Deployment notice
              <input
                value={form.communication_plan.deployment_notice}
                onChange={updateNested("communication_plan", "deployment_notice")}
                placeholder="Subject or template"
                className="astrea-control mt-2 w-full"
              />
            </label>
            <label className="astrea-field-label">
              Completion notice
              <input
                value={form.communication_plan.completion_notice}
                onChange={updateNested("communication_plan", "completion_notice")}
                className="astrea-control mt-2 w-full"
              />
            </label>
            <label className="astrea-field-label">
              Failure / rollback notice
              <input
                value={form.communication_plan.failure_notice}
                onChange={updateNested("communication_plan", "failure_notice")}
                className="astrea-control mt-2 w-full"
              />
            </label>
          </div>
        )}

        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="astrea-button astrea-button-secondary">Cancel</button>
          <button disabled={saving} className="astrea-button astrea-button-primary">
            {saving ? "Saving..." : isEdit ? "Update Release" : "Create Release Plan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Release Detail View ────────────────────────────────────

function ReleaseDetailView({ release, user, onClose, onChanged }) {
  const [detail, setDetail] = useState(release);
  const [audit, setAudit] = useState([]);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [tab, setTab] = useState("overview");
  const [actionLoading, setActionLoading] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!release?.id || loadingRef.current) return;
    loadingRef.current = true;
    Promise.all([
      changeReleaseApi.getRelease(release.id).then(setDetail).catch(() => {}),
      changeReleaseApi.getReleaseAudit(release.id).then(setAudit).catch(() => {}),
      changeReleaseApi.getReleaseComments(release.id).then(setComments).catch(() => {}),
    ]).finally(() => { loadingRef.current = false; });
  }, [release.id]);

  const statusActions = useMemo(() => {
    return VALID_TRANSITIONS[detail.status] || [];
  }, [detail.status]);

  const canAct = canAdvanceRelease(user, detail.status);

  const performAction = async (action, reason) => {
    setActionLoading(action);
    setError("");
    setFeedback("");
    try {
      let status = action;
      let payload = { reason: reason || "" };
      if (action === "Advance") {
        const next = RELEASE_STATUSES[RELEASE_STATUSES.indexOf(detail.status) + 1];
        status = next;
      }
      if (action === "Approve") {
        status = "Approved";
        payload = { ...payload, approved_by: user?.user_id || user?.id };
      }
      if (action === "Reject") {
        status = "Rejected";
      }
      const result = await changeReleaseApi.transitionRelease(detail.id, status, payload);
      setDetail((prev) => ({ ...prev, ...result, status: result.status || status }));
      setFeedback(`Release ${status.toLowerCase()} successfully.`);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading("");
      setConfirm(null);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await changeReleaseApi.addReleaseComment(detail.id, newComment.trim());
      setComments((prev) => [...prev, { id: Date.now(), message: newComment.trim(), actor_name: user?.full_name || "You", created_at: new Date().toISOString() }]);
      setNewComment("");
      setFeedback("Comment added.");
    } catch (e) {
      setError(e.message);
    }
  };

  const progress = useMemo(() => {
    const idx = RELEASE_STATUSES.indexOf(detail.status);
    if (idx < 0) return detail.progress || 0;
    return Math.round((idx / (RELEASE_STATUSES.length - 3)) * 100);
  }, [detail.status, detail.progress]);

  const envIcon = (name) => {
    const n = String(name || "").toLowerCase();
    if (n === "production") return <Rocket size={16} />;
    if (n === "disaster recovery") return <Shield size={16} />;
    if (n === "development") return <Monitor size={16} />;
    if (n === "testing" || n === "uat") return <CheckCircle2 size={16} />;
    return <Cloud size={16} />;
  };

  if (!detail) return null;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "changes", label: "Change Requests" },
    { id: "schedule", label: "Schedule" },
    { id: "environments", label: "Environments" },
    { id: "deployment", label: "Deployment" },
    { id: "validation", label: "Validation" },
    { id: "rollback", label: "Rollback" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <Modal wide title={`${detail.release_number || `REL-${detail.id}`} · ${detail.title}`} subtitle="Full release plan details, schedule, environments, deployment, validation, and rollback readiness." onClose={onClose}>
      <div className="space-y-5">
        {/* Header status & actions */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusTimeline currentStatus={detail.status} compact />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={detail.status} />
          {detail.environment && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{detail.environment}</span>}
          {detail.branch_name && <span className="text-xs text-slate-400">{detail.branch_name}</span>}
          {detail.risk_level && <RiskBadge level={detail.risk_level} />}
          <span className="text-xs font-black text-slate-400">{detail.release_type || "—"}</span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {statusActions.map((action) => {
            const isDanger = ["Failed", "Rolled Back", "Cancelled", "Rejected"].includes(action);
            const isLoading = actionLoading === action;
            return (
              <button
                key={action}
                disabled={!canAct || isLoading}
                onClick={() => {
                  if (isDanger || action === "Cancelled") {
                    setConfirm({ action, message: `Are you sure you want to mark this release as "${action}"? This will update the release status and notify stakeholders.`, reason: true });
                  } else {
                    performAction(action);
                  }
                }}
                className={`astrea-button text-xs ${
                  isDanger
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : canAct
                    ? "astrea-button-primary"
                    : "astrea-button-secondary opacity-50"
                }`}
              >
                {isLoading ? "Processing..." : action}
              </button>
            );
          })}
        </div>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        {feedback && <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{feedback}</p>}

        {/* Tab navigation */}
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-blue-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Overview */}
        {tab === "overview" && (
          <div className="space-y-4">
            <SectionCard title="Progress" icon={<Activity size={16} />}>
              <ProgressBar value={progress} />
            </SectionCard>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoRow label="Release Version" value={detail.release_version || "—"} />
              <InfoRow label="Release Type" value={detail.release_type || "—"} />
              <InfoRow label="Risk Level" value={detail.risk_level || "—"} />
              <InfoRow label="Release Manager" value={detail.release_manager || ownerName(detail)} />
              <InfoRow label="Scope / Branch" value={detail.scope || detail.branch_name || "—"} />
              <InfoRow label="Associated Changes" value={`${(detail.change_ids || detail.change_requests || []).length} change(s)`} />
            </div>

            {detail.description && <InfoRow label="Description" value={detail.description} />}
            {detail.release_notes && <InfoRow label="Release Notes" value={detail.release_notes} />}
          </div>
        )}

        {/* Tab: Change Requests */}
        {tab === "changes" && (
          <div>
            {detail.change_requests?.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {detail.change_requests.map((c) => (
                  <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black text-blue-700">{c.change_number || `CR-${c.id}`}</p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-800">{c.title}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>Category: {c.category || c.change_type || "—"}</span>
                      <span>Risk: {c.risk_level || c.risk || "—"}</span>
                      <span>Owner: {c.owner_name || "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No change requests linked to this release.</p>
            )}
          </div>
        )}

        {/* Tab: Schedule */}
        {tab === "schedule" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Planned Deployment" value={detail.scheduled_start ? new Date(detail.scheduled_start).toLocaleString() : "Not scheduled"} />
            <InfoRow label="Expected Completion" value={detail.scheduled_end ? new Date(detail.scheduled_end).toLocaleString() : "Not set"} />
            <InfoRow label="Maintenance Window" value={detail.maintenance_window || "—"} />
            <InfoRow label="Time Zone" value={detail.timezone || "—"} />
            <InfoRow label="Deployment Priority" value={detail.deployment_priority || "—"} />
            {detail.scheduled_by_name && <InfoRow label="Scheduled By" value={detail.scheduled_by_name} />}
          </div>
        )}

        {/* Tab: Environments */}
        {tab === "environments" && (
          <div>
            {(detail.environments && detail.environments.length > 0) ? (
              <div className="space-y-3">
                {detail.environments.map((env, idx) => (
                  <div key={env.id || idx} className={`flex items-center justify-between rounded-xl border p-4 ${
                    env.status === "Completed" ? "border-emerald-200 bg-emerald-50" :
                    env.status === "Deploying" ? "border-blue-200 bg-blue-50" :
                    "border-slate-200 bg-white"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                        env.status === "Completed" ? "bg-emerald-100 text-emerald-700" :
                        env.status === "Deploying" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-500"
                      }`}>
                        {envIcon(env.name)}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{env.name || `Environment ${idx + 1}`}</p>
                        <p className="text-xs text-slate-400">Order: {env.deployment_order || idx + 1}</p>
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-bold text-slate-600">{env.owner || "—"}</p>
                      {env.status && <StatusBadge status={env.status} />}
                      {env.planned_start && <p className="mt-1 text-slate-400">{new Date(env.planned_start).toLocaleString()}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <InfoRow label="Primary Environment" value={detail.environment || "—"} />
              </div>
            )}
          </div>
        )}

        {/* Tab: Deployment */}
        {tab === "deployment" && (
          <div>
            {(detail.deployment_steps && detail.deployment_steps.length > 0) || (detail.checklist && detail.checklist.length > 0) ? (
              <div className="space-y-3">
                {(detail.deployment_steps || detail.checklist).map((step, idx) => {
                  const label = step.step || step.label || String(step);
                  const complete = step.status === "Completed" || step.complete;
                  return (
                    <div key={step.id || idx} className={`flex items-center gap-4 rounded-xl border p-4 ${
                      complete ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                    }`}>
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white ${
                        complete ? "bg-emerald-500" : "bg-slate-300"
                      }`}>
                        {complete ? <Check size={16} /> : idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-bold ${complete ? "text-emerald-800" : "text-slate-800"}`}>{label}</p>
                        {step.owner && <p className="text-xs text-slate-400">Owner: {step.owner}</p>}
                        {step.duration && <p className="text-xs text-slate-400">Duration: {step.duration}</p>}
                      </div>
                      {step.status && <StatusBadge status={step.status} />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No deployment steps defined.</p>
            )}
          </div>
        )}

        {/* Tab: Validation */}
        {tab === "validation" && (
          <div>
            {detail.validation_tasks && detail.validation_tasks.length > 0 ? (
              <div className="space-y-3">
                {detail.validation_tasks.map((task, idx) => (
                  <div key={task.id || idx} className={`rounded-xl border p-4 ${
                    task.status === "Completed" ? "border-emerald-200 bg-emerald-50" :
                    task.status === "Failed" ? "border-red-200 bg-red-50" :
                    "border-slate-200 bg-white"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{task.task || `Validation ${idx + 1}`}</p>
                        {task.expected_result && <p className="mt-1 text-xs text-slate-500">Expected: {task.expected_result}</p>}
                      </div>
                      {task.status && <StatusBadge status={task.status} />}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                      {task.validator && <span>Validator: {task.validator}</span>}
                      {task.environment && <span>Environment: {task.environment}</span>}
                      {task.evidence_required && <span className="font-bold text-amber-600">Evidence Required</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No validation tasks defined.</p>
            )}
          </div>
        )}

        {/* Tab: Rollback */}
        {tab === "rollback" && (
          <div className="grid gap-4 sm:grid-cols-2">
            {detail.rollback_procedure_id && (
              <div className="rounded-xl bg-blue-50 p-4 md:col-span-2">
                <p className="text-xs font-black text-blue-700">Linked Rollback Procedure</p>
                <p className="mt-1 text-sm font-bold text-blue-800">{detail.rollback_procedure_name || `Procedure #${detail.rollback_procedure_id}`}</p>
              </div>
            )}
            <InfoRow label="Rollback Plan" value={detail.rollback_plan || "—"} />
            <InfoRow label="Rollback Trigger" value={detail.rollback_trigger || "—"} />
            <InfoRow label="Rollback Owner" value={detail.rollback_owner || "—"} />
            <InfoRow label="Estimated Duration" value={detail.rollback_duration || "—"} />
            <div className="md:col-span-2">
              <InfoRow label="Recovery Validation Steps" value={detail.recovery_validation || "—"} />
            </div>
            <div className="md:col-span-2">
              <InfoRow
                label="Rollback Readiness"
                value={
                  detail.rollback_plan || detail.rollback_procedure_id
                    ? "Rollback readiness has been defined."
                    : "No rollback readinss defined."
                }
              />
            </div>
          </div>
        )}

        {/* Tab: Activity */}
        {tab === "activity" && (
          <div className="space-y-6">
            <SectionCard title="Comments" icon={<MessageSquare size={16} />}>
              <div className="space-y-3">
                {comments.length > 0 ? (
                  comments.map((c) => (
                    <div key={c.id} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-sm font-bold text-slate-700">{c.message}</p>
                      <p className="mt-1 text-xs text-slate-400">{c.actor_name || "System"} · {new Date(c.created_at).toLocaleString()}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No comments yet.</p>
                )}
                <div className="flex gap-3">
                  <input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="astrea-control flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                  />
                  <button type="button" onClick={handleAddComment} disabled={!newComment.trim()} className="astrea-button astrea-button-primary">
                    Post
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Activity History" icon={<History size={16} />}>
              <ActivityTimeline activities={audit} />
            </SectionCard>
          </div>
        )}

        {/* Dependencies info */}
        {detail.dependencies && detail.dependencies.length > 0 && tab === "overview" && (
          <SectionCard title="Dependencies" icon={<GitMerge size={16} />}>
            <div className="flex flex-wrap gap-2">
              {(typeof detail.dependencies[0] === "string" ? detail.dependencies : detail.dependencies).map((dep, idx) => {
                const label = typeof dep === "string" ? dep : dep.name || dep.label || `Dependency ${idx + 1}`;
                return (
                  <span key={idx} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                    {label}
                  </span>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Confirmation dialog */}
        {confirm && (
          <ConfirmationDialog
            title={confirm.action}
            message={confirm.message || `Are you sure you want to update this release status to "${confirm.action}"?`}
            confirmLabel="Confirm"
            onConfirm={() => {
              performAction(confirm.action, confirm.reasonValue || "");
            }}
            onCancel={() => setConfirm(null)}
            danger={["Failed", "Rolled Back", "Cancelled", "Rejected"].includes(confirm.action)}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Main Release Planning Page ─────────────────────────────

export default function ReleasePlanning() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [changes, setChanges] = useState([]);
  const [rollbacks, setRollbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [filterEnv, setFilterEnv] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterManager, setFilterManager] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmFilter, setConfirmFilter] = useState(null);
  const itemsPerPage = 15;

  const hasFilters = !!(status || filterEnv || filterRisk || filterType || filterManager || filterDateFrom || filterDateTo);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const params = {};
      if (search) params.search = search;
      if (status) params.status = status;
      if (filterEnv) params.environment = filterEnv;
      if (filterRisk) params.risk_level = filterRisk;
      if (filterType) params.release_type = filterType;
      if (filterManager) params.release_manager = filterManager;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      params.page = page;
      params.limit = itemsPerPage;
      const result = await changeReleaseApi.listReleases(params);
      const data = result.data || result;
      if (Array.isArray(data)) {
        setItems(data);
        setTotalPages(result.total_pages || result.pages || Math.ceil((result.total || data.length) / itemsPerPage) || 1);
      } else {
        setItems(data.items || data.records || []);
        setTotalPages(data.totalPages || data.total_pages || data.pages || 1);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, status, filterEnv, filterRisk, filterType, filterManager, filterDateFrom, filterDateTo, page]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      load(false);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, filterEnv, filterRisk, filterType, filterManager, filterDateFrom, filterDateTo]);

  // Load on page change (no debounce)
  useEffect(() => {
    if (page !== 1) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Load initial data
  useEffect(() => {
    load(false);
    Promise.all([
      fetch(`${API_URL}/api/v1/branches`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
      changeReleaseApi.listChanges({ status: "Approved,Ready for Implementation", limit: 200 }).then((r) => r.data || r).catch(() => []),
      changeReleaseApi.listRollbacks({ limit: 100 }).then((r) => r.data || r).catch(() => []),
    ]).then(([branchRows, changeRows, rollbackRows]) => {
      setBranches(branchRows);
      setChanges(Array.isArray(changeRows) ? changeRows : []);
      setRollbacks(Array.isArray(rollbackRows) ? rollbackRows : []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = useMemo(() => filterMetrics(items), [items]);

  const handleRefresh = () => {
    if (refreshing || loading) return;
    load(true);
  };

  const saved = () => {
    setCreating(false);
    setEditing(null);
    load(false);
  };

  const handleCardFilter = (key) => {
    switch (key) {
      case "upcoming":
        setStatus("");
        setFilterEnv("");
        break;
      case "deploying":
        setStatus("Deploying");
        break;
      case "production":
        setStatus("");
        setFilterEnv("Production");
        break;
      case "completed":
        setStatus("Completed");
        break;
    }
  };

  const clearFilters = () => {
    setStatus("");
    setFilterEnv("");
    setFilterRisk("");
    setFilterType("");
    setFilterManager("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setSearch("");
    setPage(1);
  };

  const isSuperAdmin = String(user?.role_name).toLowerCase() === "superadmin";
  const isAdmin = isSuperAdmin || String(user?.role_name).toLowerCase() === "admin";
  const canPlan = canPlanRelease(user);
  const canEdit = canEditRelease(user);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHero
        eyebrow="Change & Release Management"
        title="Release Planning"
        subtitle="Coordinate release packages, dependencies, environments, deployment progress, validation, and recovery."
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="astrea-button border border-white/30 bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            {canPlan && (
              <button
                onClick={() => setCreating(true)}
                className="astrea-button bg-white text-blue-700 hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Plus size={16} /> Plan Release
              </button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => handleCardFilter("upcoming")}
          className={`text-left transition hover:-translate-y-0.5 ${status === "" && filterEnv === "" ? "" : "opacity-80"}`}
        >
          <MetricCard icon={CalendarDays} label="Upcoming Releases" value={metrics.upcoming} tone="bg-blue-50 text-blue-700" />
        </button>
        <button
          type="button"
          onClick={() => handleCardFilter("deploying")}
          className="text-left transition hover:-translate-y-0.5"
        >
          <MetricCard icon={Rocket} label="In Deployment" value={metrics.deploying} tone="bg-violet-50 text-violet-700" detail="Deploying & Validation" />
        </button>
        <button
          type="button"
          onClick={() => handleCardFilter("production")}
          className="text-left transition hover:-translate-y-0.5"
        >
          <MetricCard icon={Boxes} label="Production Releases" value={metrics.production} tone="bg-cyan-50 text-cyan-700" />
        </button>
        <button
          type="button"
          onClick={() => handleCardFilter("completed")}
          className="text-left transition hover:-translate-y-0.5"
        >
          <MetricCard icon={CheckCircle2} label="Completed" value={metrics.completed} tone="bg-emerald-50 text-emerald-700" />
        </button>
      </div>

      {/* Search & Filters */}
      <section className={panelClass}>
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by release title, ID, change request, environment, manager, or version..."
              className="astrea-control w-full pl-10"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="astrea-control md:w-44">
            <option value="">All statuses</option>
            {RELEASE_STATUSES.map((v) => <option key={v}>{v}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`astrea-button astrea-button-secondary ${hasFilters ? "border-blue-300 bg-blue-50 text-blue-700" : ""}`}
          >
            <SlidersHorizontal size={15} />
            Filters
            {hasFilters && <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">{1}</span>}
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4">
            <label className="astrea-field-label text-xs">
              Environment
              <select value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)} className="astrea-control mt-1 w-full text-sm">
                <option value="">All environments</option>
                {ENVIRONMENTS.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="astrea-field-label text-xs">
              Risk level
              <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} className="astrea-control mt-1 w-full text-sm">
                <option value="">All risks</option>
                {RISK_LEVELS.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="astrea-field-label text-xs">
              Release type
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="astrea-control mt-1 w-full text-sm">
                <option value="">All types</option>
                {RELEASE_TYPES.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="astrea-field-label text-xs">
              Release manager
              <input value={filterManager} onChange={(e) => setFilterManager(e.target.value)} placeholder="Filter by manager" className="astrea-control mt-1 w-full text-sm" />
            </label>
            <label className="astrea-field-label text-xs">
              From date
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="astrea-control mt-1 w-full text-sm" />
            </label>
            <label className="astrea-field-label text-xs">
              To date
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="astrea-control mt-1 w-full text-sm" />
            </label>
            <div className="flex items-end md:col-span-2">
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="astrea-button astrea-button-secondary text-xs">
                  <X size={14} /> Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Error */}
      {error && (
        <p className="rounded-xl bg-red-50 p-4 font-bold text-red-700">{error}</p>
      )}

      {/* Loading */}
      {loading && !refreshing ? (
        <LoadingSkeleton rows={6} />
      ) : items.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Release ID</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Change</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Environment</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Manager</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-50 transition hover:bg-blue-50/40">
                      <td className="px-4 py-3">
                        <span className="text-xs font-black text-blue-700">
                          {item.release_number || `REL-${item.id}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-slate-800">{item.title}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{item.release_version || "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.change_ids?.length || item.change_requests?.length || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-slate-500">{item.release_type || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                          {item.environment || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.scheduled_start ? new Date(item.scheduled_start).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{ownerName(item)}</td>
                      <td className="px-4 py-3">{item.risk_level ? <RiskBadge level={item.risk_level} /> : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="w-20">
                          <ProgressBar value={item.progress || 0} />
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelected(item)}
                            className="astrea-icon-button rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                            title="View"
                          >
                            <Eye size={15} />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setEditing(item)}
                              className="astrea-icon-button rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                              title="Edit"
                            >
                              <Edit3 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-400">
                  Page {page} of {totalPages} · {items.length} records
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="astrea-button astrea-button-secondary text-xs disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="astrea-button astrea-button-secondary text-xs disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mobile card list */}
          <div className="grid gap-4 md:hidden">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`${panelClass} text-left`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-blue-700">{item.release_number || `REL-${item.id}`}</p>
                    <h3 className="mt-1 truncate font-black text-slate-900">{item.title}</h3>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                  {item.environment && <span className="rounded-lg bg-slate-100 px-2 py-1">{item.environment}</span>}
                  {item.release_type && <span>{item.release_type}</span>}
                  {item.risk_level && <RiskBadge level={item.risk_level} />}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <Clock3 size={14} />
                  <span>{item.scheduled_start ? new Date(item.scheduled_start).toLocaleDateString() : "Unscheduled"}</span>
                  <span className="ml-auto">{ownerName(item)}</span>
                </div>
                <div className="mt-4">
                  <ProgressBar value={item.progress || 0} />
                </div>
                <div className="mt-3 flex justify-between text-xs text-slate-400">
                  <span>Version: {item.release_version || "—"}</span>
                  <span>Changes: {item.change_ids?.length || item.change_requests?.length || 0}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Empty state */
        <EmptyState
          title="No release plans"
          message="Plan a release connected to approved changes."
        />
      )}

      {/* Plan Release Modal */}
      {creating && (
        <ReleaseForm
          branches={branches}
          changes={changes}
          rollbacks={rollbacks}
          user={user}
          onClose={() => setCreating(false)}
          onSaved={saved}
        />
      )}

      {/* Edit Release Modal */}
      {editing && (
        <ReleaseForm
          branches={branches}
          changes={changes}
          rollbacks={rollbacks}
          release={editing}
          user={user}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {/* Release Detail Modal */}
      {selected && (
        <ReleaseDetailView
          release={selected}
          user={user}
          onClose={() => setSelected(null)}
          onChanged={() => load(false)}
        />
      )}
    </div>
  );
}
