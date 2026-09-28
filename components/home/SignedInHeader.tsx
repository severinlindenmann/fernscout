"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, House, PenLine, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AccountChip from "@/components/AccountChip";
import type { HomeJournal } from "@/components/HomeJournals";
import { useI18n } from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { Logo, WIDE } from "@/components/landing/kit";
import { journalPath } from "@/lib/journalPath";

/**
 * The signed-in `/` header and the owner's phone tab bar — B2519, the
 * Owner-Desktop / Owner-Phone boards.
 *
 * An owner gets the mark, Home · Studio · Readers · Prints and the account
 * chip; on a phone the same doors move to a tab bar at the bottom. A
 * reader-only person owns nothing to write in, so they get the mark and the
 * account chip only. Prints is `/studio/orders`, offered only where postcards
 * or the photobook exist — without `paid/` that route is a 404.
 */

type Door = { href: string; label: string; icon: LucideIcon; current?: boolean };

/** The owner's doors, or none for a reader-only person. */
function ownerDoors(
  journals: HomeJournal[],
  prints: boolean,
  t: (key: "home.navHome" | "nav.studio" | "studio.hub.group.write" | "studio.hub.item.readers.title" | "landing.navPrints") => string,
  atHome = true,
): { nav: Door[]; tabs: Door[] } | null {
  // ponytail: the first owned journal; an address owning two gets the other from the trip cards.
  const user = journals.find((j) => j.role === "owner")?.username;
  if (!user) return null;
  const home: Door = { href: "/", label: t("home.navHome"), icon: House, current: atHome };
  const readers: Door = { href: journalPath(user, "/studio/readers"), label: t("studio.hub.item.readers.title"), icon: Users };
  const printsDoor: Door[] = prints ? [{ href: journalPath(user, "/studio/orders"), label: t("landing.navPrints"), icon: BookOpen }] : [];
  return {
    nav: [home, { href: journalPath(user, "/studio"), label: t("nav.studio"), icon: PenLine }, readers, ...printsDoor],
    tabs: [home, { href: journalPath(user, "/studio"), label: t("studio.hub.group.write"), icon: PenLine }, readers, ...printsDoor],
  };
}

// B2531: the kit's wide column, the same edge as every other page's header.
const WRAP = `${WIDE} flex items-center justify-between gap-3 py-3 sm:py-4`;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

export default function SignedInHeader({
  siteName,
  locales,
  email,
  admin,
  journals,
  prints,
  badge,
}: {
  siteName: string;
  locales?: string[];
  email: string;
  admin?: boolean;
  journals: HomeJournal[];
  prints: boolean;
  /** B2531: the audience's word beside the wordmark, on a tinted page. */
  badge?: string;
}) {
  const { t } = useI18n();
  // B2531: the same header on every page outside the journal; Home is only
  // the current door on `/`.
  const doors = ownerDoors(journals, prints, t, usePathname() === "/");
  return (
    <>
      <header className="border-b border-line-quiet">
        <div className={WRAP}>
          <Logo siteName={siteName} badge={badge} />
          {doors && (
            <nav aria-label={t("home.navLabel")} className="hidden items-center gap-5 sm:flex lg:gap-7">
              {doors.nav.map((d) => (
                <Link
                  key={d.href}
                  href={d.href}
                  aria-current={d.current ? "page" : undefined}
                  className={`whitespace-nowrap rounded border-b-[3px] pb-0.5 text-[15px] font-semibold text-ink-strong ${FOCUS} ${
                    d.current ? "border-yellow-400" : "border-transparent hover:border-line-strong"
                  }`}
                >
                  {d.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-1">
            {/* Not on a phone, where it pushes into the name; /me offers it too. */}
            {admin && (
              <Link
                href="/admin"
                className="hidden min-h-11 items-center rounded-full px-2.5 text-xs font-bold text-ink-secondary sm:flex transition-colors hover:bg-surface-subtle hover:text-ink-strong"
              >
                {t("home.operator")}
              </Link>
            )}
            <ThemeSwitcher subtle />
            <LocaleSwitcher locales={locales} subtle />
            <AccountChip email={email} />
          </div>
        </div>
      </header>
      {doors && (
        // Phone only; the page reserves its height (`Landing`), and the iPhone
        // app's home indicator gets the safe-area inset below it.
        <nav
          aria-label={t("home.navLabel")}
          className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-line-quiet bg-surface-raised pb-[env(safe-area-inset-bottom,0px)] sm:hidden"
        >
          {doors.tabs.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              aria-current={d.current ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-bold ${FOCUS} ${
                d.current ? "text-ink-strong" : "text-ink-secondary"
              }`}
            >
              <d.icon aria-hidden className="h-[22px] w-[22px]" strokeWidth={2} />
              {d.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
