import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronDown, Link2, ShieldCheck, Trash2 } from "lucide-react";
import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";
import { appAlert, appConfirm } from "../services/appDialog";
import { formatPriority } from "../utils/ticketVisuals";

const API_BASE = `${API_URL}/api/v1`;

function formatTarget(minutes, calendar) {
  const value = Number(minutes) || 0;
  if (calendar === "business_hours") {
    if (value >= 540 && value % 540 === 0) {
      const days = value / 540;
      return `${days} business day${days === 1 ? "" : "s"}`;
    }
    const hours = value / 60;
    return `${hours % 1 === 0 ? hours : hours.toFixed(1)} business hr${hours === 1 ? "" : "s"}`;
  }
  if (value >= 1440 && value % 1440 === 0) {
    const days = value / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (value >= 60) {
    const hours = value / 60;
    return `${hours % 1 === 0 ? hours : hours.toFixed(1)} hr${hours === 1 ? "" : "s"}`;
  }
  return `${value} min`;
}

function PolicyTable({ policies, showSeverity }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[480px] text-left text-xs">
        <thead className="bg-slate-50 font-black uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">{showSeverity ? "Severity" : "Priority"}</th>
            <th className="px-4 py-3">Response</th>
            <th className="px-4 py-3">{showSeverity ? "Restoration" : "Resolution"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
          {policies.map((policy) => (
            <tr key={policy.policy_id}>
              <td className="px-4 py-3 font-black text-slate-900">
                {showSeverity && policy.severity_label ? `${policy.severity_label} (${formatPriority(policy.priority)})` : formatPriority(policy.priority)}
              </td>
              <td className="px-4 py-3">{formatTarget(policy.response_target_mins, policy.response_calendar)}</td>
              <td className="px-4 py-3">{formatTarget(policy.resolution_target_mins, policy.resolution_calendar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SlaPolicyPanel({ isSuperAdmin }) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState(null);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/sla/policies`, { headers: authHeaders(), cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Failed to load SLA policies.");
      setData(body);
    } catch (error) {
      console.error("SLA policies:", error.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addHoliday = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/sla/holidays`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ holiday_date: holidayDate, name: holidayName }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to save holiday.");
      setHolidayDate("");
      setHolidayName("");
      await load();
    } catch (error) {
      void appAlert({ title: "Holiday not saved", message: error.message, tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const removeHoliday = async (holiday) => {
    const confirmed = await appConfirm({
      title: "Remove business holiday",
      message: `Remove ${holiday.name} (${holiday.holiday_date})? New connected-system tickets will count it as a business day. Existing due times do not change.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      const response = await fetch(`${API_BASE}/sla/holidays/${holiday.holiday_date}`, { method: "DELETE", headers: authHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to remove holiday.");
      await load();
    } catch (error) {
      void appAlert({ title: "Holiday not removed", message: error.message, tone: "danger" });
    }
  };

  if (!data) return null;

  const internal = data.policies.filter((policy) => (policy.scope || "internal") === "internal");
  const connectedStandard = data.policies.filter((policy) => policy.scope === "connected_system" && !policy.origin_system);
  const systemOverrides = data.policies.filter((policy) => policy.scope === "connected_system" && policy.origin_system);
  const overrideSystems = [...new Set(systemOverrides.map((policy) => policy.origin_system))];
  const hours = data.businessHours;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-lg font-black text-slate-900">Which SLA applies</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {data.connectedSystemsEnabled
              ? "Tickets filed by ITSM users follow internal ITSM targets. Tickets from connected systems follow their partner SLA."
              : "All tickets follow the internal ITSM targets below."}
          </p>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-6 border-t border-slate-100 px-6 py-6">
          <div className={`grid gap-6 ${data.connectedSystemsEnabled ? "lg:grid-cols-2" : ""}`}>
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-black text-slate-900">
                <ShieldCheck size={16} className="text-blue-600" /> Internal ITSM SLA
              </p>
              <p className="text-xs font-semibold text-slate-500">Tickets filed in this ITSM. Clock hours, 24×7.</p>
              <PolicyTable policies={internal} />
            </div>

            {data.connectedSystemsEnabled && (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm font-black text-violet-800">
                  <Link2 size={16} /> Connected-System SLA (standard)
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  Tickets from EIS and every other connected system, until a system signs its own SLA.
                  S1 runs 24×7. Other targets count business hours: {hours.days}, {hours.start}–{hours.end} Manila, excluding the holidays below.
                  1 business day = 9 business hours.
                </p>
                <PolicyTable policies={connectedStandard} showSeverity />
                {overrideSystems.map((system) => (
                  <div key={system} className="space-y-2">
                    <p className="text-xs font-black uppercase tracking-wide text-violet-700">{system} own SLA</p>
                    <PolicyTable policies={systemOverrides.filter((policy) => policy.origin_system === system)} showSeverity />
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.connectedSystemsEnabled && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-black text-slate-900">
                <CalendarDays size={16} className="text-slate-500" /> Business holidays
              </p>
              <p className="text-xs font-semibold text-slate-500">
                Business-hours timers skip these dates. Changes apply to new tickets only.
              </p>
              <div className="flex flex-wrap gap-2">
                {data.holidays.length === 0 && <span className="text-xs font-semibold text-slate-400">No upcoming holidays recorded.</span>}
                {data.holidays.map((holiday) => (
                  <span key={holiday.holiday_date} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
                    {holiday.holiday_date} · {holiday.name}
                    {isSuperAdmin && (
                      <button type="button" onClick={() => removeHoliday(holiday)} className="text-slate-400 hover:text-red-600" aria-label={`Remove ${holiday.name}`}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {isSuperAdmin && (
                <form onSubmit={addHoliday} className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-center">
                  <input
                    type="date"
                    required
                    value={holidayDate}
                    onChange={(event) => setHolidayDate(event.target.value)}
                    className="w-full rounded-[11px] border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                  />
                  <input
                    type="text"
                    required
                    maxLength={150}
                    placeholder="Holiday name"
                    value={holidayName}
                    onChange={(event) => setHolidayName(event.target.value)}
                    className="w-full rounded-[11px] border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
                  />
                  <button type="submit" disabled={saving} className="whitespace-nowrap rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                    {saving ? "Saving..." : "Add holiday"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
