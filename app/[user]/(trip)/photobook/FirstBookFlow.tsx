"use client";

import { useState } from "react";
import Image from "next/image";
import ConfirmPanel from "@/components/ConfirmPanel";
import { mediaLoader } from "@/components/mediaLoader";
import { creditsInRappen, formatChf } from "@/lib/credits/pricing";
import type { TranslationKey } from "@/lib/i18n";
import { DAY_LAYOUTS, type BookOptions, type DayLayout } from "@/lib/photobook/options";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import type { MediaTile } from "@/lib/types";
import BookShape, { FormatShape, type BookShapeKind } from "./BookShape";
import LayoutShape from "./LayoutShape";
import { SIZE_LABEL } from "./BookSettingsPanel";
import type { PreviewState } from "./BookLevelView";

/**
 * The book, asked as questions — B704, widened and made mobile-first in B727.
 *
 * The composer is right for somebody returning to a book they have already
 * arranged, and B548 was right to put its nine controls behind one entry. It
 * does nothing for the first one: a format dropdown, a cover picker, a
 * language dropdown and six checkboxes, all at once, none of them
 * illustrated. "Print chapter dividers" is a yes/no about a page the
 * person has never seen.
 *
 * So the same decisions, asked in order, each with a drawing of what the
 * answer does. Every step arrives with an answer already chosen, so "next" is
 * always a valid move and nobody is held up by a question they do not care
 * about; the skip link leaves at any point.
 *
 * **It opens every time now, and offers to carry on** (B727). Opening only on
 * a first visit was the right instinct for a wizard standing between somebody
 * and their book, and the wrong one for what this turned into — for most
 * people these questions *are* the composer. Where an arrangement already
 * exists the first screen says so and offers the composer in one tap, so
 * "always" costs a returning owner nothing.
 *
 * **It writes `BookOptions` and nothing else.** A second way to reach the
 * object the settings panel edits, never a second state to keep in step;
 * answers are written as they are made, so a phone locking half way through
 * loses nothing.
 *
 * **One question is still not asked.** The *language* is asked only where
 * the journal offers more than one — a dropdown with one option is a screen
 * about nothing.
 */

type T = (key: TranslationKey, vars?: Record<string, string>) => string;

/** The extras, and the switches each tile is. `numbers` is two switches on
 * purpose: "cost summary" and "charts" are one decision to somebody who has
 * not read the planner, and `initialBookOptions` already ties their defaults
 * together. The settings panel keeps every one of them separate. */
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
  { id: "figures", shape: "figures", label: "photobook.first.extras.figures", hint: "photobook.first.extras.figuresHint", keys: ["includeFigureMarks"] },
  { id: "vehicles", shape: "vehicles", label: "photobook.first.extras.vehicles", hint: "photobook.first.extras.vehiclesHint", keys: ["includeVehicles"] },
];

/** Each language named in itself — a German owner looks for "Deutsch". The
 * same table the settings panel uses, for the same reason. */
const LANGUAGE_NAME: Record<string, string> = { en: "English", de: "Deutsch", hu: "Magyar" };

type Step = "resume" | "size" | "text" | "layout" | "days" | "extras" | "cover" | "language" | "summary";

/**
 * One card: a drawing, a name, and a line saying what it does.
 *
 * `min-h-11` and the whole card being the target, because this is a phone
 * first: the drawing is not a decoration beside a radio button, it is the
 * button.
 */
function Card({
  chosen,
  onChoose,
  label,
  hint,
  role = "radio",
  children,
}: {
  chosen: boolean;
  onChoose: () => void;
  label: string;
  hint?: string;
  role?: "radio" | "checkbox";
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={chosen}
      onClick={onChoose}
      className={`flex min-h-11 flex-col items-start gap-1.5 rounded-xl border-2 p-2.5 text-left ${
        chosen ? "border-yellow-600 bg-yellow-50" : "border-navy-200 bg-white"
      }`}
    >
      {children && <span className="text-navy-800">{children}</span>}
      <span className="text-sm leading-tight font-semibold text-navy-900">{label}</span>
      {hint && <span className="text-xs leading-snug text-navy-600">{hint}</span>}
    </button>
  );
}

export default function FirstBookFlow({
  options,
  setOptions,
  media,
  days,
  locales,
  hasCosts,
  hasWeather,
  hasFigures,
  hasTransport,
  hadSaved,
  preview,
  applyLayoutToEveryDay,
  setDayExcluded,
  onDone,
  t,
}: {
  options: BookOptions;
  setOptions: (update: (o: BookOptions) => BookOptions) => void;
  media: MediaTile[];
  /** The trip's days, in the order the book prints them. */
  days: { date: string; title: string; location: string }[];
  locales: string[];
  /** Whether the trip has anything to put on a numbers page at all. No budget
   * and no measured weather means the tile is not offered — a tile that adds
   * nothing is worse than one less question. */
  hasCosts: boolean;
  hasWeather: boolean;
  /** Whether anybody has been described, and there are therefore figures to
   * draw. Same rule. */
  hasFigures: boolean;
  /** Whether any day says how it was travelled, and there is therefore a
   * transport page for a vehicle to stand on. */
  hasTransport: boolean;
  /** Whether an arrangement was already saved, which is the only difference
   * between a flow that opens on a question and one that opens on an offer to
   * carry on. */
  hadSaved: boolean;
  /** The planned book, for the last step's page count, binding and price.
   * `null` while the debounced preview is still on its way. */
  preview: PreviewState;
  /**
   * "Every day like this", applied without asking — B739.
   *
   * The composer's own `applyLayoutToAll` asks first, through the panel at the
   * top of the page, and both halves of that are wrong here: the question
   * scrolls off the top of a screen the flow fills, and it counts the flow's
   * *own* previous tap as work somebody did by hand. Nine days arranged by
   * choosing "one big picture" a moment ago are not nine days to warn about.
   * So the flow takes the plain version and asks its own question, below the
   * cards, about the days that were arranged before it opened.
   */
  applyLayoutToEveryDay: (layout: DayLayout) => void;
  setDayExcluded: (date: string, excluded: boolean) => void;
  onDone: () => void;
  t: T;
}) {
  const steps: Step[] = [
    ...(hadSaved ? (["resume"] as const) : []),
    "size",
    "text",
    "layout",
    ...(days.length > 1 ? (["days"] as const) : []),
    "extras",
    "cover",
    ...(locales.length > 1 ? (["language"] as const) : []),
    "summary",
  ];
  const [step, setStep] = useState(0);
  const at: Step = steps[Math.min(step, steps.length - 1)];
  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));

  /**
   * Which layout the whole trip was last given here.
   *
   * Not read back off `options.days`, which is a per-day record that any one
   * day can differ in the moment somebody opens the day controls — "they all
   * look like this" would then be a claim this screen cannot honestly make.
   * `auto` is where every book starts and what most should stay.
   */
  const [everyDay, setEveryDay] = useState<DayLayout>("auto");

  /**
   * The days that were already arranged by hand when these questions opened —
   * B739.
   *
   * A snapshot, taken once in the initialiser, because the flow is about to
   * start writing layouts itself and every one of those would otherwise look
   * like somebody's own work by the next tap. Empty is the normal case (a book
   * nobody has opened, or one arranged only through these questions), and then
   * nothing is ever asked.
   */
  const [handArranged] = useState(
    () => days.filter((d) => options.days[d.date]?.layout !== undefined).length,
  );
  /** Set once the owner has answered, or once there was nothing to ask. */
  const [mayOverwrite, setMayOverwrite] = useState(handArranged === 0);
  /** The layout waiting on that answer. */
  const [asking, setAsking] = useState<DayLayout | null>(null);

  const chooseLayout = (layout: DayLayout) => {
    if (!mayOverwrite) {
      setAsking(layout);
      return;
    }
    setEveryDay(layout);
    applyLayoutToEveryDay(layout);
  };

  const extras = EXTRAS.filter(
    (e) =>
      (e.id !== "numbers" || hasCosts || hasWeather) &&
      // The figures are drawn from the party, and `buildBookSource` empties
      // that when "who travelled" is off — so this switch would draw nothing.
      (e.id !== "figures" || (hasFigures && options.includeNames)) &&
      // Same rule for the vehicles: they are drawn on the transport page, and
      // a trip that never said how it moved does not get one.
      (e.id !== "vehicles" || hasTransport),
  );

  const set = <K extends keyof BookOptions>(key: K, value: BookOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  const excluded = (date: string) => options.days[date]?.excluded === true;
  const included = days.filter((d) => !excluded(d.date)).length;

  return (
    <section className="mt-4 rounded-xl border-2 border-navy-900 bg-cream-100 p-3 sm:mt-6 sm:max-w-2xl sm:p-4">
      <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
        {t("photobook.first.eyebrow")}
      </p>

      {/* Where you are, as dots. A count ("3 of 8") is a number to read; the
          dots are a glance, and they are the only thing here that has to
          survive the list of steps changing with the trip. */}
      <ol
        className="mt-2 flex gap-1"
        aria-label={t("photobook.first.progress", {
          step: String(step + 1),
          of: String(steps.length),
        })}
      >
        {steps.map((s, i) => (
          <li
            key={s}
            aria-hidden
            className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-yellow-600" : "bg-navy-200"}`}
          />
        ))}
      </ol>

      {at === "resume" && (
        <Question heading={t("photobook.first.resume")} hint={t("photobook.first.resumeHint")} t={t}>
          <div className="grid w-full gap-2">
            <Card chosen={false} onChoose={onDone} label={t("photobook.first.resume.carryOn")} hint={t("photobook.first.resume.carryOnHint")} />
            <Card chosen={false} onChoose={next} label={t("photobook.first.resume.again")} hint={t("photobook.first.resume.againHint")} />
          </div>
        </Question>
      )}

      {at === "size" && (
        <Question heading={t("photobook.first.size")} hint={t("photobook.first.sizeHint")} t={t}>
          <div className="grid w-full grid-cols-3 gap-2">
            {Object.values(BOOK_SIZES).map((size) => (
              <Card
                key={size.id}
                chosen={options.size === size.id}
                onChoose={() => set("size", size.id)}
                label={SIZE_LABEL[size.id] ? t(SIZE_LABEL[size.id]) : size.name}
              >
                <FormatShape sizeId={size.id} />
              </Card>
            ))}
          </div>
        </Question>
      )}

      {at === "text" && (
        <Question heading={t("photobook.first.text")} hint={t("photobook.first.textHint")} t={t}>
          <div className="grid w-full grid-cols-2 gap-2">
            <Card
              chosen={options.includeText}
              onChoose={() => set("includeText", true)}
              label={t("photobook.first.text.with")}
              hint={t("photobook.first.text.withHint")}
            >
              <BookShape kind="text" size={52} />
            </Card>
            <Card
              chosen={!options.includeText}
              onChoose={() => set("includeText", false)}
              label={t("photobook.first.text.without")}
              hint={t("photobook.first.text.withoutHint")}
            >
              <BookShape kind="noText" size={52} />
            </Card>
          </div>
        </Question>
      )}

      {at === "layout" && (
        <Question heading={t("photobook.first.layout")} hint={t("photobook.first.layoutHint")} t={t}>
          <div className="grid w-full grid-cols-3 gap-2">
            {DAY_LAYOUTS.map((layout) => (
              <Card
                key={layout}
                chosen={everyDay === layout}
                onChoose={() => chooseLayout(layout)}
                label={t(LAYOUT_LABEL[layout])}
              >
                <LayoutShape layout={layout} />
              </Card>
            ))}
          </div>
          {/* Underneath the cards it is about, and asked once — B739. */}
          {asking && (
            <div className="mt-3">
              <ConfirmPanel
                label={t("photobook.first.layout")}
                question={t("photobook.first.layoutOverwrite", {
                  count: String(handArranged),
                })}
                confirmLabel={t("photobook.day.applyToAllGo")}
                onConfirm={() => {
                  setMayOverwrite(true);
                  setEveryDay(asking);
                  applyLayoutToEveryDay(asking);
                  setAsking(null);
                }}
                onCancel={() => setAsking(null)}
              />
            </div>
          )}
        </Question>
      )}

      {at === "days" && (
        <Question
          heading={t("photobook.first.days")}
          hint={t("photobook.first.daysHint", {
            included: String(included),
            total: String(days.length),
          })}
          t={t}
          plain
        >
          <ul className="w-full space-y-1.5">
            {days.map((day) => (
              <li key={day.date}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!excluded(day.date)}
                  onClick={() => setDayExcluded(day.date, !excluded(day.date))}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg border-2 px-2.5 py-1.5 text-left ${
                    excluded(day.date)
                      ? "border-navy-200 bg-white opacity-60"
                      : "border-yellow-600 bg-yellow-50"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold ${
                      excluded(day.date)
                        ? "border-navy-300 text-transparent"
                        : "border-yellow-600 bg-yellow-400 text-yellow-950"
                    }`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-navy-900">
                      {day.title}
                    </span>
                    <span className="block truncate text-xs text-navy-600">{day.location}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Question>
      )}

      {at === "extras" && (
        <Question heading={t("photobook.first.extras")} hint={t("photobook.first.extrasHint")} t={t} multi>
          <div className="grid w-full grid-cols-2 gap-2">
            {extras.map((extra) => {
              const on = extra.keys.every((k) => options[k] === true);
              return (
                <Card
                  key={extra.id}
                  role="checkbox"
                  chosen={on}
                  onChoose={() =>
                    setOptions((o) => ({
                      ...o,
                      ...Object.fromEntries(extra.keys.map((k) => [k, !on])),
                    }))
                  }
                  label={t(extra.label)}
                  hint={t(extra.hint)}
                >
                  <BookShape kind={extra.shape} size={52} />
                </Card>
              );
            })}
          </div>
        </Question>
      )}

      {at === "cover" && (
        <Question heading={t("photobook.first.cover")} hint={t("photobook.first.coverHint")} t={t} plain>
          <div
            role="radiogroup"
            aria-label={t("photobook.option.coverLegend")}
            className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!options.cover}
              onClick={() => set("cover", undefined)}
              className={`flex aspect-square items-center justify-center rounded-md border-2 p-1 text-center text-[10px] font-semibold ${
                !options.cover
                  ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                  : "border-navy-200 bg-white text-navy-600"
              }`}
            >
              {t("photobook.option.coverDefault")}
            </button>
            {/* Eight, not the whole gallery: a first choice with a good default
                behind it. The settings panel offers every photograph. */}
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

      {at === "language" && (
        <Question heading={t("photobook.first.language")} hint={t("photobook.option.languageHint")} t={t}>
          <div className="grid w-full grid-cols-2 gap-2">
            {locales.map((code) => (
              <Card
                key={code}
                chosen={options.locale === code}
                onChoose={() => set("locale", code)}
                label={LANGUAGE_NAME[code] ?? code}
              />
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
              {/* The binding, stated with the page count: Gelato glues every
                  photobook, so this is a fact rather than a choice. */}
              <p className="mt-2 text-sm text-navy-700">
                {t("photobook.first.bindingPerfect", { pages: String(preview.pages) })}
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

      {/* The actions, phone-shaped: the thing you do next is full width and
          under your thumb, and the two ways out are text beneath it. */}
      {at !== "resume" && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => (at === "summary" ? onDone() : next())}
            className="min-h-11 w-full rounded-full border-2 border-navy-900 bg-navy-900 px-5 text-sm font-semibold text-white sm:w-auto"
          >
            {t(at === "summary" ? "photobook.first.open" : "photobook.first.next")}
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="min-h-11 text-sm font-semibold text-navy-600 underline"
              >
                {t("photobook.first.back")}
              </button>
            )}
            {/* Out at any point, without answering the rest. Somebody who knows
                what they want must not have to tap through every screen. */}
            <button
              type="button"
              onClick={onDone}
              className="min-h-11 text-sm font-semibold text-navy-600 underline"
            >
              {t("photobook.first.skip")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** What each arrangement is called, the same table the day controls use. */
const LAYOUT_LABEL: Record<DayLayout, TranslationKey> = {
  auto: "photobook.day.layout.auto",
  hero: "photobook.day.layout.hero",
  single: "photobook.day.layout.single",
  pair: "photobook.day.layout.pair",
  grid: "photobook.day.layout.grid",
  text: "photobook.day.layout.text",
};

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
