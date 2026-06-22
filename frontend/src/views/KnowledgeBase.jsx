import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Edit3,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const API_BASE = "http://localhost:5001/api/v1";

const emptyArticle = {
  title: "",
  category: "",
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
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [articleForm, setArticleForm] = useState(null);

  const canManage = ["Admin", "Technician"].includes(role || user?.role_name);

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/knowledge-base`);
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
      const res = await fetch(`${API_BASE}/tickets`);
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch tickets for KB failed:", err);
    }
  }, [canManage]);

  useEffect(() => {
    fetchArticles();
    fetchTickets();
  }, [fetchArticles, fetchTickets]);

  useEffect(() => {
    if (!canManage || !location.state?.kbPrefill) return;

    setArticleForm({
      ...emptyArticle,
      ...location.state.kbPrefill,
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
        article.symptoms?.toLowerCase().includes(text) ||
        article.resolution?.toLowerCase().includes(text) ||
        article.related_ticket_number?.toLowerCase().includes(text);

      return matchesCategory && matchesText;
    });
  }, [articles, category, query]);

  const deleteArticle = async (article) => {
    if (!window.confirm(`Delete "${article.title}"?`)) return;

    try {
      const res = await fetch(`${API_BASE}/knowledge-base/${article.kb_id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete article");

      setSelectedArticle(null);
      fetchArticles();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-black">Knowledge Base</h1>
          <p className="mt-2 text-blue-100">
            Search known issues, fixes, root causes, and reusable resolutions.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setArticleForm({ ...emptyArticle })}
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
          >
            <Plus size={18} />
            Create Article
          </button>
        )}
      </section>

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
              symptoms: selectedArticle.symptoms || "",
              resolution: selectedArticle.resolution || "",
              related_ticket_id: selectedArticle.related_ticket_id
                ? String(selectedArticle.related_ticket_id)
                : "",
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
          user={user}
          onClose={() => setArticleForm(null)}
          onSaved={() => {
            setArticleForm(null);
            fetchArticles();
          }}
        />
      )}
    </div>
  );
}

function ArticleDrawer({ article, canManage, onClose, onEdit, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-white px-7 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-blue-600">
                {article.category || "General"}
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">
                {article.title}
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

        <div className="flex-1 space-y-6 overflow-y-auto p-7">
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoTile label="Created By" value={article.created_by_name || "Unknown"} />
            <InfoTile
              label="Created At"
              value={
                article.created_at
                  ? new Date(article.created_at).toLocaleString()
                  : "Not recorded"
              }
            />
            <InfoTile
              label="Related Ticket"
              value={article.related_ticket_number || "None linked"}
            />
            <InfoTile
              label="Updated At"
              value={
                article.updated_at
                  ? new Date(article.updated_at).toLocaleString()
                  : "Not recorded"
              }
            />
          </section>

          <ArticleSection title="Symptoms" text={article.symptoms} />
          <ArticleSection title="Resolution" text={article.resolution} />
        </div>

        <div className="border-t border-slate-200 bg-white/95 px-7 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
            {canManage && (
              <>
                <button
                  onClick={onEdit}
                  className="flex items-center gap-2 rounded-xl border border-blue-200 px-5 py-3 font-bold text-blue-700 hover:bg-blue-50"
                >
                  <Edit3 size={17} />
                  Edit
                </button>
                <button
                  onClick={onDelete}
                  className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700"
                >
                  <Trash2 size={17} />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArticleFormModal({ article, tickets, user, onClose, onSaved }) {
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
        symptoms: form.symptoms.trim() || null,
        resolution: form.resolution.trim() || null,
        related_ticket_id: form.related_ticket_id
          ? Number(form.related_ticket_id)
          : null,
        created_by: user?.user_id || null,
      };

      const res = await fetch(
        isEditing
          ? `${API_BASE}/knowledge-base/${article.kb_id}`
          : `${API_BASE}/knowledge-base`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
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

        <form onSubmit={saveArticle} className="space-y-5 px-7 py-6">
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
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Category
              </label>
              <input
                value={form.category}
                onChange={(e) => updateForm("category", e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Related Ticket
              </label>
              <select
                value={form.related_ticket_id}
                onChange={(e) => updateForm("related_ticket_id", e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              >
                <option value="">None</option>
                {tickets.map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>
                    {ticket.ticket_number} - {ticket.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Symptoms
            </label>
            <textarea
              value={form.symptoms}
              onChange={(e) => updateForm("symptoms", e.target.value)}
              rows={5}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Resolution
            </label>
            <textarea
              value={form.resolution}
              onChange={(e) => updateForm("resolution", e.target.value)}
              rows={6}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
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
              {saving ? "Saving..." : "Save Article"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ArticleSection({ title, text }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 font-black text-slate-900">{title}</h3>
      <p className="whitespace-pre-line text-sm leading-7 text-slate-600">
        {text || `No ${title.toLowerCase()} documented.`}
      </p>
    </section>
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
