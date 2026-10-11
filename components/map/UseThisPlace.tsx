"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { placePatch, type PlaceCandidate } from "@/lib/map/usePlace";

const LINK =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-sm font-semibold text-ink-secondary " +
  "underline decoration-line-quiet underline-offset-2 hover:text-ink-strong " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

/**
 * B-2996 — owner only (the parent gates with `canOfferPlace`). The lookup runs
 * on the owner's tap, never on its own; the owner picks, and only the
 * coordinates are written through the studio's own day PATCH.
 */
export default function UseThisPlace({ username, tripId, slug, name }: { username: string; tripId: string; slug: string; name: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, setState] = useState<"closed" | "loading" | "list" | "failed" | "saving">("closed");
  const [results, setResults] = useState<PlaceCandidate[]>([]);

  async function open() {
    setState("loading");
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/plan/search?q=${encodeURIComponent(name.trim())}`);
      if (!res.ok) throw new Error("lookup");
      const json = (await res.json()) as { results?: PlaceCandidate[] };
      setResults((json.results ?? []).slice(0, 5));
      setState("list");
    } catch {
      setState("failed");
    }
  }

  async function pick(c: PlaceCandidate) {
    setState("saving");
    try {
      const res = await fetch(
        `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(slug)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(placePatch(c)) },
      );
      if (!res.ok) throw new Error("write");
      router.refresh();
      setState("closed");
    } catch {
      setState("failed");
    }
  }

  if (state === "closed") {
    return (
      <button type="button" onClick={open} className={LINK} data-use-this-place>
        <MapPin className="h-4 w-4" aria-hidden />
        {t("map.usePlace")}
      </button>
    );
  }
  return (
    <div className="col-span-2 w-full rounded-xl border border-line-quiet bg-surface-raised p-3 text-sm text-ink-body" data-use-place-panel>
      {state === "loading" || state === "saving" ? (
        <p>{t("map.usePlace.busy")}</p>
      ) : state === "failed" ? (
        <p>{t("map.usePlace.failed")}</p>
      ) : results.length === 0 ? (
        <p>{t("map.usePlace.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {results.map((c, i) => (
            <li key={`${c.displayName}-${i}`}>
              <button type="button" onClick={() => pick(c)} className="block min-h-11 w-full rounded-lg px-2 py-1 text-left hover:bg-surface-subtle">
                <span className="block font-semibold text-ink-strong">{c.displayName}</span>
                <span className="block text-xs text-ink-secondary">
                  {[c.country, t("studio.plan.composer.source.place-query")].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setState("closed")} className={`mt-1 ${LINK}`}>
        {t("map.usePlace.close")}
      </button>
    </div>
  );
}
