"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { committedDays } from "@/components/extract/PreviewScreen";
import { photosForDate } from "@/lib/extract/dayCount";
import { useI18n } from "@/components/LocaleProvider";
import type { RunManifest } from "@/lib/staging/manifest";

type RunResponse = { manifest: RunManifest; spentCredits?: number };

/**
 * S10b — "Ready". B1803 Task 3.7.
 *
 * The flow's real terminal screen: `ExtractFlow` renders this the moment
 * `left` becomes true, i.e. the instant `commitReadyDays`/`CreditsScreen`
 * finishes. Everything it names is real and already on disk — a day here
 * is one `commitReadyDays` actually committed (`PreviewScreen.committedDays`,
 * imported rather than re-derived, so the two screens can never disagree
 * about which days that is), and "Credits spent" is `spentOnRun`'s own
 * ledger read (`studio/run`'s `spentCredits`), never a number kept beside
 * it that could drift from what was actually charged.
 *
 * **"Saved as a draft" is the truth, not a hedge.** Every day named here
 * came out of a commit path that never publishes
 * (`test/extract-no-publish.test.ts`) — this screen does not merely say
 * "draft" to be careful, it is describing the one thing that could be true.
 *
 * **"Publish these days" is a link to the studio publish page, never a call this component
 * makes itself.** `test/extract-no-publish.test.ts` is explicit that
 * nothing under `components/extract/` may reach `POST .../day/publish` —
 * publishing is the owner's own call, made in words, from the agent room,
 * the same rule `PreviewScreen.tsx` already follows for its own "Open your
 * agent" link. A press here does not publish anything; it opens the one
 * place that can, with everything this screen just showed still true when
 * it lands there. `day/publish/route.ts`'s own "wizard's own publish
 * button" is a *different* wizard's button, outside this tree — not this
 * one.
 */
export default function ReadyScreen({
  username,
  runId,
  onPreview,
}: {
  username: string;
  runId: string;
  /** Opens `PreviewScreen` over the same run — the design's own back arrow
   *  the other direction. */
  onPreview: () => void;
}) {
  const { t, tn } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    try {
      const res = await fetch(
        `/api/helper/${encodeURIComponent(username)}/studio/run?run=${encodeURIComponent(runId)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as RunResponse);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, runId]);

  if (error) {
    return (
      <div className="mt-4">
        <p className="text-sm text-coral-600">{t("studio.photos.ready.error")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
        >
          {t("err.retry")}
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="mt-4 text-sm text-ink-secondary">{t("studio.photos.board.loading")}</p>;
  }

  const { manifest, spentCredits } = data;
  const days = committedDays(manifest);
  // Counted the way `lib/extract/commit.ts` actually moved them —
  // `photosForDate`, the one shared rule, not this screen's own reading of
  // `photo.date` (which missed every photograph the camera had dated and
  // nobody had touched) — B1803 final review, finding 3.
  const committedPhotos = days.flatMap((day) => photosForDate(manifest.photos, day.date));
  const photoCount = committedPhotos.length;
  const heldBack = committedPhotos.filter((p) => p.visibility === "private").length;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* S10b's own header (design-v2.html: `<div class="navbar"><span
       *  class="t">Ready</span></div>`) — no back arrow, unlike every other
       *  screen this flow draws: `ReadyScreen` is the flow's real terminal
       *  screen, reached the instant `commitReadyDays` finishes, and there
       *  is no earlier state in this run left to step back into. */}
      <p className="text-center text-sm font-semibold text-ink-strong">{t("studio.photos.ready.title")}</p>
      <div className="grid place-items-center py-2">
        <svg width="48" height="48" viewBox="0 0 32 32" aria-hidden="true">
          <path
            d="M5 27 C 11 22, 12 13, 20 6"
            fill="none"
            stroke="var(--color-yellow-300)"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <rect
            x="9"
            y="15"
            width="11"
            height="7.5"
            rx="1.6"
            transform="rotate(-38 14.5 18.75)"
            fill="var(--color-yellow-400)"
          />
          <circle cx="22" cy="6.5" r="3.2" fill="var(--color-green-500)" />
        </svg>
      </div>

      <div className="text-center">
        <h2 className="font-display text-xl font-semibold text-ink-strong">{t("studio.photos.ready.savedAsDraft")}</h2>
        <p className="mt-1 text-sm text-ink-secondary">{t("studio.photos.ready.nobodyCanSee")}</p>
      </div>

      <dl className="flex flex-col gap-2 rounded-2xl border border-line-faint bg-surface-raised p-4">
        <div className="flex items-center justify-between">
          <dt className="text-sm text-ink-secondary">{t("studio.photos.ready.days")}</dt>
          <dd className="text-sm font-semibold text-ink-strong">{days.length}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-sm text-ink-secondary">{t("studio.photos.ready.photographs")}</dt>
          <dd className="text-sm font-semibold text-ink-strong">{photoCount}</dd>
        </div>
        {heldBack > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-sm text-ink-secondary">{t("studio.photos.ready.heldBack")}</dt>
            <dd className="text-sm font-semibold text-ink-strong">
              {tn("studio.photos.ready.heldBackValue", heldBack, { count: String(heldBack) })}
            </dd>
          </div>
        )}
        {typeof spentCredits === "number" && spentCredits > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-sm text-ink-secondary">{t("studio.photos.ready.credits")}</dt>
            <dd className="text-sm font-semibold text-ink-strong">{spentCredits}</dd>
          </div>
        )}
      </dl>

      <div className="rounded-2xl border border-line-faint bg-surface-subtle p-4">
        <p className="text-sm font-semibold text-ink-strong">{t("studio.photos.ready.publishSeparate.title")}</p>
        <p className="mt-1 text-sm text-ink-secondary">{t("studio.photos.ready.publishSeparate.body")}</p>
      </div>

      <button
        type="button"
        onClick={onPreview}
        className="text-left text-sm font-semibold text-ink-strong underline"
      >
        {t("studio.photos.ready.previewLink")}
      </button>

      {/* B2169 — a link to the studio's publish page (B2140), never a call
          this component makes itself: publishing stays a separate, worded
          consent, one day at a time. */}
      <Link
        href={`/${encodeURIComponent(username)}/studio/day/publish`}
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
      >
        {t("studio.photos.ready.publish")}
      </Link>
      {/* B1803 final review, finding 9. This was a primary-looking button
       *  with an `onClick` that did nothing, which reads as broken. Leaving
       *  it as a draft is not an action to perform — it is already the
       *  state this screen is reporting — so the honest affordance is the
       *  way *out* of the flow: the trip these days landed in, or the
       *  journal itself when nothing was committed. Nothing is published,
       *  changed or written by following it. */}
      <Link
        href={manifest.tripId && days.length > 0 ? `/${username}/trips/${manifest.tripId}` : `/${username}`}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
      >
        {t("studio.photos.ready.keepAsDraft")}
      </Link>
    </div>
  );
}
