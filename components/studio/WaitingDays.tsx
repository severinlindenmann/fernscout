"use client";

import { useState } from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { UNDATED, type WaitingDays as Model } from "@/lib/studio/dayCards";

const SHOWN = 5;
const LINK = "inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2";
const PILL =
  "inline-flex min-h-11 flex-none items-center rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

/**
 * "Waiting for your words" — B2193. One card per day that has photographs
 * waiting in the inbox; "Write about it" opens the composer with exactly
 * that day's photographs chosen. Nothing is created until the owner saves
 * there. A day no trip covers offers to start one over the run of such
 * days, name left empty. Photographs with no date are listed apart and
 * asked about. Absent when nothing waits.
 */
export default function WaitingDays({ username, model, canWrite }: { username: string; model?: Model; canWrite: boolean }) {
  const { t, tn, formatLongDate, formatShortDate } = useI18n();
  const [all, setAll] = useState(false);
  // Undated photographs need a trip to go on; before the first there is
  // nothing to ask about them yet.
  const undated = canWrite ? (model?.undatedIds.length ?? 0) : 0;
  if (!model || (model.cards.length === 0 && undated === 0)) return null;
  const cards = all ? model.cards : model.cards.slice(0, SHOWN);
  const more = model.cards.length - cards.length;
  const thumb = (id: string) => `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(id)}/thumbnail?w=200`;
  const range = (r: { start: string; end: string }) =>
    r.start === r.end ? formatShortDate(r.start) : `${formatShortDate(r.start)} – ${formatShortDate(r.end)}`;

  return (
    <section
      id="waiting"
      data-waiting-days
      aria-labelledby="h-waiting"
      className="mt-3 scroll-mt-20 rounded-2xl border border-line-faint bg-surface-raised px-3 pb-1.5 pt-3"
    >
      <h2 id="h-waiting" className="px-1 font-display text-[19px] font-semibold text-ink-strong">
        {t("studio.hub.waiting.heading")}
      </h2>
      <ul className="mt-1 divide-y divide-line-faint">
        {cards.map((card, i) => (
          <li key={card.date} data-day-card={card.date} className="flex flex-wrap items-center gap-3 px-1 py-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- an owner-only route, not an optimisable asset */}
            <img src={thumb(card.photoIds[0])} alt="" className="size-14 flex-none rounded-lg bg-surface-subtle object-cover" />
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-[15px] font-semibold leading-tight text-ink-strong">{formatLongDate(card.date, { year: true })}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">
                {[card.place, tn("studio.hub.waiting.photos", card.photoIds.length, { count: String(card.photoIds.length) })]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {/* Said once per run of uncovered days, on its first card. */}
              {card.newTrip && cards[i - 1]?.newTrip?.start !== card.newTrip.start && (
                <>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{t("studio.hub.waiting.noTrip")}</span>
                  <Link href={`/${username}/studio/trip/new?start=${card.newTrip.start}&end=${card.newTrip.end}`} className={LINK}>
                    {t("studio.hub.waiting.startTrip", { range: range(card.newTrip) })}
                  </Link>
                </>
              )}
            </span>
            {canWrite && (
              <Link href={`/${username}/studio/day/new?photos=${card.date}&from=hub`} className={PILL}>
                {t("studio.hub.waiting.write")}
              </Link>
            )}
          </li>
        ))}
        {undated > 0 && (
          <li data-day-card={UNDATED} className="flex flex-wrap items-center gap-3 px-1 py-2.5">
            <span aria-hidden className="grid size-14 flex-none place-items-center rounded-lg bg-surface-subtle text-ink-secondary">
              <ImageOff size={20} />
            </span>
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-[15px] font-semibold leading-tight text-ink-strong">
                {tn("studio.hub.waiting.undated", undated, { count: String(undated) })}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{t("studio.hub.waiting.undatedHint")}</span>
            </span>
            <Link href={`/${username}/studio/day/new?photos=${UNDATED}&from=hub`} className={PILL}>
              {t("studio.hub.waiting.chooseDay")}
            </Link>
          </li>
        )}
      </ul>
      {more > 0 && (
        <button type="button" onClick={() => setAll(true)} className={`${LINK} px-1`}>
          {tn("studio.hub.waiting.more", more, { count: String(more) })}
        </button>
      )}
    </section>
  );
}
