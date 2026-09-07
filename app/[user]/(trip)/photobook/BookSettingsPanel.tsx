"use client";

import { useState } from "react";
import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import type { TranslationKey } from "@/lib/i18n";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import type { BookOptions } from "@/lib/photobook/options";
import type { MediaTile } from "@/lib/types";

/**
 * The format, in words a person shops in — B548.
 *
 * `BOOK_SIZES` keeps the trim in millimetres because a printer needs it; the
 * picker a customer uses does not, and "A4 landscape 297 × 210 mm" was the
 * first thing the composer said to them. Exported because the summary line
 * and the order block name the same format and must not drift from this.
 */
export const SIZE_LABEL: Record<string, TranslationKey> = {
  "square-210": "photobook.size.square",
  "landscape-a4": "photobook.size.landscape",
  "portrait-a4": "photobook.size.portrait",
};

/** Each language named in itself, which is how a language picker should read
 * — a German owner looks for "Deutsch", not for "German". */
const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  hu: "Magyar",
};

/**
 * Level 1's whole-book settings — B534.
 *
 * Everything here describes the book, not one day of it: size, cover
 * language, binding, what to include. It is deliberately the same block
 * whether it is reached at level 1 (the book's own page) or drilled into from
 * a front-matter spread at level 2 — "every level-1 setting stays reachable
 * from level 2" is the ticket's own rule, and this is the one form that makes
 * that true without a second copy of it.
 */
export default function BookSettingsPanel({
  options,
  setOptions,
  media,
  locales,
  resetBook,
  canReset,
  startOver,
  t,
}: {
  options: BookOptions;
  setOptions: (update: (o: BookOptions) => BookOptions) => void;
  media: MediaTile[];
  locales: string[];
  resetBook: () => void;
  canReset: boolean;
  /** Reopen the first-book questions — B704. The flow opens by itself only
   * when nothing has been arranged, so this is the only way back into it. */
  startOver: () => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  /** The cover picker's own disclosure — a book-level control with nothing to
   * share state with. */
  const [coverOpen, setCoverOpen] = useState(false);

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="text-sm font-semibold text-navy-800">
          {t("photobook.option.size")}
        </span>
        <select
          value={options.size}
          onChange={(e) => setOptions((o) => ({ ...o, size: e.target.value }))}
          className="mt-1 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
        >
          {Object.values(BOOK_SIZES).map((size) => (
            <option key={size.id} value={size.id}>
              {SIZE_LABEL[size.id] ? t(SIZE_LABEL[size.id]) : size.name}
            </option>
          ))}
        </select>
      </label>

      {/*
       * The front cover — B512.
       *
       * A book-level control, deliberately not a seventh button under every
       * thumbnail on every day: the page a stranger actually sees is one
       * choice for the whole book, not a property of any single photograph's
       * tile. Placed beside format and language, the other decisions that
       * apply to the book as a whole rather than to one day of it.
       *
       * A radiogroup, not a select: there is no text label for a photograph
       * worth putting in a dropdown, and — as with the day layout — exactly
       * one of these is ever chosen.
       */}
      <div>
        <button
          type="button"
          onClick={() => setCoverOpen((v) => !v)}
          aria-expanded={coverOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-sm font-semibold text-navy-800">
            {t("photobook.option.cover")}
          </span>
          <span aria-hidden className="text-navy-500">
            {coverOpen ? "−" : "+"}
          </span>
        </button>
        <p className="mt-1 text-xs text-navy-600">{t("photobook.option.coverHint")}</p>
        {coverOpen && (
          <div
            role="radiogroup"
            aria-label={t("photobook.option.coverLegend")}
            className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!options.cover}
              onClick={() => setOptions((o) => ({ ...o, cover: undefined }))}
              className={`flex aspect-square items-center justify-center rounded-md border p-1 text-center text-[10px] font-semibold ${
                !options.cover
                  ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                  : "border-navy-200 text-navy-600"
              }`}
            >
              {t("photobook.option.coverDefault")}
            </button>
            {media.map((tile) => (
              <button
                key={tile.src}
                type="button"
                role="radio"
                aria-checked={options.cover === tile.src}
                aria-label={tile.caption || tile.src}
                onClick={() => setOptions((o) => ({ ...o, cover: tile.src }))}
                className={`relative block aspect-square w-full overflow-hidden rounded-md border ${
                  options.cover === tile.src ? "border-yellow-500" : "border-navy-200"
                }`}
              >
                <Image
                  src={tile.src}
                  loader={mediaLoader}
                  alt=""
                  fill
                  sizes="10vw"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {locales.length > 1 && (
        <label className="block">
          <span className="text-sm font-semibold text-navy-800">
            {t("photobook.option.language")}
          </span>
          {/* The book's own words only — headings, the colophon, how the
              travelling is named. The days keep whatever language they were
              written in. Shown at all only where the journal offers more than
              one. */}
          <select
            value={options.locale}
            onChange={(e) => setOptions((o) => ({ ...o, locale: e.target.value }))}
            className="mt-1 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
          >
            {locales.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAME[code] ?? code}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-navy-600">
            {t("photobook.option.languageHint")}
          </span>
        </label>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-navy-800">
          {t("photobook.option.binding")}
        </legend>
        <div className="mt-1 space-y-1">
          {(["perfect", "saddle"] as const).map((binding) => (
            <label key={binding} className="flex items-center gap-2 text-sm text-navy-700">
              <input
                type="radio"
                name="binding"
                checked={options.binding === binding}
                onChange={() => setOptions((o) => ({ ...o, binding }))}
              />
              {t(
                binding === "perfect"
                  ? "photobook.option.bindingPerfect"
                  : "photobook.option.bindingSaddle",
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        {(
          [
            ["includeText", "photobook.option.text"],
            ["includeMap", "photobook.option.map"],
            ["includeChapters", "photobook.option.chapters"],
            ["includeNames", "photobook.option.names"],
            ["includeCosts", "photobook.option.costs"],
            ["includeCharts", "photobook.option.charts"],
            ["includeFigureMarks", "photobook.option.figureMarks"],
            ["includeVehicles", "photobook.option.vehicles"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-navy-700">
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
            />
            {t(label)}
          </label>
        ))}
      </fieldset>

      {/* Disabled rather than hidden when there is nothing to lose: a control
          that vanishes the moment it would do nothing is harder to find the
          one time it matters. */}
      <button
        type="button"
        onClick={startOver}
        className="block text-xs font-semibold text-navy-600 underline"
      >
        {t("photobook.first.again")}
      </button>

      <button
        type="button"
        onClick={resetBook}
        disabled={!canReset}
        className="text-xs font-semibold text-navy-600 underline disabled:cursor-not-allowed disabled:text-navy-300 disabled:no-underline"
      >
        {t("photobook.resetAll")}
      </button>
    </div>
  );
}
