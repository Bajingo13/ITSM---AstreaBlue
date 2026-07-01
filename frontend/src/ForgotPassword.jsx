import React, { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { forgotPassword } from "./context/AuthService";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await forgotPassword(email);
      setMessage(res.message || "Reset link sent successfully.");
    } catch (err) {
      setError(err.message || "Failed to process request.");
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
          <h1 className="mb-4 text-5xl font-extrabold tracking-tight">Forgot Password?</h1>
          <p className="mb-4 text-lg font-semibold text-[#1E2A44]">Don't worry, it happens.</p>
          <p className="max-w-sm text-sm leading-7 text-[#50627A]">
            Enter your email address and we'll send you a link to reset your password.
          </p>
          <div className="mt-10 grid gap-3 text-sm font-semibold text-[#1E2A44]">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#2563EB] shadow-sm">
                <CheckCircle size={17} />
              </span>
              <span>Secure Password Reset</span>
            </div>
          </div>
        </div>

        <div className="astrea-login-form-panel flex w-full flex-col justify-center px-8 py-12 md:w-1/2 md:px-14">
          <div className="mb-8 text-center md:text-left">
            <img
              src="/astrea-blue-logo.png"
              alt="AstreaBlue Logo"
              className="mx-auto mb-7 w-56 object-contain md:hidden"
            />
            <h2 className="text-3xl font-extrabold text-slate-900">Reset Password</h2>
            <p className="mt-2 text-sm text-slate-500">We'll send a reset link to your inbox.</p>
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Email Address</label>
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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[linear-gradient(135deg,#155DFB_0%,#2563EB_70%,#38BDF8_100%)] py-3.5 font-bold text-white shadow-[0_14px_28px_rgba(37,99,235,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(37,99,235,0.34)] active:translate-y-0 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>

            <div className="text-center mt-4">
              <Link to="/login" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
                Back to Login
              </Link>
            </div>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">Copyright 2026 AstreaBlue. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
