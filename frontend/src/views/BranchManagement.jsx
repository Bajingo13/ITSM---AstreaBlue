import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, GitBranch, Plus, Search, X } from "lucide-react";

const API_BASE = "http://localhost:5000/api/v1";

const emptyForm = {
  branch_name: "",
  branch_location: "",
  admin_user_id: "",
  is_active: true,
};

export default function BranchManagement() {
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [formBranch, setFormBranch] = useState(null);

  const fetchBranches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/branches`);
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch branches failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/users`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch users failed:", err);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
    fetchUsers();
  }, [fetchBranches, fetchUsers]);

  const adminUsers = useMemo(() => {
    return users.filter((user) => user.role_name === "Admin" && user.status === "Active");
  }, [users]);

  const filteredBranches = useMemo(() => {
    const text = query.toLowerCase();

    return branches.filter((branch) => {
      return (
        branch.branch_name?.toLowerCase().includes(text) ||
        branch.branch_location?.toLowerCase().includes(text) ||
        branch.admin_name?.toLowerCase().includes(text)
      );
    });
  }, [branches, query]);

  const updateBranchStatus = async (branch) => {
    try {
      const res = await fetch(`${API_BASE}/branches/${branch.branch_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !branch.is_active }),
      });

      if (!res.ok) throw new Error("Failed to update branch status");

      fetchBranches();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-800 p-7 text-white shadow-xl lg:flex-row lg:items-center">
        <div>
          <h1 className="text-3xl font-black">Branch Management</h1>
          <p className="mt-2 text-blue-100">
            Manage company branches, branch status, and assigned branch admins.
          </p>
        </div>

        <button
          onClick={() => setFormBranch({ ...emptyForm })}
          className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-black text-blue-700 shadow-lg hover:bg-blue-50"
        >
          <Plus size={18} />
          Add Branch
        </button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Search size={18} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by branch, location, or admin..."
            className="w-full bg-transparent py-2 text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
            <GitBranch size={22} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900">Branches</h2>
            <p className="text-sm text-slate-500">
              Active and inactive operating branches for AstreaBlue ITSM.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Branch Admin</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    Loading branches...
                  </td>
                </tr>
              ) : filteredBranches.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center font-bold text-slate-400">
                    No branches found.
                  </td>
                </tr>
              ) : (
                filteredBranches.map((branch) => (
                  <tr key={branch.branch_id} className="border-t border-slate-100">
                    <td className="px-4 py-4 font-bold text-slate-900">
                      {branch.branch_name}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {branch.branch_location || "No location set"}
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {branch.admin_name || "Unassigned"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          branch.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {branch.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                      {branch.created_at
                        ? new Date(branch.created_at).toLocaleDateString()
                        : "N/A"}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            setFormBranch({
                              ...branch,
                              admin_user_id: branch.admin_user_id
                                ? String(branch.admin_user_id)
                                : "",
                            })
                          }
                          className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50"
                          title="Edit branch"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => updateBranchStatus(branch)}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                        >
                          {branch.is_active ? "Deactivate" : "Activate"}
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

      {formBranch && (
        <BranchFormModal
          branch={formBranch}
          adminUsers={adminUsers}
          onClose={() => setFormBranch(null)}
          onSaved={() => {
            setFormBranch(null);
            fetchBranches();
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}

function BranchFormModal({ branch, adminUsers, onClose, onSaved }) {
  const [form, setForm] = useState(branch);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(branch.branch_id);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveBranch = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.branch_name) {
      setError("Branch name is required.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(
        isEditing
          ? `${API_BASE}/branches/${branch.branch_id}`
          : `${API_BASE}/branches`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch_name: form.branch_name,
            branch_location: form.branch_location || null,
            admin_user_id: form.admin_user_id ? Number(form.admin_user_id) : null,
            is_active: Boolean(form.is_active),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to save branch.");

      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              {isEditing ? "Edit Branch" : "Add Branch"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure branch details and assign an active Admin account.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={saveBranch} className="space-y-5 px-7 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <Field
            label="Branch Name"
            value={form.branch_name}
            onChange={(value) => updateForm("branch_name", value)}
          />
          <Field
            label="Branch Location"
            value={form.branch_location || ""}
            onChange={(value) => updateForm("branch_location", value)}
          />

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Branch Admin
            </label>
            <select
              value={form.admin_user_id || ""}
              onChange={(e) => updateForm("admin_user_id", e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            >
              <option value="">Unassigned</option>
              {adminUsers.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.full_name} ({user.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">
              Status
            </label>
            <select
              value={form.is_active ? "Active" : "Inactive"}
              onChange={(e) => updateForm("is_active", e.target.value === "Active")}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-100"
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
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
              {saving ? "Saving..." : "Save Branch"}
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
