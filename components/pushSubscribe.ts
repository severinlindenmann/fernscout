/**
 * Subscribing this browser to one journal's notifications — B440.
 *
 * Extracted from `PushOptIn` when a second control needed the same six steps.
 * Two copies of the VAPID dance is how one of them ends up passing the key in
 * the wrong encoding, or forgetting that `Notification.requestPermission()`
 * has to happen inside the click; and a subscription is the one thing here
 * that a reader cannot easily undo if it goes wrong on the wrong journal.
 *
 * **A subscription belongs to a journal, never to the instance.**
 * `push_subscriptions` is keyed by `owner_id` and endpoint, and every read,
 * write and delete in `lib/repos/pushDb.ts` is scoped by it. So subscribing
 * here says "tell me about *this* journal" and says nothing about any other —
 * which is what makes it safe to offer the same prompt on a public journal a
 * reader may not care about: not answering it is the same as saying no.
 */

/** VAPID keys travel as URL-safe base64; PushManager wants raw bytes.
 * Built over an explicit ArrayBuffer so the result is a Uint8Array<ArrayBuffer>,
 * which is what BufferSource requires — Uint8Array.from() widens to
 * ArrayBufferLike and no longer satisfies it. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type SubscribeResult = "subscribed" | "denied" | "dismissed" | "failed";

/**
 * Ask the browser, then tell the server.
 *
 * **Must be called from inside a click handler.** Safari refuses
 * `Notification.requestPermission()` outside a user gesture, and every browser
 * treats a permission prompt that appears on its own as something to penalise
 * the origin for. Nothing in this codebase may call it on a timer, on mount,
 * or from an effect — see `PushPrompt`, which is a *soft* ask precisely so
 * that this one stays behind a press.
 *
 * `denied` is worth distinguishing from `dismissed`: a denial is close to
 * permanent and the reader has to go into browser settings to undo it, so a
 * caller must never offer to ask again after one.
 */
export async function subscribeToPush(
  username: string,
  publicKey: string,
): Promise<SubscribeResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "denied") return "denied";
    if (permission !== "granted") return "dismissed";

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Spread, not nested: the route reads `body.endpoint` and `body.keys`
      // directly (app/api/push/subscribe/route.ts).
      body: JSON.stringify({ user: username, ...sub.toJSON() }),
    });
    if (!res.ok) {
      // Leave nothing behind that the server does not know about: a live
      // browser subscription the server cannot send to is a reader who has
      // agreed to notifications and will never receive one.
      await sub.unsubscribe().catch(() => undefined);
      return "failed";
    }
    return "subscribed";
  } catch {
    return "failed";
  }
}
