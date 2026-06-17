import React from 'react';

const FEATURE_DECK = [
  createFeature(
    'intelligence',
    'Intelligent Service Desk',
    'Automatic ticket classification, SLA awareness and high-impact triage for enterprise incidents.',
    'from-cyan-400 via-sky-500 to-indigo-500'
  ),
  createFeature(
    'lifecycle',
    'Asset Lifecycle Control',
    'Track procurement, deployment, repair cycles, and retirement workflows from one console.',
    'from-violet-500 via-fuchsia-500 to-indigo-500'
  ),
  createFeature(
    'compliance',
    'Compliance-ready CMDB',
    'Maintain audit-ready configuration records and live authority compliance for your hardware estate.',
    'from-sky-500 via-indigo-500 to-purple-600'
  ),
];

function createFeature(id, title, description, gradient) {
  return { id, title, description, gradient };
}

function brandGradient() {
  return 'from-sky-500 via-indigo-500 to-violet-500';
}

function FeatureCard({ feature }) {
  return (
    <div className="group rounded-[2rem] border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/20 transition hover:-translate-y-1 hover:border-slate-300/20">
      <div className={`inline-flex items-center justify-center rounded-3xl bg-gradient-to-br ${feature.gradient} p-3 text-white shadow-lg shadow-cyan-500/20 mb-4`}>
        <span className="text-sm font-semibold uppercase tracking-[0.35em]">{feature.id}</span>
      </div>
      <h3 className="text-lg font-semibold text-slate-100 mb-2">{feature.title}</h3>
      <p className="text-sm leading-6 text-slate-400">{feature.description}</p>
    </div>
  );
}

function HeroStat({ value, label }) {
  return (
    <div className="rounded-3xl border border-slate-700/70 bg-slate-950/90 p-5 text-center shadow-xl shadow-slate-950/20">
      <p className="text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
    </div>
  );
}

export default function Landing({ onEnter }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_22%),radial-gradient(circle_at_20%_80%,_rgba(168,85,247,0.16),_transparent_18%),radial-gradient(circle_at_80%_30%,_rgba(56,189,248,0.1),_transparent_15%)]" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-[#56d1ff] via-[#7c3aed] to-[#c084fc] shadow-2xl shadow-cyan-500/25">
              <span className="text-lg font-black text-white">A</span>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">AstreaBlue</p>
              <p className="text-sm font-semibold text-slate-100/90">Enterprise IT Asset Monitoring</p>
            </div>
          </div>

          <button
            onClick={onEnter}
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:shadow-violet-500/30"
          >
            Launch Portal
          </button>
        </header>

        <main className="grid flex-1 gap-10 lg:grid-cols-[1.3fr_0.95fr] lg:items-center">
          <section className="space-y-8">
            <div className="max-w-3xl space-y-6">
              <p className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-200">
                ITSM SUITE • v3.2.1
              </p>
              <h1 className="text-5xl font-extrabold tracking-tight text-slate-50 sm:text-6xl">
                AstreaBlue — your next-generation
                <span className="mx-2 bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 bg-clip-text text-transparent">IT Service Command Center</span>
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-400 sm:text-lg">
                Manage assets, service tickets, compliance and change workflows with a unified enterprise-grade platform built for scale, speed, and secure operational visibility.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <HeroStat value="2,847" label="Managed Devices" />
              <HeroStat value="94.2%" label="Compliance Score" />
              <HeroStat value="47" label="Active Clients" />
              <HeroStat value="18" label="Open Incidents" />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={onEnter}
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-violet-500 px-7 py-3 text-sm font-semibold text-white shadow-2xl shadow-cyan-500/15 transition hover:-translate-y-0.5"
              >
                See the portal
              </button>
              <a href="#features" className="text-sm font-semibold text-slate-200 transition hover:text-white">
                Explore features →
              </a>
            </div>
          </section>

          <aside className="space-y-6 rounded-[2rem] border border-white/10 bg-slate-900/80 p-8 shadow-2xl shadow-slate-950/20 backdrop-blur-xl">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3 rounded-3xl bg-slate-800/80 px-4 py-3 text-sm text-slate-100">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span>Production-ready ITSM environment</span>
              </div>
              <p className="text-slate-400">
                AstreaBlue helps you reduce incident resolution times, improve asset visibility, and keep compliance workflows aligned with enterprise policy standards.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="rounded-3xl bg-slate-950/80 p-5 ring-1 ring-white/5">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Module spotlight</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-50">Service Desk Operations</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">Simplified ticket lifecycle management with dynamic assignment and SLA visibility.</p>
              </div>
              <div className="rounded-3xl bg-slate-950/80 p-5 ring-1 ring-white/5">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Live pipeline</p>
                <h3 className="mt-3 text-lg font-semibold text-slate-50">Asset Lifecycle</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">From procurement to retirement, stay in control of hardware health and assignments.</p>
              </div>
            </div>
          </aside>
        </main>

        <section id="features" className="mt-16 grid gap-6 lg:grid-cols-3">
          {FEATURE_DECK.map(feature => (
            <FeatureCard key={feature.id} feature={feature} />
          ))}
        </section>
      </div>
    </div>
  );
}
