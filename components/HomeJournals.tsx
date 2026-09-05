"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { tellWorkerSignedOut } from "@/lib/signedOut";

/**
 * What a signed-in reader may open, and the devices they are signed in on —
 * B411.
 *
 * The part of `/` that is one person's. Everything here arrives from
 * `GET /api/v1/me/home`, which authenticates on the identity cookie alone; the
 * page around it holds no personal data at all, so that B412 can cache the two
 * separately and never serve one reader's list to the next.
 */

export type HomeTrip = {
  id: string;
  title: string;
  href: string;
  through: "public" | "owner" | "traveller" | "guest";
};

export type HomeJournal = {
  username: string;
  title: string;
  tagline: string;
  href: string;
  role: "admin" | "owner" | "traveller" | "guest";
  trips: HomeTrip[];
};

/** A journal the address holds a role in of its own — everything but `admin`,
 * which B494 renders as a row rather than a card. A predicate rather than a
 * bare `filter`, so the card and its badge are typed against the four-value
 * union minus the one they cannot draw. */
type MineJournal = HomeJournal & { role: Exclude<HomeJournal["role"], "admin"> };

function isMine(journal: HomeJournal): journal is MineJournal {
  return journal.role !== "admin";
}

export type HomeDevice = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  current: boolean;
};

/** How many trips a journal card lists before it stops and counts the rest.
 * Four fits a phone without the card becoming the page. */
const TRIPS_SHOWN = 4;

/**
 * The badge beside a journal's name.
 *
 * The roles get a colour each rather than four words in one colour, because
 * the whole point of this list is that it mixes journals a person owns with
 * journals somebody else let them into, and which is which should survive
 * being skimmed.
 *
 * `admin` never reaches here: B488 gave it a colour of its own and B494 took
 * the card away entirely, so those journals are rows under their own heading
 * and the heading says what the badge used to.
 */
function RoleBadge({ role }: { role: MineJournal["role"] }) {
  const { t } = useI18n();
  const tone =
    role === "owner"
      ? "bg-yellow-100 text-navy-900"
      : role === "traveller"
        ? "bg-sky-100 text-navy-900"
        : "bg-cream-100 text-navy-700";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${tone}`}
    >
      {t(`home.role.${role}`)}
    </span>
  );
}

function JournalCard({ journal }: { journal: MineJournal }) {
  const { t, tn } = useI18n();
  const shown = journal.trips.slice(0, TRIPS_SHOWN);
  const rest = journal.trips.length - shown.length;

  return (
    <li className="rounded-xl border border-navy-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={journal.href}
            className="font-display text-base font-semibold break-words text-navy-900
                       underline decoration-blue-500 decoration-2 underline-offset-4
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {journal.title}
          </Link>
          <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-navy-600">
            {journal.tagline}
          </p>
        </div>
        <RoleBadge role={journal.role} />
      </div>

      {/* B493. A title is somebody else's `trip.md` and can be three hundred
          characters with no space in it — which `flex-wrap` cannot break, so
          the card grew to the width of the word and took the document's
          horizontal scrollbar with it. `max-w-full` caps the row against the
          card and `truncate` ends it in an ellipsis; the trip's own page still
          shows the title whole. `min-w-0` on the `li` is what lets a flex item
          shrink below its content at all. */}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {shown.map((trip) => (
          <li key={trip.id} className="min-w-0 max-w-full">
            <Link
              href={trip.href}
              title={trip.title}
              className="block max-w-full truncate text-sm leading-6 text-navy-700
                         underline decoration-navy-200 underline-offset-4
                         hover:decoration-blue-500
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {trip.title}
            </Link>
          </li>
        ))}
        {rest > 0 && (
          <li className="font-mono text-xs leading-6 text-navy-600">
            {tn("home.moreTrips", rest, { count: String(rest) })}
          </li>
        )}
      </ul>

      <p className="mt-2 font-mono text-xs text-navy-600">
        /{journal.username} ·{" "}
        {tn("landing.trips", journal.trips.length, { count: String(journal.trips.length) })}
      </p>

      {journal.role === "owner" && (
        <p className="mt-2 text-xs leading-5 text-navy-600">{t("home.ownerHint")}</p>
      )}
    </li>
  );
}

/**
 * Every journal the operator reaches because they run the server — B494.
 *
 * A row each rather than a card each. These are not this person's journals in
 * any sense they care about while they are looking for their own, and the card
 * repeated the same nine words of small print under every one of them; on an
 * instance where anybody can sign up the list only ever grows. The sentence is
 * said once, above, where it applies to all of them.
 *
 * No badge on a row, deliberately: the heading is the badge, and a colour
 * repeated down a list of identical rows says nothing the heading has not.
 * Deliberately uncapped as well — an operator scanning for one journal wants
 * to find it, not to be told there are eleven more.
 */
function AdminJournals({ journals }: { journals: HomeJournal[] }) {
  const { t, tn } = useI18n();
  if (journals.length === 0) return null;

  return (
    <section aria-labelledby="admin-journals" className="mt-10">
      <h2
        id="admin-journals"
        className="font-display text-lg font-semibold text-navy-900"
      >
        {t("home.adminSection")}
      </h2>
      <p className="mt-1 text-xs leading-5 text-navy-600">{t("home.adminSectionBody")}</p>

      <ul className="mt-3 divide-y divide-navy-200 border-y border-navy-200">
        {journals.map((journal) => (
          <li key={journal.username} className="py-2">
            <Link
              href={journal.href}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <span
                className="min-w-0 max-w-full truncate text-sm font-semibold text-navy-900
                           underline decoration-navy-200 underline-offset-4"
              >
                {journal.title}
              </span>
              <span className="font-mono text-xs text-navy-600">
                /{journal.username} ·{" "}
                {tn("landing.trips", journal.trips.length, {
                  count: String(journal.trips.length),
                })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function YourJournals({ email, journals }: { email: string; journals: HomeJournal[] }) {
  const { t } = useI18n();
  // Two lists, one query: a journal this address holds a real role in is a
  // card, and one it merely runs the server for is a row below (B494).
  const mine = journals.filter(isMine);
  const admin = journals.filter((j) => j.role === "admin");
  return (
    <section aria-labelledby="your-journals" className="mt-6">
      <h1
        id="your-journals"
        className="font-display text-[clamp(1.5rem,5vw,2.25rem)] font-semibold leading-[1.15] text-navy-900"
      >
        {t("home.title")}
      </h1>
      <p className="mt-2 font-mono text-xs text-navy-600">
        {t("home.signedInAs", { email })}
      </p>

      {/* The three guides, for somebody who has just arrived and is working out
          what any of this is — B445. Above the list rather than below it: a
          reader with no journals yet is exactly who needs them, and they would
          never scroll past an empty state to find them. */}
      <p className="mt-3">
        <Link
          href="/docs/guide/guest"
          className="text-sm text-navy-700 underline decoration-navy-300 underline-offset-4
                     transition-colors hover:decoration-navy-700
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {t("guides.readMore")}
        </Link>
      </p>

      {mine.length === 0 && admin.length > 0 ? null : mine.length === 0 ? (
        /* Not an empty heading with nothing under it. Somebody signed in with
           no journals is in a real and explicable state — nobody has approved
           them yet, or they have not started their own — and saying so is the
           difference between a working page and a broken-looking one. */
        <p className="mt-4 text-base leading-6 text-navy-700">{t("home.none")}</p>
      ) : (
        <ul className="mt-5 grid gap-4">
          {mine.map((journal) => (
            <JournalCard key={journal.username} journal={journal} />
          ))}
        </ul>
      )}

      <AdminJournals journals={admin} />
    </section>
  );
}

/** A user-agent string, shortened to something a person recognises their own
 * phone by. Deliberately crude: the alternative is a UA-parsing dependency for
 * a line of small print. */
function deviceName(agent: string | null): string | null {
  if (!agent) return null;
  const os = /iPhone|iPad|Android|Macintosh|Windows|Linux/.exec(agent)?.[0];
  const browser = /Firefox|Edg|Chrome|Safari/.exec(agent)?.[0];
  const parts = [os, browser === "Edg" ? "Edge" : browser].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function YourDevices({
  devices,
  onRevoke,
}: {
  devices: HomeDevice[];
  onRevoke: (id: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/me/devices/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      const { current } = (await res.json()) as { current?: boolean };
      if (current) {
        // Signing *this* device out is a sign-out, and has to be treated as
        // one: drop the worker's cached copy and reload, rather than leaving
        // the page listing journals the credential behind it no longer opens.
        tellWorkerSignedOut();
        window.location.reload();
        return;
      }
      onRevoke(id);
    } finally {
      setBusy(null);
    }
  }

  if (devices.length === 0) return null;

  return (
    <section aria-labelledby="your-devices" className="mt-12 border-t border-navy-200 pt-8">
      <h2 id="your-devices" className="font-display text-xl font-semibold text-navy-900">
        {t("home.devices")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-navy-700">{t("home.devicesBody")}</p>

      <ul className="mt-4 divide-y divide-navy-200 border-y border-navy-200">
        {devices.map((device) => {
          const name = deviceName(device.userAgent);
          return (
            <li key={device.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-navy-900">
                  {name ?? t("home.unknownDevice")}
                  {device.current && (
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.12em] text-coral-600">
                      {t("home.thisDevice")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-xs text-navy-600">
                  {device.lastSeenAt
                    ? t("home.lastUsed", { when: device.lastSeenAt.slice(0, 10) })
                    : t("home.neverUsed")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(device.id)}
                disabled={busy === device.id}
                className="min-h-11 shrink-0 rounded-lg border border-navy-200 px-3 text-sm font-semibold text-navy-900
                           hover:border-navy-700 disabled:opacity-50
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                {t("home.revoke")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
