"use client";

import { useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import type { TranslationKey } from "@/lib/i18n";
import type { BookOptions } from "@/lib/photobook/options";
import type { MediaTile } from "@/lib/types";
import { addressLines } from "@/lib/order/address";
import type { PanelRecipient } from "@/lib/photobook/recipients";
import { OrderEnvelope, OrderLedgerCard } from "@/components/order/OrderDocket";
import { photobookLedger } from "@/lib/order/ledger";
import BookSettingsPanel, { SIZE_LABEL } from "./BookSettingsPanel";
import ExperimentalPrintNotice from "./ExperimentalPrintNotice";
import { readingHtml } from "./previewSlice";
import ReadTheBookView, {
  useHasKeyboard,
  useSpreadKeys,
} from "./ReadTheBookView";

export type PreviewState = {
  html: string;
  pages: number;
  volumes: number;
  /** `null` until a recipient exists and Gelato has quoted them — B1425.
   *  There is no build-only fallback figure: a book is one product at one
   *  price, and with nobody to post it to there is no honest total. */
  credits: number | null;
  /** The shape of one spread — two pages and their bleed, side by side. The
   * frame is sized from this, so the book is never a letterbox with its own
   * scrollbar. */
  ratio: number;
  warnings: {
    code: string;
    detail: string;
    count?: number;
    date?: string;
    photos?: string[];
  }[];
  buyable: boolean;
  /** Which of the three reasons `buyable` is false, or `null` when it is
   * true — B1406. Sent by the route rather than re-derived here so a new
   * refusal added to `preview/route.ts` fails `tsc` at `UNBUYABLE_MESSAGE`
   * below instead of silently rendering the wrong sentence. */
  unbuyableReason: UnbuyableReason | null;
} | null;

type UnbuyableReason = "no-photos" | "no-recipient" | "printer-unavailable";

/** One sentence per reason the button is dead — B1406. A total `Record`,
 * following `OUTCOME_MESSAGE`'s own shape in `PhotobookPageContent.tsx`. */
const UNBUYABLE_MESSAGE: Record<UnbuyableReason, TranslationKey> = {
  "no-photos": "photobook.noPhotos",
  "no-recipient": "photobook.print.noRecipients",
  "printer-unavailable": "photobook.printerUnavailable",
};

type T = (key: TranslationKey, vars?: Record<string, string>) => string;
type Tn = (
  key: TranslationKey,
  count: number,
  vars?: Record<string, string>,
) => string;

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
function countByCode(
  warnings: { code: string; count?: number }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of warnings)
    counts.set(w.code, (counts.get(w.code) ?? 0) + (w.count ?? 1));
  return counts;
}

/**
 * Which photographs each code's warnings are about, gathered across every
 * warning that carries the list — B642. `low-resolution` carries one
 * photograph per warning; this collects them all so the reader sees which
 * ones, not only how many. Since B701 they are `webSrc`s and are shown as
 * pictures: a path under `content/` named the file but not the photograph.
 */
function photosByCode(
  warnings: { code: string; photos?: string[] }[],
): Map<string, string[]> {
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
  startOver,
  preview,
  submitting,
  setSubmitting,
  orderId,
  entryUsername,
  tripRef,
  balance,
  recipients,
  recipientId,
  setRecipientId,
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
  /** Reopen the first-book questions — B704. */
  startOver: () => void;
  preview: PreviewState;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  orderId: string;
  entryUsername: string;
  tripRef: string;
  balance: number | null;
  /** Who this book may be posted to, owner first — B1157. */
  recipients: PanelRecipient[];
  /** The chosen one. Lives in the parent because the quote depends on it. */
  recipientId: string | null;
  setRecipientId: (id: string) => void;
  t: T;
  tn: Tn;
}) {
  /** The deliberate step between arranging and ordering — B561. */
  const [reading, setReading] = useState(false);
  const strip = useRef<HTMLIFrameElement>(null);
  const hasKeyboard = useHasKeyboard();
  useSpreadKeys(strip, "x", !hidden && !reading);

  const recipient = recipients.find((r) => r.id === recipientId) ?? null;
  const credits = preview?.credits ?? null;
  const tooPoor = balance !== null && credits !== null && balance < credits;
  const unbuyable = preview?.buyable === false;

  const sizeName = t(SIZE_LABEL[options.size] ?? "photobook.size.square");
  const summary = preview
    ? t(preview.volumes > 1 ? "photobook.summaryVolumes" : "photobook.summary", {
        pages: String(preview.pages),
        volumes: String(preview.volumes),
        size: sizeName,
      })
    : null;

  const counts = countByCode(preview?.warnings ?? []);
  const photosOf = photosByCode(preview?.warnings ?? []);
  /**
   * The remedy, not the description — B549's whole point.
   *
   * `blank-padding` used to offer a stapled remedy here; Gelato has no
   * saddle-stitch product, so a short trip's padding has no button to press —
   * the planner's warning is the whole of it now.
   *
   * The resolution fix is the honest half of the same move: a smaller page
   * needs fewer pixels, so offering the smallest format is a real remedy —
   * but whether it clears every photograph depends on the crop, so the button
   * changes the format and lets the re-plan (400 ms later) answer. It says
   * "print it smaller", never "this will fix it".
   */
  const fixes: { key: TranslationKey; apply: () => void }[] = [];
  if (
    (counts.has("low-resolution") || counts.has("no-original") || counts.has("no-large-photo")) &&
    options.size !== "square"
  ) {
    fixes.push({
      key: "photobook.fix.smaller",
      apply: () => setOptions((o) => ({ ...o, size: "square" })),
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

      <p className="mt-3 text-sm font-semibold text-navy-900">
        {summary ?? " "}
      </p>
      <p className="mt-1 text-xs text-navy-600">
        {t("photobook.composer.tapHint")}
      </p>
      {/* Said only where a keyboard exists — a hint about arrow keys on a
          phone is noise. B561. */}
      {hasKeyboard && (
        <p className="mt-1 text-xs text-navy-600">
          {t("photobook.composer.keyHint")}
        </p>
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
      <p className="mt-1 text-xs text-navy-600">
        {t("photobook.read.openHint")}
      </p>

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
        <p className="mt-1 text-xs text-navy-600">
          {t("photobook.composer.bookSettingsHint")}
        </p>
        <div className="mt-3">
          <BookSettingsPanel
            options={options}
            setOptions={setOptions}
            media={media}
            locales={locales}
            resetBook={resetBook}
            canReset={canReset}
            startOver={startOver}
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
        <p className="mt-1 text-sm text-navy-600">
          {t("photobook.spine", { spine: spineText })}
        </p>
        {/* Where the book is going, before the money and not after it —
            B1157. What is for sale is the printed object, so the envelope
            belongs on the same panel as the price and the button. B1145: the
            name centred over the whole address, because that is how an
            address is read and what somebody checks a parcel against. */}
        {recipient ? (
          <div className="mt-3">
            {/* The same envelope the receipt draws, from the same component —
                B1466. It was written out twice, and two copies of an envelope
                is how the two come to differ. */}
            <OrderEnvelope
              toLabel={t("photobook.print.toLabel")}
              name={recipient.name}
              lines={addressLines(recipient.address)}
            />
            {recipients.length > 1 && (
              <details className="mt-2" open={!recipient.self}>
                <summary className="min-h-11 cursor-pointer content-center text-sm text-navy-600">
                  {t("photobook.print.elsewhere")}
                </summary>
                <fieldset className="mt-1">
                  <legend className="sr-only">{t("photobook.print.chooseLabel")}</legend>
                  <div className="flex flex-col gap-1">
                    {recipients.map((r) => (
                      <label
                        key={r.id}
                        className="flex items-start gap-2 rounded-lg border-2 border-navy-200 px-3 py-2 text-sm has-[:checked]:border-navy-900 has-[:checked]:bg-cream-50"
                      >
                        <input
                          type="radio"
                          name="book-recipient"
                          checked={r.id === recipientId}
                          onChange={() => setRecipientId(r.id)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold text-navy-900">{r.name}</span>
                          <span className="block text-navy-700">
                            {addressLines(r.address).join(", ")}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </details>
            )}
          </div>
        ) : (
          // No envelope, no purchase: a printed book is the only thing for
          // sale, so a journal with nobody to post to is told why rather than
          // shown a button that cannot work.
          <p className="mt-3 text-sm text-navy-700">{t("photobook.print.noRecipients")}</p>
        )}

        {/* The price after the envelope, because it depends on it: postage to
            Zurich and postage to Sydney are different numbers, and a total
            shown above the address it was quoted for reads as though the two
            were unrelated. */}
        {credits !== null && (
          <div className="mt-3">
            {/* The same ledger card the receipt shows, built by the same
                call — B1466. A price agreed to before the press and a price
                read back afterwards must not be phrased differently, and
                they were: a sentence here, a table there. */}
            <OrderLedgerCard
              ledger={photobookLedger(t, credits)}
              heading={t("photobook.receipt.priceHeading")}
              totalLabel={t("photobook.receipt.total")}
              meta={
                balance === null
                  ? undefined
                  : t("photobook.balance", { balance: String(balance) })
              }
            />
          </div>
        )}

        <p className="mt-3 text-sm text-navy-700">{t("photobook.orderNext")}</p>

        {/* The last thing read before the button — B1368. */}
        <div className="mt-3">
          <ExperimentalPrintNotice />
        </div>

        <form
          method="post"
          action={`/${entryUsername}/photobook/order`}
          onSubmit={() => setSubmitting(true)}
          className="mt-4"
        >
          <input type="hidden" name="trip" value={tripRef} />
          <input type="hidden" name="options" value={JSON.stringify(options)} />
          <input type="hidden" name="orderId" value={orderId} />
          {/* Who it is going to. Re-checked server-side against the contacts
              this journal may post to, and the postage re-quoted for their
              country, so editing this in the browser refuses rather than
              underpays — B1157. */}
          <input type="hidden" name="contactId" value={recipientId ?? ""} />
          {/* B595: the price this screen is showing right now, so
              `order/route.ts` can refuse rather than charge a number that
              silently grew between this render and the press. */}
          <input
            type="hidden"
            name="previewedCredits"
            value={credits === null ? "" : String(credits)}
          />
          <BusyButton
            type="submit"
            busy={submitting}
            // Not `tooPoor`: a short balance leaves the button live, and the
            // press comes back `no_credits` from `order/route.ts` before a
            // page is drawn or a credit moves. A dead button is a book the
            // owner cannot see the shape of; this way they meet the price
            // rather than a grey rectangle — B606.
            disabled={unbuyable || !preview}
            className="min-h-11 w-full rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {/* What it does and what it costs, on the control itself — the
                same rule the print button follows. "Pay with credits" named
                neither the object nor the number, on a press that orders a
                printed book. */}
            {credits === null
              ? t("photobook.pay")
              : t("photobook.payTotal", { total: String(credits) })}
          </BusyButton>
          {/* The build is synchronous and a long trip is tens of seconds of
              PDF rendering — this is the only sign the page gives that the
              press was heard, between the click and the redirect. */}
          {submitting && (
            <p className="mt-2 text-sm text-navy-700" role="status">
              {t("photobook.building")}
            </p>
          )}
          {/* Not for "no-recipient" — the grey paragraph above the address
              already says it, and repeating it in red says nothing new. */}
          {unbuyable &&
            preview?.unbuyableReason &&
            preview.unbuyableReason !== "no-recipient" && (
              <p className="mt-2 text-sm text-red-700">
                {t(UNBUYABLE_MESSAGE[preview.unbuyableReason])}
              </p>
            )}
          {/* Not a dead disabled button: the one place credits are bought is
              the owner's own page, and this is the link to it — B551. */}
          {tooPoor && credits !== null && balance !== null && (
            <p className="mt-2 text-sm text-red-700">
              {t("photobook.tooPoor", {
                credits: String(credits),
                balance: String(balance),
              })}{" "}
              <a
                className="font-semibold underline"
                href={`/${entryUsername}/me`}
              >
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
            document
              .getElementById("photobook-order")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
          t={t}
        />
      )}
    </div>
  );
}
