import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  Paperclip,
  Plus,
  RotateCcw,
  Star,
  Ticket,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload, buildTicketQuery } from "../utils/ticketAccess";
import DashboardHero from "../components/DashboardHero";
import {
  getPriorityBadgeClass, formatPriority,
  getSeverityOptionStyle,
  getSeveritySelectClass,
  getStatusBadgeClass,
  priorityOptions,
} from "../utils/ticketVisuals";

const API_BASE = `${API_URL}/api/v1`;

const priorityDotStyle = {
  "P1-Critical": "bg-red-500",
  "P2-High": "bg-orange-500",
  "P3-Medium": "bg-amber-500",
  "P4-Low": "bg-green-500",
};

export default function EmployeeDashboard({ view = "dashboard" }) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);

  const employeeId = user?.user_id;
  const showOverview = view === "dashboard";
  const showCreate = view === "create";
  const showTickets = view === "dashboard" || view === "tickets";

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch employee tickets failed:", err);
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
      console.error("Fetch ticket categories failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    fetchCategories();
  }, [fetchTickets, fetchCategories]);

  useEffect(() => {
    const refresh = () => {
      fetchTickets();
      fetchCategories();
    };
    window.addEventListener("astreablue:refresh-dashboard", refresh);
    return () => window.removeEventListener("astreablue:refresh-dashboard", refresh);
  }, [fetchCategories, fetchTickets]);

  useEffect(() => {
    if (showCreate) setTicketModalOpen(true);
  }, [showCreate]);

  const myTickets = useMemo(() => {
    return tickets.filter(
      (ticket) => Number(ticket.requester_id) === Number(employeeId)
    );
  }, [tickets, employeeId]);

  const openTickets = myTickets.filter((ticket) => ticket.status === "Open Queue");
  const inProgressTickets = myTickets.filter(
    (ticket) => ticket.status === "In Progress"
  );
  const resolvedTickets = myTickets.filter((ticket) => ticket.status === "Resolved");
  const closedTickets = myTickets.filter((ticket) => ticket.status === "Closed");

  return (
    <div className="space-y-6">
      {showOverview ? <DashboardHero title="Employee Service Hub" subtitle="Track requests, follow ticket progress, and stay informed about the services supporting your workday." /> : <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-black">Employee Service Portal</h1>
          <p className="mt-2 text-blue-100">
            File service requests, track your tickets, and confirm resolutions.
          </p>
        </div>

        {showOverview && (
        <button
          onClick={() => setTicketModalOpen(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
        >
          <Plus size={18} />
          Create Ticket
        </button>
        )}
      </section>}

      {showOverview && (
        <div className="flex justify-end">
          <button onClick={() => setTicketModalOpen(true)} className="flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-black text-white shadow-lg hover:bg-blue-800">
            <Plus size={18} /> Create Ticket
          </button>
        </div>
      )}

      {showCreate && (
        <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex max-w-xl flex-col items-center">
            <div className="rounded-2xl bg-blue-50 p-4 text-blue-700">
              <Plus size={28} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-slate-900">
              Create Ticket
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              File a new incident or service request with optional screenshots or PDFs.
            </p>
            <button
              onClick={() => setTicketModalOpen(true)}
              className="mt-5 rounded-xl bg-blue-700 px-6 py-3 font-black text-white shadow-lg shadow-blue-700/20 hover:bg-blue-800"
            >
              Open Ticket Form
            </button>
          </div>
        </section>
      )}

      {showOverview && (
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card icon={Ticket} label="My Open Tickets" value={openTickets.length} color="blue" />
        <Card icon={Clock} label="In Progress" value={inProgressTickets.length} color="sky" />
        <Card icon={CheckCircle} label="Resolved" value={resolvedTickets.length} color="emerald" />
        <Card icon={FileText} label="Closed" value={closedTickets.length} color="slate" />
      </section>
      )}

      {showTickets && (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">My Tickets</h2>
        <p className="mt-1 text-sm text-slate-500">
          Requests filed from your employee account.
        </p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Ticket No.</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Technician</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading your tickets...
                  </td>
                </tr>
              ) : myTickets.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center font-bold text-slate-400">
                    No tickets filed yet.
                  </td>
                </tr>
              ) : (
                myTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket)}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40"
                  >
                    <td className="px-4 py-4 text-sm font-black text-blue-700">
                      {ticket.ticket_number}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold text-slate-900">{ticket.title}</p>
                      <p className="line-clamp-1 text-sm text-slate-400">
                        {ticket.desc || ticket.description}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.category || "Uncategorized"}
                    </td>
                    <td className="px-4 py-4">
                      <span className={getPriorityBadgeClass, formatPriority(ticket.priority)}>
                        {formatPriority(ticket.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={getStatusBadgeClass(ticket.status)}>
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.assigned_name || "Unassigned"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {ticket.created_at
                        ? new Date(ticket.created_at).toLocaleString()
                        : "Not recorded"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {ticketModalOpen && (
        <CreateTicketModal
          categories={categories}
          user={user}
          onClose={() => setTicketModalOpen(false)}
          onCreated={() => {
            setTicketModalOpen(false);
            fetchTickets();
          }}
        />
      )}

      {selectedTicket && (
        <EmployeeTicketDetails
          ticket={selectedTicket}
          user={user}
          onClose={() => setSelectedTicket(null)}
          onUpdated={() => {
            setSelectedTicket(null);
            fetchTickets();
          }}
        />
      )}
    </div>
  );
}

function CreateTicketModal({ categories, user, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    category_id: "",
    priority: "P3-Medium",
  });
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

      const res = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, {
          ...form,
          impact: "Medium",
          urgency: "Medium",
          category_id: form.category_id || null,
          requester_id: user?.user_id,
          branch_id: user?.branch_id || null,
          status: "Open Queue",
          source: "portal",
        })),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      const createdTicket = data.data || data;
      setForm({
        title: "",
        description: "",
        category_id: "",
        priority: "P3-Medium",
      });
      setFiles([]);

      try {
        await uploadTicketAttachments(createdTicket.id, files, user?.user_id);
      } catch (attachmentError) {
        console.warn("Ticket created, but attachment upload failed:", attachmentError.message);
      }

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
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">Create Ticket</h2>
            <p className="mt-1 text-sm text-slate-500">
              Submit an incident or service request to the IT team.
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
              placeholder="Briefly describe the request or issue"
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
              rows={5}
              placeholder="Include affected device, application, urgency, and helpful details"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SelectField
              label="Category"
              value={form.category_id}
              onChange={(value) => updateForm("category_id", value)}
              options={[
                { label: "Select category", value: "" },
                ...categories.map((cat) => ({
                  label: cat.category_name,
                  value: cat.category_id,
                })),
              ]}
            />
            <div>
              <SelectField
                label="Priority"
                value={form.priority}
                onChange={(value) => updateForm("priority", value)}
                options={priorityOptions.map((value) => ({ label: value, value }))}
              />
              <div className="mt-2">
                
              </div>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Attach Screenshots or PDF
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-5 text-sm font-bold text-blue-700 hover:bg-blue-50">
              <Paperclip size={18} />
              <span>{files.length ? `${files.length} file(s) selected` : "Choose PNG, JPG, JPEG, WEBP, or PDF"}</span>
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
              className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white shadow-lg shadow-blue-700/20 hover:bg-blue-800 disabled:opacity-60"
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

function PriorityIndicator({ value }) {
  return (
    <div className="flex items-end">
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">
        <span className={`h-2.5 w-2.5 rounded-full ${priorityDotStyle[value] || "bg-slate-400"}`} />
        Selected: {value || "Priority"}
      </div>
    </div>
  );
}

function EmployeeTicketDetails({ ticket, user, onClose, onUpdated }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [rating, setRating] = useState(ticket.satisfaction_rating || 0);

  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}${buildTicketQuery(user)}`);
      const data = await res.json();
      setDetails(data);
    } catch (err) {
      console.error("Fetch employee ticket details failed:", err);
    } finally {
      setLoading(false);
    }
  }, [ticket.id, user]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const item = details || ticket;

  useEffect(() => {
    setRating(item.satisfaction_rating || 0);
  }, [item.satisfaction_rating]);

  const updateTicketStatus = async (status) => {
    try {
      setUpdating(true);

      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { status })),
      });

      if (!res.ok) throw new Error("Failed to update ticket.");

      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(false);
    }
  };

  const submitRating = async (value) => {
    try {
      setRating(value);
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { satisfaction_rating: value })),
      });

      if (!res.ok) throw new Error("Failed to save rating.");
      fetchDetails();
    } catch (err) {
      console.error(err);
    }
  };

  const openAttachment = async (attachmentId) => {
    try {
      const attachment = item.attachments?.find(
        (entry) => entry.attachment_id === attachmentId
      );
      if (!attachment?.file_path) throw new Error("Attachment file path not found");
      window.open(`${API_URL}${attachment.file_path}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-white px-7 py-5">
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
            Loading ticket details...
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto p-7 pb-28">
            <section className="grid grid-cols-2 gap-4">
              <InfoTile label="Status" value={item.status} />
              <InfoTile label="Assigned Technician" value={item.assigned_name || "Unassigned"} />
              <InfoTile label="Priority" value={formatPriority(item.priority)} />
              <InfoTile label="Category" value={item.category || "Uncategorized"} />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 font-black text-slate-900">Description</h3>
              <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
                {item.desc || item.description || "No description provided."}
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

            <section className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5">
              <div className="mb-4 flex items-center gap-2">
                <CheckCircle size={18} className="text-emerald-600" />
                <h3 className="font-black text-slate-900">Resolution Details</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Resolution Notes
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-7 text-slate-700">
                    {item.resolution_notes || "No resolution notes yet."}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <InfoTile label="Root Cause" value={item.root_cause || "Not specified"} />
                  <InfoTile
                    label="Time Spent"
                    value={
                      item.time_spent_minutes !== null &&
                      item.time_spent_minutes !== undefined &&
                      item.time_spent_minutes !== ""
                        ? `${item.time_spent_minutes} minutes`
                        : "Not specified"
                    }
                  />
                  <InfoTile label="Parts Used" value={item.parts_used || "None recorded"} />
                  <InfoTile
                    label="Resolved At"
                    value={
                      item.resolved_at
                        ? new Date(item.resolved_at).toLocaleString()
                        : "Not recorded"
                    }
                  />
                </div>
              </div>
            </section>

            {(item.status === "Resolved" || item.status === "Closed") && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
                <h3 className="mb-3 font-black text-slate-900">
                  Satisfaction Rating
                </h3>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      onClick={() => submitRating(value)}
                      className={`rounded-xl p-2 ${
                        value <= rating
                          ? "bg-amber-100 text-amber-600"
                          : "bg-white text-slate-300"
                      }`}
                    >
                      <Star size={22} fill={value <= rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <div className="border-t border-slate-200 bg-white/95 px-7 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>

            {item.status === "Resolved" && (
              <>
                <button
                  onClick={() => updateTicketStatus("Open Queue")}
                  disabled={updating}
                  className="flex items-center gap-2 rounded-xl border border-blue-200 px-5 py-3 font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                >
                  <RotateCcw size={17} />
                  Reopen Ticket
                </button>

                <button
                  onClick={() => updateTicketStatus("Closed")}
                  disabled={updating}
                  className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-700 disabled:opacity-60"
                >
                  Accept Resolution / Close Ticket
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  const shouldColorBySeverity = label === "Priority";

  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border px-4 py-3 outline-none transition-colors focus:ring-4 ${
          shouldColorBySeverity
            ? getSeveritySelectClass(value)
            : "border-slate-200 bg-slate-50 text-slate-900 hover:bg-white focus:border-blue-600 focus:bg-white focus:ring-blue-100"
        }`}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            style={shouldColorBySeverity ? getSeverityOptionStyle(option.value) : {}}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
    </div>
  );
}

function Card({ icon: Icon, label, value, color }) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-700",
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`rounded-2xl p-3 ${colorMap[color]}`}>
          <Icon size={22} />
        </div>
        <div>
          <p className="text-2xl font-black text-slate-900">{value}</p>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

