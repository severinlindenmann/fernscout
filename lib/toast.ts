import { REQUEST_ID_HEADER } from "@/lib/requestId";

/** B-2929 — one way to raise a toast, and one way to write to the API that
 * raises it for you. Client side only; the host is components/Toasts.tsx. */
type Toast = {
  id: number;
  kind: "error" | "success";
  /** What the person was doing, already translated ("Saving the day"). */
  action: string;
  /** The API's own message plus its problems list, when it gave one. */
  detail?: string;
  /** The API's error code, shown beside the detail. */
  code?: string;
  /** Status and request id of a 5xx, short enough to paste to an agent. */
  ref?: string;
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const subscribeToasts = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const getToasts = () => toasts;

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function raiseToast(t: Omit<Toast, "id">): void {
  const id = nextId++;
  toasts = [...toasts, { ...t, id }].slice(-4);
  emit();
  // Successes time out; an error stays until dismissed.
  if (t.kind === "success") setTimeout(() => dismissToast(id), 4000);
}

/** Raise the toast for a failed write. `response` is null for a network error. */
export async function toastFailure(action: string, response: Response | null): Promise<void> {
  if (!response) return raiseToast({ kind: "error", action });
  const body = (await response.clone().json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
    details?: unknown;
  } | null;
  const problems = Array.isArray(body?.details)
    ? (body.details as { field?: unknown; problem?: unknown }[])
        .filter((p) => typeof p?.problem === "string")
        .map((p) => (typeof p.field === "string" ? `${p.field}: ${p.problem}` : String(p.problem)))
    : [];
  const message = typeof body?.message === "string" ? body.message : "";
  const rid = response.headers.get(REQUEST_ID_HEADER);
  raiseToast({
    kind: "error",
    action,
    // A 5xx message is internal detail; the reference is what is safe to show.
    detail: response.status >= 500 ? undefined : [message, ...problems].filter(Boolean).join(" ") || undefined,
    code: response.status >= 500 || typeof body?.error !== "string" ? undefined : body.error,
    ref: response.status >= 500 ? [response.status, rid].filter(Boolean).join(" ") : undefined,
  });
}

/** fetch for a POST/PATCH/PUT/DELETE: a failure raises the toast and the
 * response (or null on a network error) still comes back for a caller that
 * needs to react. `action` names what the person was doing. */
export async function apiWrite(action: string, url: string, init: RequestInit): Promise<Response | null> {
  const response = await fetch(url, init).catch(() => null);
  if (!response?.ok) await toastFailure(action, response);
  return response;
}
