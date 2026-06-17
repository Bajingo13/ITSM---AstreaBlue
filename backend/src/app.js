import { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { KPISummary } from "./components/KPISummary";
import { TicketingBoard } from "./components/TicketingBoard";
import { getDashboardData } from "./services/dataService";

export default function App() {
  const [data, setData] = useState({ kpis: [], tickets: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardData().then(fetchedData => {
      setData(fetchedData);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 p-8">
        <KPISummary data={data.kpis} />
        <TicketingBoard tickets={data.tickets} />
      </main>
    </div>
  );
}