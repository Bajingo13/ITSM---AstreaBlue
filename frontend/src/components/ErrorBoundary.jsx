import React from "react";

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
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-red-50 p-6">
          <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-2xl">
            <h1 className="text-center text-3xl font-black text-red-600">Something went wrong</h1>
            <p className="mt-4 text-slate-700">{this.state.error?.message || "An unexpected error occurred."}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
