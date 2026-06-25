import { useCallback, useEffect, useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload } from "../utils/ticketAccess";

const API_BASE = "http://localhost:5001/api/v1";
const priorityOptions = ["P1-Critical", "P2-High", "P3-Medium", "P4-Low"];
const impactOptions = ["High", "Medium", "Low"];
const urgencyOptions = ["High", "Medium", "Low"];

export default function CreateTicket() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    category_id: "",
    priority: "P3-Medium",
    impact: "Medium",
    urgency: "Medium",
  });

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
    fetchCategories();
  }, [fetchCategories]);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm({
      title: "",
      description: "",
      category_id: "",
      priority: "P3-Medium",
      impact: "Medium",
      urgency: "Medium",
    });
    setFiles([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

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
          category_id: form.category_id || null,
          requester_id: user?.user_id,
          branch_id: user?.branch_id || null,
          status: "Open Queue",
          source: "portal",
        })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      await uploadTicketAttachments(data.id, files, user?.user_id);
      resetForm();
      setSuccess(`Ticket ${data.ticket_number || ""} created successfully.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <FileText />
          <div>
            <h1 className="text-3xl font-black">Create Ticket</h1>
            <p className="mt-2 text-blue-100">
              File a new incident or service request to the IT team.
            </p>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            {success}
          </div>
        )}

        <Field
          label="Title *"
          value={form.title}
          onChange={(value) => updateForm("title", value)}
          placeholder="Briefly describe the request or issue"
        />
        <Field
          label="Description *"
          value={form.description}
          onChange={(value) => updateForm("description", value)}
          placeholder="Include affected device, application, urgency, and helpful details"
          textarea
        />

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
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(value) => updateForm("priority", value)}
            options={priorityOptions.map((value) => ({ label: value, value }))}
          />
          <SelectField
            label="Impact"
            value={form.impact}
            onChange={(value) => updateForm("impact", value)}
            options={impactOptions.map((value) => ({ label: value, value }))}
          />
          <SelectField
            label="Urgency"
            value={form.urgency}
            onChange={(value) => updateForm("urgency", value)}
            options={urgencyOptions.map((value) => ({ label: value, value }))}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700">
            Attach Screenshots or PDF
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-5 text-sm font-bold text-blue-700 hover:bg-blue-50">
            <Paperclip size={18} />
            <span>
              {files.length ? `${files.length} file(s) selected` : "Choose PNG, JPG, JPEG, WEBP, or PDF"}
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

        <div className="flex justify-end border-t border-slate-200 pt-5">
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

function Field({ label, value, onChange, placeholder, textarea = false }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          rows={5}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
        />
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
