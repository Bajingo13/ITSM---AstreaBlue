import sys

file_path = "C:/Users/janis/asset-monitoring-backend/frontend/src/views/EmployeeDashboard.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

old_modal_start = 'function CreateTicketModal({ categories, user, onClose, onCreated }) {'
idx_start = content.find(old_modal_start)

if idx_start != -1:
    idx_end = content.find('function EmployeeTicketDetails', idx_start)
    if idx_end != -1:
        new_modal = """function CreateTicketModal({ categories, user, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "P3-Medium",
    category_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [isOtherCategory, setIsOtherCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

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

    try {
      setSaving(true);
      
      let categoryId = form.category_id || null;
      if (isOtherCategory && customCategory.trim()) {
        const catRes = await fetch(`${API_BASE}/ticket-categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_name: customCategory.trim() }),
        });
        const catData = await catRes.json();
        if (catRes.ok && catData.category) categoryId = catData.category.category_id;
      }

      const res = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTicketPayload(user, { ...form, category_id: categoryId })),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      const createdTicket = data.data || data;
      
      try {
        await uploadTicketAttachments(createdTicket.id, files, user?.user_id);
      } catch(err) {
        console.warn("Attachment upload issue", err);
      }

      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const priorityList = [
    { value: "P1-Critical", label: "P1 — Critical", dot: "bg-red-500", bg: "bg-red-600 text-white" },
    { value: "P2-High", label: "P2 — High", dot: "bg-orange-500", bg: "bg-red-50 text-red-700" },
    { value: "P3-Medium", label: "P3 — Medium", dot: "bg-amber-500", bg: "bg-yellow-50 text-yellow-800" },
    { value: "P4-Low", label: "P4 — Low", dot: "bg-green-500", bg: "bg-green-50 text-green-700" },
  ];

  const inputClass = "w-full rounded-xl border-2 border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100";
  const labelClass = "mb-1.5 block text-sm font-black text-slate-700";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-blue-50 to-slate-50 px-7 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-600/30">
              <Plus size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Create New Ticket</h2>
              <p className="text-xs font-medium text-slate-500">
                Submit an incident or service request to the IT service desk.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-slate-700 hover:shadow-sm">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-7 py-6">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className={labelClass}>Title *</label>
            <input value={form.title} onChange={(e) => updateForm("title", e.target.value)} placeholder="Brief description of the issue..." className={inputClass} required />
          </div>

          <div>
            <label className={labelClass}>Description *</label>
            <textarea value={form.description} onChange={(e) => updateForm("description", e.target.value)} placeholder="Detailed description..." rows={4} className={`${inputClass} resize-none`} required />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Category</label>
              <select value={isOtherCategory ? "__other__" : form.category_id} onChange={(e) => handleCategoryChange(e.target.value)} className={inputClass}>
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>
                ))}
                <option value="__other__">Other...</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Priority</label>
              <div className="flex flex-wrap gap-2">
                {priorityList.map((p) => (
                  <button key={p.value} type="button" onClick={() => updateForm("priority", p.value)} className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-3.5 py-2 text-xs font-black transition ${form.priority === p.value ? `${p.bg} border-current shadow-sm` : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"}`}>
                    <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isOtherCategory && (
            <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/50 p-4">
              <label className={labelClass}>Specify Category *</label>
              <input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. CCTV, WiFi..." className={inputClass} autoFocus required />
            </div>
          )}

          <div>
            <label className={labelClass}>Attachments</label>
            <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/30 px-4 py-5 text-sm font-bold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50/60">
              <Paperclip size={18} />
              <span>{files.length ? `${files.length} file(s) selected` : "Choose PNG, JPG, JPEG, WEBP, or PDF"}</span>
              <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))} className="hidden" />
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
            <button type="button" onClick={onClose} className="rounded-xl border-2 border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-700 disabled:opacity-60">{saving ? "Creating..." : "Create Ticket"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

"""
        content = content[:idx_start] + new_modal + content[idx_end:]
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("EmployeeDashboard Modal successfully updated!")
    else:
        print("End not found")
else:
    print("Start not found")
