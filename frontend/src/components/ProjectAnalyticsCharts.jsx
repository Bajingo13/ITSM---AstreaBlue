import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const money = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value || 0);

function EmptyChart({ message }) {
  return <div className="flex h-56 items-center justify-center rounded-xl bg-slate-50 text-sm font-semibold text-slate-400">{message}</div>;
}

export function MilestoneChart({ data }) {
  const values = [{ name: "Completed", value: data.completed }, { name: "Remaining", value: data.remaining }];
  if (!data.completed && !data.remaining) return <EmptyChart message="No milestone data available." />;
  return (
    <div className="relative h-48">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart><Pie data={values} dataKey="value" innerRadius={56} outerRadius={76} paddingAngle={3}>
          <Cell fill="#2563EB" /><Cell fill="#E2E8F0" />
        </Pie><Tooltip /></PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center"><div><p className="text-3xl font-black text-slate-900">{data.completion_pct}%</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Complete</p></div></div>
    </div>
  );
}

export function CostChart({ data }) {
  if (!data.trend.length) return <EmptyChart message="No earned-value snapshots available." />;
  return <div className="h-52"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend} margin={{ left: 4, right: 8, top: 8 }}>
    <defs><linearGradient id="evFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563EB" stopOpacity={0.22}/><stop offset="95%" stopColor="#2563EB" stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
    <Tooltip formatter={(value) => money(value)} /><Legend wrapperStyle={{ fontSize: 11 }} />
    <Area type="monotone" dataKey="planned_value" name="PV" stroke="#64748B" fill="transparent" />
    <Area type="monotone" dataKey="earned_value" name="EV" stroke="#2563EB" fill="url(#evFill)" />
    <Area type="monotone" dataKey="actual_cost" name="AC" stroke="#F59E0B" fill="transparent" />
  </AreaChart></ResponsiveContainer></div>;
}

export function ResourceChart({ data }) {
  const values = [{ name: "Allocated", value: data.allocated }, { name: "Available", value: data.available }];
  if (!data.allocated && !data.available) return <EmptyChart message="No resource allocations available." />;
  return <div className="relative h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={values} dataKey="value" innerRadius={65} outerRadius={88} paddingAngle={3}><Cell fill="#2563EB"/><Cell fill="#CBD5E1"/></Pie><Tooltip /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center"><div><p className="text-3xl font-black text-slate-900">{data.utilization_pct}%</p><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Utilized</p></div></div></div>;
}

export function ForecastChart({ data }) {
  if (!data.length) return <EmptyChart message="No project forecasts available." />;
  return <div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0"/><XAxis dataKey="project_name" tick={{ fontSize: 10 }} hide={data.length > 5}/><YAxis domain={[0,100]} tick={{ fontSize: 10 }}/><Tooltip/><Legend wrapperStyle={{ fontSize: 11 }}/><Line type="monotone" dataKey="estimated_completion" name="Estimated Completion" stroke="#94A3B8" strokeWidth={2}/><Line type="monotone" dataKey="current_progress" name="Current Progress" stroke="#2563EB" strokeWidth={3}/><Line type="monotone" dataKey="confidence" name="Forecast Confidence" stroke="#14B8A6" strokeDasharray="5 4" strokeWidth={2}/></LineChart></ResponsiveContainer></div>;
}

export function ProblemTrendChart({ data }) {
  if (!data.length) return <EmptyChart message="No problem trend data available." />;
  return <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0"/><XAxis dataKey="period" tick={{ fontSize: 10 }}/><YAxis allowDecimals={false} tick={{ fontSize: 10 }}/><Tooltip/><Line type="monotone" dataKey="count" name="Problems" stroke="#2563EB" strokeWidth={3}/></LineChart></ResponsiveContainer></div>;
}
