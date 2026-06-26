import React, { useState } from "react";
import { useAuth } from "./context/AuthContext";
import { useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await login(email, password, rememberMe);

      const role = String(user.role_name || user.role || "").toLowerCase();

      if (role === "superadmin") {
        navigate("/superadmin/dashboard");
      } else if (role === "admin") {
        navigate("/admin/dashboard");
      } else if (role === "technician") {
        navigate("/technician/dashboard");
      } else if (role === "employee") {
        navigate("/employee/dashboard");
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err.message || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="astrea-login relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F5F9FF] p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(47,109,255,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(85,191,255,0.18),transparent_42%)]" />

      <div className="relative flex min-h-[560px] w-full max-w-5xl overflow-hidden rounded-3xl border border-[#E4ECF7] bg-white shadow-[0_24px_70px_rgba(30,80,160,0.14)]">
        <div className="astrea-login-panel hidden w-1/2 flex-col justify-center bg-[linear-gradient(160deg,#071A3A_0%,#123B8A_45%,#2F6DFF_100%)] p-14 text-white md:flex">
          <img
            src="/astrea-blue-logo.png"
            alt="AstreaBlue Logo"
            className="mb-10 w-72 max-w-full rounded-[22px] border border-white/25 bg-white/95 p-4 object-contain shadow-xl shadow-black/20 backdrop-blur-sm"
          />

          <h1 className="mb-4 text-5xl font-extrabold tracking-tight">
            Hey, Hello!
          </h1>

          <p className="mb-4 text-lg font-semibold text-white/90">
            Welcome to AstreaBlue ITSM.
          </p>

          <p className="max-w-sm text-sm leading-7 text-white/80">
            Manage incidents, service requests, assets, SLA monitoring, and IT
            operations through a centralized platform.
          </p>

          <div className="mt-10 grid gap-3 text-sm text-white/90">
            {[
              "Incident & Service Request Management",
              "Asset Lifecycle Monitoring",
              "SLA Tracking & Escalation",
              "Secure Role-Based Access",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5">
                <CheckCircle size={17} className="shrink-0 text-[#55BFFF]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex w-full flex-col justify-center bg-white px-8 py-12 md:w-1/2 md:px-14">
          <div className="mb-8 text-center md:text-left">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue Logo"
              className="mx-auto mb-7 w-56 object-contain md:hidden"
            />

            <h2 className="text-3xl font-extrabold text-slate-900">
              Welcome!
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Sign in using your company account.
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-[#D9E5F5] bg-[#F8FBFF] px-4 py-3 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Password
              </label>

              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#D9E5F5] bg-[#F8FBFF] px-4 py-3 pr-16 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-blue-700 hover:text-blue-900"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                />
                Remember me
              </label>

              <button
                type="button"
                className="font-semibold text-blue-700 hover:text-blue-900"
              >
                Forgot Password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[linear-gradient(135deg,#2F6DFF_0%,#174FD6_100%)] py-3.5 font-bold text-white shadow-lg shadow-blue-700/25 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-700/30 active:translate-y-0 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            Copyright 2026 AstreaBlue. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
