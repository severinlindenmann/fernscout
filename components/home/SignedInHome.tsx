"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AdminJournals, type HomeJournal, type HomeTrip } from "@/components/HomeJournals";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";

/**
 * The signed-in half of `/` — B2508.
 *
 * It was a directory: every journal as a card, then the public list. The
 * question somebody signed in brings is narrower. An owner wants back into the
 * trip they are writing; a reader wants the newest day somebody shared with
 * them. So an owner gets one Continue card and their trips, and a reader gets
 * the latest shared day first.
 *
 * Everything here is read from `/api/v2/me/home` at this address's own level
 * (`detailFor` in lib/viewer.ts). A fact the payload does not carry — a
 * readers count, a plan allowance, "new since your last visit" — is not drawn
 * at all, rather than drawn with a stand-in: the boards' `[bracket]` values
 * mean "read live, or hide".
 */

type Owned = { journal: HomeJournal; trip: HomeTrip };

/** Where the day was last touched — a draft counts, it is the work in hand. */
function freshness(trip: HomeTrip): string {
  return [trip.draft?.date, trip.latest?.date, trip.start ?? ""].filter(Boolean).sort().at(-1) ?? "";
}

/**
 * The trip the Continue card opens: the one under way, else the one with the
 * most recent writing. Exported for the test, which pins the order.
 */
export function pickContinue(items: Owned[]): Owned | undefined {
  return [...items].sort(
    (a, b) =>
      Number(b.trip.status === "current") - Number(a.trip.status === "current") ||
      freshness(b.trip).localeCompare(freshness(a.trip)),
  )[0];
}

/** An ended trip with days in it — the one a book could be made of. A
 * `test: true` trip is a rehearsal nobody lived, never a book. */
export function pickForPaper(items: Owned[]): Owned | undefined {
  return items
    .filter((i) => i.trip.status === "past" && (i.trip.days ?? 0) > 0 && !i.trip.test)
    .sort((a, b) => (b.trip.end ?? "").localeCompare(a.trip.end ?? ""))[0];
}

/** Seven and the New trip card fill two rows of four; "All trips" has the rest. */
const TRIPS_SHOWN = 7;

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
    <p className={`font-mono text-xs uppercase tracking-[0.08em] text-ink-muted ${className}`}>{children}</p>
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

function ContinueCard({ item }: { item: Owned }) {
  const { t, tn } = useI18n();
  const { range } = useDates();
  const { journal, trip } = item;
  const studio = `/${journal.username}/studio`;
  const when = range(trip.start, trip.end);
  return (
    <section aria-labelledby="home-continue" className="flex flex-col gap-3">
      <Kicker>{t("home.continue")}</Kicker>
      <div className={`${CARD} grid overflow-hidden md:grid-cols-12`}>
        <Cover src={trip.cover} sizes="(min-width: 768px) 55vw, 100vw" className="h-48 md:col-span-7 md:h-full md:min-h-80" />
        <div className="flex min-w-0 flex-col gap-3 p-5 md:col-span-5 md:p-8">
          <h1
            id="home-continue"
            className="font-display text-[clamp(1.6rem,4vw,2.25rem)] font-semibold leading-tight break-words text-ink-strong"
          >
            {trip.title}
          </h1>
          {(when || trip.days) && (
            <p className="text-sm text-ink-body">
              {[when, trip.days ? tn("home.days", trip.days, { count: String(trip.days) }) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {trip.draft && (
            <div className="flex flex-col gap-1 rounded-2xl bg-surface-subtle px-4 py-3">
              <Kicker className="text-yellow-900">{t("home.draftLabel")}</Kicker>
              <p className="font-semibold break-words text-ink-strong">{trip.draft.title}</p>
            </div>
          )}
          <div className="mt-auto flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
            {trip.draft ? (
              <Link
                href={`${studio}/day/edit?slug=${encodeURIComponent(trip.draft.slug)}`}
                className={BUTTON}
              >
                {t("home.finishDay")}
              </Link>
            ) : (
              <Link href={`${studio}/day/new?trip=${encodeURIComponent(trip.id)}`} className={BUTTON}>
                {t("home.addDay")}
              </Link>
            )}
            {trip.draft ? (
              <Link href={`${studio}/day/new?trip=${encodeURIComponent(trip.id)}`} className={GHOST}>
                {t("home.addDay")}
              </Link>
            ) : (
              <Link href={studio} className={GHOST}>
                {t("home.openStudio")}
              </Link>
            )}
          </div>
          <Link href={trip.href} className={`self-start text-sm ${LINK}`}>
            {t("home.openAsReader")}
          </Link>
        </div>
      </div>
    </section>
  );
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
      <Link href={`/${journal.username}/studio/trip/new`} className={`self-start ${BUTTON}`}>
        {t("home.newTrip")}
      </Link>
    </section>
  );
}

function TripCard({ trip }: { trip: HomeTrip }) {
  const { tn } = useI18n();
  const { range } = useDates();
  const meta = [
    range(trip.start, trip.end),
    trip.days ? tn("home.days", trip.days, { count: String(trip.days) }) : null,
  ].filter(Boolean);
  return (
    <li className="min-w-0">
      <Link
        href={trip.href}
        className={`${CARD} flex h-full items-center gap-4 overflow-hidden p-2.5 sm:flex-col sm:items-stretch sm:gap-0 sm:p-0
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
      >
        <Cover
          src={trip.cover}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 80px"
          className="size-20 shrink-0 rounded-xl sm:h-40 sm:w-full sm:rounded-none"
        />
        <span className="flex min-w-0 flex-col gap-0.5 sm:px-4 sm:py-3.5">
          <span title={trip.title} className="truncate font-display text-lg font-semibold text-ink-strong">
            {trip.title}
          </span>
          {meta.length > 0 && <span className="text-sm text-ink-body">{meta.join(" · ")}</span>}
        </span>
      </Link>
    </li>
  );
}

function YourTrips({ journal, named }: { journal: HomeJournal; named: boolean }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby={`home-trips-${journal.username}`} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={`home-trips-${journal.username}`}>
          <Kicker>{named ? journal.title : t("home.yourTrips")}</Kicker>
        </h2>
        <Link href={`/${journal.username}/trips`} className={`text-sm ${LINK}`}>
          {t("home.allTrips")}
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
        {[...journal.trips]
          .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""))
          .slice(0, TRIPS_SHOWN)
          .map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
        <li>
          <Link
            href={`/${journal.username}/studio/trip/new`}
            className="flex h-full min-h-12 items-center justify-center gap-3 rounded-full border-2 border-dashed border-line-strong px-5 py-3
                       font-bold text-ink-strong sm:min-h-56 sm:flex-col sm:rounded-3xl
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <span
              aria-hidden
              className="hidden size-12 place-items-center rounded-full border-2 border-navy-900 bg-yellow-400 text-2xl leading-none text-navy-900 sm:grid"
            >
              +
            </span>
            {t("home.newTrip")}
          </Link>
        </li>
      </ul>
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
        <Kicker className="text-yellow-400">{t("home.paper.kicker")}</Kicker>
        <h2 id="home-paper" className="font-display text-2xl font-semibold break-words text-on-deep">
          {t("home.paper.title", { trip: trip.title })}
        </h2>
        <p className="text-sm text-on-deep/85">{t("home.paper.body")}</p>
      </div>
      <div className="md:col-span-3 md:flex md:justify-end">
        <Link
          href={`/${journal.username}/trips/${encodeURIComponent(trip.id)}/photobook`}
          className={`w-full md:w-auto ${BUTTON} border-yellow-400 shadow-none`}
        >
          {t("home.paper.action")}
        </Link>
      </div>
    </section>
  );
}

type SharedTrip = { journal: HomeJournal; trip: HomeTrip };

function sharedTrips(journals: HomeJournal[]): SharedTrip[] {
  return journals
    .flatMap((journal) => journal.trips.map((trip) => ({ journal, trip })))
    .sort((a, b) => (b.trip.latest?.date ?? "").localeCompare(a.trip.latest?.date ?? ""));
}

/** The owner's rows — one per journal somebody let them into. */
function SharedRows({ journals }: { journals: HomeJournal[] }) {
  const { t } = useI18n();
  const { day } = useDates();
  if (journals.length === 0) return null;
  return (
    <section aria-labelledby="home-shared" className="flex flex-col gap-3">
      <h2 id="home-shared">
        <Kicker>{t("home.shared")}</Kicker>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2 md:gap-5">
        {journals.map((journal) => {
          const newest = sharedTrips([journal])[0]?.trip;
          return (
            <li key={journal.username} className="min-w-0">
              <Link
                href={newest?.href ?? journal.href}
                className={`${CARD} flex items-center justify-between gap-4 px-5 py-4
                            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-ink-strong">{journal.title}</span>
                  {newest?.latest && (
                    <span className="text-sm text-ink-body">
                      {t("home.latestDay", { date: day(newest.latest.date) })}
                    </span>
                  )}
                </span>
                <span className={`shrink-0 text-sm ${LINK}`}>{t("home.read")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
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
function LatestDay({ item }: { item: SharedTrip }) {
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

function SharedCard({ item }: { item: SharedTrip }) {
  const { t } = useI18n();
  const { day } = useDates();
  const { journal, trip } = item;
  return (
    <li className="min-w-0">
      <Link
        href={trip.href}
        className={`${CARD} flex items-center gap-4 p-3
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
      >
        <Cover src={trip.cover} sizes="96px" className="size-20 shrink-0 rounded-2xl md:size-24" />
        <span className="flex min-w-0 flex-col">
          <Kicker className="truncate">
            {journal.role === "traveller" ? `${journal.title} · ${t("home.role.traveller")}` : journal.title}
          </Kicker>
          <span title={trip.title} className="truncate font-display text-xl font-semibold text-ink-strong">
            {trip.title}
          </span>
          {trip.latest && (
            <span className="text-sm text-ink-body">{t("home.latestDay", { date: day(trip.latest.date) })}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

export default function SignedInHome({
  journals,
  photobookEnabled = false,
  signupEnabled = false,
}: {
  journals: HomeJournal[];
  photobookEnabled?: boolean;
  signupEnabled?: boolean;
}) {
  const { t } = useI18n();
  const owned = journals.filter((j) => j.role === "owner");
  const shared = journals.filter((j) => j.role === "traveller" || j.role === "guest");
  const admin = journals.filter((j) => j.role === "admin");

  if (owned.length > 0) {
    const items = owned.flatMap((journal) => journal.trips.map((trip) => ({ journal, trip })));
    const next = pickContinue(items);
    const paper = photobookEnabled ? pickForPaper(items) : undefined;
    return (
      <div className="mt-8 flex flex-col gap-10 md:mt-12 md:gap-12">
        {next ? <ContinueCard item={next} /> : <FirstTrip journal={owned[0]} />}
        {owned
          .filter((journal) => journal.trips.length > 0)
          .map((journal) => (
            <YourTrips key={journal.username} journal={journal} named={owned.length > 1} />
          ))}
        {paper && <ReadyForPaper item={paper} />}
        <SharedRows journals={shared} />
        <AdminJournals journals={admin} />
      </div>
    );
  }

  const trips = sharedTrips(shared);
  const [first, ...rest] = trips;
  const featured = first?.trip.latest ? first : undefined;
  const others = featured ? rest : trips;
  return (
    <div className="mt-8 flex flex-col gap-6 md:mt-10">
      <h1 className="font-display text-[clamp(2rem,6vw,3rem)] font-semibold leading-tight text-ink-strong">
        {t("home.shared")}
      </h1>
      {trips.length === 0 && admin.length === 0 && (
        <p className="text-base leading-6 text-ink-body">{t("home.none")}</p>
      )}
      {featured && <LatestDay item={featured} />}
      {others.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 md:gap-5">
          {others.map((item) => (
            <SharedCard key={`${item.journal.username}/${item.trip.id}`} item={item} />
          ))}
        </ul>
      )}
      <AdminJournals journals={admin} />
      {/* Never to an owner — this branch is only reached with no journal of
          their own — and only where this instance lets anybody start one. */}
      {signupEnabled && <StartYourOwn />}
    </div>
  );
}
