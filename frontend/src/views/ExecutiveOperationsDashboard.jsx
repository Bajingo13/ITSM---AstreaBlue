import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleGauge,
  Database,
  GitBranch,
  HardDrive,
  HeartPulse,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";
import PageHero from "../components/layout/PageHero";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const endpoint = `${API_URL}/api/v1/analytics/summary`;
const executiveCharts = () => import("../components/ExecutiveAnalyticsCharts");
const IncidentAreaChart = lazy(() => executiveCharts().then((module) => ({ default: module.IncidentAreaChart })));
const CategoryDonut = lazy(() => executiveCharts().then((module) => ({ default: module.CategoryDonut })));
const HealthBarChart = lazy(() => executiveCharts().then((module) => ({ default: module.HealthBarChart })));
const IncidentHeatmap = lazy(() => executiveCharts().then((module) => ({ default: module.IncidentHeatmap })));

const surfaceClass = "astrea-premium-card rounded-[24px] border border-blue-100 bg-white p-5 shadow-[0_12px_35px_rgba(30,64,175,0.08)]";

function Loading() {
  return <div className="grid animate-pulse gap-4 md:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-36 rounded-3xl bg-slate-100" />)}</div>;
}

function KpiCard({ icon: Icon, label, value, detail, tone, delay = 0 }) {
  return (
    <section className={`${surfaceClass} astrea-dashboard-enter group`} style={{ animationDelay: `${delay}ms` }}>
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}><Icon size={20} /></div>
        <ArrowUpRight size={17} className="text-slate-300 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-blue-600" />
      </div>
      <p className="relative z-10 mt-5 text-3xl font-black tracking-tight text-slate-950">{value ?? "-"}</p>
      <p className="relative z-10 mt-1 text-sm font-black text-slate-700">{label}</p>
      <p className="relative z-10 mt-1 text-[11px] font-semibold text-slate-400">{detail}</p>
    </section>
  );
}

function ChartCard({ title, subtitle, className = "", children }) {
  return (
    <section className={`${surfaceClass} ${className}`}>
      <div className="relative z-10">
        <h2 className="font-black text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs font-semibold text-slate-400">{subtitle}</p>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

export default function ExecutiveOperationsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(180);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeModule, setActiveModule] = useState("Service Desk");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}?days=${days}`, { headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to load enterprise analytics.");
      setData({
        ...body.data,
        replacements: body.data?.replacements || {
          active_requests: 0,
          awaiting_approval: 0,
          reserved_assets: 0,
          issued_requests: 0,
          completed_requests: 0,
          repair_recommended: 0,
          trend: [],
          recent_activity: [],
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  const sections = useMemo(() => data ? [
    { icon: Ticket, title: "Service Desk", subtitle: "Incident operations", path: "/analytics/service-desk", accent: "from-blue-500 to-cyan-400", metrics: [["Open Incidents", data.service_desk.open_incidents], ["Resolved Today", data.service_desk.resolved_today], ["Critical", data.service_desk.critical_incidents], ["Avg Resolution", `${data.service_desk.avg_resolution_hours}h`], ["SLA Compliance", `${data.service_desk.sla_compliance_pct}%`]] },
    { icon: Database, title: "Problem Management", subtitle: "Root cause intelligence", path: "/analytics/problems", accent: "from-violet-500 to-blue-500", metrics: [["Recurring", data.problems.recurring_problems], ["Known Errors", data.problems.known_errors], ["Root Causes", data.problems.root_cause_categories.length], ["Top Category", data.problems.most_frequent_category || "None"]] },
    { icon: HardDrive, title: "Asset Management", subtitle: "Lifecycle and financial health", path: "/analytics/assets", accent: "from-cyan-500 to-blue-500", metrics: [["Total Assets", data.assets.total_assets], ["Assigned", data.assets.assigned_assets], ["Available", data.assets.available_assets], ["Warranty Expiring", data.assets.warranty_expiring], ["Asset Health", `${data.assets.health_score}%`]] },
    { icon: Monitor, title: "Endpoint Management", subtitle: "Device health and policies", path: "/analytics/endpoints", accent: "from-sky-500 to-indigo-500", metrics: [["Online", data.endpoints.online_devices], ["Offline", data.endpoints.offline_devices], ["Critical Alerts", data.endpoints.critical_alerts], ["Policy Compliance", `${data.endpoints.policy_compliance_pct}%`], ["Awaiting Consent", data.endpoints.awaiting_consent]] },
    { icon: CheckCircle2, title: "SLA", subtitle: "Service commitment performance", path: "/analytics/sla", accent: "from-emerald-500 to-cyan-500", metrics: [["SLA Met", data.sla.met], ["SLA Violated", data.sla.violated], ["Avg Response", `${data.sla.avg_response_minutes}m`], ["Avg Resolution", `${data.sla.avg_resolution_hours}h`]] },
    { icon: ShieldCheck, title: "Compliance", subtitle: "Consent and policy posture", path: "/analytics/compliance", accent: "from-indigo-500 to-violet-500", metrics: [["RA10173 Consent", `${data.compliance.consent_pct}%`], ["Policy Compliance", `${data.compliance.policy_compliance_pct}%`], ["Pending", data.compliance.pending_consents], ["Expired", data.compliance.expired_consents]] },
    { icon: Users, title: "Resources", subtitle: "Technician workload", path: "/analytics/resources", accent: "from-blue-500 to-indigo-500", metrics: [["Technicians", data.resources.technicians], ["Assignments", data.resources.open_assignments], ["Average Queue", data.resources.average_queue], ["Capacity", `${data.resources.capacity_pct}%`]] },
    { icon: GitBranch, title: "Replacement Management", subtitle: "Laptop assessment, approval, and controlled issuance", path: "/analytics/replacements", accent: "from-violet-500 to-cyan-500", metrics: [["Active", data.replacements.active_requests], ["Awaiting Approval", data.replacements.awaiting_approval], ["Assets Reserved", data.replacements.reserved_assets], ["Issued", data.replacements.issued_requests], ["Completed", data.replacements.completed_requests]] },
    { icon: BookOpen, title: "Knowledge Base", subtitle: "Operational knowledge", path: "/knowledge-base", accent: "from-cyan-500 to-teal-500", metrics: [["Published", data.knowledge.published_articles], ["Used", data.knowledge.articles_used], ["Suggested", data.knowledge.suggested_articles], ["Search Trends", data.knowledge.search_trends.length ? "Available" : "No data"]] },
    { icon: BarChart3, title: "Projects", subtitle: "IT portfolio delivery", path: "/analytics/projects", accent: "from-blue-600 to-violet-500", metrics: [["Current", data.projects.current_projects], ["On Track", data.projects.on_track], ["At Risk", data.projects.at_risk], ["Delayed", data.projects.delayed]] },
  ] : [], [data]);

  const selected = sections.find((section) => section.title === activeModule) || sections[0];
  const health = data ? [
    { label: "SLA", value: data.service_desk.sla_compliance_pct },
    { label: "Assets", value: data.assets.health_score },
    { label: "Endpoints", value: data.endpoints.endpoint_health_pct },
    { label: "Consent", value: data.compliance.consent_pct },
    { label: "Replacements", value: data.replacements.active_requests ? Math.round((data.replacements.completed_requests / (data.replacements.active_requests + data.replacements.completed_requests)) * 100) : 100 },
  ] : [];

  const kpis = data ? [
    { icon: Ticket, label: "Open Incidents", value: data.service_desk.open_incidents, detail: `${data.service_desk.resolved_today} resolved today`, tone: "bg-blue-50 text-blue-700" },
    { icon: CircleGauge, label: "SLA Compliance", value: `${data.service_desk.sla_compliance_pct}%`, detail: `${data.sla.violated} currently violated`, tone: "bg-emerald-50 text-emerald-700" },
    { icon: HardDrive, label: "Managed Assets", value: data.assets.total_assets, detail: `${data.assets.health_score}% fleet health`, tone: "bg-cyan-50 text-cyan-700" },
    { icon: GitBranch, label: "Active Replacements", value: data.replacements.active_requests, detail: `${data.replacements.awaiting_approval} awaiting approval`, tone: "bg-violet-50 text-violet-700" },
    { icon: HeartPulse, label: "Endpoint Health", value: `${data.endpoints.endpoint_health_pct}%`, detail: `${data.endpoints.offline_devices} devices offline`, tone: "bg-indigo-50 text-indigo-700" },
  ] : [];

  return (
    <div className="astrea-module-page space-y-6">
      <PageHero eyebrow="Reporting & Analytics" title="Executive Operations Dashboard" subtitle="A unified command center for service delivery, assets, endpoints, governance, and replacement operations." />

      <section className="astrea-dashboard-enter flex flex-col gap-3 rounded-3xl border border-blue-100 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 px-2"><Activity className="text-blue-600" size={19} /><div><p className="text-sm font-black text-slate-800">Live enterprise overview</p><p className="text-xs font-semibold text-slate-400">Updated from operational data sources</p></div></div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Dashboard date range" value={days} onChange={(event) => setDays(Number(event.target.value))} className="astrea-control min-w-36">
            <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last year</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} /> Auto refresh</label>
          <button onClick={load} className="astrea-button astrea-button-primary"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</button>
        </div>
      </section>

      {loading ? <Loading /> : error ? (
        <section className={`${surfaceClass} text-center`}><AlertCircle className="mx-auto text-red-500" /><p className="mt-3 font-bold text-slate-800">{error}</p><button onClick={load} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">Retry</button></section>
      ) : <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{kpis.map((kpi, index) => <KpiCard key={kpi.label} {...kpi} delay={index * 65} />)}</div>

        <section className="astrea-dashboard-enter relative overflow-hidden rounded-[30px] border border-blue-900/20 bg-gradient-to-br from-[#07162f] via-[#0d2f66] to-[#155eaa] p-4 shadow-[0_28px_70px_rgba(15,52,112,0.28)] lg:p-6">
          <div className="astrea-dashboard-glow absolute -right-20 -top-28 h-72 w-72 rounded-full bg-cyan-400/25 blur-3xl" />
          <div className="relative z-10 grid gap-4 xl:grid-cols-[300px_1fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-950/35 p-3 backdrop-blur-xl">
              <div className="px-3 pb-3 pt-2"><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Operations Center</p><p className="mt-1 text-sm font-semibold text-blue-100/70">Select a module to inspect</p></div>
              <div className="astrea-dark-scrollbar max-h-[470px] space-y-1 overflow-y-auto pr-2">{sections.map((section) => {
                const Icon = section.icon; const active = section.title === selected?.title;
                return <button key={section.title} onClick={() => setActiveModule(section.title)} className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition duration-300 ${active ? "bg-white text-blue-950 shadow-xl" : "text-blue-50 hover:translate-x-1 hover:bg-white/10"}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? "bg-blue-50 text-blue-700" : "bg-white/10 text-cyan-200 group-hover:bg-white/15"}`}><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{section.title}</span><span className={`block truncate text-[11px] font-semibold ${active ? "text-slate-400" : "text-blue-200/60"}`}>{section.subtitle}</span></span><ArrowUpRight size={15} className={active ? "text-blue-500" : "opacity-0 transition group-hover:opacity-100"} /></button>;
              })}</div>
            </div>

            {selected && <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${selected.accent} p-[1px]`}>
              <div className="h-full rounded-[23px] bg-gradient-to-br from-white via-[#f7fbff] to-[#edf6ff] p-5 backdrop-blur-xl lg:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Module intelligence</p><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{selected.title}</h2><p className="mt-1 text-sm font-semibold text-slate-500">{selected.subtitle}</p></div><Link to={selected.path} className="group inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-xl">Open analytics <ArrowUpRight size={16} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></Link></div>
                <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{selected.metrics.map(([label, value], index) => <div key={label} className="astrea-intelligence-tile group rounded-2xl p-4" style={{ transitionDelay: `${index * 15}ms` }}><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className="mt-3 text-2xl font-black text-slate-950">{value ?? "-"}</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-blue-100"><div className={`h-full rounded-full bg-gradient-to-r ${selected.accent}`} style={{ width: `${Math.max(20, Math.min(100, Number.parseFloat(value) || 58))}%` }} /></div></div>)}</div>
              </div>
            </div>}
          </div>
        </section>

        <Suspense fallback={<div className="grid animate-pulse gap-4 lg:grid-cols-3"><div className="h-80 rounded-3xl bg-slate-100 lg:col-span-2" /><div className="h-80 rounded-3xl bg-slate-100" /></div>}>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Incident trend" subtitle="Selected-period Service Desk demand" className="lg:col-span-2"><IncidentAreaChart data={data.service_desk.trend} /></ChartCard>
            <ChartCard title="Top incident categories" subtitle="Where demand is concentrated"><CategoryDonut data={data.service_desk.top_categories} /></ChartCard>
            <ChartCard title="Enterprise health" subtitle="Cross-module operating posture"><HealthBarChart data={health} /></ChartCard>
            <ChartCard title="Incident demand heatmap" subtitle="Tickets by weekday and hour" className="lg:col-span-2"><IncidentHeatmap data={data.service_desk.heatmap} /></ChartCard>
          </div>
        </Suspense>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Recent replacement activity" subtitle="Latest controlled laptop replacement events"><div className="space-y-2">{data.replacements.recent_activity.length ? data.replacements.recent_activity.map((activity, index) => <Link to="/replacement-requests" key={`${activity.request_number}-${index}`} className="group flex items-start gap-3 rounded-2xl border border-transparent bg-slate-50 p-3 transition duration-300 hover:translate-x-1 hover:border-blue-100 hover:bg-blue-50"><GitBranch size={16} className="mt-0.5 text-blue-600" /><div><p className="text-sm font-bold text-slate-700">{activity.message}</p><p className="mt-1 text-xs text-slate-400">{activity.request_number} · {new Date(activity.created_at).toLocaleString()}</p></div></Link>) : <p className="py-8 text-center text-sm text-slate-400">No recent replacement activity.</p>}</div></ChartCard>
          <ChartCard title="Most viewed knowledge" subtitle="Frequently used operational guidance"><div className="space-y-2">{data.knowledge.most_viewed.map((article, index) => <Link to="/knowledge-base" key={`${article.title}-${index}`} className="group flex items-center justify-between rounded-2xl border border-transparent bg-slate-50 p-3 transition duration-300 hover:translate-x-1 hover:border-blue-100 hover:bg-blue-50"><span className="truncate text-sm font-bold text-slate-700">{article.title}</span><span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white">{article.views}</span></Link>)}</div></ChartCard>
        </div>
      </>}
    </div>
  );
}
