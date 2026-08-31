"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";

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

type State =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "off"
  | "on"
  | "blocked"
  | "working"
  | "failed";

export default function PushOptIn() {
  const { t } = useI18n();
  // TripHero — the only place this mounts — is always inside TripProvider,
  // so `username` is null only in the unexpected case where that stops being
  // true. Push has nothing to subscribe to without a trip in view, so it
  // degrades to rendering nothing rather than guessing a journal.
  const trip = useTrip();
  const username = trip?.trip.username ?? null;
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

      // `.ready` never rejects — with no worker registered it simply never
      // settles, and this component would sit in its initial state forever.
      // In development there deliberately is no worker at all.
      const registered = await navigator.serviceWorker.getRegistration();
      if (!registered) {
        if (!cancelled) setState("unsupported");
        return;
      }

      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const existing = await reg?.pushManager.getSubscription();
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
    try {
      // Must be inside the click for Safari to accept it.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: username, ...sub.toJSON() }),
      });
      setState(res.ok ? "on" : "failed");
    } catch {
      setState("failed");
    }
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

  if (state === "needs-install" || state === "blocked") {
    return (
      <p className="mt-3 max-w-md text-[11px] leading-relaxed text-navy-500">
        {state === "needs-install" ? t("push.iosInstall") : t("push.blocked")}
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
