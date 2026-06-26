import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Bell,
  Bot,
  ChevronDown,
  LogOut,
  Settings,
  X,
  CheckCircle,
  AlertTriangle,
  Info,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const notifications = [
  {
    id: 1,
    type: "error",
    title: "Critical SLA Breach",
    message: "VPN outage ticket has breached SLA.",
    read: false,
  },
  {
    id: 2,
    type: "warning",
    title: "Warranty Expiring",
    message: "3 assets have warranty expiring within 30 days.",
    read: false,
  },
  {
    id: 3,
    type: "success",
    title: "Change Approved",
    message: "Exchange patch deployment was approved.",
    read: true,
  },
];

function NotifIcon({ type }) {
  const base = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg";

  if (type === "error") {
    return (
      <div className={`${base} bg-red-50`}>
        <AlertCircle size={14} className="text-red-500" />
      </div>
    );
  }

  if (type === "warning") {
    return (
      <div className={`${base} bg-amber-50`}>
        <AlertTriangle size={14} className="text-amber-500" />
      </div>
    );
  }

  if (type === "success") {
    return (
      <div className={`${base} bg-emerald-50`}>
        <CheckCircle size={14} className="text-emerald-500" />
      </div>
    );
  }

  return (
    <div className={`${base} bg-blue-50`}>
      <Info size={14} className="text-blue-500" />
    </div>
  );
}

export default function TopNav({ collapsed }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const leftOffset = collapsed ? 68 : 260;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const role = user?.role_name || user?.role || "Employee";
  const fullName = user?.full_name || "AstreaBlue User";
  const email = user?.email || "user@astreablue.com";

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
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
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button className="rounded-lg p-2 text-blue-700/75 hover:bg-[#EAF4FF] hover:text-blue-700">
          <RefreshCw size={16} />
        </button>

        <button className="rounded-lg p-2 text-blue-700/75 hover:bg-[#EAF4FF] hover:text-blue-700">
          <Bot size={17} />
        </button>

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
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`flex gap-3 border-b border-slate-50 px-4 py-3 ${
                      !n.read ? "bg-blue-50" : "bg-white"
                    }`}
                  >
                    <NotifIcon type={n.type} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {n.message}
                      </p>
                    </div>
                    {!n.read && (
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                  </div>
                ))}
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
