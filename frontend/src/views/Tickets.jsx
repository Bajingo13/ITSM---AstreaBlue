import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Plus,
  Search,
  X,
  Ticket,
  AlertCircle,
  CheckCircle,
  User,
  Tag,
  MessageSquare,
  History,
  Send,
  BookOpen,
  Paperclip,
  RefreshCw,
  XCircle,
  Trash2,
  Download,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AttachmentPreviewModal from "../components/AttachmentPreviewModal";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import {
  getPriorityBadgeClass, formatPriority,
  getSeverityLevel,
  priorityOptions,
} from "../utils/ticketVisuals";
import { API_URL } from "../config/api";
import PageHero from "../components/layout/PageHero";
import { authHeaders } from "../services/authHeaders";
import { subscribeToTicketChanges } from "../services/realtimeTickets";
import { getTicketCompletionLabel } from "../utils/ticketDuration";
import ExportReportModal from "../components/ExportReportModal";

const API_BASE = `${API_URL}/api/v1`;

const columns = [
  { id: "Open Queue", label: "Open Queue", color: "bg-sky-500" },
  { id: "In Progress", label: "In Progress", color: "bg-amber-500" },
  { id: "Resolved", label: "Resolved", color: "bg-emerald-500" },
  { id: "Closed", label: "Closed", color: "bg-slate-500" },
  { id: "Cancelled", label: "Cancelled", color: "bg-red-500" },
];

const nonCancellableStatuses = ["Cancelled", "Resolved", "Closed"];

const priorityStyle = {
  "P1-Critical": "bg-rose-50 text-rose-700 border-rose-200",
  "P2-High": "bg-orange-50 text-orange-700 border-orange-200",
  "P3-Medium": "bg-amber-50 text-amber-800 border-amber-200",
  "P4-Low": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const priorityDotStyle = {
  "P1-Critical": "bg-red-500",
  "P2-High": "bg-orange-500",
  "P3-Medium": "bg-amber-500",
  "P4-Low": "bg-green-500",
};

function NewTicketModal({ categories, branches, user, onClose, onCreated }) {
  const isSuperAdmin = (user?.role_name || user?.role) === "SuperAdmin";
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "P3-Medium",
    status: "Open Queue",
    category_id: "",
    source: "portal",
    branch_id: user?.branch_id || "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [isOtherCategory, setIsOtherCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCategoryChange = (value) => {
    if (value === "__other__") {
      setIsOtherCategory(true);
      updateForm("category_id", "");
    } else {
      setIsOtherCategory(false);
      setCustomCategory("");
      updateForm("category_id", value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.title.trim() || !form.description.trim()) {
      setError("Title and description are required.");
      return;
    }
    if (isOtherCategory && !customCategory.trim()) {
      setError("Specify Category is required when Other is selected.");
      return;
    }

    try {
      setSaving(true);

      let categoryId = form.category_id || null;

      // Handle "Other" category - create or find it
      if (isOtherCategory && customCategory.trim()) {
        const catRes = await fetch(`${API_BASE}/ticket-categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_name: customCategory.trim() }),
        });
        const catData = await catRes.json();
        if (!catRes.ok || catData.success === false || !catData.category) {
          throw new Error(catData.message || catData.error || "Failed to save category.");
        }
        categoryId = catData.category.category_id;
      }

      const payload = buildTicketPayload(user, {
        ...form,
        impact: "Medium",
        urgency: "Medium",
        category_id: categoryId,
        requester_id: user?.user_id || null,
        branch_id: isSuperAdmin ? form.branch_id || null : user?.branch_id || null,
      });

      const res = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      const createdTicket = data.data || data;
      await uploadTicketAttachments(createdTicket.id, files, user?.user_id);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const priorityList = [
    { value: "P1-Critical", label: "P1 \u2014 Critical", dot: "bg-red-500", bg: "bg-red-600 text-white" },
    { value: "P2-High", label: "P2 \u2014 High", dot: "bg-orange-500", bg: "bg-red-50 text-red-700" },
    { value: "P3-Medium", label: "P3 \u2014 Medium", dot: "bg-amber-500", bg: "bg-yellow-50 text-yellow-800" },
    { value: "P4-Low", label: "P4 \u2014 Low", dot: "bg-green-500", bg: "bg-green-50 text-green-700" },
  ];

  const inputClass =
    "astrea-control text-sm font-medium";
  const labelClass = "astrea-field-label";

  return (
    <div className="astrea-modal-backdrop">
      <div className="astrea-modal-panel max-w-2xl">
        {/* Header */}
        <div className="astrea-modal-header bg-gradient-to-r from-blue-50 to-slate-50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/30">
              <Ticket size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Create New Ticket</h2>
              <p className="text-xs font-medium text-slate-500">
                Submit an incident or service request to the IT service desk.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-slate-700 hover:shadow-sm"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="astrea-modal-body space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className={labelClass}>Title <span className="text-red-600">*</span></label>
            <input
              value={form.title}
              onChange={(e) => updateForm("title", e.target.value)}
              placeholder="Brief description of the issue..."
              className={inputClass}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description <span className="text-red-600">*</span></label>
            <textarea
              value={form.description}
              onChange={(e) => updateForm("description", e.target.value)}
              placeholder="Detailed description, affected user/device, steps to reproduce..."
              rows={4}
              className={`${inputClass} resize-none`}
              required
            />
          </div>

          {/* Two-column grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Branch (SuperAdmin only) */}
            {isSuperAdmin && (
              <div>
                <label className={labelClass}>Branch</label>
                <select
                  value={form.branch_id}
                  onChange={(e) => updateForm("branch_id", e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch.branch_id} value={branch.branch_id}>
                      {branch.branch_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Category with Other support */}
            <div>
              <label className={labelClass}>Category</label>
              <select
                value={isOtherCategory ? "__other__" : form.category_id}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className={inputClass}
              >
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.category_id} value={cat.category_id}>
                    {cat.category_name}
                  </option>
                ))}
                <option value="__other__">Other...</option>
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className={labelClass}>Priority</label>
              <div className="flex flex-wrap gap-2">
                {priorityList.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => updateForm("priority", p.value)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-3.5 py-2 text-xs font-black transition ${
                      form.priority === p.value
                        ? `${p.bg} border-current shadow-sm`
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom category input */}
          {isOtherCategory && (
            <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/50 p-4">
              <label className={labelClass}>
                Specify Category <span className="text-red-600">*</span>
              </label>
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. CCTV, WiFi, Biometrics, Projector"
                className={inputClass}
                autoFocus
                required
              />
              <p className="mt-1.5 text-xs text-slate-500">
                This category will be saved and available for future tickets.
              </p>
            </div>
          )}

          {/* Attachments */}
          <div>
            <label className={labelClass}>Attachments</label>
            <label className="astrea-upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles(Array.from(event.dataTransfer.files || [])); }}>
              <span className="rounded-full bg-blue-100 p-3 text-blue-700"><Paperclip size={22} /></span>
              <span className="font-black">
                {files.length
                  ? `${files.length} file(s) selected`
                  : "Choose PNG, JPG, JPEG, WEBP, or PDF"}
              </span>
              <span className="text-xs font-semibold text-slate-600">Upload screenshots, PDF, or supporting files</span>
              <span className="text-xs text-slate-500">PNG, JPG, JPEG, WEBP or PDF · Maximum 10MB · Drag & Drop supported</span>
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="hidden"
              />
            </label>
          </div>

          {/* Footer */}
          <div className="astrea-modal-footer -mx-6 -mb-6 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="astrea-button astrea-button-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="astrea-button astrea-button-primary"
            >
              {saving ? "Creating..." : "Create Ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PriorityIndicator({ value }) {
  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-700">
      <span className={`h-2.5 w-2.5 rounded-full ${priorityDotStyle[value] || "bg-slate-400"}`} />
      {value || "Priority"}
    </div>
  );
}

async function uploadTicketAttachments(ticketId, files, uploadedBy) {
  if (!ticketId || !files.length) return;

  const formData = new FormData();
  files.forEach((file) => formData.append("attachments", file));
  if (uploadedBy) formData.append("uploaded_by", uploadedBy);

  const res = await fetch(`${API_BASE}/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const data = await readJsonSafely(res);
    throw new Error(data.error || "Failed to upload attachments");
  }
}

async function readJsonSafely(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: "Server returned a non-JSON response." };
  }
}

function TicketDetailsDrawer({ ticket, onClose, onRefresh }) {
  const { user, role } = useAuth();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  const [selectedStatus, setSelectedStatus] = useState(ticket.status || "");
  const [selectedPriority, setSelectedPriority] = useState(ticket.priority || "P3-Medium");

  const [technicians, setTechnicians] = useState([]);
  const [selectedTechnician, setSelectedTechnician] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");
  const [kbModalOpen, setKbModalOpen] = useState(false);
  const [kbMessage, setKbMessage] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const activeRole = role || user?.role_name || user?.role;

  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}${buildTicketQuery(user)}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to load ticket details.");
      }
      const detail = data.data || data;
      setDetails({
        ...detail,
        description: detail.description || detail.desc || ticket.description || ticket.desc || "",
        desc: detail.desc || detail.description || ticket.desc || ticket.description || "",
      });
    } catch (err) {
      console.error("Fetch ticket details failed:", err);
    } finally {
      setLoading(false);
    }
  }, [ticket.id, user]);

  const fetchTechnicians = useCallback(async () => {
    try {
      const branchId = details?.branch_id || ticket.branch_id;

      if (!["SuperAdmin", "Admin"].includes(activeRole) || !branchId) {
        setTechnicians([]);
        return;
      }

      if (
        activeRole === "Admin" &&
        (!user?.branch_id || Number(user.branch_id) !== Number(branchId))
      ) {
        setTechnicians([]);
        return;
      }

      const params = new URLSearchParams({
        ticket_id: String(ticket.id),
        branch_id: String(branchId),
        role_name: activeRole,
      });

      if (user?.branch_id) {
        params.set("current_branch_id", String(user.branch_id));
      }

      if (user?.user_id) {
        params.set("current_user_id", String(user.user_id));
      }

      const res = await fetch(`${API_BASE}/technicians?${params.toString()}`);
      const data = await res.json();

      const sameBranchTechnicians = Array.isArray(data)
        ? data.filter((technician) => Number(technician.branch_id) === Number(branchId))
        : [];

      setTechnicians(sameBranchTechnicians);
    } catch (err) {
      console.error("Fetch technicians failed:", err);
      setTechnicians([]);
    }
  }, [activeRole, details?.branch_id, ticket.branch_id, ticket.id, user?.branch_id, user?.user_id]);

  useEffect(() => {
    fetchDetails();
    fetchTechnicians();
  }, [fetchDetails, fetchTechnicians]);

  useEffect(() => {
    let timeoutId;
    const unsubscribe = subscribeToTicketChanges(() => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void fetchDetails();
        void fetchTechnicians();
      }, 150);
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [fetchDetails, fetchTechnicians]);

  useEffect(() => {
    const assignedTo = details?.assigned_to ?? ticket.assigned_to ?? "";
    setSelectedTechnician(assignedTo ? String(assignedTo) : "");
  }, [details?.assigned_to, ticket.assigned_to]);

  useEffect(() => {
    setSelectedStatus(details?.status || ticket.status || "");
  }, [details?.status, ticket.status]);

  useEffect(() => {
    setSelectedPriority(details?.priority || ticket.priority || "P3-Medium");
  }, [details?.priority, ticket.priority]);

  const addComment = async () => {
    if (!comment.trim()) return;

    try {
      setSavingComment(true);
      setActionError("");

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: comment.trim(), user_id: user?.user_id || null }),
      });

      const savedComment = await readJsonSafely(res);
      if (!res.ok || savedComment.success === false) throw new Error(savedComment.message || savedComment.error || "Failed to add comment");

      setComment("");
      setDetails((current) => ({
        ...(current || ticket),
        comments: [...(current?.comments || []), { ...savedComment, full_name: user?.full_name || user?.name || "User" }],
      }));
      void fetchDetails();
    } catch (err) {
      setActionError(err.message || "Failed to add comment.");
    } finally {
      setSavingComment(false);
    }
  };

  const item = details || ticket;
  const hasResolution =
    ["Resolved", "Closed"].includes(item.status) || Boolean(item.resolution_notes);
  const canCreateKbArticle = ["SuperAdmin", "Admin", "Technician"].includes(
    activeRole
  );
  const currentAssignedTo = item.assigned_to ? String(item.assigned_to) : "";
  const hasAssignmentChange = selectedTechnician !== currentAssignedTo;
  const currentStatus = item.status || "";
  const isCancelled = currentStatus === "Cancelled";
  const hasStatusChange = selectedStatus !== currentStatus;
  const currentPriority = item.priority || "P3-Medium";
  const hasPriorityChange = selectedPriority !== currentPriority;
  const isOwnBranchTicket =
    user?.branch_id &&
    item.branch_id &&
    Number(user.branch_id) === Number(item.branch_id);
  const canAssignTicket =
    activeRole === "SuperAdmin" ||
    (activeRole === "Admin" && isOwnBranchTicket);
  const canEditPriority = canAssignTicket;
  const hasUnsavedChanges =
    !isCancelled && (hasAssignmentChange || hasStatusChange || (canEditPriority && hasPriorityChange));
  const canCancelTicket =
    activeRole === "SuperAdmin" &&
    !nonCancellableStatuses.includes(currentStatus);

  const selectStatus = (newStatus) => {
    if (isCancelled) return;
    setActionError("");
    setSelectedStatus(newStatus);
  };

  const saveChanges = async () => {
    if (isCancelled) return;

    if (!hasUnsavedChanges) {
      onClose();
      return;
    }

    try {
      setAssigning(true);
      setActionError("");

      if (hasStatusChange || (canEditPriority && hasPriorityChange)) {
        const updateRes = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(buildTicketPayload(user, {
            ...(hasStatusChange ? { status: selectedStatus } : {}),
            ...(canEditPriority && hasPriorityChange ? { priority: selectedPriority } : {}),
          })),
        });

        const updateData = await readJsonSafely(updateRes);
        if (!updateRes.ok || updateData.success === false) {
          throw new Error(updateData.message || updateData.error || "Failed to update ticket");
        }
      }

      if (hasAssignmentChange) {
        if (!canAssignTicket) {
          throw new Error("You are not allowed to assign technicians for this ticket.");
        }

        const assignRes = await fetch(`${API_BASE}/tickets/${ticket.id}/assign`, {
          method: "PATCH",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(
            buildTicketPayload(user, {
              assigned_to: selectedTechnician ? Number(selectedTechnician) : null,
            })
          ),
        });

        const assignData = await readJsonSafely(assignRes);

        if (!assignRes.ok || assignData.success === false) {
          throw new Error(assignData.message || assignData.error || "Failed to assign technician");
        }
      }

      onClose("Ticket changes saved successfully.");
      void Promise.resolve(onRefresh()).catch((refreshError) => {
        if (import.meta.env.DEV) console.error("Ticket refresh failed:", refreshError);
      });
    } catch (err) {
      console.error(err);
      setActionError(err.message);
    } finally {
      setAssigning(false);
    }
  };

  const createKnowledgeBaseArticle = () => {
    setKbMessage("");
    setKbModalOpen(true);
  };

  const openCancelModal = () => {
    setCancellationReason("");
    setCancelError("");
    setCancelModalOpen(true);
  };

  const closeCancelModal = () => {
    if (cancelling) return;
    setCancelModalOpen(false);
    setCancellationReason("");
    setCancelError("");
  };

  const handleCloseDrawer = () => {
    setDetails(null);
    setLoading(false);
    setCancelModalOpen(false);
    setCancellationReason("");
    setCancelError("");
    onClose();
  };

  const openDeleteModal = () => {
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteModalOpen(false);
  };

  const deleteTicket = async () => {
    try {
      setDeleting(true);

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      const data = await readJsonSafely(res);

      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to delete ticket.");
      }

      setDeleteModalOpen(false);
      setDeleting(false);
      onClose("Ticket deleted successfully.");
      void Promise.resolve(onRefresh()).catch((refreshError) => {
        if (import.meta.env.DEV) console.error("Ticket refresh failed:", refreshError);
      });
    } catch (err) {
      setDeleting(false);
      onClose("Failed to delete ticket. Please try again.");
    }
  };


  const cancelTicket = async () => {
    const reason = cancellationReason.trim();

    if (!reason) {
      setCancelError("Cancellation reason is required.");
      return;
    }

    try {
      setCancelling(true);
      setCancelError("");

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}/cancel`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          role_name: activeRole,
          current_branch_id: user?.branch_id || null,
          current_user_id: user?.user_id || null,
          cancellation_reason: reason,
        }),
      });

      const data = await readJsonSafely(res);

      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to cancel ticket.");
      }

      setCancelModalOpen(false);
      setCancellationReason("");
      onClose(data.message || "Ticket cancelled successfully.");
      void Promise.resolve(onRefresh()).catch((refreshError) => {
        if (import.meta.env.DEV) console.error("Ticket refresh failed:", refreshError);
      });
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  };

  const openAttachment = (attachment) => {
    if (attachment.mime_type?.startsWith("image/")) {
      setPreviewAttachment(attachment);
      return;
    }
    if (attachment.file_path) {
      window.open(`${API_URL}${attachment.file_path}`, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
    <div className="astrea-modal-backdrop z-[80]">
      <div className="astrea-modal-panel flex w-full max-w-2xl flex-col border border-slate-300 shadow-2xl shadow-slate-950/25">
        <div className="sticky top-0 z-10 border-b-2 border-slate-200 bg-white px-7 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-blue-600">
                {item.ticket_number || `TKT-${item.id}`}
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">
                {item.title}
              </h2>
            </div>
            <button
              onClick={handleCloseDrawer}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={22} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="flex-1 p-8 font-bold text-slate-500">
            Loading details...
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto p-7 pb-28">
            {actionError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {actionError}
              </div>
            )}
            {kbMessage && <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{kbMessage}</div>}

            <section className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-md">
                <p className="text-xs font-bold text-slate-400">Status</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 font-black text-slate-900">
                  {selectedStatus}
                  {isCancelled && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-red-700">
                      Cancelled
                    </span>
                  )}
                  {hasStatusChange && (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-blue-700">
                      Unsaved
                    </span>
                  )}
                </p>
              </div>

              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-md">
                <p className="text-xs font-bold text-slate-400">Priority</p>
                {canEditPriority && !isCancelled ? (
                  <div className="mt-2">
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Correct ticket priority">
                      {priorityOptions.map((priority) => {
                        const selected = selectedPriority === priority;
                        return <button
                          key={priority}
                          type="button"
                          disabled={assigning || loading}
                          onClick={() => setSelectedPriority(priority)}
                          aria-pressed={selected}
                          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${priorityStyle[priority]} ${selected ? "ring-2 ring-slate-900 ring-offset-1" : "opacity-80 hover:opacity-100"} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <span className={`h-2 w-2 rounded-full ${priorityDotStyle[priority]}`} />
                          {formatPriority(priority)}
                        </button>;
                      })}
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-blue-700">
                      Admin correction is recorded in the activity timeline.
                    </p>
                  </div>
                ) : (
                  <p className="mt-1">
                    <span className={getPriorityBadgeClass(item.priority)}>
                      {formatPriority(item.priority)}
                    </span>
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-md">
                <p className="text-xs font-bold text-slate-400">Category</p>
                <p className="mt-1 font-black text-slate-900">
                  {item.category || "Uncategorized"}
                </p>
              </div>

              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow-md">
                <p className="text-xs font-bold text-slate-400">
                  Assigned To
                </p>
                <p className="mt-1 font-black text-slate-900">
                  {item.assigned_name || "Unassigned"}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50 p-5 shadow-sm shadow-blue-900/5">
              <div className="mb-4 flex items-center gap-2">
                <History size={18} className="text-blue-600" />
                <h3 className="font-black text-slate-900">Ticket Work Tracker</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ResolutionDetail
                  label="Ticket Created"
                  value={item.created_at ? new Date(item.created_at).toLocaleString() : "Not recorded"}
                />
                <ResolutionDetail
                  label="Work Started"
                  value={item.in_progress_started_at ? new Date(item.in_progress_started_at).toLocaleString() : "Waiting for In Progress"}
                />
                <ResolutionDetail
                  label={item.status === "Closed" ? "Closed At" : "Resolved At"}
                  value={
                    item.resolved_at || item.closed_at
                      ? new Date(item.resolved_at || item.closed_at).toLocaleString()
                      : "Not completed"
                  }
                />
                <ResolutionDetail
                  label="Completion Time"
                  value={
                    item.resolved_at || item.closed_at
                      ? getTicketCompletionLabel(item)
                      : item.in_progress_started_at
                        ? "In progress"
                        : "Not started"
                  }
                />
              </div>
              <p className="mt-3 text-[11px] font-semibold text-blue-700">Completion Time is calculated automatically from Work Started to Resolved or Closed.</p>
            </section>

            {(item.origin_system || item.created_via || item.external_reference) && (
              <section className="rounded-2xl border-2 border-blue-200 bg-blue-50/50 p-5 shadow-sm shadow-blue-900/5">
                <h3 className="mb-4 font-black text-slate-900">Integration Origin</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <ResolutionDetail label="Created Via" value={item.created_via || item.source || "Integration Gateway"} />
                  <ResolutionDetail label="Origin System" value={item.origin_system || "Not recorded"} />
                  <ResolutionDetail label="Module" value={item.origin_module || "Not recorded"} />
                  <ResolutionDetail label="Feature" value={item.origin_feature || "Not recorded"} />
                  <ResolutionDetail label="External Reference" value={item.external_reference || "Not recorded"} />
                  <ResolutionDetail label="External Employee ID" value={item.external_employee_id || "Not recorded"} />
                </div>
              </section>
            )}

            {isCancelled && (
              <section className="rounded-2xl border border-red-100 bg-red-50/60 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Ban size={18} className="text-red-600" />
                  <h3 className="font-black text-slate-900">Cancellation</h3>
                </div>
                <p className="whitespace-pre-line text-sm leading-7 text-red-700">
                  {item.cancellation_reason || "No cancellation reason recorded."}
                </p>
                {item.cancelled_at && (
                  <p className="mt-2 text-xs font-bold text-red-500">
                    Cancelled {new Date(item.cancelled_at).toLocaleString()}
                  </p>
                )}
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 font-black text-slate-900">
                Assign Technician
              </h3>

              <div>
                {isCancelled ? (
  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
    Cancelled tickets cannot be assigned.
  </div>
) : !canAssignTicket ? (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
    You can only assign technicians for tickets in your permitted branch.
  </div>
) : technicians.length === 0 ? (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
    No technician available for this branch.
  </div>
) : (
  <select
    value={selectedTechnician}
    onChange={(e) => setSelectedTechnician(e.target.value)}
    className="w-full rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition hover:border-blue-300 hover:bg-blue-50 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100"
    style={{ color: "#0f172a" }}
  >
    <option value="" style={{ color: "#0f172a" }}>
      Unassigned
    </option>

    {technicians.map((tech) => (
      <option key={tech.user_id} value={tech.user_id}>
        {tech.full_name} — {tech.email} ({tech.branch_name})
      </option>
    ))}
  </select>
)}
              </div>

              <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm">
                <p className="text-xs font-bold text-blue-400">Branch</p>
                <p className="mt-1 font-black text-blue-800">
                  {item.branch_name || "Unassigned Branch"}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 font-black text-slate-900">Description</h3>
              <div className="min-h-24 rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
                <p className="whitespace-pre-line text-sm leading-7 text-slate-700">
                  {item.desc || item.description}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <Paperclip size={18} className="text-blue-600" />
                <h3 className="font-black text-slate-900">Attachments</h3>
              </div>
              {item.attachments?.length ? (
                <div className="space-y-2">
                  {item.attachments.map((attachment) => (
                    <button
                      key={attachment.attachment_id}
                      onClick={() => openAttachment(attachment)}
                      className="flex w-full items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/40 px-4 py-3 text-left text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {attachment.mime_type?.startsWith("image/") && (
                        <img
                          src={`${API_URL}${attachment.file_path}`}
                          alt={attachment.file_name}
                          className="h-12 w-16 rounded-lg object-cover"
                        />
                      )}
                      <span className="flex-1">{attachment.file_name}</span>
                      <span className="text-xs text-slate-400">
                        {attachment.mime_type}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-5 text-sm font-semibold text-slate-500">
                  No attachments uploaded.
                </p>
              )}
            </section>

            {hasResolution && (
              <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle size={18} className="text-emerald-600" />
                  <h3 className="font-black text-slate-900">Resolution</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Resolution Notes
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-7 text-slate-700">
                      {item.resolution_notes || "No resolution notes provided."}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <ResolutionDetail
                      label="Root Cause"
                      value={item.root_cause || "Not specified"}
                    />
                    <ResolutionDetail
                      label="Time Spent"
                      value={
                        item.time_spent_minutes !== null &&
                        item.time_spent_minutes !== undefined &&
                        item.time_spent_minutes !== ""
                          ? `${item.time_spent_minutes} minutes`
                          : "Not specified"
                      }
                    />
                    <ResolutionDetail
                      label="Parts Used"
                      value={item.parts_used || "None recorded"}
                    />
                    <ResolutionDetail
                      label="Work Started"
                      value={
                        item.in_progress_started_at
                          ? new Date(item.in_progress_started_at).toLocaleString()
                          : "Not recorded"
                      }
                    />
                    <ResolutionDetail
                      label="Resolved At"
                      value={
                        item.resolved_at
                          ? new Date(item.resolved_at).toLocaleString()
                          : "Not recorded"
                      }
                    />
                    <ResolutionDetail
                      label="Completion Time"
                      value={getTicketCompletionLabel(item)}
                    />
                  </div>
                </div>

                {canCreateKbArticle && ["Resolved", "Closed"].includes(item.status) && (
                  <button
                    onClick={createKnowledgeBaseArticle}
                    className="mt-5 flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-black text-white hover:bg-blue-800"
                  >
                    <BookOpen size={17} />
                    Create Article from Ticket
                  </button>
                )}
              </section>
            )}

            {isCancelled && (
              <section className="rounded-2xl border border-red-100 bg-red-50/60 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <AlertCircle size={18} className="text-red-600" />
                  <h3 className="font-black text-slate-900">
                    Cancellation Details
                  </h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Reason
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-7 text-slate-700">
                      {item.cancellation_reason || "No cancellation reason recorded."}
                    </p>
                  </div>

                  <ResolutionDetail
                    label="Cancelled At"
                    value={
                      item.cancelled_at
                        ? new Date(item.cancelled_at).toLocaleString()
                        : "Not recorded"
                    }
                  />
                </div>
              </section>
            )}

            <section className="astrea-card border-2 border-slate-200 p-6">
              <h3 className="mb-1 font-black text-slate-900">
                Update Status
              </h3>
              <p className="mb-4 text-sm text-slate-500">Select the next valid workflow state, then save your changes.</p>
              {isCancelled ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  Cancelled tickets cannot be updated.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {columns
                    .filter((col) => col.id !== "Cancelled")
                    .map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => selectStatus(col.id)}
                      disabled={selectedStatus === col.id || assigning || loading}
                      className={`min-h-11 rounded-xl border-2 px-4 py-2.5 text-sm font-black transition ${
                        selectedStatus === col.id
                          ? "border-blue-700 bg-blue-700 text-white shadow-lg shadow-blue-700/20 ring-2 ring-blue-200"
                          : "border-blue-200 bg-blue-50/60 text-slate-700 shadow-sm hover:border-blue-500 hover:bg-blue-100/70 hover:text-blue-800"
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="astrea-card border-2 border-slate-200 p-6">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare size={18} className="text-blue-600" />
                <h3 className="font-black text-slate-900">Comments</h3>
              </div>

              <div className="space-y-3">
                {item.comments?.length ? (
                  item.comments.map((c) => (
                    <div
                      key={c.comment_id}
                      className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm"
                    >
                      <p className="text-sm text-slate-700">
                        {c.comment_text}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {c.full_name || "User"} ·{" "}
                        {new Date(c.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-5 text-center text-sm font-semibold text-slate-500">
                    No comments yet. Add context or an update for everyone following this ticket.
                  </p>
                )}
              </div>

              <div className="mt-5 flex gap-3">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="astrea-control flex-1 border-blue-200 bg-blue-50/40 text-sm hover:border-blue-300 focus:bg-white"
                />
                <button
                  onClick={addComment}
                  disabled={savingComment || hasUnsavedChanges || !comment.trim()}
                  className="astrea-button astrea-button-primary min-w-28"
                >
                  <Send size={18} />
                  {savingComment ? "Sending..." : "Send"}
                </button>
              </div>

              {hasUnsavedChanges && (
                <p className="mt-2 text-xs font-semibold text-slate-400">
                  Save or cancel pending changes before sending a comment.
                </p>
              )}
            </section>

            <section className="astrea-card border border-slate-200 p-6">
              <div className="mb-4 flex items-center gap-2">
                <History size={18} className="text-blue-600" />
                <h3 className="font-black text-slate-900">
                  Activity Timeline
                </h3>
              </div>

              <div className="space-y-3">
                {item.history?.length ? (
                  item.history.map((h) => (
                    <div
                      key={h.history_id}
                      className="astrea-timeline-item rounded-xl border border-blue-100 bg-blue-50/40 p-4 shadow-sm"
                    >
                      <p className="text-sm font-black text-slate-800">
                        {h.action}
                      </p>
                      <p className="text-xs text-slate-400">
                        {h.old_value || "—"} → {h.new_value || "—"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(h.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-5 text-sm font-semibold text-slate-500">
                    No activity yet.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}

        <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 px-7 py-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              {canCancelTicket && (
                <button
                  onClick={openCancelModal}
                  disabled={loading || cancelling}
                  className="rounded-xl border border-red-200 px-5 py-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Cancel Ticket
                </button>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
            <button
              onClick={openDeleteModal}
              className="flex items-center gap-2 rounded-xl border border-red-300 px-5 py-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 size={18} />
              Delete
            </button>

            <button
              onClick={saveChanges}
              disabled={loading || assigning || isCancelled || !hasUnsavedChanges}
              className="astrea-button astrea-button-primary"
            >
              {assigning ? "Saving..." : "Save Changes"}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {cancelModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Cancel Ticket
                </h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {item.ticket_number || `TKT-${item.id}`}
                </p>
              </div>

              <button
                onClick={closeCancelModal}
                disabled={cancelling}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              {cancelError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {cancelError}
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">
                  Cancellation Reason *
                </label>
                <textarea
                  value={cancellationReason}
                  onChange={(e) => {
                    setCancellationReason(e.target.value);
                    if (cancelError) setCancelError("");
                  }}
                  rows={4}
                  placeholder="Explain why this ticket is being cancelled..."
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                onClick={closeCancelModal}
                disabled={cancelling}
                className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Keep Ticket
              </button>

              <button
                onClick={cancelTicket}
                disabled={cancelling || !cancellationReason.trim()}
                className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white shadow-lg shadow-red-600/20 hover:bg-red-700 disabled:opacity-60"
              >
                {cancelling ? "Cancelling..." : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h3 className="text-lg font-black text-slate-900">
                Delete Ticket
              </h3>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm font-semibold text-slate-600">
                Are you sure you want to delete this ticket? This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                onClick={closeDeleteModal}
                disabled={deleting}
                className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>

              <button
                onClick={deleteTicket}
                disabled={deleting}
                className={`flex items-center gap-2 rounded-xl border-2 px-6 py-3 font-bold transition disabled:opacity-60 ${
                  deleting
                    ? "border-red-600 bg-red-600 text-white shadow-lg shadow-red-600/20"
                    : "border-red-300 bg-white text-red-700 hover:bg-red-50"
                }`}
              >
                <Trash2 size={18} className={deleting ? "text-white" : "text-red-500"} />
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewAttachment && (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
      {kbModalOpen && (
        <TicketArticleModal
          ticket={item}
          onClose={() => setKbModalOpen(false)}
          onSaved={() => {
            setKbModalOpen(false);
            setKbMessage("Knowledge Base article created successfully.");
          }}
        />
      )}
    </>
  );
}

function TicketArticleModal({ ticket, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: ticket.title ? `Resolution: ${ticket.title}` : "",
    category: ticket.category || "",
    symptoms: ticket.description || ticket.desc || "",
    resolution: ticket.resolution_notes || ticket.technician_notes || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saveArticle = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return setError("Article title is required.");
    try {
      setSaving(true);
      setError("");
      const response = await fetch(`${API_BASE}/knowledge-base`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: form.title.trim(),
          category: form.category.trim() || null,
          symptoms: form.symptoms.trim() || null,
          resolution: form.resolution.trim() || null,
          related_ticket_id: ticket.id,
          branch_id: ticket.branch_id || null,
        }),
      });
      const data = await readJsonSafely(response);
      if (!response.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to create Knowledge Base article.");
      }
      onSaved(data);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <div className="astrea-modal-backdrop z-[95]">
      <form onSubmit={saveArticle} className="astrea-modal-panel max-w-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-black text-slate-900">Create Article from Ticket</h2><p className="mt-1 text-sm text-slate-500">Review the reusable solution before saving it to the Knowledge Base.</p></div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X size={20}/></button>
        </div>
        {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="astrea-field-label sm:col-span-2">Title *<input value={form.title} onChange={(e) => update("title", e.target.value)} className="astrea-control mt-2" /></label>
          <label className="astrea-field-label">Category<input value={form.category} onChange={(e) => update("category", e.target.value)} className="astrea-control mt-2" /></label>
          <label className="astrea-field-label">Related Ticket<input value={ticket.ticket_number || `TKT-${ticket.id}`} disabled className="astrea-control mt-2" /></label>
          <label className="astrea-field-label sm:col-span-2">Problem / Issue<textarea rows="4" value={form.symptoms} onChange={(e) => update("symptoms", e.target.value)} className="astrea-control mt-2" /></label>
          <label className="astrea-field-label sm:col-span-2">Resolution<textarea rows="5" value={form.resolution} onChange={(e) => update("resolution", e.target.value)} className="astrea-control mt-2" /></label>
        </div>
        <div className="astrea-modal-footer -mx-6 -mb-6 mt-6"><button type="button" onClick={onClose} disabled={saving} className="astrea-button astrea-button-secondary">Cancel</button><button type="submit" disabled={saving} className="astrea-button astrea-button-primary">{saving ? "Creating Article..." : "Create Article"}</button></div>
      </form>
    </div>
  );
}

function ResolutionDetail({ label, value }) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm shadow-blue-900/5 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function getSlaBadgeClass(status) {
  switch (status) {
    case "Met": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Breached": return "bg-red-100 text-red-800 border-red-200";
    case "Due Soon": return "bg-amber-100 text-amber-800 border-amber-200";
    default: return "bg-blue-100 text-blue-800 border-blue-200"; // Pending / Active
  }
}

function TicketCard({ ticket, onClick }) {
  return (
    <div
      onClick={() => onClick(ticket)}
      className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <p className="text-xs font-black uppercase tracking-wider text-blue-600 truncate">
            {ticket.ticket_number || `TKT-${ticket.id}`}
          </p>
          {(ticket.resolution_sla_status || ticket.response_sla_status) && (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${getSlaBadgeClass(ticket.resolution_sla_status === 'Breached' || ticket.response_sla_status === 'Breached' ? 'Breached' : ticket.resolution_sla_status === 'Pending' ? (ticket.response_sla_status === 'Met' ? 'Pending' : ticket.response_sla_status) : ticket.resolution_sla_status)}`}>
              {ticket.resolution_sla_status === 'Breached' || ticket.response_sla_status === 'Breached' ? 'SLA Breach' : ticket.resolution_sla_status === 'Met' ? 'SLA Met' : 'SLA Active'}
            </span>
          )}
        </div>
        <span
          className={`${getPriorityBadgeClass(ticket.priority)} shrink-0 whitespace-nowrap px-2.5 py-0.5 text-[11px]`}
        >
          {formatPriority(ticket.priority)}
        </span>
      </div>

      <h3 className="mb-1.5 line-clamp-2 font-black leading-snug text-slate-900">
        {ticket.title}
      </h3>

      <p className="line-clamp-2 text-sm text-slate-500">
        {ticket.desc || ticket.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          <Tag size={12} />
          {ticket.category || "Uncategorized"}
        </span>

        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          <User size={12} />
          {ticket.assigned_name || "Unassigned"}
        </span>

        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
          {ticket.branch_name || "Unassigned Branch"}
        </span>

        {ticket.status === "Cancelled" && (
          <>
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-700">
              Cancelled
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600">
              Retained for audit
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Column({ column, tickets, onTicketClick }) {
  return (
    <div className="flex h-[620px] min-h-[460px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${column.color}`} />
          <h2 className="font-black text-slate-800">{column.label}</h2>
        </div>

        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 shadow-sm">
          {tickets.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:#93c5fd_#e2e8f0] [scrollbar-width:thin]">
        {tickets.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 text-sm font-semibold text-slate-400">
            No tickets
          </div>
        ) : (
          tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onClick={onTicketClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function Tickets() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageMessage, setPageMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("excel");
  const [exporting, setExporting] = useState(false);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      setPageError("");
      const res = await fetch(
        `${API_BASE}/tickets${buildTicketQuery(user, {
          filter_branch_id: branchFilter,
        })}`,
        { headers: authHeaders(), cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to refresh tickets.");
      }
      setTickets(Array.isArray(data) ? data : []);
      return data;
    } catch (err) {
      console.error("Fetch tickets failed:", err);
      setPageError(err.message || "Failed to refresh tickets.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [branchFilter, user]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ticket-categories`, { headers: authHeaders() });
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch categories failed:", err);
    }
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`, { headers: authHeaders() });
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch branches failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    fetchCategories();
    fetchBranches();
  }, [fetchTickets, fetchCategories, fetchBranches]);

  useEffect(() => {
    const refresh = (event) => {
      const refreshPromise = fetchTickets();
      event?.detail?.waitUntil?.(refreshPromise);
      return refreshPromise;
    };
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [fetchTickets]);

  useEffect(() => {
    let timeoutId;
    const unsubscribe = subscribeToTicketChanges(() => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => void fetchTickets(), 150);
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [fetchTickets]);

  useEffect(() => {
    if (!pageMessage) return;

    const timeout = window.setTimeout(() => setPageMessage(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [pageMessage]);

  const filteredTickets = useMemo(() => {
    const text = query.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesText = !text || (
        ticket.title?.toLowerCase().includes(text) ||
        ticket.ticket_number?.toLowerCase().includes(text) ||
        ticket.priority?.toLowerCase().includes(text) ||
        ticket.status?.toLowerCase().includes(text) ||
        ticket.category?.toLowerCase().includes(text) ||
        ticket.branch_name?.toLowerCase().includes(text) ||
        ticket.requester_name?.toLowerCase().includes(text) ||
        ticket.assigned_name?.toLowerCase().includes(text)
      );
      const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
      const matchesCategory = categoryFilter === "all" || (ticket.category || "Uncategorized") === categoryFilter;
      const matchesAssignment = assignmentFilter === "all"
        || (assignmentFilter === "assigned" && Boolean(ticket.assigned_to))
        || (assignmentFilter === "unassigned" && !ticket.assigned_to);

      return matchesText && matchesStatus && matchesPriority && matchesCategory && matchesAssignment;
    });
  }, [tickets, query, statusFilter, priorityFilter, categoryFilter, assignmentFilter]);

  const visibleColumns = useMemo(
    () => statusFilter === "all" ? columns : columns.filter((column) => column.id === statusFilter),
    [statusFilter]
  );

  const clearFilters = () => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setCategoryFilter("all");
    setAssignmentFilter("all");
    setQuery("");
  };

  const exportTickets = async () => {
    try {
      setExporting(true);
      setPageError("");
      const params = new URLSearchParams({
        format: exportFormat,
      });
      if (branchFilter) params.set("filter_branch_id", branchFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (assignmentFilter !== "all") params.set("assignment", assignmentFilter);
      if (query.trim()) params.set("query", query.trim());

      const response = await fetch(`${API_BASE}/tickets/export?${params.toString()}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!response.ok) {
        const error = await readJsonSafely(response);
        throw new Error(error.message || error.error || "Failed to export ticket report.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const fallbackExtension = exportFormat === "excel" ? "xlsx" : exportFormat;
      const filename = filenameMatch?.[1] || `ticket-report.${fallbackExtension}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setPageMessage(`Ticket report exported as ${fallbackExtension.toUpperCase()}.`);
    } catch (error) {
      setPageError(error.message || "Failed to export ticket report.");
    } finally {
      setExporting(false);
    }
  };

  const totalOpen = tickets.filter(
    (t) => t.status !== "Closed" && t.status !== "Cancelled"
  ).length;
  const critical = tickets.filter((t) => getSeverityLevel(t.priority) === "critical").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const cancelled = tickets.filter((t) => t.status === "Cancelled" || t.status === "Canceled").length;
  const isSuperAdmin = (user?.role_name || user?.role) === "SuperAdmin";

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Service Desk" title="Ticket Management" subtitle="Track, prioritize, and resolve incidents and service requests across your branches." actions={<>
          <button
            onClick={() => setExportOpen(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/50 bg-white/15 px-5 py-3 font-black text-white shadow-sm backdrop-blur transition hover:bg-white/25"
          >
            <Download size={18} />
            Export
          </button>
          <button
            onClick={() => fetchTickets().catch(() => {})}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
          >
            <Plus size={18} />
            New Ticket
          </button>
        </>} />

      {pageMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700 shadow-sm">
          {pageMessage}
        </div>
      )}
      {pageError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700 shadow-sm">
          {pageError}
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
              <Ticket size={22} />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{totalOpen}</p>
              <p className="text-sm font-semibold text-slate-500">
                Active Tickets
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-red-50 p-3 text-red-600">
              <AlertCircle size={22} />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{critical}</p>
              <p className="text-sm font-semibold text-slate-500">Critical</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
              <CheckCircle size={22} />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{resolved}</p>
              <p className="text-sm font-semibold text-slate-500">Resolved</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-rose-50 p-3 text-rose-600">
              <XCircle size={22} />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{cancelled}</p>
              <p className="text-sm font-semibold text-slate-500">Cancelled</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_1fr_2fr_auto] xl:items-center">
          {isSuperAdmin && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="astrea-control text-sm font-bold"
            >
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.branch_id} value={branch.branch_id}>
                  {branch.branch_name}
                </option>
              ))}
            </select>
          )}
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="astrea-control text-sm font-bold">
            <option value="all">All statuses</option>
            {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="astrea-control text-sm font-bold">
            <option value="all">All priorities</option>
            <option value="P1-Critical">P1 - Critical</option>
            <option value="P2-High">P2 - High</option>
            <option value="P3-Medium">P3 - Medium</option>
            <option value="P4-Low">P4 - Low</option>
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="astrea-control text-sm font-bold">
            <option value="all">All categories</option>
            {categories.map((category) => <option key={category.category_id} value={category.category_name}>{category.category_name}</option>)}
          </select>
          <select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)} className="astrea-control text-sm font-bold">
            <option value="all">All assignments</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <label className="relative block">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tickets, people, or branch..."
              className="astrea-control pl-11 text-sm font-semibold"
            />
          </label>
          <button type="button" onClick={clearFilters} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">Clear</button>
        </div>
        <p className="mt-3 text-xs font-bold text-slate-500">Showing {filteredTickets.length} of {tickets.length} tickets. Each status queue scrolls independently.</p>
      </section>

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">
          Loading tickets...
        </div>
      ) : (
        <section className="overflow-x-auto pb-2 [scrollbar-color:#93c5fd_#e2e8f0] [scrollbar-width:thin]">
          <div className={visibleColumns.length === 1 ? "grid max-w-2xl grid-cols-1 gap-5" : "grid min-w-[1500px] grid-cols-5 gap-5"}>
          {visibleColumns.map((column) => (
            <Column
              key={column.id}
              column={column}
              tickets={filteredTickets.filter(
                (ticket) => ticket.status === column.id
              )}
              onTicketClick={setSelectedTicket}
            />
          ))}
          </div>
        </section>
      )}

      {exportOpen && (
        <ExportReportModal
          title="Export Ticket Report"
          subtitle="Export a branded table containing the tickets matching the current filters and RBAC scope."
          format={exportFormat}
          onFormatChange={setExportFormat}
          onClose={() => !exporting && setExportOpen(false)}
          onExport={exportTickets}
          busy={exporting}
          branches={isSuperAdmin ? branches : []}
          branchId={branchFilter || "all"}
          onBranchChange={isSuperAdmin ? (value) => setBranchFilter(value === "all" ? "" : value) : undefined}
          allowedFormats={["excel", "txt", "pdf"]}
        />
      )}

      {modalOpen && (
        <NewTicketModal
          categories={categories}
          branches={branches}
          user={user}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            fetchTickets();
            fetchCategories();
          }}
        />
      )}

      {selectedTicket && (
        <TicketDetailsDrawer
          ticket={selectedTicket}
          onClose={(message) => {
            setSelectedTicket(null);
            if (typeof message === "string" && message) {
              setPageMessage(message);
            }
          }}
          onRefresh={fetchTickets}
        />
      )}
    </div>
  );
}
