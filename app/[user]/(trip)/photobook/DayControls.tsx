"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Crop, Star } from "lucide-react";
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
  setDayExcluded,
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
  /** Leave the whole day out of the book, or put it back — B564. */
  setDayExcluded: (date: string, excluded: boolean) => void;
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
  const excluded = plan?.excluded === true;
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

      {/* The one editorial act that was missing — B564. Beside the day's own
          controls rather than buried in a menu, because leaving a day out is
          not a smaller decision than any of the others here. Everything below
          this is a decision about a day that is actually going to print, so
          it stays hidden while this is on — there is nothing there to arrange
          until the day is back in. */}
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-navy-200 bg-cream-50 px-2.5 py-2 text-xs text-navy-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={excluded}
          onChange={(e) => setDayExcluded(day.date, e.target.checked)}
        />
        <span>
          <span className="block font-semibold text-navy-800">{t("photobook.day.exclude")}</span>
          <span className="block text-navy-600">{t("photobook.day.excludeHint")}</span>
        </span>
      </label>

      {excluded ? null : (
        <>
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
        // Which photograph prints big is one choice for the whole day —
        // mutually exclusive across every tile below, same as the layout
        // picker above, so it is a radiogroup rather than a scattered row of
        // independent `aria-pressed` stars. The other controls in here
        // (include/exclude, crop) are each independent per photograph and
        // stay plain buttons.
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("photobook.day.heroLegend")}>
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
                      className="absolute left-1 top-1 rounded-full bg-yellow-400 p-0.5 text-yellow-950"
                    >
                      <Star className="h-3 w-3" fill="currentColor" />
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
                      className="flex min-h-8 flex-1 items-center justify-center rounded border border-navy-200 text-navy-600"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      role="radio"
                      onClick={() => setHero(day.date, tile.src)}
                      aria-checked={isHero}
                      aria-label={t("photobook.day.makeBig")}
                      className={`flex min-h-8 flex-1 items-center justify-center rounded border ${
                        isHero ? "border-yellow-600 bg-yellow-400 text-yellow-950" : "border-navy-200 text-navy-600"
                      }`}
                    >
                      <Star className="h-4 w-4" aria-hidden fill={isHero ? "currentColor" : "none"} />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(day.date, tile.src, 1, dayPhotos)}
                      aria-label={t("photobook.day.moveLater")}
                      className="flex min-h-8 flex-1 items-center justify-center rounded border border-navy-200 text-navy-600"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
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
                    className={`flex min-h-8 w-full items-center justify-center gap-1 rounded border text-xs ${
                      focalEditing === tile.src
                        ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                        : "border-navy-200 text-navy-600"
                    }`}
                  >
                    <Crop className="h-3.5 w-3.5" aria-hidden />
                    {t("photobook.day.adjustCropShort")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}

      {/* The editor for whichever photograph on this day is being adjusted,
          one at a time and outside the grid so it can be shown larger than a
          3-column thumbnail — tapping it, or pressing the arrow keys once it
          has focus, moves the point `cover()` crops from. */}
      {!excluded && focalEditing && dayPhotos.some((m) => m.src === focalEditing) && (
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
