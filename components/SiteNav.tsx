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
export default function SiteNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const trip = useTrip();
  // /trips and /search belong to the user, not to one trip.
  const site = useSite();
  const userBase = site.base;
  const userHref = (p: string) => (p === "/" ? userBase : `${userBase}${p}`);
  // Pages like /trips, /search and /me have no trip in context. Falling back
  // to the bare path there sent "Costs" to `/costs` — nobody's journal, and an
  // error page. The journal's own base is the right answer: it resolves to the
  // current trip, which is what a reader clicking "Costs" from the trip list
  // is asking for.
  const href = trip?.href ?? userHref;
  const base = trip?.base ?? userBase;

  // The stranger's door. `signedIn` is the guest cookie and nothing else, so
  // an owner reading their own journal with a session is not offered a way to
  // sign in either — and an owner without one is, from here, indistinguishable
  // from any other reader with no cookie, which is the honest answer.
  const strangerDoor = site.canSignIn && !site.signedIn;
  const meLabel = strangerDoor ? t("nav.signIn") : t("me.title");
  const meHref = userHref("/me");
  const meActive = pathname === meHref;

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
      {/* Shown to everyone, not only to somebody already signed in.
          Gating it on a session was a closed loop: this is the one page whose
          purpose is helping a reader who lost their invitation email, so
          requiring a session meant it could only be reached by a reader who
          had not lost it. The panel greets a stranger with the truth — the
          link somebody sends you is what lets you in.

          What changes with `strangerDoor` is only how it is drawn: a word
          instead of an outline of a head, and an outlined pill instead of a
          flat tab. Same href, same page, same everything a signed-in reader
          gets — see the note above the component. */}
      <Link
        href={meHref}
        title={meLabel}
        aria-label={meLabel}
        aria-current={meActive ? "page" : undefined}
        className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full text-sm font-semibold transition-colors ${
          strangerDoor ? "border border-navy-700 px-3.5 sm:px-4" : "px-2.5 sm:px-3"
        } ${
          meActive
            ? "bg-yellow-400 text-yellow-950"
            : strangerDoor
              ? "text-navy-900 hover:bg-navy-200/60"
              : "text-navy-600 hover:bg-navy-200/60 hover:text-navy-900"
        }`}
      >
        <UserRound className="h-4 w-4" strokeWidth={2.2} />
        <span className={strangerDoor ? "inline" : "hidden xl:inline"}>{meLabel}</span>
      </Link>
    </nav>
  );
}
