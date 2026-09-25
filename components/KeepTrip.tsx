"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudCheck } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * "Save offline" — B2159, W43 §1.
 *
 * Asks the worker (`public/sw.js`, `fernscout-keep`) to fetch a whole trip
 * ahead, and reports what came back: progress, then *Saved offline · N MB*.
 * Hidden unless a worker controls the page, which rules out development
 * builds and browsers without one — there is nothing to keep into.
 *
 * The switch lives on the reader's own page (`OfflineTrips`, on `/me`) since
 * it is device housekeeping rather than a way into the reading; the trip's
 * hero only shows `KeptMark` once a trip is saved. The worker answers
 * whichever page asked, so keeping from `/me` needs nothing of the trip's.
 *
 * Whether the trip is already kept is read from the worker's own cache, by
 * name: the kept `keep.json` manifest holds the size estimate, so no second
 * bookkeeping exists to drift. The name's identity part is a wildcard here
 * because the page cannot know the reader's public id; the worker purges
 * every signed-in kept cache on sign-out, so what is found is the reader's.
 */
export type KeepState =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "keeping"; done: number; total: number }
  | { kind: "kept"; bytes: number; unpersisted?: boolean }
  | { kind: "refused"; bytes: number }
  | { kind: "failed" };

export function mb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

async function keptBytes(user: string, trip: string): Promise<number | null> {
  try {
    const suffix = `-${user}-${trip}`;
    const name = (await caches.keys()).find((k) => k.startsWith("kept-") && k.endsWith(suffix));
    if (!name) return null;
    const held = await (await caches.open(name)).match(
      `/${encodeURIComponent(user)}/trips/${encodeURIComponent(trip)}/keep.json`,
    );
    const manifest = held ? await held.json() : null;
    return typeof manifest?.bytes === "number" ? manifest.bytes : 0;
  } catch {
    return null;
  }
}

/** Said on `window` when something other than the worker emptied the kept
 *  caches (`ThisPhone`'s *Clear cache*), so every switch reads them again. */
export const KEPT_CHANGED = "fernscout-kept-changed";

/** One trip's offline copy: what the worker has, and the two requests. */
export function useKeptTrip(user: string, trip: string) {
  const [state, setState] = useState<KeepState>({ kind: "hidden" });

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    let cancelled = false;

    const onMessage = (event: MessageEvent) => {
      const m = event.data;
      if (!m || m.type !== "fernscout-kept" || m.user !== user || m.trip !== trip) return;
      if (m.state === "keeping") setState({ kind: "keeping", done: m.done, total: m.total });
      else if (m.state === "kept") void keptBytes(user, trip).then((bytes) => setState({ kind: "kept", bytes: bytes ?? 0 }));
      else if (m.state === "refused") setState({ kind: "refused", bytes: m.bytes });
      else if (m.state === "failed") setState({ kind: "failed" });
      else if (m.state === "gone") setState({ kind: "idle" });
    };
    const reread = () =>
      void keptBytes(user, trip).then((bytes) => {
        if (!cancelled) setState(bytes === null ? { kind: "idle" } : { kind: "kept", bytes });
      });
    reread();
    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener(KEPT_CHANGED, reread);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener(KEPT_CHANGED, reread);
    };
  }, [user, trip]);

  const post = (type: "fernscout-keep" | "fernscout-unkeep") =>
    navigator.serviceWorker.controller?.postMessage({ type, user, trip });

  const keep = async () => {
    setState({ kind: "keeping", done: 0, total: 0 });
    // Ask the browser not to evict the copy when space runs low. Refused is
    // survivable — the trip is still kept, only less firmly — and said once.
    let unpersisted = false;
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
        unpersisted = !(await navigator.storage.persist());
      }
    } catch {
      unpersisted = false;
    }
    try {
      if (unpersisted) sessionStorage.setItem("fernscout-keep-unpersisted", "1");
    } catch {
      // No session storage: the note is simply not shown.
    }
    post("fernscout-keep");
  };

  return { state, keep, remove: () => post("fernscout-unkeep") };
}

/**
 * The hero's only trace of it: a small cloud on the date line once this
 * browser holds the trip, linking to where the switch is. Nothing at all
 * while it is not kept — an offer to save belongs on `/me`, not on the trip.
 */
export function KeptMark({ user, trip }: { user: string; trip: string }) {
  const { t } = useI18n();
  const { state } = useKeptTrip(user, trip);
  if (state.kind !== "kept") return null;
  const label = t("keep.kept", { size: mb(state.bytes) });
  return (
    <Link
      href={`/${encodeURIComponent(user)}/me#offline`}
      prefetch={false}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center text-green-700"
    >
      <CloudCheck className="h-4 w-4" aria-hidden />
    </Link>
  );
}
