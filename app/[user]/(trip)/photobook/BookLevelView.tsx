"use client";

import { useRef, useState } from "react";
import { creditsInRappen, formatChf } from "@/lib/credits/pricing";
import type { TranslationKey } from "@/lib/i18n";
import type { BookOptions } from "@/lib/photobook/options";
import type { MediaTile } from "@/lib/types";
import BookSettingsPanel, { SIZE_LABEL } from "./BookSettingsPanel";
import { readingHtml } from "./previewSlice";
import ReadTheBookView, { useHasKeyboard, useSpreadKeys } from "./ReadTheBookView";

export type PreviewState = {
  html: string;
  pages: number;
  volumes: number;
  credits: number;
  /** The shape of one spread — two pages and their bleed, side by side. The
   * frame is sized from this, so the book is never a letterbox with its own
   * scrollbar. */
  ratio: number;
  warnings: { code: string; detail: string; count?: number; date?: string; photos?: string[] }[];
  buyable: boolean;
} | null;

type T = (key: TranslationKey, vars?: Record<string, string>) => string;
type Tn = (key: TranslationKey, count: number, vars?: Record<string, string>) => string;

/**
 * One line per kind of warning, in the reader's own words — B549.
 *
 * The planner's `detail` is a developer's note: it names files under
 * `content/`, and one of them named a constant in `lib/photobook/spec.ts` to
 * somebody who had just been asked for money. `code` is still the right thing
 * for a machine to key on and is still what arrives here — it is simply never
 * rendered. What a reader gets is a count and a consequence, and where the
 * software knows the remedy, a button that applies it.
 *
 * A code with no sentence of its own is dropped rather than printed raw: a
 * warning nobody wrote words for is a warning nobody can act on, and the
 * `detail` behind it is not safe to show.
 */
const WARNING_TEXT: [code: string, key: TranslationKey][] = [
  ["no-photos", "photobook.warn.noPhotos"],
  ["page-count", "photobook.warn.pageCount"],
  ["split-into-volumes", "photobook.warn.splitIntoVolumes"],
  ["blank-padding", "photobook.warn.blankPadding"],
  ["low-resolution", "photobook.warn.lowResolution"],
  ["no-original", "photobook.warn.noOriginal"],
  ["no-large-photo", "photobook.warn.noLargePhoto"],
  ["text-truncated", "photobook.warn.textTruncated"],
];

/** How many *things* each code is about, not how many warnings carry it: one
 * `no-original` speaks for every photograph that fell back to a web copy, and
 * says so in `count`. */
function countByCode(warnings: { code: string; count?: number }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + (w.count ?? 1));
  return counts;
}

/**
 * Which photographs each code's warnings are about, gathered across every
 * warning that carries the list — B642. `low-resolution` carries one
 * photograph per warning; this collects them all so the reader sees which
 * ones, not only how many. Since B701 they are `webSrc`s and are shown as
 * pictures: a path under `content/` named the file but not the photograph.
 */
function photosByCode(warnings: { code: string; photos?: string[] }[]): Map<string, string[]> {
  const photos = new Map<string, string[]>();
  for (const w of warnings) {
    if (!w.photos) continue;
    photos.set(w.code, [...(photos.get(w.code) ?? []), ...w.photos]);
  }
  return photos;
}

/**
 * The photographs one warning is about, as pictures — B701.
 *
 * Eight of them, because the row is an illustration of the sentence above it
 * and not a gallery; the sentence's own count is what says how many there
 * are. Ordinary `<img>` rather than `next/image`: these are already-sized
 * derivatives from this journal, drawn at 48px, and the loader would buy
 * nothing.
 */
function PhotoRow({ srcs }: { srcs: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {/* Deduplicated: one photograph printed on two pages is two warnings and
          still one picture to look at. */}
      {[...new Set(srcs)].slice(0, 8).map((src) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          className="h-12 w-12 rounded border border-yellow-300 object-cover"
        />
      ))}
    </div>
  );
}

/**
 * Level 1 — the book, and then everything else.
 *
 * B534 put the whole book on one level and one day on another, and that
 * hierarchy was right. What was wrong (B547/B548) was the order inside this
 * level: nine form controls, then the book in a third-of-a-screen box, then a
 * wall of planner diagnostics larger than the book itself. Reversed here. The
 * spreads come first and fill the width; the settings are one entry below
 * them; the warnings say what it means for the printed book and offer the fix
 * the planner already knows; the order block says what is being bought, in
 * money as well as credits, and what happens after the button.
 *
 * Rendered with `hidden` rather than unmounted while level 2 is open (see
 * `PhotobookPageContent`): the strip's own scroll position is what makes
 * "back returns to the spread you came from" true for free.
 */
export default function BookLevelView({
  hidden,
  options,
  setOptions,
  spineText,
  media,
  locales,
  resetBook,
  canReset,
  preview,
  submitting,
  setSubmitting,
  orderId,
  entryUsername,
  tripRef,
  balance,
  t,
  tn,
}: {
  hidden: boolean;
  options: BookOptions;
  setOptions: (update: (o: BookOptions) => BookOptions) => void;
  /** The trip's title and year, exactly as the cover prints it down the
   * spine — B642. */
  spineText: string;
  media: MediaTile[];
  locales: string[];
  resetBook: () => void;
  canReset: boolean;
  preview: PreviewState;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  orderId: string;
  entryUsername: string;
  tripRef: string;
  balance: number | null;
  t: T;
  tn: Tn;
}) {
  /** The deliberate step between arranging and ordering — B561. */
  const [reading, setReading] = useState(false);
  const strip = useRef<HTMLIFrameElement>(null);
  const hasKeyboard = useHasKeyboard();
  useSpreadKeys(strip, "x", !hidden && !reading);

  const credits = preview?.credits ?? null;
  const tooPoor = balance !== null && credits !== null && balance < credits;
  const unbuyable = preview?.buyable === false;

  const sizeName = t(SIZE_LABEL[options.size] ?? "photobook.size.square");
  const bindingName = t(
    options.binding === "saddle" ? "photobook.binding.saddle" : "photobook.binding.perfect",
  );
  const summary = preview
    ? t(preview.volumes > 1 ? "photobook.summaryVolumes" : "photobook.summary", {
        pages: String(preview.pages),
        volumes: String(preview.volumes),
        size: sizeName,
        binding: bindingName,
      })
    : null;

  const counts = countByCode(preview?.warnings ?? []);
  const photosOf = photosByCode(preview?.warnings ?? []);
  /**
   * The remedy, not the description — B549's whole point.
   *
   * `blank-padding` is the one the planner spells out and then declines to
   * act on: it knows a trip this short wants stapling, and used to print a
   * paragraph telling the reader to go and find a radio button. Offered here
   * as a button that sets it.
   *
   * The resolution pair get the honest half of the same move: a smaller page
   * needs fewer pixels, so offering the smallest format is a real remedy —
   * but whether it clears every photograph depends on the crop, so the button
   * changes the format and lets the re-plan (400 ms later) answer. It says
   * "print it smaller", never "this will fix it".
   */
  const fixes: { key: TranslationKey; apply: () => void }[] = [];
  if (counts.has("blank-padding") && options.binding !== "saddle") {
    fixes.push({
      key: "photobook.fix.staple",
      apply: () => setOptions((o) => ({ ...o, binding: "saddle" })),
    });
  }
  if (
    (counts.has("low-resolution") || counts.has("no-original") || counts.has("no-large-photo")) &&
    options.size !== "square-210"
  ) {
    fixes.push({
      key: "photobook.fix.smaller",
      apply: () => setOptions((o) => ({ ...o, size: "square-210" })),
    });
  }

  const lines = WARNING_TEXT.filter(([code]) => counts.has(code));

  return (
    <div hidden={hidden} className="mt-4">
      {/* The book, first and full width. `aspect-ratio` from the plan rather
          than a viewport fraction: the frame is exactly one spread tall, so
          there is nothing to scroll inside it and nothing letterboxed. While
          the first preview is in flight the frame keeps a spread's shape so
          the page below it does not jump. */}
      <div className="-mx-4 sm:mx-0">
        <iframe
          ref={strip}
          srcDoc={preview?.html ?? ""}
          style={{ aspectRatio: String(preview?.ratio ?? 2) }}
          className="w-full border-0 bg-cream-100 sm:rounded-xl"
          title={t("photobook.title")}
        />
      </div>

      <p className="mt-3 text-sm font-semibold text-navy-900">{summary ?? " "}</p>
      <p className="mt-1 text-xs text-navy-600">{t("photobook.composer.tapHint")}</p>
      {/* Said only where a keyboard exists — a hint about arrow keys on a
          phone is noise. B561. */}
      {hasKeyboard && (
        <p className="mt-1 text-xs text-navy-600">{t("photobook.composer.keyHint")}</p>
      )}

      {/* The way to read the book before paying for it — B561. Directly under
          the book and above everything else, because it is the next thing to
          do with what you have just arranged, not a setting. */}
      <button
        type="button"
        onClick={() => setReading(true)}
        disabled={!preview}
        className="mt-4 min-h-11 w-full rounded-full border-2 border-navy-900 px-5 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {t("photobook.read.open")}
      </button>
      <p className="mt-1 text-xs text-navy-600">{t("photobook.read.openHint")}</p>

      {/* Nothing at all when there is nothing wrong — B549. */}
      {lines.length > 0 && (
        <div className="mt-5 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
          <p className="text-sm font-semibold">{t("photobook.warn.heading")}</p>
          <ul className="mt-1 space-y-1 text-sm">
            {lines.map(([code, key]) => {
              const count = counts.get(code) ?? 1;
              const photos = photosOf.get(code);
              return (
                <li key={code}>
                  {tn(key, count, { count: String(count) })}
                  {photos && photos.length > 0 && <PhotoRow srcs={photos} />}
                </li>
              );
            })}
          </ul>
          {fixes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {fixes.map((fix) => (
                <button
                  key={fix.key}
                  type="button"
                  onClick={fix.apply}
                  className="min-h-11 rounded-full border-2 border-yellow-700 px-4 text-sm font-semibold text-yellow-900"
                >
                  {t(fix.key)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The nine settings, behind one entry — B548. Still every one of them,
          and one tap away rather than in front of the book. */}
      <details className="mt-5 rounded-lg border border-navy-200 bg-white px-3 py-3">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-navy-800">
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

      {/* What is being bought, what it costs in something a person
          understands, and what happens after the button — B551. */}
      <div
        id="photobook-order"
        className="mt-5 scroll-mt-4 rounded-xl border-2 border-navy-900 bg-cream-100 p-4"
      >
        <h2 className="font-display text-lg font-semibold text-navy-900">
          {t("photobook.orderHeading")}
        </h2>
        {summary && <p className="mt-1 text-sm text-navy-700">{summary}</p>}
        {/* The one thing about the printed object nobody sees until it
            arrives — B642. */}
        <p className="mt-1 text-sm text-navy-600">{t("photobook.spine", { spine: spineText })}</p>
        {credits !== null && (
          <p className="mt-2 text-base font-semibold text-navy-900">
            {t("photobook.price", {
              credits: String(credits),
              money: formatChf(creditsInRappen(credits)),
            })}
          </p>
        )}
        {balance !== null && (
          <p className="text-sm text-navy-600">{t("photobook.balance", { balance: String(balance) })}</p>
        )}

        <p className="mt-3 text-sm text-navy-700">{t("photobook.orderNext")}</p>
        {/* Still a simulation, and it says so before the button rather than
            in the receipt afterwards — B434's rule, applied to a page. */}
        <p className="mt-2 text-sm text-navy-600">{t("photobook.orderNotPrinted")}</p>

        <form
          method="post"
          action={`/${entryUsername}/photobook/order`}
          onSubmit={() => setSubmitting(true)}
          className="mt-4"
        >
          <input type="hidden" name="trip" value={tripRef} />
          <input type="hidden" name="options" value={JSON.stringify(options)} />
          <input type="hidden" name="orderId" value={orderId} />
          <button
            type="submit"
            // Not `tooPoor`: a short balance leaves the button live, and the
            // press comes back `no_credits` from `order/route.ts` before a
            // page is drawn or a credit moves. A dead button is a book the
            // owner cannot see the shape of; this way they meet the price
            // rather than a grey rectangle — B606.
            disabled={submitting || unbuyable || !preview}
            className="min-h-11 w-full rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {t("photobook.pay")}
          </button>
          {/* The build is synchronous and a long trip is tens of seconds of
              PDF rendering — this is the only sign the page gives that the
              press was heard, between the click and the redirect. */}
          {submitting && (
            <p className="mt-2 text-sm text-navy-700" role="status">
              {t("photobook.building")}
            </p>
          )}
          {unbuyable && <p className="mt-2 text-sm text-red-700">{t("photobook.noPhotos")}</p>}
          {/* Not a dead disabled button: the one place credits are bought is
              the owner's own page, and this is the link to it — B551. */}
          {tooPoor && credits !== null && balance !== null && (
            <p className="mt-2 text-sm text-red-700">
              {t("photobook.tooPoor", { credits: String(credits), balance: String(balance) })}{" "}
              <a className="font-semibold underline" href={`/${entryUsername}/me`}>
                {t("photobook.getCredits")}
              </a>
            </p>
          )}
        </form>
      </div>

      {/* Reading it, and then ordering it: the button below the book hands
          back to the order block above rather than carrying a second copy of
          the form — there is one Pay button on this page and it is that one. */}
      {reading && preview && (
        <ReadTheBookView
          html={readingHtml(preview.html)}
          summary={summary}
          onBack={() => setReading(false)}
          onOrder={() => {
            setReading(false);
            document.getElementById("photobook-order")?.scrollIntoView({ behavior: "smooth" });
          }}
          t={t}
        />
      )}
    </div>
  );
}
