import React, { useState } from 'react';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fastTracks = [
    { name: 'Admin Portal', email: 'k.gaa@astrea.ph', pass: 'admin123', icon: '👨‍💼' },
    { name: 'Client View', email: 'j.delacruz@mockcorp.ph', pass: 'client123', icon: '👤' }
  ];

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Email and password required.');
      return;
    }
    setError('');
    setIsLoading(true);
    setTimeout(() => { setIsLoading(false); onLoginSuccess(); }, 600);
  };

  const executeFastTrack = (mockEmail, mockPass) => {
    setEmail(mockEmail);
    setPassword(mockPass);
    setError('');
    setIsLoading(true);
    setTimeout(() => { setIsLoading(false); onLoginSuccess(); }, 600);
  };

  return (
    <div className="relative min-h-screen w-full bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950 overflow-hidden flex items-center justify-center p-4">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/3 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="text-3xl font-black text-white">A</span>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-black text-white tracking-tight">AstreaBlue</h1>
              <p className="text-xs text-cyan-400/70 font-semibold tracking-widest uppercase">v3.2.1</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 max-w-xs mx-auto">Enterprise IT Service & Asset Management</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-2xl shadow-slate-950/40 p-8 space-y-6">
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-medium flex items-center gap-2">
                <span>⚠️</span> {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@astrea.ph" className="w-full bg-slate-950/50 border border-white/10 hover:border-white/20 focus:border-cyan-500/50 rounded-lg px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 transition-all" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-slate-950/50 border border-white/10 hover:border-white/20 focus:border-cyan-500/50 rounded-lg px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 transition-all" />
            </div>

            <button type="submit" disabled={isLoading} className="w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-600 hover:from-cyan-400 hover:via-sky-400 hover:to-indigo-500 text-white font-semibold text-sm py-3 rounded-lg shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50">
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <span className="text-xs text-slate-500 font-mono">OR</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Quick Access</p>
            <div className="grid grid-cols-2 gap-2">
              {fastTracks.map((track, idx) => (
                <button key={idx} type="button" onClick={() => executeFastTrack(track.email, track.pass)} disabled={isLoading} className="p-3 rounded-lg border border-white/10 hover:border-cyan-500/50 bg-slate-950/50 hover:bg-slate-900/80 text-left transition-all disabled:opacity-50">
                  <div className="text-2xl mb-1">{track.icon}</div>
                  <div className="text-xs font-semibold text-slate-200">{track.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{track.email}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">Protected by enterprise-grade security</p>
      </div>
    </div>
  );
}