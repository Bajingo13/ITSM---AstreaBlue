import { useCallback, useEffect, useState } from "react";
import { CheckCircle, ChevronRight, Lock, ShieldCheck } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { API_URL } from "../config/api";
import { getAuthToken } from "../context/AuthService";
import { useAuth } from "../context/AuthContext";
import ConsentPage from "./ConsentPage";

const steps = ["Welcome", "Privacy Notice", "Monitoring Categories", "Digital Signature", "Review", "Confirmation"];

export default function MandatoryOnboarding() {
  const navigate = useNavigate();
  const { user, refreshOnboarding } = useAuth();
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await refreshOnboarding();
      setStatus(data);
      if (data.onboarding_status === "Completed") setStep(6);
      else if (["Consent Submitted", "Blocked", "Revision Required"].includes(data.onboarding_status)) setStep(6);
      else if (data.privacy_notice_viewed_at) setStep((current) => Math.max(current, 3));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [refreshOnboarding]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", load);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  useEffect(() => {
    if (status?.onboarding_status === "Completed" && user?.must_complete_onboarding === false) {
      navigate("/employee/dashboard", { replace: true });
    }
  }, [navigate, status?.onboarding_status, user?.must_complete_onboarding]);

  const acknowledgePrivacy = async () => {
    setError("");
    const response = await fetch(`${API_URL}/api/v1/onboarding/privacy-notice-viewed`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAuthToken()}`, "Content-Type": "application/json" },
    });
    const payload = await response.json();
    if (!response.ok) return setError(payload.message || "Failed to save privacy acknowledgement.");
    await load();
    setStep(3);
  };

  if (!user) return <Navigate to="/login" replace />;
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 font-bold text-white">Preparing secure onboarding...</div>;

  const completed = status?.onboarding_status === "Completed";
  const pending = status?.onboarding_status === "Consent Submitted";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="astrea-page-hero rounded-[28px] border border-white/15 p-7 text-white shadow-[var(--astrea-hero-shadow)]">
          <div className="flex items-center gap-3"><ShieldCheck /><div><p className="text-xs font-black uppercase tracking-[0.25em] text-blue-300">AstreaBlue Employee Onboarding</p><h1 className="text-3xl font-black">Privacy and Endpoint Monitoring Agreement</h1></div></div>
          <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-6">
            {steps.map((label, index) => <div key={label} className={`rounded-xl px-3 py-2 text-xs font-bold ${step >= index + 1 ? "bg-white text-blue-900" : "bg-white/10 text-blue-100"}`}><span className="mr-2">{step > index + 1 ? "✓" : index + 1}</span>{label}</div>)}
          </div>
        </header>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div>}

        {step === 1 && <section className="rounded-3xl bg-white p-8 shadow-sm"><h2 className="text-2xl font-black text-slate-900">Welcome, {user.full_name}</h2><p className="mt-3 max-w-3xl leading-7 text-slate-600">Before using AstreaBlue, you must review the company-device privacy notice and choose which privacy-sensitive monitoring categories you approve. Baseline device registration, inventory, heartbeat, policy synchronization, and endpoint health are operational functions—not optional employee surveillance preferences.</p><button onClick={() => setStep(2)} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800">Continue <ChevronRight size={17}/></button></section>}

        {step === 2 && <section className="rounded-3xl bg-white p-8 shadow-sm"><div className="flex items-center gap-3"><Lock className="text-blue-700"/><h2 className="text-2xl font-black text-slate-900">RA 10173 Privacy Notice</h2></div><div className="mt-5 space-y-4 leading-7 text-slate-600"><p>AstreaBlue processes company-device information for asset protection, security, support, and operational continuity under Republic Act No. 10173 and applicable company policies.</p><p><strong>Baseline functions:</strong> device registration, heartbeat, online/offline status, hardware/software inventory, asset verification, policy synchronization, agent version, and endpoint health.</p><p><strong>Consent-controlled functions:</strong> application/window activity, idle analytics, screenshots, USB activity, browser/domain monitoring, location tracking, productivity analytics, and activity-based alerts.</p><p>Consent alone does not activate a category. Activation requires approved consent, an effective endpoint policy, and an assigned endpoint.</p><p>You may access or correct your personal data and request changes or withdrawal through the governed consent workflow.</p></div><div className="mt-6 flex gap-3"><button onClick={() => setStep(1)} className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600">Back</button><button onClick={acknowledgePrivacy} className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800">I have read the privacy notice</button></div></section>}

        {step >= 3 && step <= 5 && <section><ConsentPage /></section>}

        {step === 6 && <section className={`rounded-3xl border p-8 text-center shadow-sm ${completed ? "border-emerald-200 bg-emerald-50" : pending ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}><CheckCircle className={`mx-auto ${completed ? "text-emerald-600" : "text-blue-600"}`} size={48}/><h2 className="mt-4 text-2xl font-black text-slate-900">{completed ? "Onboarding complete" : pending ? "Consent awaiting approval" : status?.onboarding_status || "Onboarding action required"}</h2><p className="mx-auto mt-3 max-w-2xl text-slate-600">{completed ? "Your approved consent document is stored privately and your account may now enter AstreaBlue. Asset assignment and agent installation can proceed separately." : pending ? "An Admin or SuperAdmin must approve your submitted consent. Privacy-sensitive monitoring remains disabled while you wait." : "Review the administrator’s reason and update your consent submission."}</p>{completed && <button onClick={() => navigate("/employee/dashboard", { replace: true })} className="mt-6 rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white hover:bg-emerald-800">Enter AstreaBlue</button>}<button onClick={load} className="ml-3 mt-6 rounded-xl border border-slate-300 bg-white px-6 py-3 font-bold text-slate-700">Refresh status</button></section>}
      </div>
    </main>
  );
}
