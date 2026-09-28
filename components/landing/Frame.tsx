"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import Link from "@/components/LanguageLink";
import SignedInHeader from "@/components/home/SignedInHeader";
import { useI18n } from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { flagFor } from "@/lib/flags";
import { SEEN_KEY, probeHome, type HomePayload } from "@/lib/homeProbe";
import { Logo, WIDE } from "./kit";
import { PILL_GHOST, PILL_PRIMARY, PILL_SMALL } from "./styles";

/**
 * The frame of every page outside the journal — B2531, the R3-Chrome board.
 *
 * Three headers and one footer. A signed-out visitor gets header A (the
 * homepage's: the mark, How it works · Prices · Schools · Tour operators,
 * Sign in and the one primary door); somebody signed in gets header B (the
 * B2519 owner header, `SignedInHeader`); a page people land on mid-task
 * (`/invite`, `/welcome`) gets the slim header C: the mark, the way home and
 * Sign in, no menu. The footer is the homepage's, everywhere.
 *
 * Which of A and B is decided in the browser, from the same
 * `/api/v2/me/home` the homepage asks: the page itself stays one document for
 * everybody (B412's reason, on `Landing`).
 */

export type InviteCta = "request" | "welcome";
/** Whom a page is for — its tint (app/globals.css, `.audience-*`). */
export type Audience = "personal" | "school" | "operator";
export type NavLink = { href: string; label: string };

export type Doors = {
  inviteCta: InviteCta;
  helperEnabled: boolean;
  prints: boolean;
  pricing: boolean;
  orgs?: NavLink[];
};

export type FrameProps = {
  siteName: string;
  locales?: string[];
  orgs?: NavLink[];
  repository?: string;
  credit?: { name: string; url?: string; countryCode?: string };
  legal?: boolean;
  /** The audience's word beside the wordmark ("Schools", "Tour operators"),
   *  on a tinted page only — B2531's tints. */
  badge?: string;
};

/** The header's links and the one primary door, for `/` or — `away` — for
 * another page, where the section links lead back to `/`. Prints stays on
 * `/` only: the header has no room for a fifth word in German at 1280px. */
export function useDoors({ inviteCta, helperEnabled, prints, pricing, orgs }: Doors, away = false) {
  const { t } = useI18n();
  // The one primary door, the same in the header, the hero, the pricing and
  // the questions: an invite request while signup is invite-only and the
  // request page exists (B2507), otherwise `/welcome` — where the helper can
  // write. With the helper off there is no hosted way in, and the agent
  // instruction below the hero is the door instead (B694, B751).
  const cta: NavLink | null =
    inviteCta === "request"
      ? { href: "/invite", label: t("landing.requestInvite") }
      : helperEnabled
        ? { href: "/welcome", label: t("landing.helperCta") }
        : null;
  const at = away ? "/" : "";
  const nav: NavLink[] = [
    { href: `${at}#how`, label: t("landing.navHow") },
    ...(prints && !away ? [{ href: "#prints", label: t("landing.navPrints") }] : []),
    ...(pricing ? [{ href: `${at}#prices`, label: t("landing.navPrices") }] : []),
    ...(orgs ?? []),
  ];
  return { nav, cta };
}

/** "Sign in": the form in place on `/`, a link to it anywhere else. */
function SignIn({ onSignIn, className, children }: { onSignIn?: () => void; className: string; children: ReactNode }) {
  return onSignIn ? (
    <button type="button" onClick={onSignIn} className={className}>
      {children}
    </button>
  ) : (
    <Link href="/?start=1" className={className}>
      {children}
    </Link>
  );
}

const NAV_LINK =
  "whitespace-nowrap text-[15px] font-semibold text-ink-strong hover:underline decoration-blue-500 decoration-2 underline-offset-4 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

/** Header A — anybody signed out. */
export function HeaderA({
  siteName,
  badge,
  locales,
  onSignIn,
  nav,
  cta,
}: FrameProps & { onSignIn?: () => void; nav: NavLink[]; cta: NavLink | null }) {
  const { t } = useI18n();
  return (
    <header className={`${WIDE} flex items-center justify-between gap-4 py-4 lg:py-5`}>
      <Logo siteName={siteName} badge={badge} />
      <nav aria-label={t("landing.navLabel")} className="hidden items-center gap-6 lg:flex">
        {nav.map((link) => (
          <a key={link.href} href={link.href} className={NAV_LINK}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <div className="hidden items-center gap-1 sm:flex">
          <ThemeSwitcher subtle />
          <LocaleSwitcher locales={locales} subtle />
        </div>
        <SignIn onSignIn={onSignIn} className={`${PILL_GHOST} ${PILL_SMALL}`}>
          {t("landing.signIn")}
        </SignIn>
        {cta && (
          // Wrapped: `hidden` on the pill itself loses to its own `inline-flex`.
          <span className="hidden sm:block">
            <Link href={cta.href} className={`${PILL_PRIMARY} ${PILL_SMALL}`}>
              {cta.label}
            </Link>
          </span>
        )}
        {/* The phone's menu: a native disclosure, so it opens without
            JavaScript and closes by a second tap. */}
        <details className="relative lg:hidden">
          <summary
            aria-label={t("landing.navMenu")}
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border-2 border-line-quiet
                       text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500
                       [&::-webkit-details-marker]:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </summary>
          <div className="absolute right-0 z-20 mt-2 flex w-64 flex-col gap-1 rounded-2xl border border-line-quiet bg-surface-raised p-3 shadow-lg">
            {nav.map((link) => (
              <a key={link.href} href={link.href} className={`${NAV_LINK} flex min-h-11 items-center px-2`}>
                {link.label}
              </a>
            ))}
            {cta && (
              <Link href={cta.href} className={`${PILL_PRIMARY} ${PILL_SMALL} mt-2`}>
                {cta.label}
              </Link>
            )}
            <div className="mt-2 flex items-center gap-1 border-t border-line-quiet pt-2 sm:hidden">
              <ThemeSwitcher subtle />
              <LocaleSwitcher locales={locales} subtle />
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

/** Header C — slim, for a page somebody lands on mid-task: no menu to lose
 * them in, only the way home and, while signed out, the way in. */
function HeaderC({ siteName, badge, locales, signedIn }: FrameProps & { signedIn: boolean }) {
  const { t } = useI18n();
  return (
    <header className={`${WIDE} flex items-center justify-between gap-3 py-4 lg:py-5`}>
      <Logo siteName={siteName} badge={badge} />
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <div className="flex items-center gap-1">
          <span className="hidden sm:contents">
            <ThemeSwitcher subtle />
          </span>
          <LocaleSwitcher locales={locales} subtle />
        </div>
        <Link href="/" className={`${NAV_LINK} hidden px-2 sm:inline`}>
          {t("landing.navHome")}
        </Link>
        {!signedIn && (
          <Link href="/?start=1" className={`${PILL_GHOST} ${PILL_SMALL}`}>
            {t("landing.signIn")}
          </Link>
        )}
      </div>
    </header>
  );
}

/** The one footer. */
export function Footer({ siteName, onSignIn, orgs, repository, legal, credit }: FrameProps & { onSignIn?: () => void }) {
  const { t } = useI18n();
  const link =
    "text-[15px] text-cream-50 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
  const heading = "font-mono text-xs uppercase tracking-[0.08em] text-navy-300";
  const madeBy = credit
    ? t("landing.madeBy", { flag: flagFor("", credit.countryCode) || "", name: "\u0000" }).split("\u0000")
    : null;
  return (
    <footer className="bg-navy-900 text-navy-300">
      <div className={`${WIDE} grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:pb-12 lg:pt-16`}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={34} height={34} className="h-8 w-8" />
            <span className="font-display text-[22px] font-semibold text-cream-50">{siteName}</span>
          </div>
          <p className="text-[15px]">{t("landing.footerTagline")}</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <p className={heading}>{t("landing.footerReaders")}</p>
          <SignIn onSignIn={onSignIn} className={link}>
            {t("landing.footerSignIn")}
          </SignIn>
        </div>
        {orgs && orgs.length > 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className={heading}>{t("landing.footerGroups")}</p>
            {orgs.map((o) => (
              <Link key={o.href} href={o.href} className={link}>
                {o.label}
              </Link>
            ))}
          </div>
        )}
        <div className="flex flex-col items-start gap-2">
          <p className={heading}>{t("landing.footerOpen")}</p>
          {repository && (
            <a href={repository} className={link}>
              {t("landing.source")}
            </a>
          )}
          <Link href="/docs" className={link}>
            {t("landing.footerDocs")}
          </Link>
          <Link href="/agentic" className={link}>
            {t("landing.footerAgentic")}
          </Link>
          {legal && (
            <Link href="/legal" className={link}>
              {t("landing.legal")}
            </Link>
          )}
        </div>
      </div>
      <div className={`${WIDE} flex flex-wrap gap-x-4 gap-y-1 border-t border-navy-700 py-5 text-xs text-navy-300`}>
        {madeBy && credit && (
          <p>
            {madeBy[0]}
            {credit.url ? (
              <a href={credit.url} className="font-semibold text-cream-50 underline decoration-blue-500 decoration-2 underline-offset-4">
                {credit.name}
              </a>
            ) : (
              <span className="font-semibold text-cream-50">{credit.name}</span>
            )}
            {madeBy[1]}
          </p>
        )}
        <p>{t("landing.noTracking")}</p>
      </div>
    </footer>
  );
}

/** The 6px stripe above every header, in the page's tint — B2531. */
export function Stripe() {
  return <div aria-hidden className="h-1.5 bg-tint" />;
}

/** The height the owner's phone tab bar (`SignedInHeader`) takes, reserved. */
export const TAB_BAR_ROOM = "max-sm:pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]";

/**
 * The frame around a page's bands: header A, B or C, `<main>`, the footer.
 * Rendered by `PageShell`, which reads the instance's facts on the server.
 */
export function SiteFrame({
  slim = false,
  audience = "personal",
  children,
  ...props
}: FrameProps & Doors & { slim?: boolean; audience?: Audience; children: ReactNode }) {
  const { nav, cta } = useDoors(props, true);
  // undefined: not known yet; null: nobody signed in.
  const [home, setHome] = useState<HomePayload | null | undefined>(undefined);
  // A browser that was signed in last time waits for the answer with the
  // mark alone, rather than flashing header A at its owner.
  const [expected, setExpected] = useState(false);
  useEffect(() => {
    let live = true;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpected(window.localStorage.getItem(SEEN_KEY) === "1");
    } catch {
      // Blocked storage: header A until the answer, as for a first visit.
    }
    probeHome(() => live)
      .then((data) => {
        if (live) setHome(data?.id ? data : null);
      })
      .catch(() => {
        // Offline (`/offline` is this frame too): signed out is the honest
        // fallback, it needs nothing from the server.
        if (live) setHome(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const owner = !slim && Boolean(home?.journals.some((j) => j.role === "owner"));
  const header = slim ? (
    <HeaderC {...props} signedIn={Boolean(home)} />
  ) : home ? (
    <SignedInHeader
      siteName={props.siteName}
      locales={props.locales}
      email={home.email}
      admin={home.admin}
      journals={home.journals}
      prints={props.prints}
      badge={props.badge}
    />
  ) : home === undefined && expected ? (
    <header className={`${WIDE} flex min-h-[4.75rem] items-center py-4 lg:py-5`}>
      <Logo siteName={props.siteName} badge={props.badge} />
    </header>
  ) : (
    <HeaderA {...props} nav={nav} cta={cta} />
  );

  return (
    <div
      className={`flex min-h-full flex-col bg-surface-base text-ink-body ${owner ? TAB_BAR_ROOM : ""} ${
        audience === "personal" ? "" : `audience-${audience}`
      }`}
    >
      <Stripe />
      {header}
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer {...props} />
    </div>
  );
}
