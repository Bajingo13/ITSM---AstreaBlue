import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Bell,
  ChevronDown,
  LogOut,
  Settings,
  X,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  UserPlus,
  Moon,
  Sun,
  Zap,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

import { useEffect } from "react";
import { API_URL } from "../../config/api";

function NotifIcon({ type, title }) {
  const base = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm border";
  const t = (title || "").toLowerCase();

  if (type === "success" || t.includes("resolved") || t.includes("closed")) {
    return (
      <div className={`${base} bg-emerald-50 border-emerald-100`}>
        <CheckCircle2 size={20} className="text-emerald-500" />
      </div>
    );
  }

  if (type === "error" || t.includes("cancel")) {
    return (
      <div className={`${base} bg-red-50 border-red-100`}>
        <XCircle size={20} className="text-red-500" />
      </div>
    );
  }

  if (type === "warning" || t.includes("assign")) {
    return (
      <div className={`${base} bg-orange-50 border-orange-100`}>
        <AlertTriangle size={20} className="text-orange-500" />
      </div>
    );
  }

  if (t.includes("invite") || t.includes("account")) {
    return (
      <div className={`${base} bg-purple-50 border-purple-100`}>
        <UserPlus size={20} className="text-purple-500" />
      </div>
    );
  }

  if (t.includes("ticket") || t.includes("status") || t.includes("update")) {
    return (
      <div className={`${base} bg-blue-50 border-blue-100`}>
        <FileText size={20} className="text-blue-500" />
      </div>
    );
  }

  return (
    <div className={`${base} bg-slate-50 border-slate-200`}>
      <Bell size={20} className="text-slate-500" />
    </div>
  );
}

export default function TopNav({ collapsed, theme = "light", onToggleTheme }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");

  const fetchNotifications = async () => {
    if (!user?.user_id) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/notifications?user_id=${user.user_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [user]);

  const handleMarkAsRead = async (id) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/notifications/${id}/read`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ user_id: user.user_id })
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      }
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  const leftOffset = collapsed ? 68 : 260;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const role = user?.role_name || user?.role || "Employee";
  const fullName = user?.full_name || "AstreaBlue User";
  const email = user?.email || "user@astreablue.com";

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const searchItems = [
    { label: "Ticket Management", keywords: "tickets incidents requests", path: "/tickets", roles: ["SuperAdmin", "Admin", "Technician"] },
    { label: "My Tickets", keywords: "tickets incidents requests", path: "/employee/my-tickets", roles: ["Employee"] },
    { label: "Hardware Assets", keywords: "assets inventory hardware", path: "/assets", roles: ["SuperAdmin", "Admin"] },
    { label: "User Management", keywords: "users access roles", path: "/settings/users", roles: ["SuperAdmin", "Admin"] },
    { label: "Knowledge Base", keywords: "knowledge articles solutions", path: "/knowledge-base", roles: ["SuperAdmin", "Admin", "Technician", "Employee"] },
    { label: "Service Requests", keywords: "service catalog requests", path: "/service-requests", roles: ["SuperAdmin", "Admin", "Technician"] },
  ].filter((item) => item.roles.includes(role) && `${item.label} ${item.keywords}`.toLowerCase().includes(searchQuery.trim().toLowerCase()));

  const refreshDashboard = async () => {
    setRefreshing(true);
    try {
      await fetchNotifications();
      window.dispatchEvent(new CustomEvent("astreablue:refresh-dashboard"));
    } finally {
      window.setTimeout(() => setRefreshing(false), 450);
    }
  };

  const openSearchItem = (path) => {
    navigate(path);
    setSearchOpen(false);
    setSearchQuery("");
  };

  return (
    <header
      className="astrea-topnav fixed top-0 right-0 z-30 flex h-[64px] items-center gap-3 px-5 transition-all duration-300"
      style={{
        left: leftOffset,
        background: "#FFFFFF",
        borderBottom: "1px solid #E6EEF8",
        boxShadow: "0 8px 24px rgba(30,80,160,0.05)",
      }}
    >
      <div className="relative max-w-lg flex-1">
        <div
          onClick={() => setSearchOpen(true)}
          className="flex cursor-text items-center gap-2.5 rounded-xl border border-[#D9E5F5] bg-[#F8FBFF] px-4 py-2.5 shadow-sm"
        >
          <Search size={16} className="shrink-0 text-blue-700/70" />

          {searchOpen ? (
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tickets, assets, users..."
              className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          ) : (
            <span className="flex-1 text-sm text-slate-400">
              Search tickets, assets, users...
            </span>
          )}

          {searchOpen && searchQuery && (
            <button onClick={() => setSearchQuery("")}>
              <X size={13} className="text-slate-400" />
            </button>
          )}
        </div>
        {searchOpen && searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            {searchItems.length ? searchItems.map((item) => (
              <button key={item.path} onClick={() => openSearchItem(item.path)} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 last:border-0 hover:bg-blue-50 hover:text-blue-700">
                <Search size={14} /> {item.label}
              </button>
            )) : <p className="px-4 py-3 text-sm text-slate-500">No matching ITSM module.</p>}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button onClick={refreshDashboard} disabled={refreshing} title="Refresh dashboard" className="rounded-lg p-2 text-blue-700/75 hover:bg-[#EAF4FF] hover:text-blue-700 disabled:opacity-50">
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
        </button>

        <button onClick={onToggleTheme} title={`Use ${theme === "dark" ? "light" : "dark"} mode`} className="rounded-lg p-2 text-blue-700/75 hover:bg-[#EAF4FF] hover:text-blue-700">
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <div className="relative">
          <button onClick={() => setQuickOpen((value) => !value)} title="Quick actions" className="rounded-lg p-2 text-blue-700/75 hover:bg-[#EAF4FF] hover:text-blue-700">
            <Zap size={17} />
          </button>
          {quickOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              {(
                role === "Employee"
                  ? [["Create ticket", "/employee/create-ticket"], ["My tickets", "/employee/my-tickets"], ["Knowledge base", "/knowledge-base"]]
                  : [["Ticket management", "/tickets"], ["Knowledge base", "/knowledge-base"], ...(role === "SuperAdmin" || role === "Admin" ? [["View assets", "/assets"]] : [["Service requests", "/service-requests"]])]
              ).map(([label, path]) => (
                <button key={path + label} onClick={() => { navigate(path); setQuickOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700">
                  <Zap size={13} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setNotifOpen(!notifOpen);
              setProfileOpen(false);
            }}
            className="relative rounded-lg p-2 text-blue-700/75 hover:bg-[#EAF4FF] hover:text-blue-700"
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Notifications
                </h3>
                <button onClick={() => setNotifOpen(false)}>
                  <X size={14} className="text-slate-400" />
                </button>
              </div>

              <div className="max-h-[400px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-500">
                    No new notifications
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => !n.read && handleMarkAsRead(n.id)}
                      className={`group flex cursor-pointer items-start gap-4 p-4 transition-all hover:bg-slate-50 border-b border-slate-100 last:border-0 ${
                        !n.read ? "bg-[#f8fafc]" : "opacity-80"
                      }`}
                    >
                      <NotifIcon type={n.type} title={n.title} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm ${!n.read ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>
                            {n.title}
                          </p>
                          {!n.read && (
                            <span className="h-2 w-2 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.6)]"></span>
                          )}
                        </div>
                        <p className={`mt-1 text-xs leading-relaxed ${!n.read ? "text-slate-600" : "text-slate-500"}`}>{n.message}</p>
                        <p className="mt-2 flex items-center text-[11px] text-slate-400 font-medium">
                          <Clock size={12} className="mr-1 opacity-70" />
                          {new Date(n.created_at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative ml-1">
          <button
            onClick={() => {
              setProfileOpen(!profileOpen);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2.5 rounded-xl py-1.5 pl-2 pr-3 hover:bg-blue-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2F6DFF] to-[#7C3CFF] text-xs font-bold text-white shadow-lg shadow-blue-700/20">
              {fullName.charAt(0)}
            </div>

            <div className="hidden text-left sm:block">
              <p className="text-sm font-semibold leading-none text-slate-900">
                {fullName}
              </p>
              <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                {role}
              </span>
            </div>

            <ChevronDown size={13} className="text-slate-400" />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {fullName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{email}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  AstreaBlue ITSM
                </p>
              </div>

              <div className="p-2">
                <button
                  onClick={() => {
                    navigate("/settings");
                    setProfileOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Settings size={13} />
                  Settings
                </button>

                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-500 hover:bg-red-50 hover:text-red-700"
                >
                  <LogOut size={13} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
