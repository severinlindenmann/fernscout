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
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type SubscribeResult = "subscribed" | "denied" | "dismissed" | "unavailable" | "failed";

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
    /**
     * The browser's own push service can refuse, and one browser refuses by
     * default — B446.
     *
     * Brave ships with *Use Google services for push messaging* off, and this
     * call then rejects with an `AbortError`. Permission was granted a line
     * ago, the server has not been asked yet, and nothing the page does will
     * change it: it is the reader's setting. Told apart from every other
     * failure here so the copy can name it instead of inviting a retry that
     * cannot work.
     */
    let sub: PushSubscription;
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch (err) {
      console.warn("[fernscout] the browser refused to subscribe to push", err);
      return "unavailable";
    }

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
      console.warn("[fernscout] the server refused the subscription", res.status);
      await sub.unsubscribe().catch(() => undefined);
      return "failed";
    }
    return "subscribed";
  } catch (err) {
    // Say what went wrong somewhere. The reader gets one sentence and a
    // retry; whoever they send the screenshot to needs the error, and before
    // B446 this line threw it away — leaving a failure nobody could diagnose
    // from anything the page showed.
    console.warn("[fernscout] subscribing to push failed", err);
    return "failed";
  }
}

/**
 * The iPhone shell's own subscribe — B2115. Same shape as `subscribeToPush`
 * above (ask, then tell the server), but through
 * `@capacitor/push-notifications` instead of `PushManager`: there is no
 * encryption keypair, no push-service endpoint, only a device token Apple
 * hands back once registration succeeds. **Must be called from inside a
 * tap**, for the same reason `subscribeToPush` must: `requestPermissions()`
 * is what shows iOS's own permission dialog, once ever per install.
 *
 * The token is kept in `localStorage` so `unsubscribeNativePush` can tell
 * the server which row to drop later — the shell has no equivalent of
 * `pushManager.getSubscription()` to ask again.
 */
const NATIVE_TOKEN_KEY = (username: string) => `fs.push.apns.token.${username}`;

export async function subscribeToNativePush(username: string): Promise<SubscribeResult> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive === "denied") return "denied";
    if (permission.receive !== "granted") return "dismissed";

    const token = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));
      PushNotifications.addListener("registration", (t: { value: string }) => {
        finish(() => resolve(t.value));
      }).catch((err: unknown) => finish(() => reject(asError(err))));
      PushNotifications.addListener("registrationError", (err: { error: string }) => {
        finish(() => reject(new Error(err.error || "apns registration failed")));
      }).catch((err: unknown) => finish(() => reject(asError(err))));
      PushNotifications.register().catch((err: unknown) => finish(() => reject(asError(err))));
    });

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, kind: "apns", token }),
    });
    if (!res.ok) {
      console.warn("[fernscout] the server refused the apns subscription", res.status);
      return "failed";
    }
    window.localStorage.setItem(NATIVE_TOKEN_KEY(username), token);
    return "subscribed";
  } catch (err) {
    console.warn("[fernscout] subscribing to native push failed", err);
    return "failed";
  }
}

/** The stored token, if `subscribeToNativePush` ever ran on this device for
 * this journal — nothing to remove server-side otherwise. */
export async function unsubscribeNativePush(username: string): Promise<void> {
  const token = window.localStorage.getItem(NATIVE_TOKEN_KEY(username));
  if (!token) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: username, endpoint: token }),
  }).catch(() => undefined);
  window.localStorage.removeItem(NATIVE_TOKEN_KEY(username));
}
