"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Images, Map, ChartNoAxesColumn, Compass, Search, UserRound } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import { useTrip } from "./TripProvider";
import type { TranslationKey } from "@/lib/i18n";

const LINKS: {
  href: string;
  key: TranslationKey;
  Icon: typeof BookOpen;
  /** Other paths this tab owns, for the active state. */
  also?: string[];
}[] = [
  { href: "/", key: "nav.story" as TranslationKey, Icon: BookOpen },
  { href: "/gallery", key: "nav.gallery" as TranslationKey, Icon: Images },
  { href: "/map", key: "nav.map" as TranslationKey, Icon: Map },
  /**
   * Analytics, and the leaves that hang off it — B557.
   *
   * `also` exists because the hub's own children keep their own URLs: the
   * costs page is still `/<user>/costs` and nothing about a hub was worth
   * breaking a bookmark or a printed photobook reference for. A prefix match
   * on `/analytics` alone would therefore leave the whole row unhighlighted
   * while the reader is standing on one of its pages, which reads as having
   * navigated out of the site.
   */
  {
    href: "/analytics",
    key: "nav.analytics" as TranslationKey,
    Icon: ChartNoAxesColumn,
    also: ["/costs", "/weather"],
  },
];

/** One destination, resolved to this reader's URLs and its own active state —
 * B770. The single thing both the icon bar and the mobile panel's list draw
 * from, and what `PageHeader` reads to find the current section without
 * duplicating the active-state logic a third time. */
export type NavEntry = {
  href: string;
  label: string;
  Icon: typeof BookOpen;
  active: boolean;
  /** Only the last entry (`/me`) ever sets this — see the doc comment below. */
  strangerDoor?: boolean;
};

/**
 * Labels appear from `xl`, not `lg`. With them the nav measures 529px, which
 * together with the header's chips left no room for the journal's own title —
 * it was printed over the day counter at 1024–1279. Icons alone are 250px and
 * every one of them keeps its `title` and `aria-label`.
 *
 * One entry is exempt, and it is the last one. B44: a reader who was invited
 * to this journal months ago, has lost the mail and arrives with no cookie
 * sees a journal that looks finished — the gate has quietly removed everything
 * they were invited for, and nothing in the chrome says a filter ran. Their
 * conclusion is not "I should sign in", it is "they never added me". The page
 * that answers them exists and is good; the only route to it was this row's
 * person icon, which below `xl` is a small outline of a head. `title` and
 * `aria-label` are correct and invisible to somebody looking at a phone.
 *
 * So for a reader with no session, on a journal that can actually issue a
 * code, the last entry stops being an icon and becomes a door with a word on
 * it, at every width. Two properties matter and both are load-bearing:
 *
 * - It is **constant**. It depends on the session cookie and on
 *   `features.auth`, and on nothing the gate did or did not filter. "3 trips
 *   are not shown to you" would tell an anonymous prober that three private
 *   trips exist on a journal whose owner may not want that known, so the door
 *   is identical on a journal with ten hidden trips and on one with none.
 * - It is **absent rather than broken**. With `auth` off there is no form
 *   behind `/<user>/me` to reach, only a line saying to ask for a link, and a
 *   control marked "Sign in" leading to that is the exact bug recorded at
 *   app/[user]/me/MePageContent.tsx. That journal keeps the icon it had.
 *
 * Only this one entry gets a permanent label; giving all six one is what the
 * paragraph above measured at 529px and rejected. It sits last because an
 * outlined pill between two icon tabs reads as a broken tab, and at the end of
 * the row it reads as what it is.
 */
export function useNavEntries(): NavEntry[] {
  const pathname = usePathname();
  const { t } = useI18n();
  const trip = useTrip();
  // /trips and /search belong to the user, not to one trip.
  const site = useSite();
  const userBase = site.base;
  const userHref = (p: string) => (p === "/" ? userBase : `${userBase}${p}`);
  // Pages like /trips, /search and /me have no trip in context. Falling back
  // to the bare path there sent "Analytics" to `/analytics` — nobody's journal, and an
  // error page. The journal's own base is the right answer: it resolves to the
  // current trip, which is what a reader clicking "Analytics" from the trip list
  // is asking for.
  const href = trip?.href ?? userHref;
  const base = trip?.base ?? userBase;

  // The stranger's door. `signedIn` is the guest cookie and nothing else, so
  // an owner reading their own journal with a session is not offered a way to
  // sign in either — and an owner without one is, from here, indistinguishable
  // from any other reader with no cookie, which is the honest answer.
  const strangerDoor = site.canSignIn && !site.signedIn;

  /**
   * Every analysis is a capability, so the tab is one too. B165, B557.
   *
   * With `features.costs` off both costs pages answer 404, and the same holds
   * for weather; a tab pointing at a 404 is the failure the paragraph above
   * describes for the sign-in door, and an optional capability must be absent
   * rather than broken. `analyticsEnabled` is true when *any* analysis has
   * something behind it, so a journal that does no spending but records the
   * weather keeps the tab and gets a hub with one card on it. Nothing else in
   * this row is optional today.
   */
  const links = site.analyticsEnabled ? LINKS : LINKS.filter((l) => l.href !== "/analytics");
  const meLabel = strangerDoor ? t("nav.signIn") : t("me.title");
  const meHref = userHref("/me");
  const meActive = pathname === meHref;
  const tripsHref = userHref("/trips");
  const searchHref = userHref("/search");

  const entries: NavEntry[] = links.map(({ href: path, key, Icon, also }) => {
    const target = href(path);
    // The story page is the base itself, so "active" is an exact match
    // plus its day permalinks; every other page is a prefix match, plus
    // whatever else that tab owns (see `also` on Analytics).
    const active =
      path === "/"
        ? pathname === target || pathname === `${base}/` || pathname.startsWith(`${base}/day`)
        : pathname.startsWith(target) || (also ?? []).some((p) => pathname.startsWith(href(p)));
    return { href: target, label: t(key), Icon, active };
  });
  entries.push({ href: tripsHref, label: t("nav.trips"), Icon: Compass, active: pathname === tripsHref });
  entries.push({ href: searchHref, label: t("nav.search"), Icon: Search, active: pathname === searchHref });
  entries.push({ href: meHref, label: meLabel, Icon: UserRound, active: meActive, strangerDoor });

  return entries;
}

/** The tab bar this component has always drawn — unchanged pixel for pixel,
 * and still what `sm` and up mount. B770 only adds the `list` variant below;
 * this one keeps every class it had. */
function TabBar({ entries }: { entries: NavEntry[] }) {
  return (
    /*
       Wrapping, and right-aligned so a wrapped row stays under the one above
       it. The door is the widest thing in this row by some margin — a word
       rather than a 16px glyph — and at 320px, the narrowest phone still in
       use, the seven entries no longer fit across the header's content box.
       Without this the row silently overflowed its container to the *left*
       and clipped the first icon off the screen; the document itself never
       scrolled sideways, so nothing looked wrong from the outside.
    */
    <nav className="flex flex-wrap items-center justify-end gap-1">
      {entries.map(({ href: target, label, Icon, active, strangerDoor }) => (
        <Link
          key={target}
          href={target}
          title={label}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full text-sm font-semibold transition-colors ${
            strangerDoor ? "border border-navy-700 px-3.5 sm:px-4" : "px-2.5 sm:px-3"
          } ${
            active
              ? "bg-yellow-400 text-yellow-950"
              : strangerDoor
                ? "text-navy-900 hover:bg-navy-200/60"
                : "text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden />
          <span className={strangerDoor ? "inline" : "hidden xl:inline"}>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The mobile panel's list — B770.
 *
 * Every row is 48px tall (`min-h-12`), well past the 44px floor, and carries
 * its label at every width: a panel opened on purpose has room for words, so
 * the `xl`-only labels the tab bar needs to fit seven controls into one row
 * do not apply here. `onNavigate` closes the panel on tap, since a link
 * inside it that left the panel open behind the new page would read as
 * broken.
 */
function ListNav({ entries, onNavigate }: { entries: NavEntry[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {entries.map(({ href: target, label, Icon, active }) => (
        <Link
          key={target}
          href={target}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-semibold transition-colors ${
            active ? "bg-yellow-400 text-yellow-950" : "text-navy-700 hover:bg-cream-100"
          }`}
        >
          <Icon className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default function SiteNav({
  variant = "bar",
  onNavigate,
}: {
  /** `"bar"` is the icon row this component always drew, and is what `sm`
   * and up still mount. `"list"` is the mobile menu panel's full-width,
   * always-labelled rows — see `ListNav` above. */
  variant?: "bar" | "list";
  onNavigate?: () => void;
} = {}) {
  const entries = useNavEntries();
  return variant === "list" ? (
    <ListNav entries={entries} onNavigate={onNavigate} />
  ) : (
    <TabBar entries={entries} />
  );
}
