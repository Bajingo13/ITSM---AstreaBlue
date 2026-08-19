import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_URL } from "../config/api";

const STANDARD_DEPLOYMENT = Object.freeze({
  instance_id: "UNKNOWN",
  profile: "STANDARD",
  capabilities: Object.freeze({}),
});

const DeploymentContext = createContext({
  deployment: STANDARD_DEPLOYMENT,
  loading: true,
  hasCapability: () => false,
});

export function DeploymentProvider({ children }) {
  const [deployment, setDeployment] = useState(STANDARD_DEPLOYMENT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDeployment() {
      try {
        const response = await fetch(`${API_URL}/api/deployment`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body?.data) throw new Error("Deployment configuration unavailable.");
        setDeployment(body.data);
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Failed to load deployment capabilities:", error.message);
          setDeployment(STANDARD_DEPLOYMENT);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadDeployment();
    return () => controller.abort();
  }, []);

  const value = useMemo(() => ({
    deployment,
    loading,
    hasCapability: (capability) => deployment.capabilities?.[capability] === true,
  }), [deployment, loading]);

  return <DeploymentContext.Provider value={value}>{children}</DeploymentContext.Provider>;
}

export function useDeployment() {
  return useContext(DeploymentContext);
}
