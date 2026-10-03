import { act } from "react";
import { vi } from "vitest";

/** A stubbed `fetch` that answers by "METHOD path" (query stripped). A value
 *  is a JSON body, a function of (url, init), or an array answered in order
 *  (the last entry repeats). `ok: false` bodies carry `__status`. */
type Answer = Record<string, unknown>;
type Handler = Answer | ((url: string, init?: RequestInit) => Answer) | Answer[];

export const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];

export function stubWizardFetch(routes: Record<string, Handler>) {
  calls.length = 0;
  const queues = new Map<string, Answer[]>();
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url.split("?")[0]}`;
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    let handler = routes[key];
    if (Array.isArray(handler)) {
      const q = queues.get(key) ?? [...handler];
      queues.set(key, q);
      handler = q.length > 1 ? q.shift()! : q[0];
    }
    const answer = (typeof handler === "function" ? handler(url, init) : handler) ?? { __status: 404, error: "unrouted" };
    const status = typeof answer.__status === "number" ? answer.__status : 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      headers: new Headers(),
      json: async () => answer,
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Let timers and promise chains run inside act. */
export async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
