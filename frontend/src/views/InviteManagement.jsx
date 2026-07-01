import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../config/api";
import { useAuth } from "../context/AuthContext";
import { Mail, RefreshCw, XCircle, CheckCircle, Link as LinkIcon, ExternalLink } from "lucide-react";

const API_BASE = `${API_URL}/api/v1`;

export default function InviteManagement() {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role;
  const isSuperAdmin = activeRole === "SuperAdmin";
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [latestInviteLink, setLatestInviteLink] = useState("");

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(
        `${API_BASE}/invites?current_role=${activeRole}&current_branch_id=${user?.branch_id}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load invitations.");
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load invitations.");
    } finally {
      setLoading(false);
    }
  }, [activeRole, user?.branch_id]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleAction = async (invite, action) => {
    if (!window.confirm(`Are you sure you want to ${action} this invitation?`)) return;
    
    try {
      setActionLoading(invite.user_id);
      let url = `${API_BASE}/invites/${invite.user_id}/${action}`;
      let method = action === "resend" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_role: activeRole,
          current_branch_id: user?.branch_id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} invite`);
      
      if (action === "resend" && data.invite_link) {
        setLatestInviteLink(data.invite_link);
      }
      alert(data.message || data.warning || `Invite ${action}ed successfully.`);
      fetchInvites();
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (link) => {
    if (!link) return;
    navigator.clipboard.writeText(link);
    alert("Invite link copied to clipboard!");
  };

  if (!["SuperAdmin", "Admin"].includes(activeRole)) {
    return <div className="p-6 text-center font-bold text-slate-500">You do not have permission to view invitations.</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-red-700 font-bold text-sm">
          {error}
        </div>
      )}

      {latestInviteLink && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-black">New invite link</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1 break-all font-semibold">{latestInviteLink}</span>
            <button
              onClick={() => copyToClipboard(latestInviteLink)}
              className="shrink-0 rounded-lg bg-white px-3 py-2 font-bold text-blue-700"
            >
              <LinkIcon size={14} className="mr-1 inline" /> Copy Invite Link
            </button>
          </div>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">Active & Past Invitations</h2>
            <p className="text-sm text-slate-500">
              Manage employee onboarding, resend links, and revoke access.
            </p>
          </div>
          <button 
            onClick={fetchInvites}
            className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-700 hover:bg-slate-200"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Employee Name</th>
                <th className="px-4 py-3">Personal Email</th>
                <th className="px-4 py-3">Role & Branch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expiration</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading invitations...
                  </td>
                </tr>
              ) : invites.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    No invitations found.
                  </td>
                </tr>
              ) : (
                invites.map((item) => (
                  <tr key={item.user_id} className="border-t border-slate-100">
                    <td className="px-4 py-4 font-bold text-slate-900">{item.full_name}</td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {item.personal_email}
                      {item.company_email && <div className="text-xs text-slate-400 font-normal">{item.company_email}</div>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm font-bold text-blue-700">{item.role_name}</div>
                      <div className="text-xs font-semibold text-slate-500">{item.branch_name || "Global"}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          item.invite_status === "Pending"
                            ? "bg-blue-50 text-blue-700"
                            : item.invite_status === "Accepted"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.invite_status === "Expired"
                            ? "bg-orange-50 text-orange-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {item.invite_status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {item.invite_status === "Pending" && item.invite_expires_at ? (
                        new Date(item.invite_expires_at).toLocaleString()
                      ) : "-"}
                    </td>
                    <td className="px-4 py-4 text-right space-x-2">
                      {["Pending", "Expired"].includes(item.invite_status) && (
                        <>
                          <button
                            onClick={() => copyToClipboard(item.invite_link)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                            title="Copy Invite Link"
                          >
                            <LinkIcon size={14} /> Copy
                          </button>
                          <button
                            onClick={() => handleAction(item, "resend")}
                            disabled={actionLoading === item.user_id}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                          >
                            <Mail size={14} /> Resend
                          </button>
                          {item.invite_status === "Pending" && <button
                            onClick={() => handleAction(item, "revoke")}
                            disabled={actionLoading === item.user_id}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            <XCircle size={14} /> Revoke
                          </button>}
                        </>
                      )}
                      {item.invite_status === "Revoked" && (
                        <button
                          onClick={() => handleAction(item, "reactivate")}
                          disabled={actionLoading === item.user_id}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <RefreshCw size={14} /> Reactivate
                        </button>
                      )}
                      {item.invite_status === "Accepted" && (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-emerald-600">
                          <CheckCircle size={14} /> Completed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
