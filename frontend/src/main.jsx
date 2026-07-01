import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app.jsx";
import "./index.css";
import { AuthProvider } from "./context/AuthContext.jsx";
import { getAuthToken } from "./context/AuthService.js";

const originalFetch = window.fetch;
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
  
  return originalFetch(resource, config);
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