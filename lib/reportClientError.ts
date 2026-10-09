import { isNativeShell } from "@/components/nativeShell";
import { pageRequestId } from "@/lib/requestId";

const seen = new Map<string, number>();
const URL_PATH = "/api/v2/client-error";

/** Tell the server a page crashed (B-2953). Fire and forget; never throws. */
export function reportClientError(e: { message?: string; stack?: string; route?: string; digest?: string }): void {
  try {
    const message = (e.message ?? "").slice(0, 500);
    const now = Date.now();
    if (!message || message === "Script error." || /ResizeObserver loop/.test(message)) return;
    if (now - (seen.get(message) ?? 0) < 10_000) return;
    seen.set(message, now);
    const body = JSON.stringify({
      message,
      stack: e.stack?.slice(0, 4000),
      route: (e.route ?? location.pathname).slice(0, 200),
      appVersion: (document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content || "unknown").slice(0, 40),
      platform: isNativeShell() ? "ios" : "web",
      requestId: pageRequestId() || undefined,
      digest: e.digest || undefined,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.(URL_PATH, blob)) return;
    void fetch(URL_PATH, { method: "POST", body: blob, keepalive: true }).catch(() => {});
  } catch {
    // reporting must never be the second crash
  }
}
