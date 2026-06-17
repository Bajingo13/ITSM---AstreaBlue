import React from 'react';

export default function Dashboard() {
  return (
    <div className="flex-1 p-8 bg-slate-900 text-white min-h-screen">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-400">Astrea ITSM Operations</h1>
          <p className="text-slate-400 text-sm mt-1">Real-time asset tracking and ticketing matrix</p>
        </div>
        <div className="bg-slate-800 px-4 py-2 rounded-lg border border-slate-700 text-sm">
          System Status: <span className="text-emerald-400 font-semibold">Online</span>
        </div>
      </header>

      {/* Grid placeholder for tomorrow's Figma Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <h3 className="text-slate-400 text-sm font-medium">Total Assets Monitored</h3>
          <p className="text-2xl font-bold mt-2">--</p>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <h3 className="text-slate-400 text-sm font-medium">Active Critical Alerts</h3>
          <p className="text-2xl font-bold mt-2 text-rose-400">--</p>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <h3 className="text-slate-400 text-sm font-medium">Open Support Tickets</h3>
          <p className="text-2xl font-bold mt-2 text-amber-400">--</p>
        </div>
      </div>
    </div>
  );
}