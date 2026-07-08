import { API_URL } from "../config/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  ChevronDown,
  Edit3,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { authHeaders } from "../services/authHeaders";
import { buildTicketQuery } from "../utils/ticketAccess";
import PageHero from "../components/layout/PageHero";

const API_BASE = `${API_URL}/api/v1`;

const emptyArticle = {
  title: "",
  category: "",
  tags: "",
  branch_id: "",
  symptoms: "",
  resolution: "",
  related_ticket_id: "",
};

export default function KnowledgeBase() {
  const { user, role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [articleForm, setArticleForm] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const isSuperAdmin = (role || user?.role_name) === "SuperAdmin";
  const canManage = ["Admin", "Technician"].includes(role || user?.role_name) || isSuperAdmin;

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/knowledge-base`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setArticles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch knowledge base failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    if (!canManage) return;

    try {
      const res = await fetch(`${API_BASE}/tickets${buildTicketQuery(user)}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch tickets for KB failed:", err);
    }
  }, [canManage, user]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch branches failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
    fetchTickets();

    if (isSuperAdmin) {
      fetchBranches();
    }
  }, [fetchArticles, fetchTickets, isSuperAdmin]);

  useEffect(() => {
    if (!canManage || !location.state?.kbPrefill) return;

    setArticleForm({
      ...emptyArticle,
      ...location.state.kbPrefill,
      tags: location.state.kbPrefill.tags || "",
      branch_id: location.state.kbPrefill.branch_id || "",
      related_ticket_id: location.state.kbPrefill.related_ticket_id
        ? String(location.state.kbPrefill.related_ticket_id)
        : "",
    });
    navigate(location.pathname, { replace: true, state: null });
  }, [canManage, location.pathname, location.state, navigate]);

  const categories = useMemo(() => {
    const values = articles
      .map((article) => article.category)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return ["All", ...Array.from(new Set(values))];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    const text = query.trim().toLowerCase();

    return articles.filter((article) => {
      const matchesCategory =
        category === "All" || article.category === category;
      const matchesText =
        !text ||
        article.title?.toLowerCase().includes(text) ||
        article.category?.toLowerCase().includes(text) ||
        article.tags?.toLowerCase().includes(text) ||
        article.symptoms?.toLowerCase().includes(text) ||
        article.resolution?.toLowerCase().includes(text) ||
        article.related_ticket_number?.toLowerCase().includes(text);

      return matchesCategory && matchesText;
    });
  }, [articles, category, query]);

  const deleteArticle = async (article) => {
    setDeleteError("");
    setDeleteCandidate(article);
  };

  const confirmDeleteArticle = async () => {
    if (!deleteCandidate) return;
    try {
      setDeleting(true);
      const res = await fetch(`${API_BASE}/knowledge-base/${deleteCandidate.kb_id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error("Failed to delete article");

      setSelectedArticle(null);
      setDeleteCandidate(null);
      fetchArticles();
    } catch (err) {
      setDeleteError(err.message || "Failed to delete article.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Knowledge Management" title="Knowledge Base" subtitle="Search proven fixes, known issues, root causes, and reusable service resolutions." actions={canManage && (
          <button
            onClick={() => setArticleForm({ ...emptyArticle })}
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
          >
            <Plus size={18} />
            Create Article
          </button>
        )} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Search size={18} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, category, symptoms, resolution, or ticket number..."
              className="w-full bg-transparent py-2 text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm outline-none focus:border-blue-600"
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </section>

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">
          Loading knowledge base articles...
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BookOpen className="mx-auto text-slate-300" size={42} />
          <p className="mt-3 font-black text-slate-500">No articles found.</p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {filteredArticles.map((article) => (
            <button
              key={article.kb_id}
              onClick={() => setSelectedArticle(article)}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-blue-600">
                    {article.category || "General"}
                  </p>
                  <h2 className="mt-1 line-clamp-2 text-lg font-black text-slate-900">
                    {article.title}
                  </h2>
                </div>
                <FileText className="shrink-0 text-blue-500" size={20} />
              </div>

              <p className="line-clamp-3 text-sm leading-6 text-slate-500">
                {article.symptoms || "No symptoms documented."}
              </p>

              <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {article.created_by_name || "Unknown author"}
                </span>
                {article.branch_name && (
                  <span className="rounded-full bg-slate-100 px-3 py-1">
                    {article.branch_name}
                  </span>
                )}
                {article.related_ticket_number && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                    {article.related_ticket_number}
                  </span>
                )}
              </div>
            </button>
          ))}
        </section>
      )}

      {selectedArticle && (
        <ArticleDrawer
          article={selectedArticle}
          canManage={canManage}
          onClose={() => setSelectedArticle(null)}
          onEdit={() => {
            setArticleForm({
              title: selectedArticle.title || "",
              category: selectedArticle.category || "",
              tags: selectedArticle.tags || "",
              symptoms: selectedArticle.symptoms || "",
              resolution: selectedArticle.resolution || "",
              related_ticket_id: selectedArticle.related_ticket_id
                ? String(selectedArticle.related_ticket_id)
                : "",
              branch_id: selectedArticle.branch_id || "",
              kb_id: selectedArticle.kb_id,
            });
            setSelectedArticle(null);
          }}
          onDelete={() => deleteArticle(selectedArticle)}
        />
      )}

      {articleForm && (
        <ArticleFormModal
          article={articleForm}
          tickets={tickets}
          branches={branches}
          isSuperAdmin={isSuperAdmin}
          user={user}
          onClose={() => setArticleForm(null)}
          onSaved={() => {
            setArticleForm(null);
            fetchArticles();
          }}
        />
      )}
      {deleteCandidate && (
        <div className="astrea-modal-backdrop z-[90]">
          <div className="astrea-modal-panel max-w-md">
            <div className="astrea-modal-header"><div><h2 className="text-lg font-black text-slate-900">Delete KB Article</h2><p className="mt-1 text-sm text-slate-500">This action cannot be undone.</p></div></div>
            <div className="astrea-modal-body"><p className="text-sm text-slate-700">Delete <strong>{deleteCandidate.title}</strong>?</p>{deleteError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{deleteError}</p>}</div>
            <div className="astrea-modal-footer"><button type="button" disabled={deleting} onClick={() => setDeleteCandidate(null)} className="astrea-button astrea-button-secondary">Cancel</button><button type="button" disabled={deleting} onClick={confirmDeleteArticle} className="astrea-button astrea-button-danger">{deleting ? "Deleting..." : "Delete Article"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArticleDrawer({ article, canManage, onClose, onEdit, onDelete }) {
  return (
    <div className="astrea-modal-backdrop">
      <div className="astrea-modal-panel flex max-w-4xl flex-col overflow-hidden shadow-2xl">
        {/* ── Header ── */}
        <div className="relative shrink-0 border-b border-slate-200 px-8 py-6">
          <button
            onClick={onClose}
            className="absolute right-5 top-5 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={22} />
          </button>
          <p className="inline-flex rounded-full bg-blue-50 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-blue-700">
            {article.category || "General"}
          </p>
          <h2 className="mt-3 pr-12 text-2xl font-black leading-tight text-slate-900">
            {article.title}
          </h2>
          <p className="mt-1.5 text-sm font-medium text-slate-500">Knowledge Base Article</p>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 space-y-8 overflow-y-auto px-8 py-6">

          {/* Info Cards Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Created By</p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">{article.created_by_name || "Unknown"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Created At</p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">
                {article.created_at ? new Date(article.created_at).toLocaleString() : "Not recorded"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Related Ticket</p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">{article.related_ticket_number || "None linked"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Branch</p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">{article.branch_name || "Global"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Tags</p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">{article.tags || "None"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Updated At</p>
              <p className="mt-1.5 text-sm font-bold text-slate-900">
                {article.updated_at ? new Date(article.updated_at).toLocaleString() : "Not recorded"}
              </p>
            </div>
          </div>

          {/* Symptoms */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-base font-black text-slate-900">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
              Symptoms
            </h3>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
                {article.symptoms || "No symptoms documented."}
              </p>
            </div>
          </section>

          {/* Resolution */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-base font-black text-slate-900">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Resolution
            </h3>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
                {article.resolution || "No resolution documented."}
              </p>
            </div>
          </section>
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-8 py-4">
          <button
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            Close
          </button>
          {canManage && (
            <>
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                <Edit3 size={16} />
                Edit
              </button>
              <button
                onClick={onDelete}
                className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-700 shadow-sm transition hover:bg-red-100"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleFormModal({ article, tickets, branches = [], isSuperAdmin, user, onClose, onSaved }) {
  const [form, setForm] = useState(article);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(article.kb_id);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveArticle = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        title: form.title.trim(),
        category: form.category.trim() || null,
        tags: form.tags?.trim() || null,
        symptoms: form.symptoms.trim() || null,
        resolution: form.resolution.trim() || null,
        related_ticket_id: form.related_ticket_id
          ? Number(form.related_ticket_id)
          : null,
        branch_id: isSuperAdmin ? Number(form.branch_id) : undefined,
        created_by: user?.user_id || null,
      };

      const res = await fetch(
        isEditing
          ? `${API_BASE}/knowledge-base/${article.kb_id}`
          : `${API_BASE}/knowledge-base`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        }
      );

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to save article.");

      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="astrea-modal-backdrop">
      <div className="astrea-modal-panel max-w-3xl">
        <div className="astrea-modal-header items-start">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              {isEditing ? "Edit KB Article" : "Create KB Article"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Document reusable fixes for future incidents and requests.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={saveArticle} className="astrea-modal-body space-y-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="astrea-field-label">
              Title <span className="astrea-required">*</span>
            </label>
            <input
              required
              value={form.title}
              onChange={(e) => updateForm("title", e.target.value)}
              className="astrea-control"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="astrea-field-label">
                Category
              </label>
              <input
                value={form.category}
                onChange={(e) => updateForm("category", e.target.value)}
                className="astrea-control"
              />
            </div>

            <div>
              <label className="astrea-field-label">
                Tags
              </label>
              <input
                value={form.tags || ""}
                onChange={(e) => updateForm("tags", e.target.value)}
                placeholder="hardware, vpn, windows"
                className="astrea-control"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="astrea-field-label">
                Related Ticket
              </label>
              <TicketSelect
                value={form.related_ticket_id}
                tickets={tickets}
                onChange={(value) => updateForm("related_ticket_id", value)}
              />
            </div>

            {isSuperAdmin && (
              <div>
                <label className="astrea-field-label">
                  Branch
                </label>
                <select
                  value={form.branch_id || ""}
                  onChange={(e) => updateForm("branch_id", e.target.value)}
                  className="astrea-control"
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
          </div>

          <div>
            <label className="astrea-field-label">
              Symptoms
            </label>
            <textarea
              value={form.symptoms}
              onChange={(e) => updateForm("symptoms", e.target.value)}
              rows={5}
              className="astrea-control"
            />
          </div>

          <div>
            <label className="astrea-field-label">
              Resolution
            </label>
            <textarea
              value={form.resolution}
              onChange={(e) => updateForm("resolution", e.target.value)}
              rows={6}
              className="astrea-control"
            />
          </div>

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
              {saving ? "Saving..." : "Save Article"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TicketSelect({ value, tickets, onChange }) {
  const [open, setOpen] = useState(false);
  const selectedTicket = tickets.find((ticket) => String(ticket.id) === String(value));
  const selectedLabel = selectedTicket
    ? formatTicketLabel(selectedTicket)
    : "None";

  const selectTicket = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="astrea-control flex items-center justify-between gap-3 text-left"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => selectTicket("")}
            className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 ${
              !value ? "bg-blue-50 font-bold text-blue-700" : "text-slate-700"
            }`}
          >
            None
          </button>
          {tickets.map((ticket) => {
            const optionValue = String(ticket.id);
            const selected = String(value) === optionValue;

            return (
              <button
                key={ticket.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectTicket(optionValue)}
                className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 ${
                  selected ? "bg-blue-50 font-bold text-blue-700" : "text-slate-700"
                }`}
              >
                {formatTicketLabel(ticket)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTicketLabel(ticket) {
  return `${ticket.ticket_number} - ${ticket.title}`;
}

function ArticleSection({ title, text }) {
  return (
    <section className="astrea-card-soft p-5">
      <h3 className="mb-3 text-base font-black text-slate-900">{title}</h3>
      <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
        {text || `No ${title.toLowerCase()} documented.`}
      </p>
    </section>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="astrea-card-soft p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-slate-900">{value}</p>
    </div>
  );
}

