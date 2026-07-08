import { API_URL } from "../config/api";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE = `${API_URL}/api/v1`;

export default function InviteRegistration() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function fetchInvite() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/invites/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invite not found.");
        setInvite(data.invite || data);
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

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/invites/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm_password: confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete invite.");
      setInvite(null);
      setSuccess(data.message || "Account created successfully.");
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
        ) : success ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              {success}
            </div>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="w-full rounded-xl bg-blue-700 py-3.5 font-bold text-white shadow-lg shadow-blue-700/30 hover:bg-blue-800"
            >
              Go to Login
            </button>
          </div>
        ) : (
          <form onSubmit={acceptInvite} className="mt-6 space-y-5">
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}

            {invite && (
              <div className="rounded-2xl bg-slate-50 p-5">
                <p className="text-sm font-bold text-slate-500">
                  {invite.personal_email}
                </p>
                <p className="mt-1 text-xl font-black text-slate-900">
                  {invite.full_name || "Invited User"}
                </p>
                <p className="mt-2 text-sm font-semibold text-blue-700">
                  Role: {invite.role || invite.role_name}
                </p>
                <p className="text-sm font-semibold text-slate-500">
                  Branch: {invite.branch || invite.branch_name || "Global"}
                </p>
                {invite.company_email && (
                  <p className="text-sm font-semibold text-slate-500">
                    Company Email: {invite.company_email}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Set Password <span className="astrea-required">*</span>
              </label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">
                Confirm Password <span className="astrea-required">*</span>
              </label>
              <input
                required
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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

