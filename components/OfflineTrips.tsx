"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "./LocaleProvider";
import { KEPT_CHANGED, mb, useKeptTrip } from "./KeepTrip";
import { Row, Switch } from "./studio/ThisPhone";

/**
 * "Offline on this device" — the reader's own page's list of trips this
 * browser can save for reading without a connection.
 *
 * It used to be a line on each trip's hero ("Kept on this phone · 29 MB ·
 * Remove"), which named the wrong device on a laptop and put housekeeping
 * among the ways into the reading. Here it is one switch per trip the reader
 * may open, and the hero keeps only a small mark (`KeptMark`) that links back.
 *
 * **Absent, not disabled, without a worker** — a development build, or a
 * browser with none, has nothing to keep into. The same test `useKeptTrip`
 * makes, so the section and its rows cannot disagree.
 */
type Trip = { id: string; title: string };

function TripSwitch({ user, trip }: { user: string; trip: Trip }) {
  const { t } = useI18n();
  const { state, keep, remove } = useKeptTrip(user, trip.id);
  if (state.kind === "hidden") return null;

  let unpersisted = false;
  try {
    unpersisted = sessionStorage.getItem("fernscout-keep-unpersisted") === "1";
  } catch {
    // No session storage: the note is simply not shown.
  }
  const hint =
    state.kind === "kept"
      ? t("keep.kept", { size: mb(state.bytes) }) + (unpersisted ? ` ${t("keep.unpersisted")}` : "")
      : state.kind === "keeping"
        ? state.total
          ? t("keep.keeping", { done: String(state.done), total: String(state.total) })
          : t("keep.starting")
        : state.kind === "refused"
          ? t("keep.refused", { size: mb(state.bytes) })
          : state.kind === "failed"
            ? t("keep.failed")
            : t("keep.notKept");
  const on = state.kind === "kept" || state.kind === "keeping";

  return (
    <Row label={trip.title} hint={hint}>
      <Switch
        on={on}
        busy={state.kind === "keeping"}
        // A trip over the size limit cannot be kept, and saying so on the
        // row is the whole answer; a switch that flips back is not.
        disabled={state.kind === "refused"}
        label={t("keep.action")}
        onChange={() => void (state.kind === "kept" ? remove() : keep())}
      />
    </Row>
  );
}

/** Trips of this journal this browser still holds but the reader can no
 *  longer open (or that were renamed away) — offered for removal only. */
async function strayKept(user: string, known: Set<string>): Promise<Trip[]> {
  const out: Trip[] = [];
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith("kept-") || name.endsWith("-building")) continue;
      const cache = await caches.open(name);
      const held = (await cache.keys()).find((k) => k.url.endsWith("/keep.json"));
      const manifest = held ? await (await cache.match(held))?.json() : null;
      if (!manifest || manifest.user !== user || known.has(manifest.trip)) continue;
      out.push({ id: String(manifest.trip), title: String(manifest.title || manifest.trip) });
    }
  } catch {
    // No Cache API, or storage refused: nothing kept to list.
  }
  return out;
}

function subscribeController(onChange: () => void) {
  navigator.serviceWorker?.addEventListener("controllerchange", onChange);
  return () => navigator.serviceWorker?.removeEventListener("controllerchange", onChange);
}

/** Whether a worker controls this page — false on the server and before
 *  hydration, so the section is never in the server's HTML. */
function useControlled(): boolean {
  return useSyncExternalStore(
    subscribeController,
    () => "serviceWorker" in navigator && !!navigator.serviceWorker.controller,
    () => false,
  );
}

export default function OfflineTrips({ username, trips }: { username: string; trips: Trip[] }) {
  const { t } = useI18n();
  const controlled = useControlled();
  const [stray, setStray] = useState<Trip[]>([]);
  const ids = trips.map((trip) => trip.id).join("\n");

  useEffect(() => {
    if (!controlled) return;
    let cancelled = false;
    const read = () =>
      void strayKept(username, new Set(ids.split("\n"))).then((found) => {
        if (!cancelled) setStray(found);
      });
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "fernscout-kept") read();
    };
    read();
    navigator.serviceWorker.addEventListener("message", onMessage);
    window.addEventListener(KEPT_CHANGED, read);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener(KEPT_CHANGED, read);
    };
  }, [controlled, username, ids]);

  if (!controlled || trips.length + stray.length === 0) return null;

  return (
    <section id="offline" className="mt-6 scroll-mt-20">
      <h2 className="font-display text-xl font-semibold text-ink-strong">{t("keep.title")}</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-secondary">{t("keep.lede")}</p>
      <ul className="mt-3 divide-y divide-line-quiet overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
        {[...trips, ...stray].map((trip) => (
          <TripSwitch key={trip.id} user={username} trip={trip} />
        ))}
      </ul>
    </section>
  );
}
