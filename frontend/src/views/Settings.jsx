import { Link } from "react-router-dom";
import { GitBranch, UserCog } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Settings() {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role;
  const isSuperAdmin = activeRole === "SuperAdmin";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl">
        <h1 className="text-3xl font-black">Settings</h1>
        <p className="mt-2 text-blue-100">
          Manage AstreaBlue ITSM access controls, users, and branch structure.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SettingsCard
          to="/settings/users"
          icon={UserCog}
          title="User Management"
          description="Create accounts, assign roles, reset passwords, and manage user access."
        />

        {isSuperAdmin && (
          <SettingsCard
            to="/settings/branches"
            icon={GitBranch}
            title="Branch Management"
            description="Create branches, assign branch admins, and activate or deactivate branches."
          />
        )}
      </section>
    </div>
  );
}

function SettingsCard({ to, icon: Icon, title, description }) {
  return (
    <Link
      to={to}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-blue-50 p-4 text-blue-700">
          <Icon size={26} />
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
    </Link>
  );
}
