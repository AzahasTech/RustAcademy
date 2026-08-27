"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { errorReporter } from "@/lib/errorReporter";
import { RequestContext, type RequestContextValue } from "@/lib/requestContext";

export type ErrorBoundaryProps = {
  children: ReactNode;
  onOpenReportIssue?: (error: Error, componentStack?: string) => void;
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
};

export type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
  componentStack?: string;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  static contextType = RequestContext;
  declare context: RequestContextValue | null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: undefined,
      componentStack: undefined,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const capturedError = error instanceof Error ? error : new Error(String(error));
    return {
      hasError: true,
      error: capturedError,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const capturedError = error instanceof Error ? error : new Error(String(error));

    this.setState({
      hasError: true,
      error: capturedError,
      componentStack: info.componentStack ?? undefined,
    });

    this.props.onError?.(capturedError, info);

    errorReporter.captureError(capturedError, {
      requestId: this.context?.requestId,
      correlationId: this.context?.correlationId,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      componentStack: info.componentStack ?? undefined,
      codeOrigin: "ErrorBoundary",
      extra: {
        source: "ErrorBoundary",
        componentStack: info.componentStack,
      },
    });
  }

  handleReportClick = () => {
    if (!this.state.error) {
      return;
    }

    this.props.onOpenReportIssue?.(
      this.state.error,
      this.state.componentStack
    );
  };

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: undefined,
      componentStack: undefined,
    });
  };

  handleGoHome = () => {
    this.handleRetry();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(
          this.state.error ?? new Error("An unexpected error occurred"),
          this.handleRetry
        );
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <section
          role="alert"
          aria-live="assertive"
          className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-6 rounded-3xl border border-white/10 bg-neutral-950/90 p-8 text-center shadow-2xl shadow-black/20"
        >
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-2xl text-red-400">
            ⚠️
          </div>
          <p className="text-sm uppercase tracking-[0.22em] text-neutral-400">
            Something went wrong
          </p>
          <h1 className="text-3xl font-semibold text-white">An error occurred</h1>
          <p className="max-w-xl text-neutral-300">
            This issue has been captured and can be reported with your request details.
          </p>
          {this.state.error && (
            <details className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <summary className="cursor-pointer text-sm font-semibold text-neutral-300 hover:text-neutral-100">
                Error details
              </summary>
              <p className="mt-3 whitespace-pre-wrap break-all font-mono text-xs text-neutral-400">
                {this.state.error.message}
                {this.state.componentStack ? `\n\n${this.state.componentStack}` : ""}
              </p>
            </details>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-95"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10 active:scale-95"
            >
              Go to Home
            </button>
            {this.props.onOpenReportIssue && (
              <button
                type="button"
                onClick={this.handleReportClick}
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-100 active:scale-95"
              >
                Report Issue
              </button>
            )}
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
