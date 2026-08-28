"use client";

import { useState, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import {
  RequestContextProvider,
  useRequestContext,
} from "@/lib/requestContext";
import { errorReporter } from "@/lib/errorReporter";
import { useOnlineStatus } from "@/lib/onlineStatus";
import { useErrorSyncOnReconnect } from "@/hooks/useErrorSyncOnReconnect";
import { queueError } from "@/lib/errorQueue";

type ErrorReportingShellProps = {
  children: React.ReactNode;
};

type ReportPayload = {
  userMessage?: string;
};

function ErrorReportingShellContent({ children }: ErrorReportingShellProps) {
  const { requestId, correlationId } = useRequestContext();
  const { isOnline } = useOnlineStatus();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeError, setActiveError] = useState<Error | null>(null);
  const [activeSummary, setActiveSummary] = useState("");

  // Wrapper to submit errors with offline queueing support
  const submitErrorPayload = async (errorPayload: unknown) => {
    const url = process.env.NEXT_PUBLIC_ERROR_REPORTING_URL;
    if (!url) {
      throw new Error("Error reporting URL not configured");
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(errorPayload),
    });

    if (!response.ok) {
      throw new Error(`Error reporting failed: ${response.status}`);
    }
  };

  // Sync queued errors when coming back online
  useErrorSyncOnReconnect(submitErrorPayload);

  // Wrapper for capturing and queueing errors
  const captureErrorWithQueue = async (error: Error, context?: any) => {
    try {
      await errorReporter.captureError(error, context);
    } catch (err) {
      // If we can't report immediately, queue it
      if (!isOnline) {
        await queueError({ error, context });
      }
    }
  };

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "Uncaught window error");

      const context = {
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
      };

      captureErrorWithQueue(error, context).catch((err) => {
        console.error("Failed to capture error:", err);
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

      const context = {
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
      };

      captureErrorWithQueue(error, context).catch((err) => {
        console.error("Failed to capture error:", err);
      });
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [requestId, correlationId, isOnline]);

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

    const context = {
      requestId,
      correlationId,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      componentStack: activeError.stack,
      codeOrigin: "ErrorReportingShell.ReportIssueModal",
      extra: {
        userMessage,
        source: "report-issue-modal",
      },
    };

    await captureErrorWithQueue(activeError, context);
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

/**
 * Wraps the entire app with error reporting and request context.
 * Should be placed at the root level, before feature providers.
 * 
 * Features:
 * - Captures uncaught errors and promise rejections
 * - Tracks request IDs and correlation IDs
 * - Allows users to manually report errors
 * - Redacts PII from error payloads
 * - Queues errors while offline and retries on reconnection
 */
export function ErrorReportingShell({ children }: ErrorReportingShellProps) {
  return (
    <RequestContextProvider>
      <ErrorReportingShellContent>{children}</ErrorReportingShellContent>
    </RequestContextProvider>
  );
}
