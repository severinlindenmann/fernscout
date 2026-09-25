"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { hasOutbox, openOutboxStore, runOutbox, type OutboxIntent, type OutboxStore } from "@/lib/outbox";
import { drainNativeUploads, isNativeShell, nativeMediaHandoff } from "@/components/nativeShell";

/** 30s — "every 30 s while open and online" (B2329). */
const SYNC_INTERVAL_MS = 30_000;

export interface OutboxCounts {
  /** Not yet sent, still waiting for a connection or a turn. */
  pending: number;
  /** Sent, but the server's answer did not match what we sent — B2331 shows
   *  these; this wave only counts them. */
  conflicts: number;
  /** A replay pass is running right now. */
  syncing: boolean;
  online: boolean;
}

/**
 * The studio's own outbox for one owner — counts for the status pill
 * (`StudioBar.tsx`) and the sign-out confirmation, and the runner that
 * empties the queue.
 *
 * Runs on mount, on the browser's `online` event, and every
 * `SYNC_INTERVAL_MS` while the tab is open and online — B2329. Nothing here
 * enqueues a write; that is B2330's job, through `lib/outbox.ts` directly.
 *
 * A no-op (all zero, nothing scheduled) wherever `hasOutbox()` is false — an
 * old browser with no IndexedDB simply has no queue, not a broken one.
 */
export function useOutbox(user: string): OutboxCounts {
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const storeRef = useRef<OutboxStore | null>(null);
  const enabled = useMemo(() => hasOutbox(), []);

  useEffect(() => {
    if (!enabled) return;
    storeRef.current = openOutboxStore();
    let cancelled = false;

    const refreshCounts = async () => {
      const rows = await storeRef.current!.list(user).catch(() => []);
      if (cancelled) return;
      setPending(rows.filter((r) => r.state === "pending").length);
      setConflicts(rows.filter((r) => r.state === "conflict").length);
    };

    // `navigator.onLine` reflects the network interface, not this server —
    // it stays `true` with the wifi up and `next start` dead, which is
    // exactly the acceptance this pill exists for. So the authoritative
    // signal is a real request's own outcome, not the browser's flag: this
    // one-liner probe on `/api/health` (public, unauthenticated, already
    // used for exactly this "is the server there" question) is what actually
    // flips `online`. `navigator.onLine` is still checked first as a fast,
    // free skip — no point spending a request when the interface itself is
    // known to be down.
    const probe = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setOnline(false);
        return false;
      }
      try {
        await fetch("/api/health", { cache: "no-store" });
        if (!cancelled) setOnline(true);
        return true;
      } catch {
        if (!cancelled) setOnline(false);
        return false;
      }
    };

    // B2330 — the iPhone shell's own upload for a queued `media.upload`:
    // a native background `URLSession` instead of `fetch`, so it keeps
    // going with this tab suspended or the app closed. `undefined` outside
    // the shell, so `runOutbox`'s ordinary web path is exactly what it was.
    const nativeUpload = isNativeShell()
      ? (intent: OutboxIntent) =>
          intent.blob
            ? nativeMediaHandoff(intent.id, intent.blob, (intent.body as { filename?: string } | null)?.filename ?? "photo")
            : Promise.resolve(false)
      : undefined;

    const sync = async () => {
      if (!(await probe())) return;
      setSyncing(true);
      if (isNativeShell()) await drainNativeUploads(storeRef.current!, user).catch(() => undefined);
      await runOutbox(storeRef.current!, user, fetch, nativeUpload).catch(() => undefined);
      if (!cancelled) await refreshCounts();
      if (!cancelled) setSyncing(false);
    };

    void refreshCounts();
    void sync();

    const onOnline = () => void sync();
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `enabled` only ever flips at mount (feature detection), not per-render.
  }, [user]);

  return { pending, conflicts, syncing, online };
}
