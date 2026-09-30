"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import ConfirmPanel from "./ConfirmPanel";
import { KEPT_CHANGED, keptTripIds, mb, requestKeep, useKeptTrip } from "./KeepTrip";
import { Row, Switch } from "./studio/ThisPhone";
import { useNativeShell, useStandalone } from "./nativeShell";
import { clearKeptCaches } from "@/lib/keepCache";
import { autoSaveTargets, type OfflineTripMeta } from "@/lib/offlineTrips";

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
 *
 * B2463 added three things every reader now sees: the list is capped to kept
 * trips plus upcoming, current and the two most recent past ones (the rest
 * behind "Show N more trips" — same pattern `TripsIndexContent.tsx` uses for
 * its own locked trips), a "Clear saved trips" action, and a per-device
 * "Save recent trips automatically" switch, on by default in the shell or an
 * installed PWA and off in an ordinary tab.
 */
type Trip = OfflineTripMeta & { title: string };

/** Whether "Save recent trips automatically" is on — B2463. A device
 *  preference (never the reader's, which is why it is `localStorage` and not
 *  something the server keeps), read once per mount so the default (native
 *  shell or installed PWA: on; an ordinary tab: off) only applies before
 *  anybody has ever touched the switch. `null` means "not read yet", not
 *  "off" — the effect below must not fire on that transient guess. */
const AUTOSAVE_KEY = "fernscout-autosave-trips";

function readAutoSavePref(): boolean | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

function writeAutoSavePref(on: boolean) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, on ? "1" : "0");
  } catch {
    // No storage: the choice simply does not survive the page.
  }
}

/** Trips this device has already offered to auto-keep, so turning a switch
 *  off (or manually removing one) is not undone on the next render — B2463.
 *  Scoped per journal: a device visiting several journals must not treat one
 *  journal's trip ids as another's. */
function appliedKey(username: string): string {
  return `fernscout-autosave-applied:${username}`;
}

function readApplied(username: string): Set<string> {
  try {
    const raw = localStorage.getItem(appliedKey(username));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function markApplied(username: string, ids: string[]) {
  try {
    const existing = readApplied(username);
    for (const id of ids) existing.add(id);
    localStorage.setItem(appliedKey(username), JSON.stringify([...existing]));
  } catch {
    // Best effort — worst case an already-kept trip is asked for again.
  }
}

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
      out.push({ id: String(manifest.trip), title: String(manifest.title || manifest.trip), status: "past", end: "" });
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

/** "Clear saved trips" — B2463, reusing the exact logic `ThisPhone`'s
 *  owner-only *Clear cache* already has (`clearKeptCaches`), asked here
 *  through a page confirmation rather than a browser dialog, and offered to
 *  every reader rather than only the owner in the app or PWA. */
function ClearSavedTrips({ anyKept }: { anyKept: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; freed: number }>({
    kind: "idle",
  });

  async function clear() {
    setState({ kind: "busy" });
    const { freed } = await clearKeptCaches();
    window.dispatchEvent(new Event(KEPT_CHANGED));
    setState({ kind: "done", freed });
    setOpen(false);
  }

  if (state.kind === "done") {
    return <li className="px-4 py-3 text-sm text-ink-secondary">{t("keep.clearDone", { size: mb(state.freed) })}</li>;
  }
  // B2575 — nothing kept, nothing to clear.
  if (!anyKept) return null;
  if (open) {
    return (
      <li className="px-4 py-3">
        <ConfirmPanel
          label={t("keep.clear")}
          question={t("keep.clearQuestion")}
          confirmLabel={t("keep.clearConfirm")}
          busyLabel={t("keep.clearing")}
          tone="destructive"
          busy={state.kind === "busy"}
          onConfirm={() => void clear()}
          onCancel={() => setOpen(false)}
        />
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-2 px-4 py-3 text-left text-base font-semibold text-coral-600 transition-colors hover:bg-surface-subtle"
      >
        <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
        {t("keep.clear")}
      </button>
    </li>
  );
}

export default function OfflineTrips({ username, trips }: { username: string; trips: Trip[] }) {
  const { t } = useI18n();
  const controlled = useControlled();
  const native = useNativeShell();
  const standalone = useStandalone();
  const [stray, setStray] = useState<Trip[]>([]);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  // The persisted preference, read the same hydration-safe way `useNativeShell`
  // and `useStandalone` read theirs (server snapshot `null`, real value once
  // mounted) — a plain `useEffect` + `setState` for the first read would be
  // exactly the "cascading render" the lint rule warns about, for a value
  // that never changes from outside this tab anyway.
  const storedAutoSave = useSyncExternalStore(() => () => {}, readAutoSavePref, () => null);
  const [autoSaveOverride, setAutoSaveOverride] = useState<boolean | null>(null);
  const ids = trips.map((trip) => trip.id).join("\n");

  useEffect(() => {
    if (!controlled) return;
    let cancelled = false;
    const known = new Set(ids.split("\n"));
    const read = () =>
      void Promise.all([strayKept(username, known), keptTripIds(username, [...known])]).then(([found, keptIds]) => {
        if (cancelled) return;
        setStray(found);
        setKept(keptIds);
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

  // Default before the switch is ever touched: on inside the shell or an
  // installed PWA, off in an ordinary tab — D4's recommendation, so a laptop
  // visitor does not quietly download hundreds of megabytes.
  const autoSave = autoSaveOverride ?? storedAutoSave ?? (native || standalone);
  const setAutoSave = (on: boolean) => {
    setAutoSaveOverride(on);
    writeAutoSavePref(on);
  };

  useEffect(() => {
    if (!controlled || !autoSave) return;
    const targets = autoSaveTargets(trips);
    const applied = readApplied(username);
    const toKeep = targets.filter((id) => !kept.has(id) && !applied.has(id));
    if (toKeep.length === 0) return;
    markApplied(username, toKeep);
    for (const id of toKeep) void requestKeep(username, id);
  }, [controlled, autoSave, username, trips, kept]);

  if (!controlled || trips.length + stray.length === 0) return null;

  const alwaysShownIds = new Set([...autoSaveTargets(trips), ...kept]);
  const shown = expanded ? trips : trips.filter((trip) => alwaysShownIds.has(trip.id));
  const hiddenCount = trips.length - shown.length;

  return (
    <section id="offline" className="mt-6 scroll-mt-20">
      <h2 className="font-display text-xl font-semibold text-ink-strong">{t("keep.title")}</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-secondary">{t("keep.lede")}</p>
      <ul className="mt-3 divide-y divide-line-quiet overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
        <Row label={t("keep.autoSave")} hint={t("keep.autoSaveHint")}>
          <Switch on={autoSave} label={t("keep.autoSave")} onChange={() => setAutoSave(!autoSave)} />
        </Row>
        {[...shown, ...stray].map((trip) => (
          <TripSwitch key={trip.id} user={username} trip={trip} />
        ))}
        {!expanded && hiddenCount > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex min-h-12 w-full items-center px-4 py-2 text-left text-sm text-ink-secondary underline underline-offset-4 transition-colors hover:text-ink-strong"
            >
              {t("keep.showMore", { count: String(hiddenCount) })}
            </button>
          </li>
        )}
        <ClearSavedTrips anyKept={kept.size + stray.length > 0} />
      </ul>
    </section>
  );
}
