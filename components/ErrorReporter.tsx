"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/reportClientError";

/** Reports uncaught errors and unhandled rejections to the server log (B-2953). */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => reportClientError({ message: ev.message || ev.error?.message, stack: ev.error?.stack });
    const onRejection = (ev: PromiseRejectionEvent) => {
      const r = ev.reason;
      reportClientError({ message: r instanceof Error ? r.message : String(r ?? ""), stack: r instanceof Error ? r.stack : undefined });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
