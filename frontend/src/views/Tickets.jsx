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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";

const API_BASE = "http://localhost:5001/api/v1";

const columns = [
  { id: "Open Queue", label: "Open Queue", color: "bg-sky-500" },
  { id: "In Progress", label: "In Progress", color: "bg-amber-500" },
  { id: "Resolved", label: "Resolved", color: "bg-emerald-500" },
  { id: "Closed", label: "Closed", color: "bg-slate-500" },
  { id: "Cancelled", label: "Cancelled", color: "bg-red-500" },
];

const priorityStyle = {
  "P1-Critical": "bg-red-50 text-red-700 border-red-200",
  "P2-High": "bg-orange-50 text-orange-700 border-orange-200",
  "P3-Medium": "bg-amber-50 text-amber-700 border-amber-200",
  "P4-Low": "bg-blue-50 text-blue-700 border-blue-200",
};

function NewTicketModal({ categories, user, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "P3-Medium",
    status: "Open Queue",
    category_id: "",
    source: "portal",
    impact: "Medium",
    urgency: "Medium",
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
        category_id: form.category_id || null,
        requester_id: user?.user_id || null,
        branch_id: user?.branch_id || null,
      });

      const res = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      await uploadTicketAttachments(data.id, files, user?.user_id);
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

            <select
              value={form.priority}
              onChange={(e) => updateForm("priority", e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
            >
              <option value="P1-Critical">P1 - Critical</option>
              <option value="P2-High">P2 - High</option>
              <option value="P3-Medium">P3 - Medium</option>
              <option value="P4-Low">P4 - Low</option>
            </select>

            <select
              value={form.impact}
              onChange={(e) => updateForm("impact", e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
            >
              <option value="High">High Impact</option>
              <option value="Medium">Medium Impact</option>
              <option value="Low">Low Impact</option>
            </select>

            <select
              value={form.urgency}
              onChange={(e) => updateForm("urgency", e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none"
            >
              <option value="High">High Urgency</option>
              <option value="Medium">Medium Urgency</option>
              <option value="Low">Low Urgency</option>
            </select>
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
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState("");

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
      const res = await fetch(`${API_BASE}/technicians`);
      const data = await res.json();
      setTechnicians(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch technicians failed:", err);
    }
  }, []);

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
  const normalizedRole = String(role || user?.role_name || user?.role || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  const hasResolution =
    item.status === "Resolved" || Boolean(item.resolution_notes);
  const canCreateKbArticle = ["SuperAdmin", "Admin", "Technician"].includes(
    role || user?.role_name || user?.role
  );
  const isCancelled = item.status === "Cancelled";
  const canCancelTicket =
    normalizedRole === "superadmin" &&
    item.status !== "Closed" &&
    !isCancelled;
  const currentAssignedTo = item.assigned_to ? String(item.assigned_to) : "";
  const hasAssignmentChange = selectedTechnician !== currentAssignedTo;
  const currentStatus = item.status || "";
  const hasStatusChange = selectedStatus !== currentStatus;
  const hasUnsavedChanges = hasAssignmentChange || hasStatusChange;

  const saveChanges = async () => {
    if (!hasUnsavedChanges) {
      onClose();
      return;
    }

    try {
      setAssigning(true);

      if (hasStatusChange) {
        const statusRes = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildTicketPayload(user, { status: selectedStatus })),
        });

        if (!statusRes.ok) throw new Error("Failed to update status");
      }

      if (hasAssignmentChange) {
        const assignRes = await fetch(`${API_BASE}/tickets/${ticket.id}/assign`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildTicketPayload(user, {
              assigned_to: selectedTechnician ? Number(selectedTechnician) : null,
            })
          ),
        });

        if (!assignRes.ok) throw new Error("Failed to assign technician");
      }

      await fetchDetails();
      await onRefresh();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setAssigning(false);
    }
  };

  const cancelTicket = async (e) => {
    e.preventDefault();
    setActionError("");

    if (!cancellationReason.trim()) {
      setActionError("Cancellation reason is required.");
      return;
    }

    try {
      setCancelling(true);

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildTicketPayload(user, {
            cancellation_reason: cancellationReason.trim(),
          })
        ),
      });
      const data = await readJsonSafely(res);

      if (!res.ok) {
        throw new Error(data.error || "Failed to cancel ticket.");
      }

      setCancellationReason("");
      setCancelModalOpen(false);
      await fetchDetails();
      await onRefresh();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setCancelling(false);
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

  const openAttachment = async (attachmentId) => {
    try {
      const attachment = item.attachments?.find(
        (entry) => entry.attachment_id === attachmentId
      );
      if (!attachment?.file_path) throw new Error("Attachment file path not found");
      window.open(`http://localhost:5001${attachment.file_path}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
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
              onClick={onClose}
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
                <p className="mt-1 font-black text-slate-900">
                  {selectedStatus}
                  {hasStatusChange && (
                    <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-blue-700">
                      Unsaved
                    </span>
                  )}
                </p>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-400">Priority</p>
                <p className="mt-1 font-black text-slate-900">
                  {item.priority}
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
                      {tech.full_name} — {tech.email}
                    </option>
                  ))}
                </select>
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
                      onClick={() => openAttachment(attachment.attachment_id)}
                      className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <span>{attachment.file_name}</span>
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

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 font-black text-slate-900">
                Update Status
              </h3>
              <div className="flex flex-wrap gap-2">
                {columns.filter((col) => col.id !== "Cancelled").map((col) => (
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
          <div className="flex items-center justify-end gap-3">
            {canCancelTicket && (
              <button
                onClick={() => {
                  setActionError("");
                  setCancelModalOpen(true);
                }}
                disabled={loading || assigning || cancelling || hasUnsavedChanges}
                className="flex items-center gap-2 rounded-xl border border-red-200 px-5 py-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                <Ban size={17} />
                Cancel Ticket
              </button>
            )}

            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>

            <button
              onClick={saveChanges}
              disabled={loading || assigning || !hasUnsavedChanges}
              className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white shadow-lg shadow-blue-700/20 hover:bg-blue-800 disabled:opacity-60"
            >
              {assigning ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>

    {cancelModalOpen && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-red-600">
                Cancel Ticket
              </p>
              <h3 className="mt-1 text-xl font-black text-slate-900">
                {item.ticket_number || `TKT-${item.id}`}
              </h3>
            </div>
            <button
              onClick={() => setCancelModalOpen(false)}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={20} />
            </button>
          </div>

          <form onSubmit={cancelTicket} className="space-y-4 px-6 py-5">
            {actionError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {actionError}
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Cancellation Reason *
              </label>
              <textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                rows={4}
                placeholder="Why is this ticket being cancelled?"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-red-500 focus:bg-white focus:ring-4 focus:ring-red-100"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={cancelling}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Ban size={17} />
                {cancelling ? "Cancelling..." : "Confirm Cancel"}
              </button>
            </div>
          </form>
        </div>
      </div>
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
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${
            priorityStyle[ticket.priority] ||
            "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {ticket.priority || "P3-Medium"}
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

export default function Tickets({
  title = "Ticket Management",
  description = "Track, prioritize, and resolve IT incidents and service requests.",
  showServiceFilters = false,
}) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Services");
  const [loading, setLoading] = useState(true);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch tickets failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ticket-categories`);
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch categories failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    fetchCategories();
  }, [fetchTickets, fetchCategories]);

  const serviceFilterOptions = useMemo(() => {
    const uniqueCategories = Array.from(
      new Set(categories.map((category) => category.category_name).filter(Boolean))
    );
    return ["All Services", ...uniqueCategories];
  }, [categories]);

  const filteredTickets = useMemo(() => {
    const text = query.toLowerCase();

    return tickets.filter((ticket) => {
      const matchesSearch =
        ticket.title?.toLowerCase().includes(text) ||
        ticket.ticket_number?.toLowerCase().includes(text) ||
        ticket.priority?.toLowerCase().includes(text) ||
        ticket.status?.toLowerCase().includes(text) ||
        ticket.category?.toLowerCase().includes(text) ||
        ticket.requester_name?.toLowerCase().includes(text) ||
        ticket.description?.toLowerCase().includes(text);

      const matchesCategory =
        selectedCategory === "All Services" ||
        ticket.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [tickets, query, selectedCategory]);

  const totalOpen = tickets.filter(
    (t) => t.status !== "Closed" && t.status !== "Cancelled"
  ).length;
  const critical = tickets.filter((t) => t.priority === "P1-Critical").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-black">{title}</h1>
          <p className="mt-2 text-blue-100">{description}</p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
        >
          <Plus size={18} />
          New Ticket
        </button>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
      </section>

      {showServiceFilters && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {serviceFilterOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSelectedCategory(option)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  selectedCategory === option
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search user requests by ticket number, title, requester, status, priority, or category..."
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
          onClose={() => setSelectedTicket(null)}
          onRefresh={fetchTickets}
        />
      )}
    </div>
  );
}
