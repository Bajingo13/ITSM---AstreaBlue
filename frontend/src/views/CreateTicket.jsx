import { API_URL } from "../config/api";
import { useCallback, useEffect, useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { buildTicketPayload } from "../utils/ticketAccess";
import {
  getSeverityOptionStyle,
  getSeverityLevel,
  getSeveritySelectClass,
  priorityOptions,
} from "../utils/ticketVisuals";
import PageHero from "../components/layout/PageHero";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1`;
const priorityDotStyle = {
  "P1-Critical": "bg-red-500",
  "P2-High": "bg-orange-500",
  "P3-Medium": "bg-amber-500",
  "P4-Low": "bg-green-500",
};

export default function CreateTicket() {
  const { user } = useAuth();
  const isHr = String(user?.role_name || user?.role || "").trim().toLowerCase() === "hr";
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isOtherCategory, setIsOtherCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    category_id: "",
    priority: "P3-Medium",
    requester_id: "",
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

  useEffect(() => {
    if (!isHr) return;
    let active = true;
    fetch(`${API_BASE}/employee-lifecycle/employees`, {
      headers: authHeaders(),
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || body.success === false) throw new Error(body.message || "Failed to load employees.");
        if (active) setEmployees((body.data || []).filter((employee) => employee.is_active !== false));
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => { active = false; };
  }, [isHr]);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm({
      title: "",
      description: "",
      category_id: "",
      priority: "P3-Medium",
      requester_id: "",
    });
    setFiles([]);
    setIsOtherCategory(false);
    setCustomCategory("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.title.trim() || !form.description.trim()) {
      setError("Title and description are required.");
      return;
    }
    if (isHr && !form.requester_id) {
      setError("Select the employee this ticket is for.");
      return;
    }
    if (isOtherCategory && !customCategory.trim()) {
      setError("Specify Category is required when Other is selected.");
      return;
    }

    try {
      setSaving(true);
      let categoryId = form.category_id || null;
      if (isOtherCategory) {
        const categoryResponse = await fetch(`${API_BASE}/ticket-categories`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ category_name: customCategory.trim() }),
        });
        const categoryBody = await categoryResponse.json();
        if (!categoryResponse.ok || categoryBody.success === false || !categoryBody.category) {
          throw new Error(categoryBody.message || categoryBody.error || "Failed to save category.");
        }
        categoryId = categoryBody.category.category_id;
      }
      const res = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(buildTicketPayload(user, {
          ...form,
          impact: "Medium",
          urgency: "Medium",
          category_id: categoryId,
          requester_id: isHr ? form.requester_id : user?.user_id,
          branch_id: user?.branch_id || null,
          status: "Open Queue",
          source: "portal",
        })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      const createdTicket = data.data || data;
      await uploadTicketAttachments(createdTicket.id, files, user?.user_id);
      resetForm();
      setSuccess(`Ticket ${createdTicket.ticket_number || ""} created successfully.`);
      await fetchCategories();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={isHr ? "HR Service Desk" : "Employee Service Hub"}
        title={isHr ? "Create Employee Ticket" : "Create Ticket"}
        subtitle={isHr
          ? "Submit a branch-scoped IT request on behalf of an employee. IT retains assignment and resolution control."
          : "Submit an incident or service request with the details needed for a fast response."}
        compact
      />

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

        {isHr && (
          <SelectField
            label="Ticket For Employee *"
            value={form.requester_id}
            onChange={(value) => updateForm("requester_id", value)}
            options={[
              { label: "Select an employee in your branch", value: "" },
              ...employees.map((employee) => ({
                label: `${employee.full_name} — ${employee.email}`,
                value: employee.user_id,
              })),
            ]}
          />
        )}

        <Field
          label="Title"
          required
          value={form.title}
          onChange={(value) => updateForm("title", value)}
          placeholder="Briefly describe the request or issue"
        />
        <Field
          label="Description"
          required
          value={form.description}
          onChange={(value) => updateForm("description", value)}
          placeholder="Include affected device, application, urgency, and helpful details"
          textarea
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SelectField
            label="Category"
            value={isOtherCategory ? "__other__" : form.category_id}
            onChange={(value) => {
              setIsOtherCategory(value === "__other__");
              if (value !== "__other__") {
                setCustomCategory("");
                updateForm("category_id", value);
              } else updateForm("category_id", "");
            }}
            options={[
              { label: "Select category", value: "" },
              ...categories.map((cat) => ({
                label: cat.category_name,
                value: cat.category_id,
              })),
              { label: "Other...", value: "__other__" },
            ]}
          />
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(value) => updateForm("priority", value)}
            options={priorityOptions.map((value) => ({ label: value, value }))}
          />
          
        </div>

        {isOtherCategory && (
          <Field
            label="Specify Category"
            required
            value={customCategory}
            onChange={setCustomCategory}
            placeholder="e.g. CCTV, WiFi, Biometrics, Projector"
          />
        )}

        {!isHr && <div>
          <label className="astrea-field-label">
            Attach Screenshots or PDF
          </label>
          <label className="astrea-upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles(Array.from(event.dataTransfer.files || [])); }}>
            <span className="rounded-full bg-blue-100 p-3 text-blue-700"><Paperclip size={22} /></span>
            <span className="font-black">
              {files.length ? `${files.length} file(s) selected` : "Choose PNG, JPG, JPEG, WEBP, or PDF"}
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
        </div>}

        <div className="flex justify-end border-t border-slate-200 pt-5">
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
  );
}

async function uploadTicketAttachments(ticketId, files, uploadedBy) {
  if (!ticketId || !files.length) return;

  const formData = new FormData();
  files.forEach((file) => formData.append("attachments", file));
  if (uploadedBy) formData.append("uploaded_by", uploadedBy);

  const res = await fetch(`${API_BASE}/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: authHeaders(),
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

function Field({ label, value, onChange, placeholder, textarea = false, required = false }) {
  return (
    <div>
      <label className="astrea-field-label">{label}{required && <span className="ml-1 text-red-600">*</span>}</label>
      {textarea ? (
        <textarea
          value={value}
          rows={5}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="astrea-control resize-none"
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="astrea-control"
        />
      )}
    </div>
  );
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

function SelectField({ label, value, onChange, options }) {
  const shouldColorBySeverity = label === "Priority";

  return (
    <div>
      <label className="astrea-field-label">{label}</label>
      <select
        value={value}
        data-severity={shouldColorBySeverity ? getSeverityLevel(value) : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`astrea-control transition-colors ${
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

