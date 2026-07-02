import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app.jsx";
import "./index.css";
import { AuthProvider } from "./context/AuthContext.jsx";
import { getAuthToken } from "./context/AuthService.js";

const originalFetch = window.fetch;

function redactApiData(value) {
  if (Array.isArray(value)) return value.map(redactApiData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /token|password|secret|jwt/i.test(key) ? "[REDACTED]" : redactApiData(item),
    ])
  );
}

window.fetch = async (...args) => {
  let [resource, config] = args;
  
  if (typeof resource === 'string' && resource.includes('/api/v1')) {
    const token = getAuthToken();
    if (token) {
      config = config || {};
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`
      };
    }
  }
  
  const response = await originalFetch(resource, config);

  if (import.meta.env.DEV && typeof resource === "string" && resource.includes("/api/")) {
    const body = await response.clone().text();
    let responseBody = {};
    if (body) {
      try {
        responseBody = JSON.parse(body);
      } catch {
        responseBody = { message: body };
      }
    }
    console.debug("[API]", {
      url: resource,
      method: config?.method || "GET",
      status: response.status,
      response: redactApiData(responseBody),
    });
  }

  const readText = response.text.bind(response);
  response.json = async () => {
    const body = await readText();
    if (!body || response.status === 204) return {};
    try {
      return JSON.parse(body);
    } catch {
      return { message: body };
    }
  };

  return response;
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
