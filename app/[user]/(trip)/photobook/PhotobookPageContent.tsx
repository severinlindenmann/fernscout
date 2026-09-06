"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import {
  DEFAULT_OPTIONS,
  type BookOptions,
  type DayLayout,
  type DayPlan,
} from "@/lib/photobook/options";
import type { PhotobookOutcome, PhotobookOutcomeState } from "@/lib/photobook/orders";
import type { MediaTile, PhotobookEntry } from "@/lib/types";
import BookLevelView, { type PreviewState } from "./BookLevelView";
import DayLevelView, { type Drill } from "./DayLevelView";
import { extractSpreads } from "./previewSlice";
import { usePersistedState } from "./usePersistedState";

/**
 * Every outcome `order/route.ts` can redirect back with, as a key rather
 * than a sentence baked into this file — the same reasoning as the postcard
 * page's own `RESULTS` table.
 *
 * An exact `Record` over `PhotobookOutcomeState` minus `"done"` (handled
 * below as its own success panel, not a message from this table) rather than
 * `Record<string, TranslationKey>` — B484. Add a state in `order/route.ts`
 * without adding its entry here and `tsc` refuses the file, instead of the
 * owner seeing a blank page for a redirect nobody wrote a message for.
 */
const OUTCOME_MESSAGE: Record<Exclude<PhotobookOutcomeState, "done">, TranslationKey> = {
  duplicate: "photobook.duplicate",
  no_credits: "photobook.noCredits",
  no_photos: "photobook.noPhotos",
  failed: "photobook.failed",
};

/**
 * The book's own preview page: options on one level, a day's controls on
 * another, and one Pay button that is the only thing here that spends
 * credits.
 *
 * The preview is server-planned — `POST /<user>/photobook/preview` runs the
 * same `planFor` the paying route does — so this component's job is to hold
 * `BookOptions` in state, ask for a new preview whenever they change, and
 * render whatever comes back. It never lays out a page itself.
 *
 * **Two levels, hierarchical, never a wizard — B534.** Level 1
 * (`BookLevelView`) is the whole book: settings, preview, warnings, price,
 * Pay, short enough to reach without meeting a single per-day control. Level
 * 2 (`DayLevelView`) is reached by tapping a spread inside the preview
 * iframe — the iframe's own script posts a message this component listens
 * for — and shows that spread's controls with the spread itself directly
 * beneath. There is no day accordion any more: drilling in from the preview
 * is the only way to a day's controls, not a second one beside it. Days are
 * addressed by *date*, never by page index, because pages renumber
 * (`expandToMinimum`, a volume split, B517's run-on) and `options.days` —
 * `Record<date, DayPlan>` — does not.
 */
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
  /** The trip's days, in the order the book prints them. */
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
  const { t, tn } = useI18n();
  /**
   * The arrangement, kept in the browser between visits.
   *
   * Eighteen days of choices is an evening's work, and losing it to a phone
   * locking or a tab being closed is the thing that makes somebody give up on
   * a tool rather than complain about it. `localStorage` and not a server-side
   * draft: a draft is a table, a lifetime, a thing to clean up and a thing to
   * decide who else can see — and this belongs to one person on one device,
   * which is exactly what `localStorage` already is.
   *
   * Keyed by trip, so arranging one journey does not disturb another.
   *
   * **Read after mounting, not in the initialiser.** The server renders this
   * page too, and it has no `localStorage` — so an initialiser that reads one
   * makes the first client render disagree with the server's, and React says
   * so: "a tree hydrated but some attributes of the server rendered HTML
   * didn't match". It showed up on B515's reset button, which is disabled
   * when nothing has been arranged and was therefore enabled on the client and
   * disabled on the server. Every control that reads the arrangement had the
   * same fault; only that one happened to render an attribute React compares.
   *
   * The cost is one frame of the default arrangement before the stored one
   * arrives, which is the standard trade and is invisible at this size.
   *
   * A stored arrangement from an older version is ignored rather than merged:
   * `parseOptions` on the server would refuse it anyway, and starting from the
   * default is a better failure than a form that cannot be submitted. B534
   * changes nothing here — `options.days` is still keyed by date, so an
   * arrangement saved before this ticket restores exactly as it did before.
   *
   * The mounting-after / never-in-the-initialiser rule, and the restore/persist
   * pair of effects themselves, live in `usePersistedState` — B507 moved them
   * there after a race between the two (real only in dev, under Strict Mode's
   * double-effect invocation) made a saved arrangement vanish on reload; see
   * that file's own comment and `test/photobook-persistence.test.tsx`.
   */
  const storageKey = `fernscout:photobook:${tripRef}`;
  const [options, setOptions] = usePersistedState<BookOptions>(
    storageKey,
    { ...DEFAULT_OPTIONS, locale: locales[0] ?? DEFAULT_OPTIONS.locale },
    (saved, current) => {
      const parsed = JSON.parse(saved) as Partial<BookOptions>;
      return {
        ...current,
        ...parsed,
        days: typeof parsed.days === "object" && parsed.days !== null ? parsed.days : {},
      };
    },
  );
  const [preview, setPreview] = useState<PreviewState>(null);
  const [submitting, setSubmitting] = useState(false);

  // The double-press guard for the Pay button lives on the server
  // (`ORDER_ID_RE`, `claimOrder`), and it needs one id per visit to this
  // page rather than one per press — generated once, in the initialiser, so
  // a re-render (an option changing, a preview arriving) never hands the
  // form a second id to race the first against.
  const [orderId] = useState(() => crypto.randomUUID());

  /** Level 1 (`null`) or level 2, on a day — B534. Front matter has no
   * controls of its own (B563) so it does not drill. */
  const [drill, setDrill] = useState<Drill>(null);
  /** Which photograph's crop is being adjusted, by `src` — B513. A src is
   * unique across the whole book, so one flag (not one per day) is enough. */
  const [focalEditing, setFocalEditing] = useState<string | null>(null);

  // Drill-in: `lib/photobook/preview.ts` stamps every drillable spread with a
  // click handler that posts a message rather than navigating — the preview
  // document has no idea it is sitting in an iframe here, and opened straight
  // from a folder (the CLI's own copy) nothing is listening. Filtered by
  // `source` so an unrelated message on the page is never mistaken for one.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { source?: string; kind?: string; date?: string | null } | null;
      if (!data || data.source !== "fernscout-photobook-preview") return;
      if ((data.kind === "day" || data.kind === "photos") && data.date) {
        setFocalEditing(null);
        setDrill({ date: data.date });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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

  /**
   * Leave a day out of the book entirely, or put it back — B564.
   *
   * The same shape as `setDayRunOn`: `true` writes the flag, `false` deletes
   * it, so a day nobody has excluded stays indistinguishable from one this
   * was explicitly set back off. Everything downstream — the planner, the
   * page count, the price — reads `options.days[date].excluded` from here on.
   */
  const setDayExcluded = (date: string, excludedFlag: boolean) =>
    setOptions((o) => {
      const next = { ...o.days[date] };
      if (excludedFlag) next.excluded = true;
      else delete next.excluded;
      return { ...o, days: { ...o.days, [date]: next } };
    });

  /** Let a day's words carry on to a second page instead of being cut short
   * — B517. Off is the default `days` entry never says otherwise, so
   * deleting the key when it is turned back off is what keeps a day nobody
   * has touched indistinguishable from one this was explicitly set false. */
  const setDayRunOn = (date: string, runOn: boolean) =>
    setOptions((o) => {
      const next = { ...o.days[date] };
      if (runOn) next.runOn = true;
      else delete next.runOn;
      return { ...o, days: { ...o.days, [date]: next } };
    });

  /** One tap: this is the photograph that should run big. Tapping the current
   * one again gives the choice back to the planner. */
  const setHero = (date: string, src: string) =>
    setOptions((o) => {
      const current = o.days[date]?.hero;
      const next = { ...o.days[date] };
      if (current === src) delete next.hero;
      else next.hero = src;
      return { ...o, days: { ...o.days, [date]: next } };
    });

  /** Move a photograph one place earlier or later within its day. Buttons
   * rather than dragging: a drag on a phone fights the page's own scroll, and
   * these lists are three or four items long. */
  const movePhoto = (date: string, src: string, by: -1 | 1, dayPhotos: MediaTile[]) =>
    setOptions((o) => {
      const current = [...(o.days[date]?.photos ?? dayPhotos.map((m) => m.src))];
      const at = current.indexOf(src);
      const to = at + by;
      if (at === -1 || to < 0 || to >= current.length) return o;
      [current[at], current[to]] = [current[to], current[at]];
      return { ...o, days: { ...o.days, [date]: { ...o.days[date], photos: current } } };
    });

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

  /**
   * The way back — B515.
   *
   * A day the owner has fiddled with has an entry in `options.days`; deleting
   * it is enough to hand the day back to the planner, because "no entry" is
   * already what "the planner decides" means everywhere else in this file.
   *
   * Any crop tapped onto one of the day's own photographs goes with it — a
   * "start this day over" that left a subject nudged off-centre would not
   * read as a reset.
   */
  const resetDay = (date: string, dayPhotos: MediaTile[]) =>
    setOptions((o) => {
      const rest = { ...o.days };
      delete rest[date];
      const focalPoints = { ...o.focalPoints };
      for (const m of dayPhotos) delete focalPoints[m.src];
      return { ...o, days: rest, focalPoints };
    });

  /**
   * Where a photograph is cropped from, when it is cropped at all — B513.
   *
   * `focalOf` is the default (0.5, 0.5) plus whatever a person has tapped;
   * `setFocal` writes a tap or a keyboard nudge; `resetFocal` hands one
   * photograph back to the centre. All three go through `options.focalPoints`,
   * which is why persisting and resetting the whole book already covers them
   * with no second mechanism.
   */
  const focalOf = (src: string) => options.focalPoints[src] ?? { x: 0.5, y: 0.5 };
  const setFocal = (src: string, x: number, y: number) =>
    setOptions((o) => ({
      ...o,
      focalPoints: { ...o.focalPoints, [src]: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } },
    }));
  const resetFocal = (src: string) =>
    setOptions((o) => {
      const focalPoints = { ...o.focalPoints };
      delete focalPoints[src];
      return { ...o, focalPoints };
    });
  /** Tapping the thumbnail: the fraction across and down its own rendered
   * box, which is exactly what `BookOptions.focalPoints` stores. */
  const setFocalFromTap = (src: string, e: React.MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setFocal(src, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
  };
  /** Arrow keys move the point in 5% steps — twenty stops across the frame,
   * fine enough to matter and coarse enough to reach the edge in a few
   * presses. The only other keyboard route to the same value, since a tap
   * target is not itself operable from a keyboard. */
  const FOCAL_STEP = 0.05;
  const nudgeFocalByKey = (src: string, e: React.KeyboardEvent<HTMLElement>) => {
    const { x, y } = focalOf(src);
    if (e.key === "ArrowLeft") setFocal(src, x - FOCAL_STEP, y);
    else if (e.key === "ArrowRight") setFocal(src, x + FOCAL_STEP, y);
    else if (e.key === "ArrowUp") setFocal(src, x, y - FOCAL_STEP);
    else if (e.key === "ArrowDown") setFocal(src, x, y + FOCAL_STEP);
    else return;
    e.preventDefault();
  };

  /**
   * The whole book, back to the planner's arrangement.
   *
   * Eighteen days of choices is an evening's work, so this asks first — in
   * words, naming how many days are about to be undone, rather than a bare
   * "are you sure?" that could mean anything. `window.confirm` rather than a
   * dialog of our own: this is the one native primitive built for exactly
   * "say what happens, then let the person stop it".
   *
   * Clearing `days` and `focalPoints` is the whole fix for `localStorage` too:
   * the effect above writes `options` on every change, so the stored
   * arrangement shrinks along with the in-memory one rather than needing a
   * second, separate erase.
   */
  const resetBook = () => {
    const count = Object.keys(options.days).length;
    if (count === 0 && Object.keys(options.focalPoints).length === 0) return;
    if (!window.confirm(tn("photobook.resetAllConfirm", count, { count: String(count) }))) return;
    setOptions((o) => ({ ...o, days: {}, focalPoints: {} }));
  };

  /**
   * One layout, everywhere — B516.
   *
   * The ticket offers two shapes: this simple action, or a book-level default
   * a day's `DayPlan` inherits until it says otherwise. The inheriting
   * default is the larger change — it needs a third layout state ("this day
   * says pairs" vs. "this day inherits pairs") read by the planner, by the
   * summary row above, and by `resetBook`, and nobody has asked for that yet.
   * This writes the chosen layout into every day's own entry once, which
   * everything downstream already knows how to read — a day arranged this
   * way is indistinguishable from one arranged by hand, one at a time.
   *
   * Confirms first, and only when it would actually overwrite a choice: a day
   * already sitting at `auto` costs nothing to skip past silently, but a day
   * somebody laid out by hand does not lose that without being told how many
   * are about to change — the "obvious before, not after" the ticket asks
   * for.
   */
  const applyLayoutToAll = (layout: DayLayout) => {
    const overridden = days.filter(
      (d) => options.days[d.date]?.layout !== undefined && options.days[d.date]?.layout !== layout,
    ).length;
    if (
      overridden > 0 &&
      !window.confirm(tn("photobook.day.applyToAllConfirm", overridden, { count: String(overridden) }))
    ) {
      return;
    }
    setOptions((o) => {
      const next = { ...o.days };
      for (const d of days) next[d.date] = { ...next[d.date], layout };
      return { ...o, days: next };
    });
  };

  // Debounced: every keystroke and every tile click changes `options`, and
  // each one plans and lays out the whole book server-side. 400 ms is long
  // enough that a run of clicks collapses into one request and short enough
  // that the preview still feels like it is following you. Unchanged by
  // B534 — level 2 reads its spread out of the same `preview.html` this
  // fetches, rather than asking again.
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

  /**
   * Which days are actually being cut short — B517.
   *
   * Reads `BookWarning.date`, not `detail`: `detail` is a sentence for a
   * person and must be free to be reworded or translated without silently
   * hiding this control on every day.
   */
  const truncatedDates = new Set(
    (preview?.warnings ?? [])
      .filter((w) => w.code === "text-truncated" && w.date)
      .map((w) => w.date as string),
  );

  /**
   * Level 2's own slice of the preview — a day's spread(s), or the front
   * matter's — cut from `preview.html` on the client rather than fetched
   * again. `extractSpreads` reads the `data-date`/`data-kind` attributes
   * `lib/photobook/preview.ts` stamps on every drillable page.
   */
  const sliceHtml = useMemo(() => {
    if (!drill || !preview) return null;
    return extractSpreads(preview.html, (ds) => ds.date === drill.date);
  }, [drill, preview]);

  const drillDay = drill ? days.find((d) => d.date === drill.date) : undefined;
  const drillDayPhotos = drillDay ? media.filter((m) => m.date === drillDay.date) : [];
  const drillPlan: DayPlan | undefined = drillDay ? options.days[drillDay.date] : undefined;
  const drillLayout: DayLayout = drillPlan?.layout ?? "auto";

  const canReset = Object.keys(options.days).length > 0 || Object.keys(options.focalPoints).length > 0;

  /**
   * Every day left out, and the way back — B564.
   *
   * Kept in this component rather than in `BookLevelView` (another session's
   * turf right now): rendered as its own block, beside it, only when there is
   * something to say. Nothing at all when no day has been excluded, the same
   * "quiet unless it matters" rule the warnings block already follows.
   */
  const excludedDays = days.filter((d) => options.days[d.date]?.excluded);

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
        {/* Two short lines, because the book starts immediately below them
            and at 390px every one of them costs a slice of it — B548. What
            this page is goes in the eyebrow; the heading is the trip, which
            is what the book is of. */}
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500">
          {t("photobook.title")}
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
          {tripTitle}
        </h1>

        {/* The outcome of the last press, above everything else: a page that
            looked identical whether Pay had just succeeded, failed, or never
            been pressed is what made a second press cost a second book. A
            successful order replaces the form outright rather than sitting
            above an armed Pay button, since the book it would build is the
            one already sitting in the links below. */}
        {outcome?.state === "done" ? (
          <div className="mt-6 max-w-xl rounded-lg border-2 border-navy-900 bg-cream-100 px-4 py-4">
            <p className="font-semibold text-navy-900">{t("photobook.done")}</p>
            {outcome.orderId && outcome.files.length > 0 ? (
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
            ) : (
              // `markPrinted`'s payload carries `files` only when the row was
              // still `submitted` when the build finished — B484. That guard
              // is correct (B509's review confirmed it keeps a refunded order
              // from reading as printed) but it means this panel can render
              // with nothing to link to for an order the owner *did* pay for
              // and the receipt mail — sent unconditionally, off the real
              // build result rather than this row — still carries the links.
              // Saying so beats a success panel that looks like it forgot
              // them.
              <p className="mt-3 text-sm text-navy-700">{t("photobook.done.filesInMail")}</p>
            )}
            <a href="?" className="mt-4 inline-block text-sm underline">
              {t("photobook.anotherBook")}
            </a>
          </div>
        ) : (
          <>
            {outcome && (
              <p
                className="mt-6 max-w-xl rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
                role="status"
              >
                {t(OUTCOME_MESSAGE[outcome.state])}
              </p>
            )}

            <BookLevelView
              hidden={drill !== null}
              options={options}
              setOptions={setOptions}
              media={media}
              locales={locales}
              resetBook={resetBook}
              canReset={canReset}
              preview={preview}
              submitting={submitting}
              setSubmitting={setSubmitting}
              orderId={orderId}
              entryUsername={entry.username}
              tripRef={tripRef}
              balance={balance}
              t={t}
              tn={tn}
            />

            {/* Visible and reversible from level 1 — the ticket's own rule,
                so a day excluded from inside its own drill-in is never a
                trap: even without ever going back in, the owner can see how
                many days are still in the book and undo any of this here. */}
            {!drill && excludedDays.length > 0 && (
              <div className="mt-4 rounded-lg border border-navy-200 bg-white px-3 py-3">
                <p className="text-sm font-semibold text-navy-800">
                  {t("photobook.excluded.heading")}
                </p>
                <p className="mt-1 text-xs text-navy-600">
                  {t("photobook.excluded.summary", {
                    included: String(days.length - excludedDays.length),
                    total: String(days.length),
                  })}
                </p>
                <ul className="mt-2 space-y-1">
                  {excludedDays.map((d) => (
                    <li key={d.date} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-navy-700">{d.title}</span>
                      <button
                        type="button"
                        onClick={() => setDayExcluded(d.date, false)}
                        className="min-h-8 shrink-0 rounded-full border border-navy-200 px-3 text-xs font-semibold text-navy-700"
                      >
                        {t("photobook.excluded.putBack")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {drill && (
              <DayLevelView
                drill={drill}
                onBack={() => setDrill(null)}
                day={drillDay}
                dayPhotos={drillDayPhotos}
                plan={drillPlan}
                layout={drillLayout}
                truncated={drillDay ? truncatedDates.has(drillDay.date) : false}
                focalEditing={focalEditing}
                focalOf={focalOf}
                setDayLayout={setDayLayout}
                setDayRunOn={setDayRunOn}
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
                options={options}
                setOptions={setOptions}
                media={media}
                locales={locales}
                resetBook={resetBook}
                canReset={canReset}
                sliceHtml={sliceHtml}
                ratio={preview?.ratio ?? 2}
                t={t}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
