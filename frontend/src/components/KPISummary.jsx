import { Monitor, Users, ShieldCheck, AlertTriangle } from "lucide-react";

export function KPISummary({ data }) {
  // Mapping icons to keys that might come from your API
  const iconMap = { total: Monitor, clients: Users, compliance: ShieldCheck, incidents: AlertTriangle };

  return (
    <div className="grid grid-cols-4 gap-4 mb-8">
      {data?.map((kpi) => {
        const Icon = iconMap[kpi.key]; 
        return (
          <div key={kpi.id} className="bg-white p-5 rounded-xl border border-slate-200">
            {Icon && <Icon className="text-blue-500 mb-2" size={24} />}
            <div className="text-2xl font-bold">{kpi.value}</div>
            <div className="text-sm text-slate-500">{kpi.label}</div>
          </div>
        );
      })}
    </div>
  );
}