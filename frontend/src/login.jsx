import React, { useState } from "react";
import { useAuth } from "./context/AuthContext";
import { useNavigate, Link } from "react-router-dom";
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

      if (role === "employee" && user.must_complete_onboarding) {
        navigate("/onboarding", { replace: true });
        return;
      }

      if (role === "superadmin") {
        navigate("/superadmin/dashboard");
      } else if (role === "admin") {
        navigate("/admin/dashboard");
      } else if (role === "hr") {
        navigate("/hr/lifecycle");
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
    <div className="astrea-login relative flex min-h-screen items-center justify-center overflow-hidden p-6">

      <div className="astrea-login-card relative flex min-h-[560px] w-full max-w-5xl overflow-hidden rounded-3xl bg-white">
        <div className="astrea-login-panel hidden w-1/2 flex-col justify-center bg-[linear-gradient(135deg,#FFFFFF_0%,#EAF4FF_54%,#CFE3FF_100%)] p-14 text-[#07172A] md:flex">
          <img
            src="/astrea-blue-logo.png"
            alt="AstreaBlue Logo"
            className="mb-10 w-72 max-w-full rounded-2xl bg-white/95 p-3 object-contain"
          />

          <h1 className="mb-4 text-5xl font-extrabold tracking-tight">
            Hey, Hello!
          </h1>

          <p className="mb-4 text-lg font-semibold text-[#1E2A44]">
            Welcome to AstreaBlue ITSM.
          </p>

          <p className="max-w-sm text-sm leading-7 text-[#50627A]">
            Manage incidents, service requests, assets, SLA monitoring, and IT
            operations through a centralized platform.
          </p>

          <div className="mt-10 grid gap-3 text-sm font-semibold text-[#1E2A44]">
            {[
              "Incident & Service Request Management",
              "Asset Lifecycle Monitoring",
              "SLA Tracking & Escalation",
              "Secure Role-Based Access",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#2563EB] shadow-sm">
                  <CheckCircle size={17} />
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="astrea-login-form-panel flex w-full flex-col justify-center px-8 py-12 md:w-1/2 md:px-14">
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
                Email Address <span className="astrea-required">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                required
                autoComplete="email"
                className="w-full rounded-xl border border-[#D8E5F6] bg-[#F7FAFF] px-4 py-3 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Password <span className="astrea-required">*</span>
              </label>

              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-[#D8E5F6] bg-[#F7FAFF] px-4 py-3 pr-16 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
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

              <Link
                to="/forgot-password"
                className="font-semibold text-blue-700 hover:text-blue-900"
              >
                Forgot Password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[linear-gradient(135deg,#155DFB_0%,#2563EB_70%,#38BDF8_100%)] py-3.5 font-bold text-white shadow-[0_14px_28px_rgba(37,99,235,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(37,99,235,0.34)] active:translate-y-0 disabled:cursor-not-allowed disabled:bg-blue-400"
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
