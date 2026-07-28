import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app.jsx";
import "./index.css";
import { AuthProvider } from "./context/AuthContext.jsx";
import { installFetchClient } from "./services/installFetchClient";
import { installChunkRecovery } from "./services/chunkRecovery";
import AppDialogHost from "./components/feedback/AppDialogHost";

installChunkRecovery();
installFetchClient();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <AppDialogHost />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
