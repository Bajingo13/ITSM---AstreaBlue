import React from "react";
import { isChunkLoadError, recoverFromStaleChunk } from "../services/chunkRecovery";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    recoverFromStaleChunk(error);
  }

  render() {
    if (this.state.hasError) {
      const staleDeployment = isChunkLoadError(this.state.error);
      return (
        <div className="flex min-h-screen items-center justify-center bg-red-50 p-6">
          <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-2xl">
            <h1 className="text-center text-3xl font-black text-red-600">
              {staleDeployment ? "A new version is available" : "Something went wrong"}
            </h1>
            <p className="mt-4 text-slate-700">
              {staleDeployment
                ? "The browser tried to open files from an older deployment. Reload to use the latest AstreaBlue version."
                : this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700"
            >
              Reload Latest Version
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
