import { Outlet } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import SideBar from "./SideBar";
import TopNav from "./TopNav";
import AIAssistant from "./AIAssistant";

export default function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("astreablue:theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("astreablue:theme", theme);
  }, [theme]);

  return (
    <div className="astrea-app-shell min-h-screen bg-[#F4F8FF]">
      <SideBar
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <TopNav collapsed={sidebarCollapsed} theme={theme} onToggleTheme={() => setTheme((value) => value === "dark" ? "light" : "dark")} />

      <main
        className="min-h-screen pt-[70px] transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? 68 : 260 }}
      >
        <div className="p-5">
          <Suspense fallback={<div className="flex min-h-[45vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      <AIAssistant />
    </div>
  );
}
