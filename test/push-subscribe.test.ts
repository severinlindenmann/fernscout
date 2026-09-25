import { afterEach, describe, expect, test, vi } from "vitest";
import { subscribeToPush } from "@/components/pushSubscribe";

/**
 * B446 — the failure a reader can do something about.
 *
 * Brave ships with *Use Google services for push messaging* off, and
 * `pushManager.subscribe()` then rejects after the permission has already been
 * granted. That used to fall into the same bare `catch` as everything else and
 * come back as `failed`, which the page renders as "that didn't work, try
 * again" — a retry that cannot succeed until a setting three menus away is
 * changed, and no error left anywhere to say so.
 *
 * The dance itself needs no DOM: it is `Notification`, one service worker
 * registration and one `fetch`, all of which are stubbed here.
 */

function stubBrowser({
  permission = "granted",
  subscribe = async () => ({
    toJSON: () => ({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => true,
  }),
  status = 200,
}: {
  permission?: NotificationPermission;
  subscribe?: () => Promise<unknown>;
  status?: number;
} = {}) {
  vi.stubGlobal("Notification", { requestPermission: async () => permission });
  vi.stubGlobal("navigator", {
    serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
  });
  const fetched = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fetched);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  return fetched;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("subscribing this browser to a journal", () => {
  test("the happy path tells the server, once", async () => {
    const fetched = stubBrowser();
    expect(await subscribeToPush("alex", "aaaa")).toBe("subscribed");
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  /** The whole point of the ticket: a refusal from the browser's own push
   * service is not a "try again", and the server is never told. */
  test("a browser with its push service off is unavailable, not failed", async () => {
    const fetched = stubBrowser({
      subscribe: async () => {
        throw new DOMException("Registration failed - push service error", "AbortError");
      },
    });
    expect(await subscribeToPush("alex", "aaaa")).toBe("unavailable");
    expect(fetched).not.toHaveBeenCalled();
  });

  /** A denial is close to permanent, so it must never be confused with the
   * above — the caller stops asking after one. */
  test("a denied permission is still its own answer", async () => {
    stubBrowser({ permission: "denied" });
    expect(await subscribeToPush("alex", "aaaa")).toBe("denied");
  });

  /** A live subscription the server does not know about is a reader who
   * agreed to notifications and will never get one. */
  test("a server refusal unsubscribes again and reports a failure", async () => {
    const unsubscribe = vi.fn(async () => true);
    stubBrowser({
      status: 500,
      subscribe: async () => ({
        toJSON: () => ({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }),
        unsubscribe,
      }),
    });
    expect(await subscribeToPush("alex", "aaaa")).toBe("failed");
    expect(unsubscribe).toHaveBeenCalled();
  });

  /** Whatever went wrong, it is written down somewhere. Before B446 the one
   * error that would explain the screenshot was thrown away. */
  test("every failure leaves the reason in the console", async () => {
    stubBrowser({
      subscribe: async () => {
        throw new Error("nope");
      },
    });
    await subscribeToPush("alex", "aaaa");
    expect(console.warn).toHaveBeenCalled();
  });
});
