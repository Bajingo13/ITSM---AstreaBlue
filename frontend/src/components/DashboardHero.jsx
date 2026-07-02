import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import PageHero from "./layout/PageHero";

export default function DashboardHero({ title = "Operations Command Center", subtitle }) {
  const { user } = useAuth();
  const fullName = user?.full_name || user?.name || "AstreaBlue User";
  const firstName = fullName.trim().split(/\s+/)[0];
  const historyKey = `astreablue:welcomed:${user?.user_id || user?.email || "user"}`;
  const [hasVisited] = useState(() => localStorage.getItem(historyKey) === "true");

  useEffect(() => {
    localStorage.setItem(historyKey, "true");
  }, [historyKey]);

  return <PageHero eyebrow={title} showGreeting userName={firstName} returning={hasVisited} subtitle={subtitle || "Here’s what needs attention across tickets, assets, and service operations today."} />;
}
