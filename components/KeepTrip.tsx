"use client";

import { useEffect, useState } from "react";
import { Check, Download } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * "Keep on this phone" — B2159, W43 §1.
 *
 * Asks the worker (`public/sw.js`, `fernscout-keep`) to fetch a whole trip
 * ahead, then shows what came back: progress, then *Kept · N MB · Remove*.
 * Renders nothing unless a worker controls the page, which rules out
 * development builds and browsers without one — there is nothing to keep
 * into.
 *
 * Whether the trip is already kept is read from the worker's own cache, by
 * name: the kept `keep.json` manifest holds the size estimate, so no second
 * bookkeeping exists to drift. The name's identity part is a wildcard here
 * because the page cannot know the reader's public id; the worker purges
 * every signed-in kept cache on sign-out, so what is found is the reader's.
 */
type State =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "keeping"; done: number; total: number }
  | { kind: "kept"; bytes: number; unpersisted?: boolean }
  | { kind: "refused"; bytes: number }
  | { kind: "failed" };

function mb(bytes: number): string {
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

export default function KeepTrip({
  user,
  trip,
  className,
}: {
  user: string;
  trip: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "hidden" });

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    let cancelled = false;
    void keptBytes(user, trip).then((bytes) => {
      if (cancelled) return;
      setState(bytes === null ? { kind: "idle" } : { kind: "kept", bytes });
    });

    const onMessage = (event: MessageEvent) => {
      const m = event.data;
      if (!m || m.type !== "fernscout-kept" || m.user !== user || m.trip !== trip) return;
      if (m.state === "keeping") setState({ kind: "keeping", done: m.done, total: m.total });
      else if (m.state === "kept") void keptBytes(user, trip).then((bytes) => setState({ kind: "kept", bytes: bytes ?? 0 }));
      else if (m.state === "refused") setState({ kind: "refused", bytes: m.bytes });
      else if (m.state === "failed") setState({ kind: "failed" });
      else if (m.state === "gone") setState({ kind: "idle" });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [user, trip]);

  if (state.kind === "hidden") return null;

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
    if (unpersisted) sessionStorage.setItem("fernscout-keep-unpersisted", "1");
    post("fernscout-keep");
  };

  if (state.kind === "kept") {
    const unpersisted = sessionStorage.getItem("fernscout-keep-unpersisted") === "1";
    return (
      <span className={`inline-flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-ink-secondary ${className ?? ""}`}>
        <Check className="h-4 w-4 text-green-700" aria-hidden />
        {t("keep.kept", { size: mb(state.bytes) })}
        <button type="button" onClick={() => post("fernscout-unkeep")} className="font-semibold underline decoration-line-quiet underline-offset-4 hover:text-ink-strong">
          {t("keep.remove")}
        </button>
        {unpersisted && <span className="basis-full text-xs">{t("keep.unpersisted")}</span>}
      </span>
    );
  }

  if (state.kind === "keeping") {
    return (
      <span className={`inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-secondary ${className ?? ""}`} aria-live="polite">
        <Download className="h-4 w-4 animate-pulse" aria-hidden />
        {state.total ? t("keep.keeping", { done: String(state.done), total: String(state.total) }) : t("keep.starting")}
      </span>
    );
  }

  return (
    <button type="button" onClick={keep} className={className} title={state.kind === "refused" ? t("keep.refused", { size: mb(state.bytes) }) : undefined}>
      <Download className="h-4 w-4" aria-hidden />
      {state.kind === "refused"
        ? t("keep.refused", { size: mb(state.bytes) })
        : state.kind === "failed"
          ? t("keep.failed")
          : t("keep.action")}
    </button>
  );
}
