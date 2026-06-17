import { Plus } from "lucide-react";

export function TicketingBoard({ tickets }) {
  const columns = ["open", "in-progress", "resolved"];

  return (
    <section className="bg-white p-6 rounded-xl border border-slate-200">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold">Service Desk Operations</h2>
        <button className="bg-blue-900 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <Plus size={14}/> New Incident
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {columns.map(col => (
          <div key={col} className="bg-slate-50 p-4 rounded-lg border">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4">{col}</h3>
            {tickets?.filter(t => t.status === col).map(t => (
              <div key={t.id} className="bg-white p-3 rounded border mb-2 shadow-sm text-sm">
                <div className="font-semibold">{t.title}</div>
                <div className="text-xs text-slate-400 mt-2">{t.assignee}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}