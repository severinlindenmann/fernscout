"use client";

import { useState } from "react";
import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import { creditsInRappen, formatChf } from "@/lib/credits/pricing";
import type { TranslationKey } from "@/lib/i18n";
import type { BookOptions } from "@/lib/photobook/options";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import type { MediaTile } from "@/lib/types";
import BookShape, { FormatShape, type BookShapeKind } from "./BookShape";
import { SIZE_LABEL } from "./BookSettingsPanel";
import type { PreviewState } from "./BookLevelView";

/**
 * The first book, one question at a time — B704.
 *
 * The composer is right for somebody coming back to a book they have already
 * arranged, and B548 was right to put its nine controls behind one entry. It
 * does nothing for the first one: a format dropdown, a cover picker, a
 * language dropdown, two binding radios and six checkboxes, all at once, none
 * of them illustrated. "Print chapter dividers" is a yes/no about a page the
 * person has never seen.
 *
 * So the same decisions, asked in order, each with a drawing of what the
 * answer does — `BookShape`, in `LayoutShape`'s vocabulary. Every step
 * arrives with an answer already chosen (whatever `initialBookOptions` gave),
 * so "next" is always a valid move and nobody is held up by a question they
 * do not care about.
 *
 * **It writes `BookOptions` and nothing else.** This is a second way to reach
 * the object the settings panel edits, never a second state to keep in step:
 * leaving it lands on the composer as it has always been, already arranged.
 * Answers are written as they are made rather than at the end, so a phone
 * locking half way through loses nothing — the same reason the arrangement is
 * in `localStorage` at all.
 *
 * **Two questions are deliberately not asked.** The *binding* depends on the
 * page count, which the planner knows and the owner cannot guess before a
 * book exists; the last step states it instead, and the settings panel keeps
 * the radios. The *language* defaults to the journal's own locale, which is
 * right essentially always — a screen for it would be a screen about nothing.
 */

type T = (key: TranslationKey, vars?: Record<string, string>) => string;

/** The four tiles of step three, and the switches each one is. `costs` is two
 * switches on purpose: "cost summary" and "charts" are one decision to
 * somebody who has not read the planner, and `initialBookOptions` already
 * ties their defaults together. The settings panel keeps them separate for
 * anybody who wants them separate. */
const EXTRAS: {
  id: string;
  shape: BookShapeKind;
  label: TranslationKey;
  hint: TranslationKey;
  keys: (keyof BookOptions)[];
}[] = [
  { id: "map", shape: "map", label: "photobook.first.extras.map", hint: "photobook.first.extras.mapHint", keys: ["includeMap"] },
  { id: "chapters", shape: "chapters", label: "photobook.first.extras.chapters", hint: "photobook.first.extras.chaptersHint", keys: ["includeChapters"] },
  { id: "names", shape: "names", label: "photobook.first.extras.names", hint: "photobook.first.extras.namesHint2", keys: ["includeNames"] },
  { id: "numbers", shape: "numbers", label: "photobook.first.extras.numbers", hint: "photobook.first.extras.numbersHint", keys: ["includeCosts", "includeCharts"] },
];

const STEPS = ["size", "text", "extras", "cover", "summary"] as const;
type Step = (typeof STEPS)[number];

/** One answer: a drawing, a name, and a line saying what it does. */
function Choice({
  chosen,
  onChoose,
  label,
  hint,
  children,
}: {
  chosen: boolean;
  onChoose: () => void;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onChoose}
      className={`flex min-h-11 flex-1 basis-40 flex-col items-start gap-2 rounded-xl border-2 p-3 text-left ${
        chosen ? "border-yellow-600 bg-yellow-50" : "border-navy-200 bg-white"
      }`}
    >
      <span className="text-navy-800">{children}</span>
      <span className="text-sm font-semibold text-navy-900">{label}</span>
      {hint && <span className="text-xs text-navy-600">{hint}</span>}
    </button>
  );
}

export default function FirstBookFlow({
  options,
  setOptions,
  media,
  hasCosts,
  hasWeather,
  preview,
  onDone,
  t,
}: {
  options: BookOptions;
  setOptions: (update: (o: BookOptions) => BookOptions) => void;
  media: MediaTile[];
  /** Whether the trip has anything to put on a numbers page at all. No budget
   * and no measured weather means the tile is not offered — a tile that adds
   * nothing is worse than one less question. */
  hasCosts: boolean;
  hasWeather: boolean;
  /** The planned book, for the last step's page count, binding and price.
   * `null` while the debounced preview is still on its way. */
  preview: PreviewState;
  onDone: () => void;
  t: T;
}) {
  const [step, setStep] = useState(0);
  const at: Step = STEPS[step];
  const extras = EXTRAS.filter((e) => e.id !== "numbers" || hasCosts || hasWeather);

  const set = <K extends keyof BookOptions>(key: K, value: BookOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  return (
    <section className="mt-6 max-w-2xl rounded-xl border-2 border-navy-900 bg-cream-100 p-4">
      <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
        {t("photobook.first.eyebrow")}
      </p>

      {/* Where you are, as dots. A count ("3 of 5") is a number to read; five
          dots is a glance. */}
      <ol className="mt-2 flex gap-1.5" aria-label={t("photobook.first.progress", { step: String(step + 1), of: String(STEPS.length) })}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-hidden
            className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-yellow-600" : "bg-navy-200"}`}
          />
        ))}
      </ol>

      {at === "size" && (
        <Question heading={t("photobook.first.size")} hint={t("photobook.first.sizeHint")} t={t}>
          {Object.values(BOOK_SIZES).map((size) => (
            <Choice
              key={size.id}
              chosen={options.size === size.id}
              onChoose={() => set("size", size.id)}
              label={SIZE_LABEL[size.id] ? t(SIZE_LABEL[size.id]) : size.name}
            >
              <FormatShape sizeId={size.id} box={56} />
            </Choice>
          ))}
        </Question>
      )}

      {at === "text" && (
        <Question heading={t("photobook.first.text")} hint={t("photobook.first.textHint")} t={t}>
          <Choice
            chosen={options.includeText}
            onChoose={() => set("includeText", true)}
            label={t("photobook.first.text.with")}
            hint={t("photobook.first.text.withHint")}
          >
            <BookShape kind="text" size={52} />
          </Choice>
          <Choice
            chosen={!options.includeText}
            onChoose={() => set("includeText", false)}
            label={t("photobook.first.text.without")}
            hint={t("photobook.first.text.withoutHint")}
          >
            <BookShape kind="noText" size={52} />
          </Choice>
        </Question>
      )}

      {at === "extras" && (
        <Question heading={t("photobook.first.extras")} hint={t("photobook.first.extrasHint")} t={t} multi>
          {extras.map((extra) => {
            const on = extra.keys.every((k) => options[k] === true);
            return (
              <button
                key={extra.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() =>
                  setOptions((o) => ({
                    ...o,
                    ...Object.fromEntries(extra.keys.map((k) => [k, !on])),
                  }))
                }
                className={`flex min-h-11 flex-1 basis-40 flex-col items-start gap-2 rounded-xl border-2 p-3 text-left ${
                  on ? "border-yellow-600 bg-yellow-50" : "border-navy-200 bg-white"
                }`}
              >
                <span className="text-navy-800">
                  <BookShape kind={extra.shape} size={52} />
                </span>
                <span className="text-sm font-semibold text-navy-900">{t(extra.label)}</span>
                <span className="text-xs text-navy-600">{t(extra.hint)}</span>
              </button>
            );
          })}
        </Question>
      )}

      {at === "cover" && (
        <Question heading={t("photobook.first.cover")} hint={t("photobook.first.coverHint")} t={t} plain>
          <div role="radiogroup" aria-label={t("photobook.option.coverLegend")} className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
            <button
              type="button"
              role="radio"
              aria-checked={!options.cover}
              onClick={() => set("cover", undefined)}
              className={`flex aspect-square items-center justify-center rounded-md border-2 p-1 text-center text-[10px] font-semibold ${
                !options.cover ? "border-yellow-600 bg-yellow-400 text-yellow-950" : "border-navy-200 bg-white text-navy-600"
              }`}
            >
              {t("photobook.option.coverDefault")}
            </button>
            {/* Eight, not the whole gallery: this is a first choice with a
                good default behind it, and the settings panel offers every
                photograph for anybody who wants to hunt. */}
            {media.slice(0, 8).map((tile) => (
              <button
                key={tile.src}
                type="button"
                role="radio"
                aria-checked={options.cover === tile.src}
                aria-label={tile.caption || tile.src}
                onClick={() => set("cover", tile.src)}
                className={`relative block aspect-square w-full overflow-hidden rounded-md border-2 ${
                  options.cover === tile.src ? "border-yellow-600" : "border-navy-200"
                }`}
              >
                <Image src={tile.src} loader={mediaLoader} alt="" fill sizes="20vw" className="object-cover" />
              </button>
            ))}
          </div>
        </Question>
      )}

      {at === "summary" && (
        <div className="mt-3">
          <h2 className="font-display text-lg font-semibold text-navy-900">
            {t("photobook.first.summary")}
          </h2>
          {preview ? (
            <>
              {/* The binding, stated with the page count it follows from
                  rather than asked as a question nobody can answer yet. */}
              <p className="mt-2 text-sm text-navy-700">
                {t(
                  options.binding === "saddle"
                    ? "photobook.first.bindingSaddle"
                    : "photobook.first.bindingPerfect",
                  { pages: String(preview.pages) },
                )}
              </p>
              <p className="mt-1 text-sm text-navy-700">
                {t("photobook.first.price", {
                  credits: String(preview.credits),
                  money: formatChf(creditsInRappen(preview.credits)),
                })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-navy-600">{t("photobook.first.planning")}</p>
          )}
          <p className="mt-3 text-sm text-navy-600">{t("photobook.first.changeable")}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="min-h-11 rounded-full border-2 border-navy-200 px-4 text-sm font-semibold text-navy-700"
          >
            {t("photobook.first.back")}
          </button>
        )}
        <button
          type="button"
          onClick={() => (at === "summary" ? onDone() : setStep((s) => s + 1))}
          className="min-h-11 rounded-full border-2 border-navy-900 bg-navy-900 px-5 text-sm font-semibold text-white"
        >
          {t(at === "summary" ? "photobook.first.open" : "photobook.first.next")}
        </button>
        {/* Out of the flow at any point, without answering the rest. Somebody
            who knows what they want must not have to tap through five screens
            to say so. */}
        <button type="button" onClick={onDone} className="text-sm font-semibold text-navy-600 underline">
          {t("photobook.first.skip")}
        </button>
      </div>
    </section>
  );
}

function Question({
  heading,
  hint,
  multi,
  plain,
  children,
  t,
}: {
  heading: string;
  hint: string;
  /** A set of independent switches rather than one choice out of several. */
  multi?: boolean;
  /** The step brings its own grouping — the cover picker is already a
   * radiogroup, and nesting one inside another announces two. */
  plain?: boolean;
  children: React.ReactNode;
  t: T;
}) {
  return (
    <div className="mt-3">
      <h2 className="font-display text-lg font-semibold text-navy-900">{heading}</h2>
      <p className="mt-1 text-sm text-navy-600">{hint}</p>
      <div
        role={plain ? undefined : multi ? "group" : "radiogroup"}
        aria-label={plain ? undefined : heading}
        className="mt-3 flex flex-wrap gap-2"
      >
        {children}
      </div>
      {multi && <p className="mt-2 text-xs text-navy-500">{t("photobook.first.extrasMulti")}</p>}
    </div>
  );
}
