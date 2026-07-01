import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  XCircle,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AttachmentPreviewModal from "../components/AttachmentPreviewModal";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import {
  getPriorityBadgeClass, formatPriority,
  getSeverityLevel,
} from "../utils/ticketVisuals";
import { API_URL } from "../config/api";

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
  "P1-Critical": "bg-red-50 text-red-700 border-red-200",
  "P2-High": "bg-orange-50 text-orange-700 border-orange-200",
  "P3-Medium": "bg-amber-50 text-amber-700 border-amber-200",
  "P4-Low": "bg-blue-50 text-blue-700 border-blue-200",
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

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.title.trim() || !form.description.trim()) {
      setError("Title and description are required.");
      return;
    }

    try {
      setSaving(true);

      const payload = buildTicketPayload(user, {
        ...form,
        impact: "Medium",
        urgency: "Medium",
        category_id: form.category_id || null,
        requester_id: user?.user_id || null,
        branch_id: isSuperAdmin ? form.branch_id || null : user?.branch_id || null,
      });

      const res = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              Create New Ticket
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Submit an incident or service request to the IT service desk.
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-7 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Title *
            </label>
            <input
              value={form.title}
              onChange={(e) => updateForm("title", e.target.value)}
              placeholder="Brief description of the issue..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Description *
            </label>
            <textarea
              value={form.description}
              onChange={(e) => updateForm("description", e.target.value)}
              placeholder="Detailed description, affected user/device, steps to reproduce..."
              rows={5}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {isSuperAdmin && (
              <select
                value={form.branch_id}
                onChange={(e) => updateForm("branch_id", e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              >
                <option value="">Select branch</option>
                {branches.map((branch) => (
                  <option key={branch.branch_id} value={branch.branch_id}>
                    {branch.branch_name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={form.category_id}
              onChange={(e) => updateForm("category_id", e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
            >
              <option value="">Select category</option>
              {categories.map((cat) => (
                <option key={cat.category_id} value={cat.category_id}>
                  {cat.category_name}
                </option>
              ))}
            </select>

            <div>
              <select
                value={form.priority}
                onChange={(e) => updateForm("priority", e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
              >
                <option value="P1-Critical">P1 - Critical</option>
                <option value="P2-High">P2 - High</option>
                <option value="P3-Medium">P3 - Medium</option>
                <option value="P4-Low">P4 - Low</option>
              </select>
              <PriorityIndicator value={form.priority} />
            </div>

          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Attach Screenshots or PDF
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-5 text-sm font-bold text-blue-700 hover:bg-blue-50">
              <Paperclip size={18} />
              <span>
                {files.length
                  ? `${files.length} file(s) selected`
                  : "Choose PNG, JPG, JPEG, WEBP, or PDF"}
              </span>
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white shadow-lg shadow-blue-700/25 hover:bg-blue-800 disabled:opacity-60"
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
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  const [selectedStatus, setSelectedStatus] = useState(ticket.status || "");

  const [technicians, setTechnicians] = useState([]);
  const [selectedTechnician, setSelectedTechnician] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");
  const activeRole = role || user?.role_name || user?.role;

  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}${buildTicketQuery(user)}`);
      const data = await res.json();
      setDetails(data);
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
    const assignedTo = details?.assigned_to ?? ticket.assigned_to ?? "";
    setSelectedTechnician(assignedTo ? String(assignedTo) : "");
  }, [details?.assigned_to, ticket.assigned_to]);

  useEffect(() => {
    setSelectedStatus(details?.status || ticket.status || "");
  }, [details?.status, ticket.status]);

  const addComment = async () => {
    if (!comment.trim()) return;

    try {
      setSavingComment(true);

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: comment }),
      });

      if (!res.ok) throw new Error("Failed to add comment");

      setComment("");
      await fetchDetails();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingComment(false);
    }
  };

  const item = details || ticket;
  const hasResolution =
    item.status === "Resolved" || Boolean(item.resolution_notes);
  const canCreateKbArticle = ["SuperAdmin", "Admin", "Technician"].includes(
    activeRole
  );
  const currentAssignedTo = item.assigned_to ? String(item.assigned_to) : "";
  const hasAssignmentChange = selectedTechnician !== currentAssignedTo;
  const currentStatus = item.status || "";
  const isCancelled = currentStatus === "Cancelled";
  const hasStatusChange = selectedStatus !== currentStatus;
  const hasUnsavedChanges =
    !isCancelled && (hasAssignmentChange || hasStatusChange);
  const isOwnBranchTicket =
    user?.branch_id &&
    item.branch_id &&
    Number(user.branch_id) === Number(item.branch_id);
  const canAssignTicket =
    activeRole === "SuperAdmin" ||
    (activeRole === "Admin" && isOwnBranchTicket);
  const canCancelTicket =
    (activeRole === "SuperAdmin" ||
      (activeRole === "Admin" && isOwnBranchTicket)) &&
    !nonCancellableStatuses.includes(currentStatus);

  const saveChanges = async () => {
    if (isCancelled) return;

    if (!hasUnsavedChanges) {
      onClose();
      return;
    }

    try {
      setAssigning(true);
      setActionError("");

      if (hasStatusChange) {
        const statusRes = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildTicketPayload(user, { status: selectedStatus })),
        });

        if (!statusRes.ok) throw new Error("Failed to update status");
      }

      if (hasAssignmentChange) {
        if (!canAssignTicket) {
          throw new Error("You are not allowed to assign technicians for this ticket.");
        }

        const assignRes = await fetch(`${API_BASE}/tickets/${ticket.id}/assign`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildTicketPayload(user, {
              assigned_to: selectedTechnician ? Number(selectedTechnician) : null,
            })
          ),
        });

        const assignData = await readJsonSafely(assignRes);

        if (!assignRes.ok) {
          throw new Error(assignData.error || "Failed to assign technician");
        }
      }

      await fetchDetails();
      await onRefresh();
      onClose();
    } catch (err) {
      console.error(err);
      setActionError(err.message);
    } finally {
      setAssigning(false);
    }
  };

  const createKnowledgeBaseArticle = () => {
    navigate("/knowledge-base", {
      state: {
        kbPrefill: {
          title: item.title || "",
          category: item.category || "",
          symptoms: item.description || item.desc || "",
          resolution: item.resolution_notes || "",
          related_ticket_id: item.id,
        },
      },
    });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role_name: activeRole,
          current_branch_id: user?.branch_id || null,
          current_user_id: user?.user_id || null,
          cancellation_reason: reason,
        }),
      });

      const data = await readJsonSafely(res);

      if (!res.ok) {
        throw new Error(data.error || "Failed to cancel ticket.");
      }

      setCancelModalOpen(false);
      setCancellationReason("");
      await onRefresh();
      onClose(data.message || "Ticket cancelled successfully.");
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
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-7 py-5">
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

            <section className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-slate-50 p-4">
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

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-400">Priority</p>
                <p className="mt-1">
                  <span className={getPriorityBadgeClass, formatPriority(item.priority)}>
                    {formatPriority(item.priority)}
                  </span>
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-400">Category</p>
                <p className="mt-1 font-black text-slate-900">
                  {item.category || "Uncategorized"}
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-400">
                  Assigned To
                </p>
                <p className="mt-1 font-black text-slate-900">
                  {item.assigned_name || "Unassigned"}
                </p>
              </div>
            </section>

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
    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-600"
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

              <div className="rounded-2xl bg-blue-50 p-4">
                <p className="text-xs font-bold text-blue-400">Branch</p>
                <p className="mt-1 font-black text-blue-800">
                  {item.branch_name || "Unassigned Branch"}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 font-black text-slate-900">Description</h3>
              <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
                {item.desc || item.description}
              </p>
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
                      className="flex w-full items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700"
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
                <p className="text-sm font-semibold text-slate-400">
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
                      label="Resolved At"
                      value={
                        item.resolved_at
                          ? new Date(item.resolved_at).toLocaleString()
                          : "Not recorded"
                      }
                    />
                  </div>
                </div>

                {canCreateKbArticle && item.status === "Resolved" && item.resolution_notes && (
                  <button
                    onClick={createKnowledgeBaseArticle}
                    className="mt-5 flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-black text-white hover:bg-blue-800"
                  >
                    <BookOpen size={17} />
                    Create KB Article
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

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 font-black text-slate-900">
                Update Status
              </h3>
              {isCancelled ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  Cancelled tickets cannot be updated.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {columns
                    .filter((col) => col.id !== "Cancelled")
                    .map((col) => (
                    <button
                      key={col.id}
                      onClick={() => setSelectedStatus(col.id)}
                      disabled={selectedStatus === col.id}
                      className={`rounded-xl px-4 py-2 text-sm font-black ${
                        selectedStatus === col.id
                          ? "bg-blue-700 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                      } disabled:opacity-60`}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare size={18} className="text-blue-600" />
                <h3 className="font-black text-slate-900">Comments</h3>
              </div>

              <div className="space-y-3">
                {item.comments?.length ? (
                  item.comments.map((c) => (
                    <div
                      key={c.comment_id}
                      className="rounded-xl bg-slate-50 p-4"
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
                  <p className="text-sm font-semibold text-slate-400">
                    No comments yet.
                  </p>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600"
                />
                <button
                  onClick={addComment}
                  disabled={savingComment || hasUnsavedChanges}
                  className="rounded-xl bg-blue-700 px-4 text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  <Send size={18} />
                </button>
              </div>

              {hasUnsavedChanges && (
                <p className="mt-2 text-xs font-semibold text-slate-400">
                  Save or cancel pending changes before sending a comment.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
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
                      className="border-l-2 border-blue-200 pl-4"
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
                  <p className="text-sm font-semibold text-slate-400">
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
              onClick={handleCloseDrawer}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>

            <button
              onClick={saveChanges}
              disabled={loading || assigning || isCancelled || !hasUnsavedChanges}
              className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white shadow-lg shadow-blue-700/20 hover:bg-blue-800 disabled:opacity-60"
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
      {previewAttachment && (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  );
}

function ResolutionDetail({ label, value }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm shadow-emerald-900/5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function TicketCard({ ticket, onClick }) {
  return (
    <div
      onClick={() => onClick(ticket)}
      className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-blue-600">
            {ticket.ticket_number || `TKT-${ticket.id}`}
          </p>
          <h3 className="mt-1 line-clamp-2 font-black text-slate-900">
            {ticket.title}
          </h3>
        </div>

        <span
          className={`${getPriorityBadgeClass, formatPriority(ticket.priority)} shrink-0 px-2.5 text-[11px]`}
        >
          {formatPriority(ticket.priority)}
        </span>
      </div>

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
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-700">
            Cancelled
          </span>
        )}
      </div>
    </div>
  );
}

function Column({ column, tickets, onTicketClick }) {
  return (
    <div className="flex min-h-[620px] flex-col rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${column.color}`} />
          <h2 className="font-black text-slate-800">{column.label}</h2>
        </div>

        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 shadow-sm">
          {tickets.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {tickets.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 text-sm font-semibold text-slate-400">
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
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageMessage, setPageMessage] = useState("");

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${API_BASE}/tickets${buildTicketQuery(user, {
          filter_branch_id: branchFilter,
        })}`
      );
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, user]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ticket-categories`);
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch categories failed:", err);
    }
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`);
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
    if (!pageMessage) return;

    const timeout = window.setTimeout(() => setPageMessage(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [pageMessage]);

  const filteredTickets = useMemo(() => {
    const text = query.toLowerCase();

    return tickets.filter((ticket) => {
      return (
        ticket.title?.toLowerCase().includes(text) ||
        ticket.ticket_number?.toLowerCase().includes(text) ||
        ticket.priority?.toLowerCase().includes(text) ||
        ticket.status?.toLowerCase().includes(text) ||
        ticket.category?.toLowerCase().includes(text)
      );
    });
  }, [tickets, query]);

  const totalOpen = tickets.filter(
    (t) => t.status !== "Closed" && t.status !== "Cancelled"
  ).length;
  const critical = tickets.filter((t) => getSeverityLevel(t.priority) === "critical").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const cancelled = tickets.filter((t) => t.status === "Cancelled" || t.status === "Canceled").length;
  const isSuperAdmin = (user?.role_name || user?.role) === "SuperAdmin";

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-black">Ticket Management</h1>
          <p className="mt-2 text-blue-100">
            Track, prioritize, and resolve IT incidents and service requests.
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
        >
          <Plus size={18} />
          New Ticket
        </button>
      </section>

      {pageMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700 shadow-sm">
          {pageMessage}
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {isSuperAdmin && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none"
            >
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.branch_id} value={branch.branch_id}>
                  {branch.branch_name}
                </option>
              ))}
            </select>
          )}
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ticket number, title, status, priority, or category..."
            className="w-full bg-transparent py-2 text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
      </section>

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">
          Loading tickets...
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              tickets={filteredTickets.filter(
                (ticket) => ticket.status === column.id
              )}
              onTicketClick={setSelectedTicket}
            />
          ))}
        </section>
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
