"use client";

import type { TranslationKey } from "@/lib/i18n";
import type { BookOptions, DayLayout, DayPlan, Focal } from "@/lib/photobook/options";
import type { MediaTile } from "@/lib/types";
import BookSettingsPanel from "./BookSettingsPanel";
import DayControls from "./DayControls";

export type Drill = { date: string } | null;

/**
 * Level 2 — one day's controls, with the spread it describes directly
 * beneath — B534.
 *
 * A day is reached by tapping its spread in the level-1 preview. Front
 * matter (title, route, costs, colophon) does not drill at all — B563: it
 * has no per-item settings of its own, everything about it is book-wide (the
 * cover, the map, the cost summary), and those already live in level 1's own
 * whole-book settings. A drill-in that only ever showed that same panel
 * again was a door onto an empty room next to the real one.
 *
 * "Back" only ever clears `drill` — nothing here is state of its own, so
 * there is nothing to lose by leaving.
 */
export default function DayLevelView({
  drill,
  onBack,
  day,
  dayPhotos,
  plan,
  layout,
  truncated,
  focalEditing,
  focalOf,
  setDayLayout,
  setDayRunOn,
  setDayText,
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
  options,
  setOptions,
  media,
  locales,
  resetBook,
  canReset,
  sliceHtml,
  ratio,
  t,
}: {
  drill: Drill;
  onBack: () => void;
  day: { date: string; title: string; location: string } | undefined;
  dayPhotos: MediaTile[];
  plan: DayPlan | undefined;
  layout: DayLayout;
  truncated: boolean;
  focalEditing: string | null;
  focalOf: (src: string) => Focal;
  setDayLayout: (date: string, layout: DayLayout) => void;
  setDayRunOn: (date: string, runOn: boolean) => void;
  setDayText: (date: string, wanted: boolean) => void;
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
  options: BookOptions;
  setOptions: (update: (o: BookOptions) => BookOptions) => void;
  media: MediaTile[];
  locales: string[];
  resetBook: () => void;
  canReset: boolean;
  sliceHtml: string | null;
  /** One spread's shape, from the plan — the frame is sized from it rather
   * than from a fraction of the viewport, so nothing scrolls inside it. */
  ratio: number;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  if (!drill) return null;

  return (
    <div className="mt-6 space-y-4">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-navy-700 underline">
        ← {t("photobook.composer.back")}
      </button>

      {/*
       * Every level-1 setting stays reachable from level 2 — the ticket's own
       * rule, because the settings are interdependent with what a day needs
       * (trim size decides what fits, which decides which days overflow,
       * which decides which days want `runOn`). Collapsed by default, so the
       * day's own controls stay what the screen is about.
       */}
      <details className="rounded-lg border border-navy-200 bg-white px-3 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-navy-800">
          {t("photobook.composer.bookSettings")}
        </summary>
        <p className="mt-1 text-xs text-navy-600">{t("photobook.composer.bookSettingsHint")}</p>
        <div className="mt-3">
          <BookSettingsPanel
            options={options}
            setOptions={setOptions}
            media={media}
            locales={locales}
            resetBook={resetBook}
            canReset={canReset}
            t={t}
          />
        </div>
      </details>

      {day && (
        <DayControls
          day={day}
          dayPhotos={dayPhotos}
          plan={plan}
          layout={layout}
          truncated={truncated}
          focalEditing={focalEditing}
          focalOf={focalOf}
          setDayLayout={setDayLayout}
          setDayRunOn={setDayRunOn}
          setDayText={setDayText}
          bookPrintsText={options.includeText}
          setDayExcluded={setDayExcluded}
          setHero={setHero}
          movePhoto={movePhoto}
          toggleDayPhoto={toggleDayPhoto}
          resetDay={resetDay}
          applyLayoutToAll={applyLayoutToAll}
          setFocalEditing={setFocalEditing}
          setFocalFromTap={setFocalFromTap}
          nudgeFocalByKey={nudgeFocalByKey}
          resetFocal={resetFocal}
          t={t}
        />
      )}

      {sliceHtml ? (
        <div className="-mx-4 sm:mx-0">
          <iframe
            srcDoc={sliceHtml}
            style={{ aspectRatio: String(ratio) }}
            className="w-full border-0 bg-cream-100 sm:rounded-xl"
            title={t("photobook.title")}
          />
        </div>
      ) : (
        // A day left out of the book has no spread to show here any more —
        // B564. The switch above stays visible and checked either way, so
        // this is not the trap the ticket warns about: turning it back off
        // is one tap, right here, with nowhere to navigate to first.
        plan?.excluded && <p className="text-xs text-navy-600">{t("photobook.day.excludedPreview")}</p>
      )}
    </div>
  );
}
