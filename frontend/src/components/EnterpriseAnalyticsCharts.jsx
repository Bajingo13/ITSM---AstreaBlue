import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const emptyState = <div className="flex h-64 items-center justify-center text-sm font-semibold text-slate-400">No trend data available.</div>;

export function AnalyticsTrendChart({ data = [], seriesName = "Incidents" }) {
  if (!data.length) return emptyState;
  return <ResponsiveContainer width="100%" height={260}><LineChart data={data} margin={{ top: 12, right: 18, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#94a3b8"/><YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8"/><Tooltip/><Line type="monotone" dataKey="count" name={seriesName} stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }}/></LineChart></ResponsiveContainer>;
}

export function RootCauseChart({ data = [] }) {
  if (!data.length) return emptyState;
  return <ResponsiveContainer width="100%" height={260}><BarChart data={data} margin={{ top: 12, right: 18, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="category" tick={{ fontSize: 10 }} stroke="#94a3b8"/><YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94a3b8"/><Tooltip/><Bar dataKey="count" name="Root causes" fill="#2563eb" radius={[6, 6, 0, 0]}/></BarChart></ResponsiveContainer>;
}
