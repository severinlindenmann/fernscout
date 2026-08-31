"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Images, Map, Wallet, Compass, Search, UserRound } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import { useTrip } from "./TripProvider";
import type { TranslationKey } from "@/lib/i18n";

const LINKS = [
  { href: "/", key: "nav.story" as TranslationKey, Icon: BookOpen },
  { href: "/gallery", key: "nav.gallery" as TranslationKey, Icon: Images },
  { href: "/map", key: "nav.map" as TranslationKey, Icon: Map },
  { href: "/costs", key: "nav.costs" as TranslationKey, Icon: Wallet },
];

/**
 * Labels appear from `xl`, not `lg`. With them the nav measures 529px, which
 * together with the header's chips left no room for the journal's own title —
 * it was printed over the day counter at 1024–1279. Icons alone are 250px and
 * every one of them keeps its `title` and `aria-label`.
 */
export default function SiteNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const trip = useTrip();
  // /trips and /search belong to the user, not to one trip.
  const { base: userBase } = useSite();
  const userHref = (p: string) => (p === "/" ? userBase : `${userBase}${p}`);
  // Pages like /trips, /search and /join have no trip in context. Falling back
  // to the bare path there sent "Costs" to `/costs` — nobody's journal, and an
  // error page. The journal's own base is the right answer: it resolves to the
  // current trip, which is what a reader clicking "Costs" from the trip list
  // is asking for.
  const href = trip?.href ?? userHref;
  const base = trip?.base ?? userBase;

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map(({ href: path, key, Icon }) => {
        const target = href(path);
        const label = t(key);
        // The story page is the base itself, so "active" is an exact match
        // plus its day permalinks; every other page is a prefix match.
        const active =
          path === "/"
            ? pathname === target || pathname === `${base}/` || pathname.startsWith(`${base}/day`)
            : pathname.startsWith(target);
        return (
          <Link
            key={path}
            href={target}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors sm:px-3 ${
              active
                ? "bg-yellow-400 text-yellow-950"
                : "text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={2.2} />
            <span className="hidden xl:inline">{label}</span>
          </Link>
        );
      })}
      <Link
        href={userHref("/trips")}
        title={t("nav.trips")}
        aria-label={t("nav.trips")}
        aria-current={pathname === userHref("/trips") ? "page" : undefined}
        className={`flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors sm:px-3 ${
          pathname === userHref("/trips")
            ? "bg-yellow-400 text-yellow-950"
            : "text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
        }`}
      >
        <Compass className="h-4 w-4" strokeWidth={2.2} />
        <span className="hidden xl:inline">{t("nav.trips")}</span>
      </Link>
      {/* Shown to everyone, not only to somebody already signed in.
          Gating it on a session was a closed loop: `/join` is linked from
          nowhere else, so the one page whose purpose is helping a reader who
          lost their invitation email could only be reached by a reader who had
          not lost it. The panel greets a stranger with an invitation. */}
      <Link
        href={userHref("/me")}
        title={t("me.title")}
        aria-label={t("me.title")}
        aria-current={pathname === userHref("/me") ? "page" : undefined}
        className={`flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors sm:px-3 ${
          pathname === userHref("/me")
            ? "bg-yellow-400 text-yellow-950"
            : "text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
        }`}
      >
        <UserRound className="h-4 w-4" strokeWidth={2.2} />
        <span className="hidden xl:inline">{t("me.title")}</span>
      </Link>
      <Link
        href={userHref("/search")}
        title={t("nav.search")}
        aria-label={t("nav.search")}
        aria-current={pathname === userHref("/search") ? "page" : undefined}
        className={`flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition-colors sm:px-3 ${
          pathname === userHref("/search")
            ? "bg-yellow-400 text-yellow-950"
            : "text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
        }`}
      >
        <Search className="h-4 w-4" strokeWidth={2.2} />
        <span className="hidden xl:inline">{t("nav.search")}</span>
      </Link>
    </nav>
  );
}
