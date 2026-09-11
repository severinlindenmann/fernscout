"use client";

import { useState } from "react";
import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import type { TranslationKey } from "@/lib/i18n";
import { COVER_TYPES, defaultSizeFor, sizesFor } from "@/lib/photobook/spec";
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
  pocket: "photobook.size.pocket",
  square: "photobook.size.square",
  portrait: "photobook.size.portrait",
  "large-square": "photobook.size.largeSquare",
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
 * language, what to include. It is deliberately the same block
 * whether it is reached at level 1 (the book's own page) or drilled into from
 * a front-matter spread at level 2 — "every level-1 setting stays reachable
 * from level 2" is the ticket's own rule, and this is the one form that makes
 * that true without a second copy of it.
 */

/**
 * The drawing's settings card — B1487.
 *
 * Every control this panel had is still here; what changed is that they are
 * rows in one card rather than a stack of native widgets. A label on the
 * left, the value or the switch on the right, a hairline between. The panel
 * was two `<select>`s carrying their own operating-system chrome, a
 * nine-line list of checkboxes and two underlined links, about four hundred
 * pixels of form dropped into a cream page, and it read as a dialog from
 * another application.
 *
 * The `<select>` is still a `<select>` — `appearance-none` and a chevron, so
 * the keyboard, the screen reader and the phone's native picker all behave
 * exactly as they did. Only the paint is different.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // The label gives way, never the value — B1524. The card was 20rem wide
    // beside the book, and "Quadratisch, 20 x 20 cm" is wider than the space
    // a `shrink-0` value was left with, so the select overran its own label
    // and the two sat on top of each other. The card is 24rem now (see
    // `BookLevelView`'s columns) and the label wraps inside what is left,
    // which keeps the thing being chosen readable in full — truncating a
    // format name hides the choice somebody is making.
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 text-sm text-navy-800">{label}</span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

/**
 * A value that opens a native picker, drawn as a value rather than a box.
 *
 * No chevron of its own — B1489. `app/globals.css` already draws one on every
 * `select` in the codebase (there were twenty-four of them and not one set
 * `appearance`), so a second one here rendered two arrows side by side.
 */
function ValueSelect({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <span className="relative flex min-w-0 items-center justify-end">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 max-w-full cursor-pointer appearance-none rounded-lg bg-transparent py-1 pl-2 pr-6 text-right font-mono text-sm text-navy-900 hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-yellow-600"
      >
        {children}
      </select>
    </span>
  );
}

/** One boolean, as a switch. `peer` keeps the input the thing that is
 *  checked, focused and read out; the span is only paint. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-6 w-10 rounded-full bg-navy-200 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-yellow-600 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-yellow-600 peer-focus-visible:ring-offset-2"
      />
    </label>
  );
}

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
    <div className="overflow-hidden rounded-xl border border-navy-200 bg-white">
      <div className="divide-y divide-navy-100">
        {/* Soft or hard — B845. It comes first because it decides which sizes
            the row below may offer. */}
        {/* No hint on the row — B1487. The card is 20rem wide beside the
            book, and the sentence explaining what a cover costs to print
            wraps to four lines and pushes every switch below it off the
            screen. The wizard says it at the moment the choice is first
            made, which is where it belongs. */}
        <Row label={t("photobook.option.coverType")}>
          <ValueSelect
            label={t("photobook.option.coverType")}
            value={options.coverType}
            onChange={(v) => {
              const coverType = v as (typeof COVER_TYPES)[number];
              setOptions((o) => ({
                ...o,
                coverType,
                size: sizesFor(coverType).some((s) => s.id === o.size)
                  ? o.size
                  : defaultSizeFor(coverType).id,
              }));
            }}
          >
            {COVER_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`photobook.option.coverType.${c}`)}
              </option>
            ))}
          </ValueSelect>
        </Row>

        <Row label={t("photobook.option.size")}>
          <ValueSelect
            label={t("photobook.option.size")}
            value={options.size}
            onChange={(v) => setOptions((o) => ({ ...o, size: v }))}
          >
            {sizesFor(options.coverType).map((size) => (
              <option key={size.id} value={size.id}>
                {SIZE_LABEL[size.id] ? t(SIZE_LABEL[size.id]) : size.name}
              </option>
            ))}
          </ValueSelect>
        </Row>

        {/*
         * The front cover — B512. A book-level control, deliberately not a
         * seventh button under every thumbnail on every day. A radiogroup
         * rather than a select: there is no text label for a photograph worth
         * putting in a dropdown, and exactly one of these is ever chosen.
         */}
        <div>
          <button
            type="button"
            onClick={() => setCoverOpen((v) => !v)}
            aria-expanded={coverOpen}
            className="flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2.5 text-left"
          >
            <span className="text-sm text-navy-800">{t("photobook.option.cover")}</span>
            <span aria-hidden className="text-navy-500">
              {coverOpen ? "−" : "+"}
            </span>
          </button>
          {coverOpen && (
            <div
              role="radiogroup"
              aria-label={t("photobook.option.coverLegend")}
              className="grid grid-cols-3 gap-2 px-4 pb-3 sm:grid-cols-4"
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

        {/* The book's own words only — headings, the colophon, how the
            travelling is named. The days keep whatever language they were
            written in. Shown at all only where the journal offers more than
            one. */}
        {locales.length > 1 && (
          <Row label={t("photobook.option.language")}>
            <ValueSelect
              label={t("photobook.option.language")}
              value={options.locale}
              onChange={(v) => setOptions((o) => ({ ...o, locale: v }))}
            >
              {locales.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAME[code] ?? code}
                </option>
              ))}
            </ValueSelect>
          </Row>
        )}

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
          <Row key={key} label={t(label)}>
            <Switch
              label={t(label)}
              checked={options[key]}
              onChange={(v) => setOptions((o) => ({ ...o, [key]: v }))}
            />
          </Row>
        ))}
      </div>

      {/* The two ways back out, on the card's own footer. Disabled rather
          than hidden when there is nothing to lose: a control that vanishes
          the moment it would do nothing is harder to find the one time it
          matters. */}
      {/* One under the other and ranged left — B1524. Two sentence-long links
          on one wrapping row centred themselves into a paragraph of
          underlined text that read as prose rather than as two controls. */}
      <div className="flex flex-col items-start gap-2 border-t border-navy-200 bg-navy-50 px-4 py-3">
        <button
          type="button"
          onClick={startOver}
          className="text-left text-xs font-semibold text-navy-600 underline"
        >
          {t("photobook.first.again")}
        </button>
        <button
          type="button"
          onClick={resetBook}
          disabled={!canReset}
          className="text-left text-xs font-semibold text-navy-600 underline disabled:cursor-not-allowed disabled:text-navy-300 disabled:no-underline"
        >
          {t("photobook.resetAll")}
        </button>
      </div>
    </div>
  );
}
