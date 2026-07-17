import { Activity, BarChart3, ShieldCheck } from "lucide-react";
import ModuleContextNav from "./ModuleContextNav";

export default function PageHero({
  eyebrow,
  title,
  subtitle,
  userName,
  showGreeting = false,
  returning = true,
  actions,
  breadcrumbs,
  rightVisual,
  compact = false,
}) {
  const greeting = returning ? "Welcome back" : "Welcome";
  const contextGroup = eyebrow === "Replacement Management"
    ? "replacements"
    : ["Reporting & Analytics", "Project Analytics"].includes(eyebrow)
      ? "analytics"
      : null;
  return (
    <>
    <section className={`astrea-page-hero relative overflow-hidden rounded-[28px] border border-white/15 px-7 text-white shadow-[var(--astrea-hero-shadow)] ${compact ? "py-6 lg:px-8" : "py-8 lg:px-10 lg:py-10"}`}>
      <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full border-[34px] border-cyan-200/10" />
      <div className="pointer-events-none absolute bottom-[-110px] right-24 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl" />
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          {breadcrumbs && <div className="mb-2 text-xs font-semibold text-cyan-100/80">{breadcrumbs}</div>}
          {eyebrow && <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100">{eyebrow}</p>}
          <h1 className={`${compact ? "mt-2 text-2xl sm:text-3xl" : "mt-3 text-3xl sm:text-4xl"} font-black tracking-tight`}>
            {showGreeting ? `${greeting}, ${userName || "AstreaBlue User"} ` : title}
            {showGreeting && <span aria-hidden="true">👋</span>}
          </h1>
          {subtitle && <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-blue-100 sm:text-base">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {rightVisual || (
        <div className="absolute bottom-6 right-8 hidden items-end gap-2 lg:flex" aria-hidden="true">
          {[42, 68, 52, 86, 74].map((height, index) => <div key={height + index} className="w-4 rounded-t-md bg-white/20" style={{ height }} />)}
          <div className="ml-3 grid gap-2"><Activity size={22} className="text-cyan-200" /><BarChart3 size={22} className="text-blue-100" /><ShieldCheck size={22} /></div>
        </div>
      )}
    </section>
    {contextGroup && <ModuleContextNav group={contextGroup} />}
    </>
  );
}
