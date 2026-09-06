"use client";

import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import type { TranslationKey } from "@/lib/i18n";
import { DAY_LAYOUTS, type DayLayout, type DayPlan, type Focal } from "@/lib/photobook/options";
import type { MediaTile } from "@/lib/types";

/** What each arrangement is called on the page. `auto` first, because it is
 * what every day starts as and what most days should stay. */
const LAYOUT_LABEL: Record<DayLayout, TranslationKey> = {
  auto: "photobook.day.layout.auto",
  hero: "photobook.day.layout.hero",
  single: "photobook.day.layout.single",
  pair: "photobook.day.layout.pair",
  grid: "photobook.day.layout.grid",
  text: "photobook.day.layout.text",
};

/**
 * Level 2 — one day's controls, drilled into from its spread in the preview.
 *
 * Replaces the old day accordion outright (B534): there is now exactly one
 * way to reach these, not two. The spread this day prints as sits directly
 * beneath, in `PhotobookPageContent`, rather than at the opposite end of the
 * page.
 */
export default function DayControls({
  day,
  dayPhotos,
  plan,
  layout,
  truncated,
  focalEditing,
  focalOf,
  setDayLayout,
  setDayRunOn,
  setHero,
  movePhoto,
  toggleDayPhoto,
  resetDay,
  applyLayoutToAll,
  setFocalEditing,
  setFocalFromTap,
  nudgeFocalByKey,
  resetFocal,
  t,
}: {
  day: { date: string; title: string; location: string };
  dayPhotos: MediaTile[];
  plan: DayPlan | undefined;
  layout: DayLayout;
  truncated: boolean;
  focalEditing: string | null;
  focalOf: (src: string) => Focal;
  setDayLayout: (date: string, layout: DayLayout) => void;
  setDayRunOn: (date: string, runOn: boolean) => void;
  setHero: (date: string, src: string) => void;
  movePhoto: (date: string, src: string, by: -1 | 1, dayPhotos: MediaTile[]) => void;
  toggleDayPhoto: (date: string, src: string, dayPhotos: MediaTile[]) => void;
  resetDay: (date: string, dayPhotos: MediaTile[]) => void;
  applyLayoutToAll: (layout: DayLayout) => void;
  setFocalEditing: (src: string | null) => void;
  setFocalFromTap: (src: string, e: React.MouseEvent<HTMLElement>) => void;
  nudgeFocalByKey: (src: string, e: React.KeyboardEvent<HTMLElement>) => void;
  resetFocal: (src: string) => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  const chosen = plan?.photos ?? dayPhotos.map((m) => m.src);
  const included = new Set(chosen);
  const ordered = plan?.photos
    ? [...dayPhotos].sort((a, b) => {
        const rank = new Map(plan.photos!.map((src, i) => [src, i]));
        return (rank.get(a.src) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.src) ?? Number.MAX_SAFE_INTEGER);
      })
    : dayPhotos;

  return (
    <div className="rounded-lg border border-navy-200 bg-white px-3 py-3">
      <p className="text-sm font-semibold text-navy-800">{t("photobook.day.heading")}</p>
      <p className="mt-1 text-xs text-navy-600">{t("photobook.day.hint")}</p>

      {/* A radio group, not six toggle buttons. They are mutually exclusive —
          exactly one is true — and `aria-pressed` on each said the opposite:
          a screen reader announced six independent toggles, any of which
          might be on. */}
      <div
        role="radiogroup"
        aria-label={t("photobook.day.layoutLegend")}
        className="mt-3 flex flex-wrap gap-1"
      >
        {DAY_LAYOUTS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={layout === option}
            onClick={() => setDayLayout(day.date, option)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
              layout === option
                ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                : "border-navy-200 text-navy-700"
            }`}
          >
            {t(LAYOUT_LABEL[option])}
          </button>
        ))}
      </div>

      {/* Only worth showing where it would do something: a day already
          fitting its column has no overflow for a second page to solve —
          B517. Once turned on, kept visible even if a photograph change
          stops it overflowing, so the box stays reachable to turn back off. */}
      {(truncated || plan?.runOn) && (
        <label className="mt-2 flex items-start gap-2 text-xs text-navy-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={plan?.runOn === true}
            onChange={(e) => setDayRunOn(day.date, e.target.checked)}
          />
          <span>
            <span className="block font-semibold text-navy-800">{t("photobook.day.runOn")}</span>
            <span className="block text-navy-600">{t("photobook.day.runOnHint")}</span>
          </span>
        </label>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => applyLayoutToAll(layout)}
          className="text-xs font-semibold text-navy-600 underline"
        >
          {t("photobook.day.applyToAll")}
        </button>
        {/* Only for a day the owner has actually touched — plan is undefined
            for every day still left to the planner, and a button that undoes
            nothing has no reason to be there. */}
        {plan && (
          <button
            type="button"
            onClick={() => resetDay(day.date, dayPhotos)}
            className="text-xs font-semibold text-navy-600 underline"
          >
            {t("photobook.day.reset")}
          </button>
        )}
      </div>

      {dayPhotos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {ordered.map((tile, i) => {
            const inBook = included.has(tile.src);
            // Starred only when the owner picked one. Starring whatever the
            // planner would choose anyway would claim a decision nobody made.
            const isHero = plan?.hero === tile.src;
            // A "text" day prints none of its photographs — B513's rule that
            // a crop control is only ever shown where cropping is something
            // that actually happens.
            const croppable = inBook && layout !== "text";
            return (
              <li key={tile.src} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleDayPhoto(day.date, tile.src, dayPhotos)}
                  aria-pressed={inBook}
                  aria-label={
                    tile.caption ||
                    t("photobook.option.photoName", { index: String(i + 1), total: String(dayPhotos.length) })
                  }
                  className={`relative block aspect-square w-full overflow-hidden rounded-md border ${
                    inBook ? "border-yellow-500" : "border-navy-200 opacity-30"
                  }`}
                >
                  <Image src={tile.src} loader={mediaLoader} alt="" fill sizes="10vw" className="object-cover" />
                  {isHero && (
                    <span
                      aria-hidden
                      className="absolute left-1 top-1 rounded-full bg-yellow-400 px-1.5 text-[10px] font-bold text-yellow-950"
                    >
                      ★
                    </span>
                  )}
                </button>
                {/* Only for photographs that are in the book: nudging the
                    order of one that is not would be a control with no
                    visible effect. */}
                {inBook && (
                  <div className="flex items-center justify-between gap-0.5">
                    <button
                      type="button"
                      onClick={() => movePhoto(day.date, tile.src, -1, dayPhotos)}
                      aria-label={t("photobook.day.moveEarlier")}
                      className="min-h-8 flex-1 rounded border border-navy-200 text-xs text-navy-600"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => setHero(day.date, tile.src)}
                      aria-pressed={isHero}
                      aria-label={t("photobook.day.makeBig")}
                      className={`min-h-8 flex-1 rounded border text-xs ${
                        isHero ? "border-yellow-600 bg-yellow-400 text-yellow-950" : "border-navy-200 text-navy-600"
                      }`}
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(day.date, tile.src, 1, dayPhotos)}
                      aria-label={t("photobook.day.moveLater")}
                      className="min-h-8 flex-1 rounded border border-navy-200 text-xs text-navy-600"
                    >
                      ›
                    </button>
                  </div>
                )}
                {/* The crop control itself — B513. Hidden for a photograph
                    that would print whole: offering it there is a control
                    that does nothing. */}
                {croppable && (
                  <button
                    type="button"
                    onClick={() => setFocalEditing(focalEditing === tile.src ? null : tile.src)}
                    aria-pressed={focalEditing === tile.src}
                    aria-label={t("photobook.day.adjustCrop")}
                    className={`min-h-8 w-full rounded border text-xs ${
                      focalEditing === tile.src
                        ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                        : "border-navy-200 text-navy-600"
                    }`}
                  >
                    {t("photobook.day.adjustCrop")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The editor for whichever photograph on this day is being adjusted,
          one at a time and outside the grid so it can be shown larger than a
          3-column thumbnail — tapping it, or pressing the arrow keys once it
          has focus, moves the point `cover()` crops from. */}
      {focalEditing && dayPhotos.some((m) => m.src === focalEditing) && (
        <div className="mt-3 border-t border-navy-100 pt-3">
          <p className="text-xs text-navy-600">{t("photobook.day.cropHint")}</p>
          <button
            type="button"
            onClick={(e) => setFocalFromTap(focalEditing, e)}
            onKeyDown={(e) => nudgeFocalByKey(focalEditing, e)}
            aria-label={t("photobook.day.cropAriaLabel")}
            className="relative mt-2 block aspect-square w-40 max-w-full overflow-hidden rounded-md border border-navy-300"
          >
            <Image
              src={focalEditing}
              loader={mediaLoader}
              alt=""
              fill
              sizes="10vw"
              className="object-cover"
              style={{
                objectPosition: `${focalOf(focalEditing).x * 100}% ${focalOf(focalEditing).y * 100}%`,
              }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-400 bg-yellow-400/60"
              style={{
                left: `${focalOf(focalEditing).x * 100}%`,
                top: `${focalOf(focalEditing).y * 100}%`,
              }}
            />
          </button>
          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => resetFocal(focalEditing)}
              className="text-xs font-semibold text-navy-600 underline"
            >
              {t("photobook.day.cropReset")}
            </button>
            <button
              type="button"
              onClick={() => setFocalEditing(null)}
              className="text-xs font-semibold text-navy-600 underline"
            >
              {t("photobook.day.cropDone")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
