"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AdminJournals, type HomeJournal } from "@/components/HomeJournals";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { bandsFor, newestDay, phaseOf, type BandTrip } from "@/lib/homeBands";
import { readerTodayISO } from "@/lib/tripTime";

import { journalPath } from "@/lib/journalPath";
/**
 * The signed-in half of `/` — B2508, reordered by B-2975.
 *
 * The question somebody signed in brings is "who is on the road?" — their
 * friends first, and themselves if they are travelling. So trips running now
 * lead (`lib/homeBands.ts` decides which, on the device, from the dates), the
 * reader's own trip is a strip with its next step, and everything finished is
 * a folded line with a count.
 *
 * Everything here is read from `/api/v2/me/home` at this address's own level
 * (`detailFor` in lib/viewer.ts). A fact the payload does not carry — a
 * position, "new since your last visit", when a day was published — is not
 * drawn at all, rather than drawn with a stand-in.
 */

type Owned = BandTrip;

/** An ended trip with days in it — the one a book could be made of. A
 * `test: true` trip is a rehearsal nobody lived, never a book. */
function pickForPaper(items: Owned[]): Owned | undefined {
  return items
    .filter((i) => i.trip.status === "past" && (i.trip.days ?? 0) > 0 && !i.trip.test)
    .sort((a, b) => (b.trip.end ?? "").localeCompare(a.trip.end ?? ""))[0];
}

const DISMISS_KEY = "fs-home-start-dismissed";

const BUTTON =
  "inline-flex min-h-12 items-center justify-center rounded-full border-2 border-navy-900 bg-yellow-400 px-6 " +
  "text-base font-bold text-navy-900 shadow-[0_3px_0_var(--color-navy-900)] transition-colors hover:bg-yellow-300 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
const GHOST =
  "inline-flex min-h-12 items-center justify-center rounded-full border-2 border-line-ink px-5 " +
  "text-base font-bold text-ink-strong hover:bg-surface-subtle " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
const LINK =
  "font-bold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-4 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
const CARD = "rounded-3xl border border-surface-muted bg-surface-raised";

function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-xs uppercase tracking-[0.08em] text-ink-secondary ${className}`}>{children}</p>
  );
}

function Cover({ src, sizes, className }: { src?: string; sizes: string; className: string }) {
  if (!src) return <span aria-hidden className={`block bg-surface-muted ${className}`} />;
  return (
    <span className={`relative block overflow-hidden bg-surface-muted ${className}`}>
      <Image src={src} loader={mediaLoader} alt="" fill sizes={sizes} className="object-cover" />
    </span>
  );
}

function useDates() {
  const { locale, formatLongDate } = useI18n();
  const range = (start?: string, end?: string) => {
    if (!start || !end) return undefined;
    const format = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return format.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
  };
  return { range, day: (date: string) => formatLongDate(date, { year: true }) };
}

/** An owner whose journal has no trip yet: the one next step, not an empty grid. */
function FirstTrip({ journal }: { journal: HomeJournal }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="home-first" className={`${CARD} flex flex-col gap-3 p-6 md:p-8`}>
      <Kicker>{t("home.continue")}</Kicker>
      <h1 id="home-first" className="font-display text-3xl font-semibold break-words text-ink-strong">
        {journal.title}
      </h1>
      <p className="text-base text-ink-body">{t("home.firstTrip")}</p>
      <Link href={`${journalPath(journal.username)}/studio/trip/new`} className={`self-start ${BUTTON}`}>
        {t("home.newTrip")}
      </Link>
    </section>
  );
}

function ReadyForPaper({ item }: { item: Owned }) {
  const { t } = useI18n();
  const { journal, trip } = item;
  return (
    <section
      aria-labelledby="home-paper"
      className="grid items-center gap-5 rounded-3xl border border-line-quiet bg-navy-900 p-6 text-on-deep md:grid-cols-12 md:px-8"
    >
      <span aria-hidden className="hidden h-32 overflow-hidden rounded-r-lg rounded-l-sm bg-cream-50 md:col-span-2 md:block">
        <Cover src={trip.cover} sizes="160px" className="h-24 w-full" />
      </span>
      <div className="flex flex-col gap-1.5 md:col-span-7">
        <Kicker className="text-on-deep">{t("home.paper.kicker")}</Kicker>
        <h2 id="home-paper" className="font-display text-2xl font-semibold break-words text-on-deep">
          {t("home.paper.title", { trip: trip.title })}
        </h2>
        <p className="text-sm text-on-deep/85">{t("home.paper.body")}</p>
      </div>
      <div className="md:col-span-3 md:flex md:justify-end">
        <Link
          href={`${journalPath(journal.username)}/trips/${encodeURIComponent(trip.id)}/photobook`}
          className={`w-full md:w-auto ${BUTTON} border-yellow-400 shadow-none`}
        >
          {t("home.paper.action")}
        </Link>
      </div>
    </section>
  );
}

function StartYourOwn() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <aside
      aria-labelledby="home-start"
      className="flex flex-col gap-4 rounded-3xl bg-surface-subtle p-6 md:flex-row md:items-center md:justify-between md:px-7"
    >
      <div className="flex flex-col gap-1">
        <h2 id="home-start" className="font-display text-2xl font-semibold text-ink-strong">
          {t("home.start.title")}
        </h2>
        <p className="text-base text-ink-body">{t("home.start.body")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link href="/welcome" className={BUTTON}>
          {t("home.start.action")}
        </Link>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // Private mode or blocked storage: it goes for this visit only.
            }
            setDismissed(true);
          }}
          className="min-h-12 rounded-full px-5 font-bold text-ink-strong hover:bg-surface-muted
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {t("home.start.dismiss")}
        </button>
      </div>
    </aside>
  );
}

/** A reader's newest shared day, large — the thing they came back for. */
function LatestDay({ item }: { item: BandTrip }) {
  const { t } = useI18n();
  const latest = item.trip.latest!;
  return (
    <article className={`${CARD} grid overflow-hidden md:grid-cols-12`}>
      <Cover
        src={latest.image ?? item.trip.cover}
        sizes="(min-width: 768px) 58vw, 100vw"
        className="h-56 md:col-span-7 md:h-full md:min-h-96"
      />
      <div className="flex min-w-0 flex-col gap-3 p-5 md:col-span-5 md:p-8">
        <Kicker>
          {item.journal.title} · {item.trip.title}
        </Kicker>
        <h2 className="font-display text-[clamp(1.6rem,4vw,2.25rem)] font-semibold leading-tight break-words text-ink-strong">
          {latest.title}
        </h2>
        {latest.excerpt && <p className="break-words text-ink-strong">{latest.excerpt}</p>}
        <div className="mt-auto flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
          <Link href={latest.href} className={BUTTON}>
            {t("home.readDay")}
          </Link>
          <Link href={item.trip.href} className={`self-center text-sm ${LINK}`}>
            {t("home.allDays")}
          </Link>
        </div>
      </div>
    </article>
  );
}


/** What a card or row says about a journal's owner — the name when the config
 * has one, else the journal's own title. */
function whose(journal: HomeJournal): string {
  return journal.owner ?? journal.title;
}

/** The reader's own trip: running, or holding a draft. A strip rather than a
 * hero — they know where they are; what they need is the next step. */
function MineStrip({ item, isRunning }: { item: BandTrip; isRunning: boolean }) {
  const { t } = useI18n();
  const { journal, trip } = item;
  const studio = `${journalPath(journal.username)}/studio`;
  const writes = journal.role === "owner" || trip.through === "owner";
  // "Travelling" is said only of a trip whose dates include today; a draft on
  // a trip that has ended, or not begun, is named as the draft it is.
  const kicker = !isRunning
    ? t("home.draftLabel")
    : trip.through === "traveller" && !writes
      ? t("home.road.onTrip")
      : t("home.road.mine");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border-2 border-yellow-400 bg-surface-raised px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-48 flex-col">
        <Kicker>{kicker}</Kicker>
        <Link href={trip.href} title={trip.title} className="truncate font-display text-lg font-semibold text-ink-strong">
          {trip.title}
        </Link>
        {trip.draft && <span className="truncate text-sm text-ink-body">{trip.draft.title}</span>}
      </div>
      {writes ? (
        trip.draft ? (
          <Link href={`${studio}/day/edit?slug=${encodeURIComponent(trip.draft.slug)}`} className={BUTTON}>
            {t("home.finishDay")}
          </Link>
        ) : (
          <Link href={`${studio}/day/new?trip=${encodeURIComponent(trip.id)}`} className={BUTTON}>
            {t("home.addDay")}
          </Link>
        )
      ) : (
        <Link href={trip.latest?.href ?? trip.href} className={GHOST}>
          {t("home.read")}
        </Link>
      )}
    </div>
  );
}

/** A friend's running trip with a day to read — large, because it is what the
 * reader came for. */
function RunningCard({ item }: { item: BandTrip }) {
  const { t, tn } = useI18n();
  const { day } = useDates();
  const { journal, trip } = item;
  const latest = trip.latest!;
  const place = [latest.location, latest.country].filter(Boolean).join(", ");
  return (
    <article className={`${CARD} grid overflow-hidden md:grid-cols-12`}>
      <span className="relative block md:col-span-5">
        <Cover src={latest.image ?? trip.cover} sizes="(min-width: 768px) 30vw, 100vw" className="h-48 md:h-full md:min-h-60" />
        <span className="absolute bottom-3 left-3 rounded-full bg-navy-900 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-on-deep">
          {t("home.road.latestDay", { date: day(latest.date) })}
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-2 p-5 md:col-span-7 md:p-6">
        <Kicker>
          {whose(journal)} · {trip.title}
        </Kicker>
        <h2 className="font-display text-2xl font-semibold leading-tight break-words text-ink-strong">{latest.title}</h2>
        {place && <p className="text-sm text-ink-body">{t("home.road.latestFrom", { place })}</p>}
        {latest.excerpt && <p className="break-words text-ink-strong">{latest.excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-2">
          <Link href={latest.href} className={BUTTON}>
            {t("home.readDay")}
          </Link>
          {trip.days ? (
            <Link href={trip.href} className={`text-sm ${LINK}`}>
              {tn("home.road.readable", trip.days, { count: String(trip.days) })}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** One line for a trip: running with nothing to feature, quiet, or upcoming. */
function TripRow({ item, note, tone }: { item: BandTrip; note: string; tone?: "quiet" }) {
  const { journal, trip } = item;
  return (
    <li className="min-w-0">
      <Link
        href={trip.href}
        className={`${CARD} flex min-h-16 items-center gap-3 p-2 pr-4
                    ${tone === "quiet" ? "border-dashed" : ""}
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
      >
        <Cover src={trip.cover} sizes="48px" className="size-12 shrink-0 rounded-xl" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span title={trip.title} className="truncate font-display text-base font-semibold text-ink-strong">
            {trip.title}
          </span>
          <span className="truncate text-sm text-ink-body">
            {whose(journal)} · {note}
          </span>
        </span>
        <span aria-hidden className="text-ink-secondary">
          ›
        </span>
      </Link>
    </li>
  );
}

/** Past trips, one folded line per journal. */
function EarlierFolds({ rows }: { rows: ReturnType<typeof bandsFor>["earlier"] }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="home-earlier" className="flex flex-col gap-2">
      <h2 id="home-earlier">
        <Kicker>{t("home.road.earlier")}</Kicker>
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map(({ journal, count, own }) => (
          <li key={journal.username}>
            <Link
              href={`${journalPath(journal.username)}/trips`}
              className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-surface-muted bg-surface-raised px-4
                         font-semibold text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <span className="truncate">{own ? t("home.yourTrips") : whose(journal)}</span>
              <span className="shrink-0 font-normal text-ink-secondary">{count} ›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SignedInHome({
  journals,
  photobookEnabled = false,
  signupEnabled = false,
  today,
  savedAt = null,
}: {
  journals: HomeJournal[];
  photobookEnabled?: boolean;
  signupEnabled?: boolean;
  /** The reader's own date. Defaults to this device's; a test passes one. */
  today?: string;
  /** When this answer was saved, if it came from the offline copy. */
  savedAt?: number | null;
}) {
  const { t, locale } = useI18n();
  const { day } = useDates();
  const owned = journals.filter((j) => j.role === "owner");
  const admin = journals.filter((j) => j.role === "admin");
  const todayISO = today ?? readerTodayISO();
  const bands = bandsFor(journals, todayISO);
  const runningMine = bands.mine.filter((i) => phaseOf(i.trip, todayISO) === "running");
  const onTheRoad = runningMine.length + bands.running.length > 0;
  const nothingAnywhere = journals.every((j) => j.role === "admin" || j.trips.length === 0);
  const items = owned.flatMap((journal) => journal.trips.map((trip) => ({ journal, trip })));
  const paper = photobookEnabled ? pickForPaper(items) : undefined;
  // An owner whose own journals hold no trip yet gets the one next step.
  const firstEmpty = owned.every((journal) => journal.trips.length === 0) ? owned[0] : undefined;
  const cards = bands.running.filter((i) => i.trip.latest).slice(0, 2);
  const rows = bands.running.filter((i) => !cards.includes(i));
  const featured = onTheRoad ? undefined : newestDay(journals);
  const next = bands.upcoming[0];

  return (
    <div className="mt-8 flex flex-col gap-10 md:mt-10 md:gap-12">
      {savedAt !== null && (
        <p className="text-center font-mono text-xs tracking-[0.04em] text-ink-secondary">
          {t("home.road.savedCopy", {
            when: new Intl.DateTimeFormat(locale, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(savedAt)),
          })}
        </p>
      )}
      {firstEmpty && <FirstTrip journal={firstEmpty} />}

      {!nothingAnywhere && (
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          <div className="flex min-w-0 flex-col gap-4 md:col-span-7">
            {onTheRoad && (
              <h1 className="flex items-baseline justify-between gap-3">
                <Kicker className="font-semibold text-green-700">
                  {t("home.road.title")} · {runningMine.length + bands.running.length}
                </Kicker>
                <Kicker>{t("home.road.byDates")}</Kicker>
              </h1>
            )}
            {bands.mine.map((item) => (
              <MineStrip
                key={`${item.journal.username}/${item.trip.id}`}
                item={item}
                isRunning={phaseOf(item.trip, todayISO) === "running"}
              />
            ))}
            {onTheRoad ? (
              <>
                {cards.map((item) => (
                  <RunningCard key={`${item.journal.username}/${item.trip.id}`} item={item} />
                ))}
                {rows.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {rows.map((item) => (
                      <TripRow
                        key={`${item.journal.username}/${item.trip.id}`}
                        item={item}
                        note={
                          item.trip.latest
                            ? t("home.latestDay", { date: day(item.trip.latest.date) })
                            : t("home.road.nothingReadable")
                        }
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <h1 className="font-display text-[clamp(1.6rem,4vw,2.25rem)] font-semibold leading-tight text-ink-strong">
                  {t("home.road.nobody")}
                </h1>
                {next && (
                  <p className="text-base text-ink-body">
                    {t("home.road.next", { trip: next.trip.title, date: day(next.trip.start ?? "") })}
                  </p>
                )}
                {featured?.trip.latest && (
                  <>
                    <Kicker>{t("home.road.newest")}</Kicker>
                    <LatestDay item={featured} />
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-8 md:col-span-5">
            {bands.quiet.length > 0 && (
              <section aria-labelledby="home-quiet" className="flex flex-col gap-2">
                <h2 id="home-quiet">
                  <Kicker>{t("home.road.quiet")}</Kicker>
                </h2>
                <ul className="flex flex-col gap-2">
                  {bands.quiet.map((item) => (
                    <TripRow
                      key={`${item.journal.username}/${item.trip.id}`}
                      item={item}
                      tone="quiet"
                      note={
                        item.trip.latest
                          ? t("home.latestDay", { date: day(item.trip.latest.date) })
                          : t("home.road.nothingReadable")
                      }
                    />
                  ))}
                </ul>
              </section>
            )}
            {bands.upcoming.length > 0 && (
              <section aria-labelledby="home-upcoming" className="flex flex-col gap-2">
                <h2 id="home-upcoming">
                  <Kicker>{t("home.road.comingUp")}</Kicker>
                </h2>
                <ul className="flex flex-col gap-2">
                  {bands.upcoming.map((item) => (
                    <TripRow
                      key={`${item.journal.username}/${item.trip.id}`}
                      item={item}
                      note={t("home.road.starts", { date: day(item.trip.start ?? "") })}
                    />
                  ))}
                </ul>
              </section>
            )}
            <EarlierFolds rows={bands.earlier} />
            {owned.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {owned.map((journal) => (
                  <span key={journal.username} className="contents">
                    {!firstEmpty && (
                      <Link href={`${journalPath(journal.username)}/studio/trip/new`} className={GHOST}>
                        {owned.length > 1 ? `${t("home.newTrip")} · ${journal.title}` : t("home.newTrip")}
                      </Link>
                    )}
                    <Link href={`${journalPath(journal.username)}/studio`} className={GHOST}>
                      {owned.length > 1 ? `${t("home.openStudio")} · ${journal.title}` : t("home.openStudio")}
                    </Link>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {paper && <ReadyForPaper item={paper} />}
      {nothingAnywhere && admin.length === 0 && owned.length === 0 && (
        <p className="text-base leading-6 text-ink-body">{t("home.none")}</p>
      )}
      <AdminJournals journals={admin} />
      {/* Never to an owner, and only where this instance lets anybody start one. */}
      {signupEnabled && owned.length === 0 && <StartYourOwn />}
    </div>
  );
}

/** The shape of the home while its answer is on the way. */
export function HomeSkeleton() {
  return (
    <div aria-hidden className="mt-8 flex animate-pulse flex-col gap-4 md:mt-10 motion-reduce:animate-none">
      <span className="block h-4 w-32 rounded-full bg-surface-muted" />
      <span className="block h-16 rounded-3xl bg-surface-muted" />
      <span className="block h-60 rounded-3xl bg-surface-muted" />
      <span className="block h-16 rounded-3xl bg-surface-muted" />
    </div>
  );
}
