"use client";

import { useEffect, useState } from "react";

/**
 * `navigator.onLine` — the network interface, not a probe of this server.
 * `useOutbox`'s own `/api/health` probe is the authoritative signal for the
 * write path (a queued write is never lost either way this reads wrong),
 * but wiring the same probe into every small "needs a signal" feature
 * (`PolishText` here; a plan search, a figure from a photo and Publish are
 * this wave's named remainders) would give each one its own `fetch` on
 * mount, competing with whatever that component's own tests already mock
 * `fetch` for. `navigator.onLine` is the cheap, good-enough signal for a tap
 * that already had its own failure handling before this ticket — greying it
 * out saves the tap, not the correctness the outbox owns.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}
