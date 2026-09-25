"use client";

import Image from "next/image";
import Link from "next/link";
import { mediaLoader } from "./mediaLoader";
import { motion } from "motion/react";
import { ArrowDown, BookOpen, ChevronRight, Clapperboard, PlayCircle, Sparkles } from "lucide-react";
import LatestDayButton from "./LatestDayButton";
import TripMap from "./TripMap";
import { isPlottable } from "@/lib/mapFrame";
import type { Basemap } from "@/lib/basemap";
import PushInstallOnboarding from "./PushInstallOnboarding";
import PushOptIn from "./PushOptIn";
import { KeptMark } from "./KeepTrip";
import Travelers from "./Travelers";
import { partyFor } from "@/lib/travellers/parse";
import UnconvertedNotice from "./UnconvertedNotice";
import { TripVisibility } from "./Visibility";
import { StackedShareBar, BarList } from "./charts/Charts";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { flagFor } from "@/lib/flags";
import { useSite } from "@/components/SiteProvider";
import { useMoney } from "./CurrencyProvider";
import {
  CATEGORY_STYLE,
  type CostCategory,
  type Unconverted,
} from "@/lib/costFormat";
import type { TranslationKey } from "@/lib/i18n";
import type { DaySummary, PhotobookEntry } from "@/lib/types";

/**
 * The other ways into the reading, beside the one filled button — B989.
 *
 * Equal shares of one row, so three of them read as a set of choices rather
 * than a primary and its footnotes. `min-h-11` because each is a tap target.
 * On a phone the icon sits above a smaller label, which keeps "Letzter Tag"
 * on one line in a third of the card; from `sm` up they are ordinary
 * side-by-side buttons.
 */
const SECONDARY =
  "inline-flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-line-quiet bg-surface-raised px-2 py-2 text-center text-xs font-semibold leading-tight text-ink-strong transition-colors hover:border-line-prominent sm:flex-none sm:flex-row sm:gap-1.5 sm:px-4 sm:text-sm";

export type HeroStats = {
  tripDays: number;
  dayCount: number;
  places: number;
  countries: number;
  totalMedia: number;
  firstDate?: string;
  lastDate?: string;
  totalSpend?: number;
  spendPerDay?: number;
  /** Spend split, for the breakdown bar. */
  byCategory?: { category: CostCategory; amount: number }[];
  /** Nights and spend per country. */
  byCountry?: {
    country: string;
    countryCode?: string;
    nights: number;
    amount: number;
  }[];
  /**
   * Spend `totalSpend` and `spendPerDay` had to leave out, for want of a
   * rate — same list the costs page's own totals carry. B353: a total built
   * from converted costs while this is non-empty is not the whole trip, and
   * must not render as a plain, confident figure.
   */
  unconverted?: Unconverted[];
};

export default function TripHero({
  stats,
  route,
  current,
  over,
  coverSrc,
  onStart,
  onLatest,
  onResume,
  resumeLabel,
  newDayCount = 0,
  onShowNew,
  basemap = null,
  locals,
  photobook,
  travellerNames,
  track = [],
}: {
  stats: HeroStats;
  /** Clipped to this trip's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
  /** One town-scale basemap per stop area — see `TripMap`. */
  locals?: Record<string, Basemap>;
  /**
   * Every day the reader may see, in order — the map's stops come from these
   * (`lib/tripMap.ts`), which is why they arrive as summaries rather than as
   * bare coordinates: a marker without a name is a dot nobody can read.
   */
  route: DaySummary[];
  /** Where the trip has got to — the pin on the map and the "currently in" /
   * "ended in" line. A summary, not a full day: the hero never shows the day's
   * prose. For a finished trip this is its last day, not "today". */
  current: DaySummary;
  /** Whether the trip is done — see `isOver` in lib/tripTime.ts. Turns off the
   * pulsing dot, which is a claim about right now that stops being true the
   * moment the trip ends. */
  over: boolean;
  coverSrc?: string;
  onStart: () => void;
  /** Jump to the day the story lands on — today, or the last day of a trip
   * that is over. `over` above is what decides which of the two it says. */
  onLatest: () => void;
  onResume?: () => void;
  resumeLabel?: string;
  /** Days published since this reader was last here. 0 for a first visit. */
  newDayCount?: number;
  onShowNew?: () => void;
  /**
   * Present only for the journal's owner, on a journal with photobook and
   * credits switched on — B569. The server decides
   * (`app/[user]/trips/[trip]/page.tsx`, via `paid/photobook/lib/photobook/entry.ts`); this
   * component only renders what it was handed.
   */
  photobook?: PhotobookEntry;
  /** Who took this trip — `travellerNamesOf` in lib/site.ts, joined with
   * "+". B10: the walking figures beside the cover photo (`Travelers`
   * below) carry no names at all, so this is the one place on the story
   * that says whose trip it was in words rather than only in the page's
   * JSON-LD. Absent for a trip nobody is credited on. */
  travellerNames?: string;
  /** The recorded route for the one day this permalink names — B2199. See
   * `TripMap`'s own doc for what it draws and why the frame ignores it. */
  track?: [number, number][][];
}) {
  const { t, tn, formatShortDate, localizedTrip } = useI18n();
  const { money } = useMoney();
  const site = useSite();
  const flag = flagFor(current.country, current.countryCode);
  // A day with nothing written down — no coordinates, no name (B381) — has no
  // place to claim. Saying "we're in" nothing would be inventing a fiction the
  // day itself does not carry, so the badge is simply not drawn rather than
  // drawn empty.
  const hasLocation = current.location !== "";
  // Nothing plottable anywhere on the trip — no day has a coordinate — is the
  // "nothing recorded" case B1260 is about, and the map has nothing to draw
  // but the whole world. A real trip that spent its one day somewhere has a
  // point; a fresh journal with no coordinates yet does not.
  const hasRoute = route.some(isPlottable) || isPlottable(current);
  // Same shape of question for the two location-derived tiles: `places` is 0
  // only when no day carries a coordinate at all, never as a real count that
  // happens to be zero (a trip cannot visit zero of its own stops).
  const hasPlaces = stats.places > 0;

  // **The masthead is always the trip**, on the bare journal URL as much as on
  // a trip's own address.
  //
  // It used to be the journal's own title and tagline whenever the trip on
  // screen was the current one, on the reasoning that the bare URL is the
  // journal's front door. Two things were wrong with that. `PageHeader`
  // already renders the journal's title directly above this, so the hero was
  // repeating it and spending its largest line saying nothing new — while the
  // one fact a reader wants there, *which journey is this*, was missing
  // entirely. And "current" only means the most recent trip, not one that is
  // still happening: a finished journey sat under the journal's name beside a
  // card reading "the trip is over", which reads as a mistake because it is
  // one.
  //
  // The date line underneath has always belonged to the trip, so this is the
  // heading agreeing with what was already beneath it. (The hero only renders
  // inside a trip's story, so there is always a trip to name.)
  const active = useTrip()!;
  const localized = localizedTrip(active.trip);
  const heading = localized.title;
  // **No fallback to the journal's tagline** — B842. It used to borrow it so
  // the masthead never had a gap, which was a layout reason losing to a
  // correctness one: the heading above this line is the *trip's* title, so
  // whatever sits here reads as the trip's subtitle. A journal tagline
  // describing its authors was being presented as a description of one
  // journey. `PageHeader` renders that tagline under the journal's own name
  // directly above, where it belongs — so the borrowed line was also the same
  // words twice on one screen, which is how it was noticed.
  const subheading = localized.tagline;
  // "Right now we're in" is a claim about the world, and `status` alone is not
  // enough to make it: a trip still marked `current` a fortnight after its end
  // date is exactly the case that goes on claiming a location. `isOver` decides
  // — see lib/tripTime.ts.
  const live = !over;

  const slices = (stats.byCategory ?? []).map((c) => ({
    key: c.category,
    label: t(`cost.cat.${c.category}` as TranslationKey),
    value: c.amount,
    color: CATEGORY_STYLE[c.category].color,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Masthead */}
      <section className="overflow-hidden rounded-2xl border border-line-quiet bg-surface-subtle shadow-sm">
        <div
          className={
            // `minmax(0, …)`: a column that may shrink below its content's
            // widest line, so the row of reading buttons wraps its labels
            // inside the card instead of widening the card past the screen.
            coverSrc
              ? "grid grid-cols-[minmax(0,1fr)] gap-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
              : "grid grid-cols-[minmax(0,1fr)] gap-0"
          }
        >
          <div className="p-6 sm:p-8">
            {/* B1585 — the trip is the gate, and it was the one level with no
                label anywhere. On the heading's own line, at its right edge:
                on a row of its own it read as a stray button between the
                title and the dates. `shrink-0` inside `TripVisibility` keeps
                it whole while a long title wraps beside it. The badge is a
                link into the studio's "Who may read this trip" flow (D4,
                B1938), so nothing opens in place to push the masthead around.
                Owner only, and absent for everybody else —
                `TripVisibility` returns null. */}
            <div className="flex items-start justify-between gap-3">
              <h1 className="min-w-0 font-display text-3xl font-semibold leading-tight tracking-tight text-ink-strong sm:text-4xl">
                {heading}
              </h1>
              <span className="pt-2 sm:pt-3">
                <TripVisibility />
              </span>
            </div>
            {subheading && (
              <p className="mt-1.5 max-w-md text-sm text-ink-secondary">
                {subheading}
              </p>
            )}
            {/* The dates, and — once it is — that the trip is over. A status,
                so it is words on the date line rather than a boxed card that
                looked like one more thing to press. */}
            {(stats.firstDate && stats.lastDate) || over ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-secondary">
                {stats.firstDate && stats.lastDate && (
                  <span>
                    {formatShortDate(stats.firstDate)}
                    {stats.firstDate !== stats.lastDate &&
                      ` – ${formatShortDate(stats.lastDate)}`}
                  </span>
                )}
                {stats.firstDate && stats.lastDate && over && <span aria-hidden>·</span>}
                {over && <span className="font-semibold text-ink-strong">{t("hero.over")}</span>}
                {/* Renders nothing unless this browser keeps the trip offline — B2159. */}
                <KeptMark user={active.trip.username} trip={active.trip.id} />
              </p>
            ) : (
              <KeptMark user={active.trip.username} trip={active.trip.id} />
            )}
            {travellerNames && (
              <p className="mt-0.5 text-xs text-ink-secondary">
                {t("hero.travellers", { names: travellerNames })}
              </p>
            )}

            {newDayCount > 0 && onShowNew && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15 }}
                className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-green-500/40 bg-green-100 px-3 py-2"
              >
                <Sparkles
                  className="h-4 w-4 shrink-0 text-green-700"
                  aria-hidden
                />
                <span className="text-xs text-ink-strong">
                  <strong className="font-semibold">{newDayCount}</strong>{" "}
                  {newDayCount === 1
                    ? t("hero.newSinceOne")
                    : t("hero.newSince")}
                </span>
                <button
                  onClick={onShowNew}
                  className="inline-flex min-h-11 items-center rounded-full bg-green-700 px-3.5 text-sm font-semibold text-on-deep transition-colors hover:bg-action-strong-hover"
                >
                  {t("hero.showNew")}
                </button>
              </motion.div>
            )}

            {live ? (
              hasLocation && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-line-quiet bg-surface-raised px-3 py-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
                  </span>
                  <span className="text-xs text-ink-secondary">
                    {t("hero.currentlyIn")}{" "}
                    <strong className="font-semibold text-ink-strong">
                      {flag} {current.location}
                    </strong>
                  </span>
                </div>
              )
            ) : (
              // No dot, nothing pinging — the whole point is that this is
              // not happening right now. That it is over is on the date line
              // above; this says where it ended, if the last day said where
              // that was.
              hasLocation && (
                <p className="mt-3 text-xs text-ink-secondary">
                  {t("hero.endedIn")}{" "}
                  <strong className="font-semibold text-ink-strong">
                    {flag} {current.location}
                  </strong>{" "}
                  · {formatShortDate(current.date)}
                </p>
              )
            )}

            {/* One filled button decides where to start; everything else
                that also enters the reading is a smaller, equal button in
                one row under it. Four capsules of near-equal weight gave a
                reader no way in, and three of them went to the same place —
                B989. */}
            <div className="mt-6 flex flex-col items-stretch gap-3 sm:items-start">
              {onResume && resumeLabel ? (
                <button
                  onClick={onResume}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-action-strong px-5 text-base font-semibold text-on-action transition-colors hover:bg-action-strong-hover sm:w-auto"
                >
                  <PlayCircle className="h-4 w-4" />
                  {resumeLabel}
                </button>
              ) : (
                // Nobody has read anything yet, so the jump to the newest day
                // is the way in and takes the weight instead. There is always
                // exactly one filled button.
                <LatestDayButton
                  tripOver={over}
                  onClick={onLatest}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 sm:w-auto"
                />
              )}

              {/* The other ways into the reading, as one row of equal
                  buttons. They used to be three underlined links and one
                  capsule — four looks for the same kind of thing. */}
              <div className="flex w-full items-stretch gap-2 sm:w-auto">
                <button onClick={onStart} className={SECONDARY}>
                  <ArrowDown className="h-4 w-4 shrink-0" aria-hidden />
                  {t("hero.startReading")}
                </button>
                {onResume && resumeLabel && (
                  <LatestDayButton
                    tripOver={over}
                    onClick={onLatest}
                    className={SECONDARY}
                    iconClassName="h-4 w-4 shrink-0"
                  />
                )}
                {/* Same button, same condition (`hasPlaces`), as the map
                    page's own Clapperboard — B2306. A plain link to the map
                    page rather than a button that opens the show in place:
                    the story page must not carry what the show needs
                    (`places`, the whole trip's galleries and headlines) just
                    because this link sits on it. `?show=1` is read by
                    `MapPageContent`, which already has `places` in hand. */}
                {hasPlaces && (
                  <Link href={active.href("/map?show=1")} className={SECONDARY}>
                    <Clapperboard className="h-4 w-4 shrink-0" aria-hidden />
                    {t("show.start")}
                  </Link>
                )}
                {/* Renders nothing unless this browser can actually do it,
                    and only the bell here: the sentences for the dead ends
                    are on the reader's own page. */}
                <PushOptIn compact />
              </div>
            </div>

            {/* The journey is finished — this is where somebody looking at
                that fact is offered the book of it. B569. The owner's own
                tool, so below a rule rather than among the ways to read. */}
            {photobook && stats.totalMedia > 0 && (
              <div className="mt-5 border-t border-line-quiet pt-1">
                <a
                  href={`/${photobook.username}/trips/${photobook.trip}/photobook`}
                  className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold text-ink-strong transition-colors hover:text-ink-body"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" aria-hidden />
                    {t("photobook.start")}
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden />
                </a>
              </div>
            )}
            {/* Renders nothing unless it's iOS, push is on, and this browser
                hasn't seen it before — see PushInstallOnboarding. */}
            <PushInstallOnboarding />
          </div>

          {/* No photograph yet is not a scene with nothing in it — B1260. A
              flat sky under a walking figure read as a broken image on a
              journal that has published nothing but words so far, so the
              whole panel is absent instead until a cover exists. Judgement
              call, flagged for a person's eye rather than settled — see
              B1260's Work section. */}
          {coverSrc && (
            <div className="relative min-h-[200px] border-t border-line-quiet md:border-l md:border-t-0">
              <Image
                src={coverSrc}
                loader={mediaLoader}
                alt={current.location}
                fill
                sizes="(max-width: 768px) 100vw, 40vw"
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-overlay-strong/40 to-transparent" />
              <div className="pointer-events-none absolute bottom-2 right-3">
                {/* Who was actually on this trip — its own `travellers:` block,
                    or the journal's default, or one neutral figure. Never the
                    two that used to be compiled in. */}
                <Travelers
                  figures={partyFor(
                    active.trip.travellers,
                    site.travellerFigures,
                  )}
                  size={54}
                  available={220}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Where we are — absent, not a map of the whole world with no marker
          on it, until some day has a coordinate. B1260. */}
      {hasRoute && (
        <TripMap days={route} basemap={basemap} locals={locals} track={track} />
      )}

      {/* Numbers. A <dl> because Stat renders dt/dd — as a plain <section>
          those were orphaned, and each label/value pair was announced as two
          unrelated fragments. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label={tn("map.days", stats.tripDays)}
          value={String(stats.tripDays)}
          big
        />
        {/* Zero here means no day has ever carried a coordinate, not that
            the trip visited zero countries — a trip cannot visit zero of
            its own stops. That absence is not a measurement, so the tile
            disappears with it rather than reporting it. B1260. */}
        {hasPlaces && (
          <Stat
            label={tn("map.countries", stats.countries)}
            value={String(stats.countries)}
            big
          />
        )}
        {hasPlaces && (
          <Stat
            label={tn("map.stops", stats.places)}
            value={String(stats.places)}
            big
          />
        )}
        <Stat label={t("map.media")} value={String(stats.totalMedia)} big />
        {/* A dash, never a confident number, when some spend had no rate to
            convert with — CHF 0 for a trip that spent EUR 80 is a wrong
            figure, not an honest absence of one. See UnconvertedNotice
            below, and B353. */}
        {stats.totalSpend !== undefined && (
          <Stat
            label={t("cost.total")}
            value={
              (stats.unconverted?.length ?? 0) > 0
                ? "—"
                : money(stats.totalSpend)
            }
          />
        )}
        {stats.spendPerDay !== undefined && (
          <Stat
            label={t("cost.perDay")}
            value={
              (stats.unconverted?.length ?? 0) > 0
                ? "—"
                : money(stats.spendPerDay)
            }
          />
        )}
      </dl>
      {stats.unconverted && <UnconvertedNotice items={stats.unconverted} />}

      {/* Where the money goes */}
      {slices.length > 0 && (
        <section className="rounded-2xl border border-line-quiet bg-surface-raised p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 font-display text-base font-semibold text-ink-strong">
            {t("cost.byCategory")}
          </h2>
          <StackedShareBar
            slices={slices}
            format={(n) => money(n)}
            height={22}
          />
        </section>
      )}

      {/* Time per country — days, not money: spend per country already has
          its own card on the costs page. B2308. */}
      {stats.byCountry && stats.byCountry.length > 0 && (
        <section className="rounded-2xl border border-line-quiet bg-surface-raised p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 font-display text-base font-semibold text-ink-strong">
            {t("hero.timePerCountry")}
          </h2>
          {stats.byCountry.length === 1 ? (
            // One country drawn as a bar at 100% of one says nothing — a
            // single line instead of an empty-looking track.
            <p className="text-sm font-medium text-ink-strong">
              {`${flagFor(stats.byCountry[0].country, stats.byCountry[0].countryCode)} ${stats.byCountry[0].country} · ${stats.byCountry[0].nights} ${
                stats.byCountry[0].nights === 1 ? t("stay.day") : t("stay.days")
              }`}
            </p>
          ) : (
            <BarList
              rows={[...stats.byCountry]
                .sort((a, b) => b.nights - a.nights)
                .map((c) => ({
                  key: c.country,
                  label: `${flagFor(c.country, c.countryCode)} ${c.country}`,
                  value: c.nights,
                }))}
              format={(n) => `${n} ${n === 1 ? t("stay.day") : t("stay.days")}`}
              accent={CATEGORY_STYLE.accommodation.color}
            />
          )}
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line-quiet bg-surface-raised px-4 py-3">
      <dt className="text-[11px] leading-tight text-ink-secondary">{label}</dt>{" "}
      <dd
        className={`font-display font-semibold text-ink-strong ${big ? "text-2xl" : "text-lg"}`}
      >
        {value}
      </dd>
    </div>
  );
}
