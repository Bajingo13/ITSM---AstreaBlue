import { API_URL } from "../config/api";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE = `${API_URL}/api/v1`;

export default function InviteRegistration() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchInvite() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/invites/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invite not found.");
        setInvite(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchInvite();
  }, [token]);

  const acceptInvite = async (e) => {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("Password is required.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/invites/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept invite.");
      navigate("/login");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-400 via-blue-700 to-slate-950 p-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-2xl">
        <img
          src="/astrea-blue-logo.png"
          alt="AstreaBlue"
          className="mx-auto mb-6 h-14 object-contain"
        />
        <h1 className="text-center text-3xl font-black text-slate-900">
          Complete Your Account
        </h1>

        {loading ? (
          <p className="mt-6 text-center font-bold text-slate-500">
            Loading invite...
          </p>
        ) : (
          <form onSubmit={acceptInvite} className="mt-6 space-y-5">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}

            {invite && (
              <div className="rounded-2xl bg-slate-50 p-5">
                <p className="text-sm font-bold text-slate-500">{invite.email}</p>
                <p className="mt-1 text-xl font-black text-slate-900">
                  {invite.full_name || "Invited User"}
                </p>
                <p className="mt-2 text-sm font-semibold text-blue-700">
                  Role: {invite.role_name}
                </p>
                <p className="text-sm font-semibold text-slate-500">
                  Branch: {invite.branch_name || "Global"}
                </p>
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Set Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !invite}
              className="w-full rounded-xl bg-blue-700 py-3.5 font-bold text-white shadow-lg shadow-blue-700/30 hover:bg-blue-800 disabled:opacity-60"
            >
              {saving ? "Creating Account..." : "Create Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

