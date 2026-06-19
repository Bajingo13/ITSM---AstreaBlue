import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Edit3,
  Filter,
  KeyRound,
  Plus,
  Search,
  UserCog,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const API_BASE = "http://localhost:5000/api/v1";

const emptyForm = {
  full_name: "",
  email: "",
  password: "",
  role_id: "",
  company_name: "",
  branch_id: "",
  mobile_number: "",
  status: "Active",
};

export default function UserManagement() {
  const { user, role } = useAuth();
  const activeRole = role || user?.role_name || user?.role;
  const isSuperAdmin = activeRole === "SuperAdmin";
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [branchFilter, setBranchFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [formUser, setFormUser] = useState(null);
  const [resetUser, setResetUser] = useState(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/users`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch users failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/roles`);
      const data = await res.json();
      setRoles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch roles failed:", err);
    }
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/branches`);
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch branches failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchRoles();
    fetchBranches();
  }, [fetchUsers, fetchRoles, fetchBranches]);

  const allowedRoles = useMemo(() => {
    const allowedNames = isSuperAdmin
      ? ["SuperAdmin", "Admin", "Technician", "Employee"]
      : ["Technician", "Employee"];

    return roles.filter((item) => allowedNames.includes(item.role_name));
  }, [isSuperAdmin, roles]);

  const visibleUsers = useMemo(() => {
    if (isSuperAdmin) return users;

    return users.filter((item) => {
      if (!["Technician", "Employee"].includes(item.role_name)) return false;
      if (!user?.branch_id) return true;
      return (
        Number(item.branch_id) === Number(user.branch_id)
      );
    });
  }, [isSuperAdmin, user?.branch_id, users]);

  const filteredUsers = useMemo(() => {
    const text = query.toLowerCase();

    return visibleUsers.filter((item) => {
      const matchesText =
        item.full_name?.toLowerCase().includes(text) ||
        item.email?.toLowerCase().includes(text) ||
        item.role_name?.toLowerCase().includes(text) ||
        item.branch_name?.toLowerCase().includes(text);
      const matchesRole = roleFilter === "All" || item.role_name === roleFilter;
      const matchesBranch =
        branchFilter === "All" || Number(item.branch_id) === Number(branchFilter);

      return matchesText && matchesRole && matchesBranch;
    });
  }, [branchFilter, query, roleFilter, visibleUsers]);

  const openAddUser = () => {
    setFormUser({
      ...emptyForm,
      branch_id: isSuperAdmin ? "" : user?.branch_id || "",
      company_name: user?.company_name || "",
    });
  };

  const updateStatus = async (item) => {
    try {
      const nextStatus = item.status === "Active" ? "Inactive" : "Active";

      const res = await fetch(`${API_BASE}/users/${item.user_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) throw new Error("Failed to update user status");

      fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-black">User Management</h1>
          <p className="mt-2 text-blue-100">
            Create accounts, assign branch access, reset passwords, and manage status.
          </p>
        </div>

        <button
          onClick={openAddUser}
          className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
        >
          <Plus size={18} />
          Add User
        </button>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1fr_220px_220px]">
        <div className="flex items-center gap-3">
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, role, or branch..."
            className="w-full bg-transparent py-2 text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>

        <FilterSelect
          value={roleFilter}
          onChange={setRoleFilter}
          options={["All", ...allowedRoles.map((item) => item.role_name)]}
          label="Role"
        />

        <FilterSelect
          value={branchFilter}
          onChange={setBranchFilter}
          options={[
            { label: "All Branches", value: "All" },
            ...branches.map((branch) => ({
              label: branch.branch_name,
              value: String(branch.branch_id),
            })),
          ]}
          label="Branch"
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
            <UserCog size={22} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900">System Users</h2>
            <p className="text-sm text-slate-500">
              SuperAdmin, Admin, Technician, and Employee accounts.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading users...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center font-bold text-slate-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((item) => (
                  <tr key={item.user_id} className="border-t border-slate-100">
                    <td className="px-4 py-4 font-bold text-slate-900">{item.full_name}</td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">{item.email}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                        {item.role_name}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {item.branch_name || "Global"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {item.mobile_number || "N/A"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          item.status === "Active"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : "N/A"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            setFormUser({
                              ...item,
                              password: "",
                              role_id: item.role_id ? String(item.role_id) : "",
                              branch_id: item.branch_id ? String(item.branch_id) : "",
                            })
                          }
                          className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50"
                          title="Edit user"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => setResetUser(item)}
                          className="rounded-xl border border-amber-200 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-50"
                          title="Reset password"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          onClick={() => updateStatus(item)}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                        >
                          {item.status === "Active" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {formUser && (
        <UserFormModal
          user={formUser}
          roles={allowedRoles}
          branches={branches}
          isSuperAdmin={isSuperAdmin}
          currentBranchId={user?.branch_id}
          onClose={() => setFormUser(null)}
          onSaved={() => {
            setFormUser(null);
            fetchUsers();
          }}
        />
      )}

      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onSaved={() => setResetUser(null)}
        />
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, options, label }) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { label: option, value: option } : option
  );

  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3">
      <Filter size={15} className="text-slate-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full bg-transparent py-3 text-sm font-bold text-slate-600 outline-none"
      >
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function UserFormModal({
  user,
  roles,
  branches,
  isSuperAdmin,
  currentBranchId,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(user);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(user.user_id);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveUser = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.full_name || !form.email || !form.role_id || (!isEditing && !form.password)) {
      setError("Full name, email, role, and temporary password are required.");
      return;
    }

    try {
      setSaving(true);

      const finalBranchId = isSuperAdmin ? form.branch_id : currentBranchId;
      const res = await fetch(
        isEditing ? `${API_BASE}/users/${user.user_id}` : `${API_BASE}/users`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: form.full_name,
            email: form.email,
            password: form.password,
            role_id: Number(form.role_id),
            company_name: form.company_name || null,
            branch_id: finalBranchId ? Number(finalBranchId) : null,
            mobile_number: form.mobile_number || null,
            status: form.status || "Active",
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to save user.");

      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              {isEditing ? "Edit User" : "Add User"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure account profile, branch, role, and access status.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={saveUser} className="space-y-5 px-7 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Full Name" value={form.full_name} onChange={(value) => updateForm("full_name", value)} />
            <Field label="Email" value={form.email} onChange={(value) => updateForm("email", value)} />
            {!isEditing && (
              <Field
                label="Temporary Password"
                value={form.password}
                onChange={(value) => updateForm("password", value)}
              />
            )}
            <Field
              label="Mobile Number"
              value={form.mobile_number || ""}
              onChange={(value) => updateForm("mobile_number", value)}
            />
            <SelectField
              label="Role"
              value={form.role_id}
              onChange={(value) => updateForm("role_id", value)}
              options={roles.map((item) => ({
                value: String(item.role_id),
                label: item.role_name,
              }))}
              placeholder="Select role"
            />
            <SelectField
              label="Branch"
              value={isSuperAdmin ? form.branch_id || "" : currentBranchId || ""}
              onChange={(value) => updateForm("branch_id", value)}
              disabled={!isSuperAdmin}
              options={branches.map((branch) => ({
                value: String(branch.branch_id),
                label: branch.branch_name,
              }))}
              placeholder="Global or select branch"
            />
            <Field
              label="Company Name"
              value={form.company_name || ""}
              onChange={(value) => updateForm("company_name", value)}
            />
            <SelectField
              label="Status"
              value={form.status || "Active"}
              onChange={(value) => updateForm("status", value)}
              options={[
                { value: "Active", label: "Active" },
                { value: "Inactive", label: "Inactive" },
              ]}
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white shadow-lg shadow-blue-700/20 hover:bg-blue-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resetPassword = async (e) => {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("Temporary password is required.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/users/${user.user_id}/reset-password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to reset password.");

      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">Reset Password</h2>
            <p className="mt-1 text-sm text-slate-500">{user.full_name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={resetPassword} className="space-y-5 px-7 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
          <Field label="New Temporary Password" value={password} onChange={setPassword} />
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-700 px-6 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {saving ? "Resetting..." : "Reset Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">{label}</label>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">{label}</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
