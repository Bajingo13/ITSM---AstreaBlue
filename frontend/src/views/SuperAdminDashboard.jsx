import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, Ticket, UserCog, Users } from "lucide-react";

const API_BASE = "http://localhost:5001/api/v1";

export default function SuperAdminDashboard() {
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [branchRes, userRes, ticketRes] = await Promise.all([
        fetch(`${API_BASE}/branches`),
        fetch(`${API_BASE}/users`),
        fetch(`${API_BASE}/tickets`),
      ]);

      const [branchData, userData, ticketData] = await Promise.all([
        branchRes.json(),
        userRes.json(),
        ticketRes.json(),
      ]);

      setBranches(Array.isArray(branchData) ? branchData : []);
      setUsers(Array.isArray(userData) ? userData : []);
      setTickets(Array.isArray(ticketData) ? ticketData : []);
    } catch (err) {
      console.error("Fetch SuperAdmin dashboard failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const admins = users.filter((user) => user.role_name === "Admin");
  const technicians = users.filter((user) => user.role_name === "Technician");
  const employees = users.filter((user) => user.role_name === "Employee");

  const ticketsPerBranch = useMemo(() => {
    return branches.map((branch) => {
      const branchUserIds = users
        .filter((user) => Number(user.branch_id) === Number(branch.branch_id))
        .map((user) => Number(user.user_id));

      const count = tickets.filter((ticket) =>
        branchUserIds.includes(Number(ticket.requester_id))
      ).length;

      return { ...branch, count };
    });
  }, [branches, tickets, users]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">SuperAdmin Dashboard</h1>
        <p className="mt-2 text-blue-100">
          Global visibility across branches, users, technicians, employees, and tickets.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card icon={GitBranch} label="Total Branches" value={branches.length} />
        <Card icon={Users} label="Total Users" value={users.length} />
        <Card icon={Ticket} label="Total Tickets" value={tickets.length} />
        <Card icon={UserCog} label="Admins" value={admins.length} />
      </section>

      {loading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">
          Loading global dashboard...
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Tickets Per Branch">
            <div className="space-y-3">
              {ticketsPerBranch.map((branch) => (
                <div
                  key={branch.branch_id}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="font-black text-slate-900">{branch.branch_name}</p>
                    <p className="text-xs font-semibold text-slate-500">
                      {branch.is_headquarters ? "Headquarters" : branch.branch_location || "Branch"}
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-black text-blue-700">
                    {branch.count}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Role Distribution">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MiniStat label="Admins" value={admins.length} />
              <MiniStat label="Technicians" value={technicians.length} />
              <MiniStat label="Employees" value={employees.length} />
            </div>
          </Panel>

          <UserList title="All Admins" users={admins} />
          <UserList title="All Technicians" users={technicians} />
          <UserList title="All Employees" users={employees} />
        </section>
      )}
    </div>
  );
}

function Card({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
          <Icon size={22} />
        </div>
        <div>
          <p className="text-2xl font-black text-slate-900">{value}</p>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 text-xl font-black text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-5">
      <p className="text-2xl font-black text-slate-900">{value}</p>
      <p className="text-sm font-semibold text-slate-500">{label}</p>
    </div>
  );
}

function UserList({ title, users }) {
  return (
    <Panel title={title}>
      <div className="space-y-3">
        {users.length ? (
          users.map((user) => (
            <div
              key={user.user_id}
              className="rounded-2xl bg-slate-50 px-4 py-3"
            >
              <p className="font-black text-slate-900">{user.full_name}</p>
              <p className="text-sm font-semibold text-slate-500">{user.email}</p>
              <p className="text-xs font-bold text-blue-700">
                {user.branch_name || "Global"}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm font-semibold text-slate-400">No users found.</p>
        )}
      </div>
    </Panel>
  );
}
