"use client";

import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import type { PlanSummary } from "@/lib/billingSummary";
import { tellWorkerSignedOut } from "@/lib/signedOut";

import { journalPath } from "@/lib/journalPath";
/**
 * What a signed-in reader may open, and the devices they are signed in on —
 * B411.
 *
 * The part of `/` that is one person's. Everything here arrives from
 * `GET /api/v2/me/home`, which authenticates on the identity cookie alone; the
 * page around it holds no personal data at all, so that B412 can cache the two
 * separately and never serve one reader's list to the next.
 */

type HomeDay = { slug: string; title: string; date: string; href: string };

/** One trip as `/api/v2/me/home` describes it — `ViewerTrip` in lib/viewer.ts.
 * Everything after `through` is B2508's, read at this address's own level
 * and absent rather than guessed when there is nothing to show. */
export type HomeTrip = {
  id: string;
  title: string;
  href: string;
  through: "public" | "owner" | "traveller" | "guest";
  status?: "past" | "current" | "upcoming";
  end?: string;
  partial?: true;
  start?: string;
  cover?: string;
  days?: number;
  latest?: HomeDay & { image?: string; excerpt?: string };
  draft?: HomeDay;
  test?: true;
};

export type HomeJournal = {
  username: string;
  title: string;
  tagline: string;
  href: string;
  role: "admin" | "owner" | "traveller" | "guest";
  trips: HomeTrip[];
  /** This journal's own plan — B2622, present only for the address that
   *  owns it and only when `billing` is on. See `lib/home.ts`'s own field. */
  plan?: PlanSummary;
};

/** A journal the address holds a role in of its own — everything but `admin`,
 * which B494 renders as a row rather than a card. A predicate rather than a
 * bare `filter`, so the card and its badge are typed against the four-value
 * union minus the one they cannot draw. */
export type MineJournal = HomeJournal & {
  role: Exclude<HomeJournal["role"], "admin">;
};

export function isMine(journal: HomeJournal): journal is MineJournal {
  return journal.role !== "admin";
}

export type HomeDevice = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  current: boolean;
};

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
export function RoleBadge({ role }: { role: MineJournal["role"] }) {
  const { t } = useI18n();
  const tone =
    role === "owner"
      ? "bg-yellow-300 text-on-bright"
      : role === "traveller"
        ? "bg-sky-300 text-on-bright"
        : "bg-surface-subtle text-ink-body";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${tone}`}
    >
      {t(`home.role.${role}`)}
    </span>
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
export function AdminJournals({ journals }: { journals: HomeJournal[] }) {
  const { t, tn } = useI18n();
  if (journals.length === 0) return null;

  return (
    <section aria-labelledby="admin-journals" className="mt-10">
      <h2
        id="admin-journals"
        className="font-display text-lg font-semibold text-ink-strong"
      >
        {t("home.ownerSection")}
      </h2>
      <p className="mt-1 text-xs leading-5 text-ink-secondary">
        {t("home.ownerSectionBody")}
      </p>

      <ul className="mt-3 divide-y divide-line-quiet border-y border-line-quiet">
        {journals.map((journal) => (
          <li key={journal.username} className="py-2">
            <Link
              href={journal.href}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <span
                className="min-w-0 max-w-full truncate text-sm font-semibold text-ink-strong
                           underline decoration-line-quiet underline-offset-4"
              >
                {journal.title}
              </span>
              <span className="font-mono text-xs text-ink-secondary">
                {journalPath(journal.username)} ·{" "}
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
      const isThisDevice = devices.find((d) => d.id === id)?.current === true;
      if (isThisDevice) {
        // B2451: this row's DELETE only revokes the instance-wide identity
        // and deliberately leaves cookies in place (see the route's own
        // comment) — a browser holding a journal session too would still
        // resolve as signed in after reload. Signing out THIS device is a
        // sign-out, so it takes the same call the journal's own sign-out
        // button makes: both cookies, both sessions.
        const res = await fetch("/api/auth/logout", { method: "POST" });
        if (!res.ok) return;
        tellWorkerSignedOut();
        window.location.reload();
        return;
      }
      const res = await fetch(`/api/v2/me/devices/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      onRevoke(id);
    } finally {
      setBusy(null);
    }
  }

  if (devices.length === 0) return null;

  return (
    <section
      aria-labelledby="your-devices"
      className="mt-12 border-t border-line-quiet pt-8"
    >
      <h2
        id="your-devices"
        className="font-display text-xl font-semibold text-ink-strong"
      >
        {t("home.devices")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-body">
        {t("home.devicesBody")}
      </p>

      <ul className="mt-4 divide-y divide-line-quiet border-y border-line-quiet">
        {devices.map((device) => {
          const name = deviceName(device.userAgent);
          return (
            <li
              key={device.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-ink-strong">
                  {name ?? t("home.unknownDevice")}
                  {device.current && (
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.12em] text-coral-600">
                      {t("home.thisDevice")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-xs text-ink-secondary">
                  {device.lastSeenAt
                    ? t("home.lastUsed", {
                        when: device.lastSeenAt.slice(0, 10),
                      })
                    : t("home.neverUsed")}
                </p>
              </div>
              <BusyButton
                busy={busy === device.id}
                type="button"
                onClick={() => revoke(device.id)}
                className="min-h-11 shrink-0 rounded-lg border border-line-quiet px-3 text-sm font-semibold text-ink-strong
                           hover:border-line-ink disabled:opacity-50
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                {t("home.revoke")}
              </BusyButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
