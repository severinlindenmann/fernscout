"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { subscribeToPush } from "./pushSubscribe";

/** iOS only allows Web Push from a PWA that's been added to the Home Screen —
 * there is no push at all in a normal Safari tab, however the page asks.
 * Exported for `PushInstallOnboarding`, which needs the same detection to
 * decide whether to show the install explainer at all — never on desktop. */
export function needsHomeScreenInstall() {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

/**
 * How long to wait for the service worker before giving up on it — B438.
 *
 * Generous on purpose. The cost of waiting too long is that the button appears
 * a moment late on a slow connection; the cost of not waiting long enough is
 * that it never appears at all, with nothing on the page to say why. Those are
 * not comparable, so this errs at the end that is merely untidy.
 */
const WORKER_WAIT_MS = 8000;

type State =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "off"
  | "on"
  | "blocked"
  /** The browser's push service refused — see `subscribeToPush`. B446. */
  | "unavailable"
  | "working"
  | "failed";

export default function PushOptIn({
  /**
   * The journal to subscribe to, for a mount with no trip in context — B439.
   *
   * A subscription has only ever been per **journal**: `push_subscriptions` is
   * keyed by username and endpoint, and `subscribersFor` takes a trip only to
   * answer who may be *told* about it. The trip context was how this component
   * found a username, not something it needed, and taking that as a limit is
   * what left the only switch inside the hero — which `TripStory` renders on
   * the story's landing step alone, so it vanishes the moment somebody starts
   * reading.
   */
  journal,
}: {
  journal?: string;
} = {}) {
  const { t } = useI18n();
  // The trip, when there is one — the hero. `journal` covers the mounts that
  // have no trip in context, such as the reader's own page. With neither there
  // is no journal to subscribe to and this renders nothing rather than
  // guessing one.
  const trip = useTrip();
  const username = journal ?? trip?.trip.username ?? null;
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const decide = async () => {
      if (!username) {
        if (!cancelled) setState("unsupported");
        return;
      }

      // The capability check comes first: with push off — server-wide, or
      // just for this journal — nothing below should run, and in particular
      // no VAPID key should ever need to exist. Checking this before the iOS
      // Home Screen test also means a disabled deployment shows no install
      // hint either, on any device.
      const res = await fetch(`/api/push/subscribe?user=${encodeURIComponent(username)}`)
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled) return;
      if (!res?.enabled || !res.publicKey) {
        setState("unsupported");
        return;
      }
      setPublicKey(res.publicKey);

      // On an iPhone in Safari the Push APIs exist but subscribing always
      // fails, so offering a button would be a lie. Tell them what to do
      // instead.
      if (needsHomeScreenInstall()) {
        if (!cancelled) setState("needs-install");
        return;
      }
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        if (!cancelled) setState("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }

      /**
       * Wait for the worker rather than sampling once — B438.
       *
       * `ServiceWorkerRegistrar` defers `register()` to the window `load`
       * event, and this effect runs at hydration, which is usually earlier.
       * A single `getRegistration()` therefore loses that race on a first
       * visit — and losing it set `unsupported`, which renders **null**. The
       * control did not appear, said nothing about why, and never re-checked;
       * only a reload brought it back. On a phone, where the load event comes
       * late and a cold PWA start later still, that is the common case rather
       * than the rare one.
       *
       * `.ready` is the right thing to wait on and cannot be waited on alone:
       * it never rejects, and with nothing ever registered it never settles
       * either — which is exactly the state a development build is in, and
       * would leave this component stuck on `checking` for ever. So it is
       * raced against a clock, and the clock losing is the only honest
       * `unsupported`.
       */
      const registered =
        (await navigator.serviceWorker.getRegistration()) ??
        (await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WORKER_WAIT_MS)),
        ]));
      if (cancelled) return;
      if (!registered) {
        setState("unsupported");
        return;
      }

      const existing = await registered.pushManager.getSubscription();
      if (!cancelled) setState(existing ? "on" : "off");
    };

    decide().catch(() => {
      if (!cancelled) setState("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const enable = useCallback(async () => {
    if (!publicKey || !username) return;
    setState("working");
    // Through the shared module, which is also what `PushPrompt` presses —
    // B440. Two copies of the VAPID dance is how one of them ends up passing
    // the key in the wrong encoding, or forgetting that the permission request
    // has to happen inside the click for Safari to accept it.
    const result = await subscribeToPush(username, publicKey);
    setState(
      result === "subscribed"
        ? "on"
        : result === "denied"
          ? "blocked"
          : result === "dismissed"
            ? "off"
            : result === "unavailable"
              ? "unavailable"
              : "failed",
    );
  }, [publicKey, username]);

  const disable = useCallback(async () => {
    if (!username) return;
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user: username, endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("failed");
    }
  }, [username]);

  if (state === "checking" || state === "unsupported") return null;

  // Three dead ends, and each one names what the reader would have to change:
  // add to the Home Screen, re-allow the permission, or switch the browser's
  // push service back on. None of them offers the button, because pressing it
  // again cannot work until they do — B446.
  if (state === "needs-install" || state === "blocked" || state === "unavailable") {
    return (
      <p className="mt-3 max-w-md text-[11px] leading-relaxed text-navy-500">
        {t(
          state === "needs-install"
            ? "push.iosInstall"
            : state === "blocked"
              ? "push.blocked"
              : "push.unavailable",
        )}
      </p>
    );
  }

  if (state === "on") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-navy-500">
        <span className="inline-flex items-center gap-1.5 font-medium text-green-700">
          <BellRing className="h-3.5 w-3.5" aria-hidden />
          {t("push.enabled")}
        </span>
        <button
          onClick={disable}
          className="inline-flex items-center gap-1 rounded-full border border-navy-200 bg-white px-2.5 py-1 font-semibold text-navy-700 transition-colors hover:border-navy-500"
        >
          <BellOff className="h-3 w-3" aria-hidden />
          {t("push.turnOff")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        onClick={enable}
        disabled={state === "working"}
        className="inline-flex items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-700 transition-colors hover:border-navy-500 disabled:opacity-50"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden />
        {state === "working" ? t("push.working") : t("push.enable")}
      </button>
      {state === "failed" && (
        <p className="mt-1.5 text-[11px] text-coral-600">{t("push.failed")}</p>
      )}
    </div>
  );
}
