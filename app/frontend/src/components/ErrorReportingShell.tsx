"use client";

import { useState, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import {
  RequestContextProvider,
  useRequestContext,
} from "@/lib/requestContext";
import { errorReporter } from "@/lib/errorReporter";

type ErrorReportingShellProps = {
  children: React.ReactNode;
};

type ReportPayload = {
  userMessage?: string;
};

function ErrorReportingShellContent({ children }: ErrorReportingShellProps) {
  const { requestId, correlationId } = useRequestContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeError, setActiveError] = useState<Error | null>(null);
  const [activeSummary, setActiveSummary] = useState("");

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "Uncaught window error");

      errorReporter.captureError(error, {
        requestId,
        correlationId,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        codeOrigin: event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : "window.onerror",
        extra: {
          source: "window.onerror",
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const error =
        reason instanceof Error
          ? reason
          : new Error(
              typeof reason === "string"
                ? reason
                : "Unhandled Promise Rejection"
            );

      errorReporter.captureError(error, {
        requestId,
        correlationId,
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        codeOrigin: "unhandledrejection",
        extra: {
          source: "window.unhandledrejection",
          reason:
            typeof reason === "object" && reason !== null
              ? JSON.stringify(reason)
              : String(reason),
        },
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [requestId, correlationId]);

  const openReportModal = (error: Error, componentStack?: string) => {
    setActiveError(error);
    setActiveSummary(componentStack ?? error.message);
    setIsModalOpen(true);
  };

  const closeReportModal = () => {
    setIsModalOpen(false);
    setActiveError(null);
    setActiveSummary("");
  };

  const handleModalSubmit = async ({ userMessage }: ReportPayload) => {
    if (!activeError) {
      return;
    }

    await errorReporter.captureError(activeError, {
      requestId,
      correlationId,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      componentStack: activeError.stack,
      codeOrigin: "ErrorReportingShell.ReportIssueModal",
      extra: {
        userMessage,
        source: "report-issue-modal",
      },
    });
  };

  return (
    <>
      <ErrorBoundary onOpenReportIssue={openReportModal}>
        {children}
      </ErrorBoundary>
      <ReportIssueModal
        open={isModalOpen}
        onClose={closeReportModal}
        errorSummary={activeSummary}
        requestId={requestId}
        onSubmit={handleModalSubmit}
      />
    </>
  );
}

export function ErrorReportingShell({ children }: ErrorReportingShellProps) {
  return (
    <RequestContextProvider>
      <ErrorReportingShellContent>{children}</ErrorReportingShellContent>
    </RequestContextProvider>
  );
}
