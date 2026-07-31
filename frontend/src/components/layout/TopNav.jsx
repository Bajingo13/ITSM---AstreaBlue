import { useCallback, useEffect, useRef, useState } from "react";
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
  CheckCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Inbox,
  UserPlus,
  Moon,
  Sun,
  Zap,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { subscribeToTicketChanges } from "../../services/realtimeTickets";
import { API_URL } from "../../config/api";
import { authHeaders } from "../../services/authHeaders";
import { resolveNotificationDestination } from "../../services/notificationNavigation";

const philippineDateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const philippineTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function PhilippineClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const date = philippineDateFormatter.format(now);
  const time = philippineTimeFormatter.format(now);

  return (
    <div
      className="hidden items-center gap-5 whitespace-nowrap border-x border-[#D9E5F5] px-4 py-1 text-xs font-bold text-slate-600 xl:flex"
      title={`${date}, ${time} — Philippine Standard Time`}
      aria-label={`${date}, ${time}, Philippine Standard Time`}
    >
      <time dateTime={now.toISOString()} className="font-black text-slate-800">{time}</time>
      <span>{date}</span>
    </div>
  );
}

function NotifIcon({ type, title }) {
  const base = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-white shadow-md";
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

function formatNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const notificationAuthFailed = useRef(false);

  const fetchNotifications = useCallback(async () => {
    if (!user?.user_id || notificationAuthFailed.current) return [];
    const headers = authHeaders();
    if (!headers.Authorization) {
      notificationAuthFailed.current = true;
      return [];
    }
    try {
      const res = await fetch(`${API_URL}/api/v1/notifications`, {
        headers,
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        notificationAuthFailed.current = true;
        setNotifications([]);
        return [];
      }
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data) ? data : [];
        setNotifications(rows);
        return rows;
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
    return [];
  }, [user?.user_id]);

  useEffect(() => {
    notificationAuthFailed.current = false;
    void fetchNotifications();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchNotifications();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    let timeoutId;
    const unsubscribe = subscribeToTicketChanges(() => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => void fetchNotifications(), 150);
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/notifications/${id}/read`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      if (res.status === 401 || res.status === 403) notificationAuthFailed.current = true;
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      }
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!unreadCount || markingAllRead) return;
    setMarkingAllRead(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/notifications/read-all`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      if (res.status === 401 || res.status === 403) notificationAuthFailed.current = true;
      if (res.ok) {
        setNotifications((items) => items.map((item) => ({ ...item, read: true })));
      }
    } catch (err) {
      console.error("Failed to mark notifications as read:", err);
    } finally {
      setMarkingAllRead(false);
    }
  };

  const leftOffset = collapsed ? 68 : 260;
  const unreadCount = notifications.filter((n) => !n.read).length;
  const visibleNotifications = notificationFilter === "unread"
    ? notifications.filter((notification) => !notification.read)
    : notifications;

  const role = user?.role_name || user?.role || "Employee";
  const fullName = user?.full_name || "AstreaBlue User";
  const email = user?.email || "user@astreablue.com";

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const handleNotificationClick = (notification) => {
    if (!notification.read) void handleMarkAsRead(notification.id);
    const destination = resolveNotificationDestination(notification, role);
    setNotifOpen(false);
    navigate(destination.path, {
      state: {
        notificationEntityType: notification.related_entity_type || notification.metadata?.relatedEntityType || null,
        notificationEntityId: notification.related_entity_id || notification.metadata?.relatedEntityId || null,
      },
    });
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
      const pendingRefreshes = [];
      window.dispatchEvent(new CustomEvent("astreablue:refresh-dashboard", {
        detail: {
          waitUntil(promise) {
            pendingRefreshes.push(Promise.resolve(promise));
          },
        },
      }));
      await Promise.allSettled([fetchNotifications(), ...pendingRefreshes]);
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
        <PhilippineClock />

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
            <div className="absolute right-0 top-full z-50 mt-3 w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
              <div className="border-b border-slate-200 bg-white px-5 pb-3 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black text-slate-950">Notifications</h3>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">
                          {unreadCount} new
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">Updates from your AstreaBlue workspace</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotifOpen(false)}
                    aria-label="Close notifications"
                    className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  >
                    <X size={17} />
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex rounded-full bg-slate-100 p-1">
                    {[["all", "All"], ["unread", "Unread"]].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setNotificationFilter(value)}
                        className={`rounded-full px-4 py-1.5 text-xs font-black transition ${
                          notificationFilter === value
                            ? "bg-white text-blue-700 shadow-sm"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    disabled={!unreadCount || markingAllRead}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent"
                  >
                    <CheckCheck size={15} />
                    {markingAllRead ? "Updating..." : "Mark all read"}
                  </button>
                </div>
              </div>

              <div className="max-h-[min(520px,calc(100vh-150px))] overflow-y-auto bg-slate-50/60 p-2 [scrollbar-color:#94a3b8_transparent] [scrollbar-width:thin]">
                {visibleNotifications.length === 0 ? (
                  <div className="flex min-h-52 flex-col items-center justify-center px-8 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                      <Inbox size={25} />
                    </div>
                    <p className="mt-3 text-sm font-black text-slate-800">
                      {notificationFilter === "unread" ? "You're all caught up" : "No notifications yet"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {notificationFilter === "unread"
                        ? "New workspace updates will appear here."
                        : "Ticket, lifecycle, consent, and system updates will appear here."}
                    </p>
                  </div>
                ) : (
                  visibleNotifications.map((n) => {
                    const destination = resolveNotificationDestination(n, role);
                    return (
                    <button
                      type="button"
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`group relative mb-1 flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition last:mb-0 ${
                        !n.read
                          ? "border-blue-100 bg-blue-50/80 shadow-sm hover:border-blue-200 hover:bg-blue-50"
                          : "border-transparent bg-white/80 hover:border-slate-200 hover:bg-white"
                      }`}
                    >
                      <NotifIcon type={n.type} title={n.title} />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`line-clamp-1 text-sm ${!n.read ? "font-black text-slate-950" : "font-bold text-slate-700"}`}>
                            {n.title}
                          </p>
                          <span className={`shrink-0 text-[11px] font-bold ${!n.read ? "text-blue-600" : "text-slate-400"}`}>
                            {formatNotificationTime(n.created_at)}
                          </span>
                        </div>
                        <p className={`mt-1 line-clamp-2 text-xs leading-5 ${!n.read ? "text-slate-700" : "text-slate-500"}`}>
                          {n.message}
                        </p>
                        {destination?.label && (
                          <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-black text-blue-700 shadow-sm">
                            {destination.label}
                          </span>
                        )}
                      </div>
                      {!n.read && (
                        <span className="absolute bottom-3 right-3 h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_2px_rgba(37,99,235,0.12)]" />
                      )}
                    </button>
                    );
                  })
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
