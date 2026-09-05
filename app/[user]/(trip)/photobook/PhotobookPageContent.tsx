"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { DAY_LAYOUTS, DEFAULT_OPTIONS, type BookOptions, type DayLayout } from "@/lib/photobook/options";
import type { PhotobookOutcome } from "@/lib/photobook/orders";
import type { MediaTile, PhotobookEntry } from "@/lib/types";

type PreviewState = {
  html: string;
  pages: number;
  volumes: number;
  credits: number;
  warnings: { code: string; detail: string }[];
  /** `false` for a book with no photographs — legal to lay out (padding fills
   * the page-count minimum) but not one anybody should pay for. */
  buyable: boolean;
} | null;

/** Every outcome `order/route.ts` can redirect back with, as a key rather
 * than a sentence baked into this file — the same reasoning as the postcard
 * page's own `RESULTS` table. */
const OUTCOME_MESSAGE: Record<string, TranslationKey> = {
  duplicate: "photobook.duplicate",
  no_credits: "photobook.noCredits",
  failed: "photobook.failed",
  refund_failed: "photobook.refundFailed",
};

/**
 * The book's own preview page: options on the left, the printed page on the
 * right, and one Pay button that is the only thing here that spends credits.
 *
 * The preview is server-planned — `POST /<user>/photobook/preview` runs the
 * same `planFor` the paying route does — so this component's job is to hold
 * `BookOptions` in state, ask for a new preview whenever they change, and
 * render whatever comes back. It never lays out a page itself.
 */
/** Each language named in itself, which is how a language picker should read
 * — a German owner looks for "Deutsch", not for "German". */
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

const LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  hu: "Magyar",
};

export default function PhotobookPageContent({
  entry,
  tripRef,
  tripTitle,
  media,
  days,
  balance,
  locales,
  outcome,
}: {
  entry: PhotobookEntry;
  tripRef: string;
  tripTitle: string;
  media: MediaTile[];
  /** The trip's days, in the order the book prints them, so the composer can
   * be a list of days rather than a heap of photographs. */
  days: { date: string; title: string; location: string }[];
  balance: number | null;
  /** The languages this journal offers, from its own config. The picker is
   * hidden entirely where there is only one. */
  locales: string[];
  /** What the last press of Pay came back with, if this page was reached by
   * `order/route.ts`'s redirect rather than opened fresh. `null` on a first
   * visit. */
  outcome: PhotobookOutcome | null;
}) {
  const { t } = useI18n();
  // Opens in the journal's own default language rather than in English.
  const [options, setOptions] = useState<BookOptions>({
    ...DEFAULT_OPTIONS,
    locale: locales[0] ?? DEFAULT_OPTIONS.locale,
  });
  const [preview, setPreview] = useState<PreviewState>(null);
  const [submitting, setSubmitting] = useState(false);

  // The double-press guard for the Pay button lives on the server
  // (`ORDER_ID_RE`, `claimOrder`), and it needs one id per visit to this
  // page rather than one per press — generated once, in the initialiser, so
  // a re-render (an option changing, a preview arriving) never hands the
  // form a second id to race the first against.
  const [orderId] = useState(() => crypto.randomUUID());

  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * Arranging one day.
   *
   * Both of these write an explicit list rather than a set of exclusions. A
   * day the owner has not opened has no entry at all and the book decides it,
   * which is the normal case; the moment they touch one, what they see is what
   * gets printed, in the order they see it.
   *
   * The flat photograph grid this replaced wrote `excludePhotos`, which the
   * planner and the API still honour for callers that are not this page — an
   * agent proposing a book has no day list to work from.
   */
  const setDayLayout = (date: string, layout: DayLayout) =>
    setOptions((o) => ({
      ...o,
      days: { ...o.days, [date]: { ...o.days[date], layout } },
    }));

  const toggleDayPhoto = (date: string, src: string, dayPhotos: MediaTile[]) =>
    setOptions((o) => {
      const current = o.days[date]?.photos ?? dayPhotos.map((m) => m.src);
      const next = current.includes(src)
        ? current.filter((s) => s !== src)
        : // Put it back where the day has it rather than at the end, so
          // toggling a photograph off and on again does not silently reorder
          // the day.
          dayPhotos.filter((m) => current.includes(m.src) || m.src === src).map((m) => m.src);
      return { ...o, days: { ...o.days, [date]: { ...o.days[date], photos: next } } };
    });


  // Debounced: every keystroke and every tile click changes `options`, and
  // each one plans and lays out the whole book server-side. 400 ms is long
  // enough that a run of clicks collapses into one request and short enough
  // that the preview still feels like it is following you.
  const requestId = useRef(0);
  useEffect(() => {
    const mine = ++requestId.current;
    const timer = setTimeout(() => {
      fetch(`/${entry.username}/photobook/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripRef, options }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          // A slower request that started earlier must not overwrite a
          // faster one that started later — the classic out-of-order
          // response, and the only guard this component needs against it.
          if (mine === requestId.current) setPreview(data);
        })
        .catch(() => {
          if (mine === requestId.current) setPreview(null);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [entry.username, tripRef, options]);

  const credits = preview?.credits ?? null;
  const tooPoor = balance !== null && credits !== null && balance < credits;
  const unbuyable = preview?.buyable === false;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("photobook.title")}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          {tripTitle} — {t("photobook.intro")}
        </p>

        {/* The outcome of the last press, above everything else — B(this
            ticket): a page that looked identical whether Pay had just
            succeeded, failed, or never been pressed is what made a second
            press cost a second book. A successful order replaces the form
            outright rather than sitting above an armed Pay button, since the
            book it would build is the one already sitting in the links
            below. */}
        {outcome?.state === "done" ? (
          <div className="mt-6 max-w-xl rounded-lg border-2 border-navy-900 bg-cream-100 px-4 py-4">
            <p className="font-semibold text-navy-900">{t("photobook.done")}</p>
            {outcome.orderId && outcome.files.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {outcome.files.map((file) => (
                  <li key={file}>
                    <a
                      className="underline"
                      href={`/${entry.username}/photobooks/${outcome.orderId}/${file}`}
                    >
                      {t("photobook.downloadFile")} — {file}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <a href="?" className="mt-4 inline-block text-sm underline">
              {t("photobook.anotherBook")}
            </a>
          </div>
        ) : (
          <>
            {outcome && OUTCOME_MESSAGE[outcome.state] && (
              <p
                className="mt-6 max-w-xl rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
                role="status"
              >
                {t(OUTCOME_MESSAGE[outcome.state])}
              </p>
            )}

            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
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
                        {size.name}
                      </option>
                    ))}
                  </select>
                </label>

                {locales.length > 1 && (
                  <label className="block">
                    <span className="text-sm font-semibold text-navy-800">
                      {t("photobook.option.language")}
                    </span>
                    {/* The book's own words only — headings, the colophon, how
                        the travelling is named. The days keep whatever language
                        they were written in. Shown at all only where the journal
                        offers more than one. */}
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

                <div>
                  <p className="text-sm font-semibold text-navy-800">
                    {t("photobook.day.heading")}
                  </p>
                  <p className="mt-1 text-xs text-navy-600">{t("photobook.day.hint")}</p>
                  <ul className="mt-2 space-y-1">
                    {days.map((day) => {
                      const dayPhotos = media.filter((m) => m.date === day.date);
                      if (dayPhotos.length === 0 && !day.title) return null;
                      const plan = options.days[day.date];
                      // No entry means the book decides, which is the normal
                      // case and has to stay the cheapest one to read.
                      const chosen = plan?.photos ?? dayPhotos.map((m) => m.src);
                      const included = new Set(chosen);
                      const layout = plan?.layout ?? "auto";
                      const open = expanded === day.date;
                      return (
                        <li key={day.date} className="rounded-lg border border-navy-200 bg-white">
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : day.date)}
                            aria-expanded={open}
                            className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-navy-800">
                                {day.title || day.date}
                              </span>
                              <span className="block truncate text-xs text-navy-600">
                                {t("photobook.day.photos", {
                                  shown: String(included.size),
                                  total: String(dayPhotos.length),
                                })}
                                {layout !== "auto" ? ` · ${t(LAYOUT_LABEL[layout])}` : ""}
                              </span>
                            </span>
                            <span aria-hidden className="text-navy-500">
                              {open ? "\u2212" : "+"}
                            </span>
                          </button>
                          {open && (
                            <div className="border-t border-navy-100 px-3 py-3">
                              <div className="flex flex-wrap gap-1">
                                {DAY_LAYOUTS.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => setDayLayout(day.date, option)}
                                    aria-pressed={layout === option}
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
                              {dayPhotos.length > 0 && (
                                <div className="mt-3 grid grid-cols-4 gap-1.5">
                                  {dayPhotos.map((tile, i) => (
                                    <button
                                      key={tile.src}
                                      type="button"
                                      onClick={() => toggleDayPhoto(day.date, tile.src, dayPhotos)}
                                      aria-pressed={included.has(tile.src)}
                                      aria-label={
                                        tile.caption ||
                                        t("photobook.option.photoName", {
                                          index: String(i + 1),
                                          total: String(dayPhotos.length),
                                        })
                                      }
                                      className={`relative aspect-square overflow-hidden rounded-md border ${
                                        included.has(tile.src)
                                          ? "border-yellow-500"
                                          : "border-navy-200 opacity-30"
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
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              <div>
                <iframe
                  srcDoc={preview?.html ?? ""}
                  className="h-[70vh] w-full rounded-xl border border-navy-200 bg-white"
                  title={t("photobook.title")}
                />

                <div className="mt-4 space-y-2 text-sm">
                  {preview && (
                    <p className="text-navy-700">
                      {t("photobook.pages", {
                        pages: String(preview.pages),
                        volumes: String(preview.volumes),
                      })}
                    </p>
                  )}
                  {credits !== null && (
                    <p className="font-semibold text-navy-900">
                      {t("photobook.price", { credits: String(credits) })}
                    </p>
                  )}
                  {balance !== null && (
                    <p className="text-navy-600">
                      {t("photobook.balance", { balance: String(balance) })}
                    </p>
                  )}

                  {/* Shown above the button, not folded into a details element —
                      these describe failures invisible on screen and obvious on
                      paper, and folding them away is how one gets missed. */}
                  {preview && preview.warnings.length > 0 && (
                    <ul className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>
                          <code>{w.code}</code> {w.detail}
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    method="post"
                    action={`/${entry.username}/photobook/order`}
                    onSubmit={() => setSubmitting(true)}
                  >
                    <input type="hidden" name="trip" value={tripRef} />
                    <input type="hidden" name="options" value={JSON.stringify(options)} />
                    <input type="hidden" name="orderId" value={orderId} />
                    <button
                      type="submit"
                      disabled={submitting || tooPoor || unbuyable || !preview}
                      className="min-h-11 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("photobook.pay")}
                    </button>
                    {/* The build is synchronous and a long trip is tens of
                        seconds of PDF rendering — this is the only sign the
                        page gives that the press was heard, between the
                        click and the redirect. */}
                    {submitting && (
                      <p className="mt-2 text-sm text-navy-700" role="status">
                        {t("photobook.building")}
                      </p>
                    )}
                    {unbuyable && (
                      <p className="mt-2 text-sm text-red-700">{t("photobook.noPhotos")}</p>
                    )}
                    {tooPoor && credits !== null && balance !== null && (
                      <p className="mt-2 text-sm text-red-700">
                        {t("photobook.tooPoor", {
                          credits: String(credits),
                          balance: String(balance),
                        })}
                      </p>
                    )}
                  </form>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
