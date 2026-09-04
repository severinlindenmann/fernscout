"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { FileWarning } from "lucide-react";
import { mediaLoader } from "@/components/mediaLoader";
import AgentHandover from "@/components/AgentHandover";
import GuestSignIn from "@/components/GuestSignIn";
import PageHeader from "@/components/PageHeader";
import LifetimeMap, {
  ACCENT_HEX,
  type CountryVisit,
  type TripRoute,
} from "@/components/LifetimeMap";
import type { Basemap } from "@/lib/basemap";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";
import { daysUntil } from "@/lib/tripTime";
import type { MalformedTrip, MalformedTripReason } from "@/lib/trips";
import type { TripAccent, TripStatus, TripTranslations } from "@/lib/types";

export type TripCardData = {
  id: string;
  title: string;
  tagline?: string;
  cover?: string;
  accent: TripAccent;
  status: TripStatus;
  start: string; // ISO yyyy-mm-dd
  end: string; // ISO yyyy-mm-dd
  translations?: TripTranslations;
  tripDays: number;
  countries: number;
  totalMedia: number;
};

/**
 * What to say when this reader has nothing to see on the trip list.
 *
 * Null when there is at least one card to show. Otherwise there are two ways
 * to get here and they must look **identical** to a signed-out reader: the
 * journal genuinely holds no trips, or it holds some and the gate has removed
 * every one of them from *this* reader (B44: a full journal behind a silent
 * filter). Telling the two apart from the outside is a fact about somebody's
 * private journal, readable by anyone who tries the address — B117 refuses
 * that trade for a closed trip's own name, and B264 is the same refusal here.
 * So the server folds both into one `owner: false` shape and this component
 * never sees which one it was.
 *
 * `signedIn` is the one distinction that is safe to draw, because it does not
 * come from probing the journal — it comes from the reader's own cookie, which
 * they already know they are carrying. Somebody who has proven an address to
 * *this* journal and still sees nothing does not need "sign in"; they need
 * "ask for more."
 *
 * A union rather than nullable fields throughout, so that the owner's address
 * simply is not in the payload of a page a stranger asked for.
 *
 * `ownerName` (B278) travels on the `owner: false` branch for the same reason
 * `siteUrl` travels on the `owner: true` one: it is a fact about the
 * *journal*, computed once in `page.tsx` from `config.json`, and constant
 * whatever this reader's trips filter to — so, unlike `trips.length`, it is
 * safe to hand to a stranger. `page.tsx` already falls back to the journal's
 * title when the config has no nickname, so this is never an empty string.
 *
 * `filtered` (B270) is the owner's own third state, and it does not collapse
 * into either of the other two. The owner's `all.length === 0` above is
 * genuine emptiness; a *stranger's* `owner: false` already hides whether
 * anything exists at all. But an owner can also have a real trip that
 * `listableTrips` filters out from under them too — a `public, listed: false`
 * trip is unlisted for everyone, owner included, deliberately
 * (`test/access-gate.test.ts`, "the only trip the gate opens without the
 * switcher listing it"). Nothing about that state needs hiding from the
 * owner — it is their own file, and B117's reasons for not naming a trip to
 * an uninvited reader do not apply to the trip's own author — so this is a
 * plain `boolean` rather than a second `EmptyJournal` shape to keep secret.
 */
export type EmptyJournal =
  | { owner: false; signedIn: boolean; ownerName: string }
  | { owner: true; siteUrl: string; filtered?: boolean };

export type RouteData = {
  id: string;
  title: string;
  accent: TripAccent;
  translations?: TripTranslations;
  points: { lat: number; lng: number; location: string }[];
};

/**
 * What the notice needs from a `MalformedTrip`, and no more.
 *
 * `problem` is the English sentence, and the panel renders the translated
 * `reason` instead — so shipping it would put a duplicate of every message in
 * the payload for the browser to never read.
 */
export type BrokenFolder = Pick<MalformedTrip, "folder" | "reason">;

/**
 * One line per way a trip.md can be refused, in the reader's language.
 *
 * The parser hands over a code rather than its English sentence so that this
 * table can exist. The owner is being told about their own file, on their own
 * journal, and should be told in the language the rest of it is written in;
 * the English `problem` on the same object is what the server log and the API
 * carry, where the reader is an operator or an agent.
 */
const REASON_COPY: Record<MalformedTripReason, TranslationKey> = {
  "no-file": "trips.malformedNoFile",
  unparseable: "trips.malformedUnparseable",
  "missing-id": "trips.malformedMissingId",
  "id-mismatch": "trips.malformedIdMismatch",
  "invalid-id": "trips.malformedInvalidId",
  "missing-fields": "trips.malformedMissingFields",
};

const GROUPS: { status: TripStatus; key: TranslationKey }[] = [
  { status: "current", key: "trips.now" },
  { status: "upcoming", key: "trips.upcoming" },
  { status: "past", key: "trips.past" },
];

export default function TripsIndexContent({
  trips,
  routes,
  visits = [],
  userPath = "",
  lifetime,
  basemap = null,
  empty = null,
  malformed = [],
  codeMinutes,
}: {
  trips: TripCardData[];
  routes: RouteData[];
  /** Countries visited and by which trips — see LifetimeMap. Empty for a
   * journal whose days carry no `country:`, which falls back to pins. */
  visits?: CountryVisit[];
  /** `/<user>`, so a country can link to the trip that reached it. */
  userPath?: string;
  lifetime: { countries: number; days: number; photos: number; trips: number };
  /** Clipped on the server to every route's combined frame — lib/basemap.ts. */
  basemap?: Basemap | null;
  /** Set only when the journal has no trips whatsoever. See `EmptyJournal`. */
  empty?: EmptyJournal | null;
  /** Trips on disk but too broken to render. Owner-only; the server sends an
   * empty list to everyone else, so this component never has to gate it. */
  malformed?: BrokenFolder[];
  /** How long a requested code lasts, from `CODE_TTL_MINUTES` — passed down
   * to the code-request form the empty state may offer. See `EmptyState`. */
  codeMinutes: string;
}) {
  const { t, tn, localizedTrip } = useI18n();

  // The map and its legend want each route's title already resolved to the
  // active locale — LifetimeMap itself just renders what it's handed.
  const mapRoutes: TripRoute[] = routes.map((r) => ({
    id: r.id,
    title: localizedTrip(r).title,
    accent: r.accent,
    points: r.points,
  }));

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("trips.title")}
        </h1>
        {/* Owner-only, and independent of the empty state: a journal whose only
            trip is malformed is not empty, and one with good trips beside a
            broken one still needs to be told about the broken one. */}
        {malformed.length > 0 && <MalformedNotice malformed={malformed} />}
        {/*
          An empty journal used to render the subtitle and the four tiles
          anyway: a promise to record everywhere its owner had been, under
          0 · 0 · 0 · 0, with everything that could have said more hidden
          because it had nothing to show. It looked finished and said nothing,
          and it is the first page a new owner sees — `/<user>` redirects here.
          So the totals go, and the page says what is true instead (B76).
        */}
        {/*
          A journal whose only trip is malformed has no cards, no map and
          nothing to total, so it must not render the subtitle and the four
          zeroes either — that is the exact promise-over-0·0·0·0 B76 removed
          from the empty journal, and the notice above has already said what is
          actually wrong. `empty` is null here on purpose: the journal is not
          empty, so the empty state would be a second untruth.
        */}
        {empty ? (
          <EmptyState empty={empty} codeMinutes={codeMinutes} />
        ) : trips.length === 0 && malformed.length > 0 ? null : (
          <>
            <p className="mt-1 max-w-2xl text-sm text-navy-600">{t("trips.subtitle")}</p>

            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* `tn`, not `t`: one country is a country. */}
              <Stat
                label={tn("trips.lifetimeCountries", lifetime.countries)}
                value={lifetime.countries}
              />
              <Stat label={tn("trips.lifetimeDays", lifetime.days)} value={lifetime.days} />
              <Stat label={t("trips.lifetimePhotos")} value={lifetime.photos} />
              <Stat label={tn("trips.lifetimeTrips", lifetime.trips)} value={lifetime.trips} />
            </dl>

            {mapRoutes.length > 0 && (
              <div className="mt-7">
                <LifetimeMap routes={mapRoutes} visits={visits} userPath={userPath} basemap={basemap} />
              </div>
            )}

            {GROUPS.map(({ status, key }) => {
              const group = trips.filter((tr) => tr.status === status);
              if (group.length === 0) return null;
              return (
                <section key={status} className="mt-10">
                  <h2 className="font-display text-xl font-semibold text-navy-900">{t(key)}</h2>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {group.map((trip) => (
                      <TripCard key={trip.id} trip={trip} />
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * A trip that is on disk but did not load, named so the owner can fix it.
 *
 * The trip is real — its author wrote the file — but a mismatched id, a date
 * that is not a date, or frontmatter that will not parse takes it out of every
 * reading path (`lib/trips.ts`). Before B83 the only trace was a line on the
 * server's stdout, so the owner was told the journal was empty while the trip
 * sat in a folder. This is that line, moved to where the owner is. Owner-only:
 * the server sends nobody else the folder names or the reasons.
 *
 * `role="note"`, not `role="alert"`. This is part of the page from the moment
 * it renders, not something that has just happened to a reader sitting on it,
 * and an assertive live region interrupts a screen reader mid-sentence to say
 * so. The draft and test banners — the other two "your own content, only you
 * see this" notices — settled the same way.
 */
function MalformedNotice({ malformed }: { malformed: BrokenFolder[] }) {
  const { t, tn } = useI18n();
  return (
    <section
      role="note"
      data-malformed-trips
      className="mt-6 flex items-start gap-3 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3"
    >
      <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-navy-900" aria-hidden />
      <div className="min-w-0">
        <p className="font-display text-base font-semibold text-navy-900">
          {tn("trips.malformedTitle", malformed.length)}
        </p>
        <p className="mt-1 text-sm leading-6 text-navy-900">
          {tn("trips.malformedIntro", malformed.length)}
        </p>
        <ul className="mt-3 space-y-2">
          {malformed.map((m) => (
            <li key={m.folder} className="text-sm text-navy-900">
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-navy-900">
                trips/{m.folder}/trip.md
              </code>{" "}
              {/* The reason, in the journal's language. `m.problem` is the
                  English of the same thing and stays on the log and the API,
                  where the reader is an operator or an agent. */}
              — {t(REASON_COPY[m.reason])}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Nothing on the list for this reader, said plainly.
 *
 * Three readers, not two. The **owner** of a genuinely empty journal needs the
 * one fact nobody can guess from looking: there is no button here, there never
 * will be (ROADMAP decision 24), and a trip is made by handing an agent the
 * prompt below. That instruction already existed on `/<user>/me`, in a panel a
 * person who has just created a journal has no reason to have opened — so it
 * is repeated here rather than linked to, from the same component, and this
 * is the page they land on.
 *
 * Everybody else gets one of two sentences, chosen only by `signedIn` — never
 * by whether the journal is actually empty, which this component is not told
 * (see `EmptyJournal`). A stranger is pointed at both ways in: ask for an
 * invite link, or sign in if they already have one. Somebody already signed in
 * to *this* journal and still empty-handed is told the truer thing — their
 * address is not the problem, coverage is — because "sign in" to somebody
 * already signed in reads as a broken page.
 *
 * B278 adds the owner's name to both of the stranger's sentences, and — only
 * when nobody has a session yet — the same code-request form the trip gate
 * already offers (`GuestSignIn`, reused rather than rebuilt). Both additions
 * are safe for the byte-identity `EmptyJournal` exists to protect: the name
 * is the journal's own constant (see `EmptyJournal`), and the form's
 * presence turns only on `empty.signedIn` and on `useSite().canSignIn` — a
 * reader's own cookie and a journal-wide capability, neither of which is the
 * fact B264 closed off (whether there is anything to actually read). Nothing
 * here asks that question.
 */
function EmptyState({ empty, codeMinutes }: { empty: EmptyJournal; codeMinutes: string }) {
  const { t } = useI18n();
  const { username, canSignIn } = useSite();
  const title = empty.owner
    ? empty.filtered
      ? t("trips.emptyOwnerFilteredTitle")
      : t("trips.emptyTitle")
    : t("trips.hiddenTitle");
  const body = empty.owner
    ? empty.filtered
      ? t("trips.emptyOwnerFilteredBody")
      : t("trips.emptyOwnerBody")
    : empty.signedIn
      ? t("trips.hiddenSignedInBody", { name: empty.ownerName })
      : t("trips.hiddenBody", { name: empty.ownerName });

  return (
    <>
      <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-navy-900">{title}</h2>
        <p className="mt-2 max-w-2xl text-lg leading-8 text-navy-700">{body}</p>
        {/* Not shown for the filtered state: there is no first day to hand an
            agent for, the owner already has a trip — it just is not listed. */}
        {empty.owner && !empty.filtered && (
          <div className="mt-6 border-t border-navy-200 pt-5">
            <AgentHandover username={username} siteUrl={empty.siteUrl} />
          </div>
        )}
      </section>
      {/* A sibling card, not nested in the one above — GuestSignIn draws its
          own box, the same way MePageContent places it beside the panel
          rather than inside it. Not shown once signed in — TripGate makes
          the same call for the same reason (see its own three-state
          comment): somebody already carrying a session for this journal
          does not need to sign in again, they need coverage, which the
          sentence above already says. Not shown either when this journal
          cannot issue codes at all (`canSignIn`); `me`'s panel makes the
          same call, for the same journal-wide reason. */}
      {!empty.owner && !empty.signedIn && canSignIn && (
        <GuestSignIn username={username} codeMinutes={codeMinutes} />
      )}
    </>
  );
}

function TripCard({ trip }: { trip: TripCardData }) {
  const { tn, formatLongDate, localizedTrip } = useI18n();
  const { base } = useSite();
  const { title, tagline } = localizedTrip(trip);
  // Every URL carries the owner. The current trip lives at the journal's own
  // base; the rest hang off it. Without the base these pointed at `/trips/<id>`
  // at the root of the instance, which is nobody's trip and answers 404.
  const href = trip.status === "current" ? base : `${base}/trips/${trip.id}`;
  const startYear = trip.start.slice(0, 4);
  const endYear = trip.end.slice(0, 4);

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-navy-200 bg-white transition-shadow hover:shadow-md"
    >
      {trip.cover && (
        <span className="relative block h-40 w-full shrink-0 overflow-hidden bg-cream-200 sm:h-48">
          <Image
            src={trip.cover}
            loader={mediaLoader}
            alt={title}
            fill
            sizes="(min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </span>
      )}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: ACCENT_HEX[trip.accent] }}
          />
          <h3 className="font-display text-lg font-semibold text-navy-900">{title}</h3>
        </div>
        {tagline && <p className="text-sm text-navy-600">{tagline}</p>}
        <p className="text-xs text-navy-600">
          {formatLongDate(trip.start)} — {formatLongDate(trip.end)}
          {" · "}
          {startYear === endYear ? startYear : `${startYear}–${endYear}`}
        </p>

        {trip.status === "upcoming" ? (
          <CountdownLine start={trip.start} />
        ) : (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-600">
            <CardStat label={tn("map.days", trip.tripDays)} value={trip.tripDays} />
            <CardStat label={tn("map.countries", trip.countries)} value={trip.countries} />
            <CardStat label={tn("map.media", trip.totalMedia)} value={trip.totalMedia} />
          </dl>
        )}
      </div>
    </Link>
  );
}

/** Days-until text for an upcoming trip's card. Rendered after mount only —
 * this page is static, so baking `new Date()` into the server HTML would
 * disagree with the client's own `new Date()` on hydration. Mirrors
 * TripCountdown's own handling of the same problem, and shares its arithmetic
 * rather than repeating it: the two used to hold separate copies of the same
 * calculation, which is how they would have drifted apart. */
function CountdownLine({ start }: { start: string }) {
  const { t } = useI18n();
  const [away, setAway] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAway(daysUntil(start));
  }, [start]);

  return (
    <p className="mt-1 min-h-[1.25rem] text-xs font-semibold text-navy-700">
      {away !== null &&
        (away === 0
          ? t("trips.today")
          : away === 1
            ? t("trips.oneDayAway")
            : `${away} ${t("trips.daysAway")}`)}
    </p>
  );
}

function CardStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="inline font-semibold text-navy-700">{value}</dd>{" "}
      <dt className="inline">{label}</dt>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-navy-200 bg-white px-4 py-3">
      <dt className="text-xs text-navy-600">{label}</dt>{" "}
      <dd className="font-display text-2xl font-semibold text-navy-900">{value}</dd>
    </div>
  );
}
