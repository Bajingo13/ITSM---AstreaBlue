import { useCallback, useEffect, useState } from "react";
import { Check, Clipboard, KeyRound, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { authHeaders } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1/laptop-monitoring`;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || "Endpoint administration request failed.");
  }
  return payload.data ?? payload;
}

export default function EndpointAgentAdministration() {
  const { role } = useAuth();
  const isSuperAdmin = String(role || "").toLowerCase().replace(/[\s_-]/g, "") === "superadmin";
  const [codes, setCodes] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ intended_hostname: "", expires_in_minutes: "15", branch_id: "" });
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCodes = useCallback(async () => {
    try {
      setError("");
      const data = await request("/enrollment-codes");
      setCodes(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCodes(); }, [loadCodes]);
  useEffect(() => {
    if (!isSuperAdmin) return;
    fetch(`${API_URL}/api/v1/branches`, { headers: authHeaders() })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "Could not load branches.");
        setBranches(Array.isArray(payload) ? payload : (payload.data || []));
      })
      .catch((requestError) => setError(requestError.message));
  }, [isSuperAdmin]);

  const createCode = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    setIssued(null);
    try {
      const data = await request("/enrollment-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intended_hostname: form.intended_hostname.trim() || undefined,
          expires_in_minutes: Number(form.expires_in_minutes),
          branch_id: form.branch_id ? Number(form.branch_id) : undefined,
        }),
      });
      setIssued(data);
      setCopied(false);
      setNotice("Enrollment code created. Copy it now; the full code will not be shown again.");
      await loadCodes();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = async () => {
    if (!issued?.enrollment_code) return;
    try {
      await navigator.clipboard.writeText(issued.enrollment_code);
      setCopied(true);
    } catch {
      setError("Clipboard access was blocked. Select and copy the code manually.");
    }
  };

  const revokeCode = async (id) => {
    try {
      setError("");
      await request(`/enrollment-codes/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Revoked from Endpoint Administration." }),
      });
      setNotice("Enrollment code revoked.");
      await loadCodes();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHero eyebrow="Endpoint Management" title="Agent Administration" subtitle="Securely enroll Windows laptops with short-lived, single-use codes and a unique credential for every device." />

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700">{error}</div>}
      {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-800">{notice}</div>}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <form onSubmit={createCode} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700"><KeyRound size={22} /></div>
            <div><h2 className="text-lg font-black text-slate-900">Create enrollment code</h2><p className="mt-1 text-sm text-slate-500">Use one code on one laptop. It expires automatically and cannot be reused.</p></div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold text-slate-700">Laptop hostname (optional)
              <input value={form.intended_hostname} onChange={(event) => setForm((current) => ({ ...current, intended_hostname: event.target.value }))} placeholder="Example: LAPTOP-ACCT-01" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 outline-none transition hover:border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </label>
            <label className="text-sm font-bold text-slate-700">Expires in
              <select value={form.expires_in_minutes} onChange={(event) => setForm((current) => ({ ...current, expires_in_minutes: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none transition hover:border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="1440">24 hours</option>
              </select>
            </label>
            {isSuperAdmin && <label className="text-sm font-bold text-slate-700 sm:col-span-2">Branch scope
              <select value={form.branch_id} onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none transition hover:border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                <option value="">All branches</option>{branches.map((branch) => <option key={branch.branch_id} value={branch.branch_id}>{branch.branch_name || branch.name}</option>)}
              </select>
            </label>}
          </div>
          <button disabled={submitting} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-md disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"><KeyRound size={17} />{submitting ? "Creating…" : "Create one-time code"}</button>
        </form>

        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6">
          <h2 className="flex items-center gap-2 font-black text-blue-950"><ShieldCheck size={21} />Safe enrollment flow</h2>
          <ol className="mt-4 space-y-3 text-sm font-semibold text-blue-900">
            <li>1. Create a short-lived code for the target laptop.</li><li>2. Enter it once during agent installation.</li><li>3. The backend consumes the code and issues that laptop its own credential.</li><li>4. Future heartbeats use the device credential; the enrollment code stops working.</li>
          </ol>
          <Link to="/endpoint-policies" className="mt-5 inline-flex rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-black text-blue-700 transition hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-sm">Manage endpoint policies</Link>
        </div>
      </section>

      {issued?.enrollment_code && <section className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-widest text-amber-700">Shown once</p>
        <h2 className="mt-1 text-lg font-black text-amber-950">Copy this enrollment code now</h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row"><code className="min-w-0 flex-1 select-all overflow-x-auto rounded-xl border border-amber-200 bg-white px-4 py-3 font-mono text-sm font-bold text-slate-900">{issued.enrollment_code}</code><button type="button" onClick={copyCode} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700">{copied ? <Check size={17} /> : <Clipboard size={17} />}{copied ? "Copied" : "Copy code"}</button></div>
        <p className="mt-3 text-sm font-semibold text-amber-800">Expires {formatDate(issued.expires_at)}. Closing or refreshing this page permanently hides the full code.</p>
      </section>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-6"><div><h2 className="text-lg font-black text-slate-900">Enrollment code history</h2><p className="mt-1 text-sm text-slate-500">Only a safe prefix is retained for identification.</p></div><button onClick={loadCodes} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"><RefreshCw size={16} />Refresh</button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Code", "Hostname", "Branch", "Status", "Expires", "Created by", "Action"].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">
          {loading ? <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">Loading enrollment codes…</td></tr> : codes.length === 0 ? <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No enrollment codes have been created.</td></tr> : codes.map((code) => <tr key={code.enrollment_code_id} className="transition hover:bg-blue-50/50"><td className="px-5 py-4 font-mono font-bold text-slate-800">{code.code_prefix}…</td><td className="px-5 py-4">{code.intended_hostname || "Any"}</td><td className="px-5 py-4">{code.branch_name || "All branches"}</td><td className="px-5 py-4"><StatusBadge status={code.status} /></td><td className="px-5 py-4 text-slate-600">{formatDate(code.expires_at)}</td><td className="px-5 py-4 text-slate-600">{code.created_by_name || "Administrator"}</td><td className="px-5 py-4">{code.status === "Active" ? <button onClick={() => revokeCode(code.enrollment_code_id)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-black text-rose-700 transition hover:bg-rose-50"><XCircle size={14} />Revoke</button> : <span className="text-xs text-slate-400">—</span>}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = status === "Active" ? "bg-emerald-100 text-emerald-800" : status === "Used" ? "bg-blue-100 text-blue-800" : status === "Revoked" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${styles}`}>{status}</span>;
}
