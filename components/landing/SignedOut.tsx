"use client";

import Link from "@/components/LanguageLink";
import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import AppWaitlistDoor from "@/components/AppWaitlistDoor";
import { AgentBlock, LandingSteps } from "@/components/LandingSections";
import { useI18n } from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { posterSrc } from "@/components/mediaLoader";
import { flagFor } from "@/lib/flags";
import type { DemoDay } from "@/lib/demoDay";
import { landingFaq, landingHero, landingHow, landingPrints, landingTrust } from "@/lib/landingContent";
import { KICKER, PILL_GHOST, PILL_PRIMARY, PILL_SMALL, TEXT_LINK } from "./styles";

/**
 * The signed-out `/` — B2506, the "Winner" boards.
 *
 * Written for the person deciding whether to keep a journal here: what it is
 * for (the people at home), what comes out of it (a book, a card), how it
 * works, why it is safe, what it costs, and the questions people ask first.
 * The reader who only lost a link gets the slim strip at the very top, which
 * opens the same `IdentitySignIn` in place (`Landing` owns that state).
 *
 * **Everything is read or gated, nothing is typed in.** The day beside the
 * headline is a real published day (`lib/demoDay.ts`), absent when this
 * instance has none. The prints block exists only where postcards or the
 * photobook do. Prices, the plan line and the plan questions come from
 * `paid/credits` as data and are absent in a build without it. The agent
 * instruction stays on the page, below the hero, where the helper is off —
 * with no helper it is the only way in (B751).
 */

export type InviteCta = "request" | "welcome";
export type NavLink = { href: string; label: string };

export type SignedOutProps = {
  siteName: string;
  locales?: string[];
  /** The reader strip, or the sign-in form that replaced it. */
  top: ReactNode;
  /** A browser that was signed in a moment ago, waiting on `/api/v2/me/home`. */
  skeleton: boolean;
  onSignIn: () => void;
  helperEnabled: boolean;
  docUrl: string;
  agentUrl: string;
  appStoreUrl?: string;
  appWaitlistAvailable: boolean;
  postcards: boolean;
  photobook: boolean;
  demo?: DemoDay | null;
  inviteCta: InviteCta;
  planPoint?: string | null;
  planFaq?: { q: string; a: string }[];
  printPrices?: { label: string; price: string }[];
  pricing?: ReactNode;
  orgs?: NavLink[];
  repository?: string;
  credit?: { name: string; url?: string; countryCode?: string };
  legal?: boolean;
};

const WRAP = "mx-auto w-full max-w-7xl px-4 sm:px-8 lg:px-16";

function Dot() {
  return (
    <span
      aria-hidden
      className="mt-2 h-2 w-2 flex-none rounded-full border-[1.5px] border-navy-900 bg-green-500"
    />
  );
}

export function ReaderStrip({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSignIn}
      className="flex w-full flex-wrap justify-center gap-x-2 border-b border-line-quiet bg-surface-subtle px-4 py-2.5
                 text-center text-[15px] text-ink-strong
                 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500"
    >
      <span>{t("landing.readerStrip")}</span>
      <span className="font-bold underline decoration-blue-500 decoration-2 underline-offset-4">
        {t("landing.readerStripAction")}
      </span>
    </button>
  );
}

export default function SignedOut(props: SignedOutProps) {
  const { t } = useI18n();
  const { inviteCta, helperEnabled } = props;
  // The one primary door, the same in the header, the hero, the pricing and
  // the questions: an invite request while signup is invite-only and the
  // request page exists (B2507), otherwise `/welcome` — where the helper can
  // write. With the helper off there is no hosted way in, and the agent
  // instruction below the hero is the door instead (B694, B751).
  const cta =
    inviteCta === "request"
      ? { href: "/invite", label: t("landing.requestInvite") }
      : helperEnabled
        ? { href: "/welcome", label: t("landing.helperCta") }
        : null;
  const prints = props.postcards || props.photobook;
  const nav: NavLink[] = [
    { href: "#how", label: t("landing.navHow") },
    ...(prints ? [{ href: "#prints", label: t("landing.navPrints") }] : []),
    ...(props.pricing ? [{ href: "#prices", label: t("landing.navPrices") }] : []),
    ...(props.orgs ?? []),
  ];

  return (
    <div className="min-h-full bg-surface-base text-ink-body">
      {props.top}
      <Header {...props} nav={nav} cta={cta} />
      {props.skeleton ? (
        <div aria-hidden className={`${WRAP} animate-pulse space-y-4 py-12`}>
          <div className="h-12 w-2/3 rounded bg-surface-muted" />
          <div className="h-40 rounded-xl bg-surface-muted" />
        </div>
      ) : (
        <main>
          <Hero {...props} cta={cta} />
          {!helperEnabled && (
            <div className={`${WRAP} pb-16`}>
              <div className="max-w-2xl">
                <AgentBlock docUrl={props.docUrl} agentUrl={props.agentUrl} />
                <LandingSteps />
              </div>
            </div>
          )}
          {prints && <Prints {...props} />}
          <How {...props} />
          <Trust />
          {props.pricing}
          <Faq {...props} cta={cta} />
        </main>
      )}
      <Footer {...props} />
    </div>
  );
}

export function Logo({ siteName }: { siteName: string }) {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={38} height={38} className="h-9 w-9" />
      <span className="font-display text-2xl font-semibold text-ink-strong">{siteName}</span>
    </Link>
  );
}

function Header({
  siteName,
  locales,
  onSignIn,
  nav,
  cta,
}: SignedOutProps & { nav: NavLink[]; cta: NavLink | null }) {
  const { t } = useI18n();
  const navLink =
    "whitespace-nowrap text-[15px] font-semibold text-ink-strong hover:underline decoration-blue-500 decoration-2 underline-offset-4 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
  return (
    <header className={`${WRAP} flex items-center justify-between gap-4 py-4 lg:py-5`}>
      <Logo siteName={siteName} />
      <nav aria-label={t("landing.navLabel")} className="hidden items-center gap-6 lg:flex">
        {nav.map((link) => (
          <a key={link.href} href={link.href} className={navLink}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <div className="hidden items-center gap-1 sm:flex">
          <ThemeSwitcher subtle />
          <LocaleSwitcher locales={locales} subtle />
        </div>
        <button type="button" onClick={onSignIn} className={`${PILL_GHOST} ${PILL_SMALL}`}>
          {t("landing.signIn")}
        </button>
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
              <a key={link.href} href={link.href} className={`${navLink} flex min-h-11 items-center px-2`}>
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

function Hero(props: SignedOutProps & { cta: NavLink | null }) {
  const { demo, appStoreUrl, appWaitlistAvailable, cta } = props;
  const { t } = useI18n();
  const hero = landingHero(t, props);
  const points = hero.points;
  return (
    <section
      className={`${WRAP} grid items-center gap-10 pb-16 pt-6 sm:pt-10 lg:grid-cols-2 lg:gap-16 lg:pb-24 lg:pt-14`}
    >
      <div className="flex flex-col gap-5 lg:gap-6">
        <p className={KICKER}>{hero.kicker}</p>
        <h1 className="font-display text-[clamp(2.4rem,7vw,4.25rem)] font-semibold leading-[1.06] text-ink-strong">
          {hero.title}
        </h1>
        <p className="max-w-[32ch] text-lg leading-relaxed lg:text-xl">{hero.lede}</p>
        {(cta || demo) && (
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-3.5">
            {cta && (
              <Link href={cta.href} className={PILL_PRIMARY}>
                {cta.label}
              </Link>
            )}
            {demo && (
              <Link href={demo.journalHref} className={PILL_GHOST}>
                {t("landing.demoLink")}
              </Link>
            )}
          </div>
        )}
        <AppWaitlistDoor storeUrl={appStoreUrl} waitlistAvailable={appWaitlistAvailable} />
        <ul className="flex flex-col gap-1.5 text-[15px]">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5">
              <Dot />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      {demo && <DemoCard demo={demo} />}
    </section>
  );
}

/** A real published day, and the email its readers got — B2506. `id` is the
 * target /tour-operators' "Read a real trip" links to (B2450). */
function DemoCard({ demo }: { demo: DemoDay }) {
  const { t } = useI18n();
  return (
    <div id="journals" className="relative scroll-mt-4 lg:min-h-[40rem]">
      <Link
        href={demo.href}
        className="block overflow-hidden rounded-[22px] border border-line-quiet bg-surface-raised shadow-[0_30px_60px_-30px_rgba(30,41,59,.45)]
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 lg:absolute lg:right-0 lg:top-0 lg:w-[31rem]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterSrc(demo.photo.src, 1024)}
          alt={demo.photo.alt}
          className="block h-56 w-full object-cover sm:h-64"
        />
        <div className="flex flex-col gap-2 px-5 pb-6 pt-5 sm:px-6">
          <p className={KICKER}>
            {demo.date} · {demo.location}
          </p>
          <h2 className="font-display text-2xl font-semibold leading-tight text-ink-strong sm:text-3xl">{demo.title}</h2>
          <p className="text-base leading-relaxed">{demo.excerpt}</p>
          <p className="text-[13px] text-ink-secondary">{t("landing.demoFrom", { trip: demo.tripTitle })}</p>
        </div>
      </Link>
      <div
        aria-hidden
        // B2519: a faint cream edge, lighter navy over the card — lost on the
        // cream page, the only edge it has on the navy one.
        className="mt-4 flex max-w-72 flex-col gap-1.5 rounded-[18px] border border-cream-50/20 bg-navy-900 px-4 py-4 text-cream-50 shadow-[0_20px_40px_-20px_rgba(30,41,59,.6)]
                   lg:absolute lg:bottom-0 lg:left-0 lg:mt-0"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-cream-200">
          {t("landing.demoMailKicker")}
        </span>
        <b className="text-base">{t("landing.demoMailTitle", { title: demo.title })}</b>
        <span className="text-sm text-navy-300">{t("landing.demoMailBody")}</span>
      </div>
    </div>
  );
}

function Prints(props: SignedOutProps) {
  const { demo, photobook, printPrices } = props;
  const { t } = useI18n();
  const block = landingPrints(t, props);
  if (!block) return null;
  return (
    <section
      id="prints"
      className={`${WRAP} grid scroll-mt-4 items-center gap-10 py-16 lg:grid-cols-2 lg:gap-[4.5rem] lg:py-26`}
    >
      {demo ? (
        <div aria-hidden className="relative h-[20rem] sm:h-[27.5rem]">
          {photobook && (
            <div className="absolute left-2 top-2 flex h-[18rem] w-[60%] flex-col overflow-hidden rounded-l-md rounded-r-xl bg-navy-900 shadow-[0_30px_50px_-24px_rgba(30,41,59,.55)] sm:left-5 sm:h-[25rem] sm:w-[20.5rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={posterSrc(demo.cover.src, 640)} alt="" className="block h-[75%] w-full object-cover" />
              <div className="px-4 py-3 font-display text-lg font-semibold leading-tight text-cream-50 sm:px-5 sm:text-[22px]">
                {demo.tripTitle}
              </div>
            </div>
          )}
          {demo.postcard && (
            <div className="absolute bottom-0 right-1 w-[62%] rotate-3 rounded-lg bg-white p-2.5 shadow-[0_24px_40px_-20px_rgba(30,41,59,.5)] sm:right-2.5 sm:w-[18.75rem] sm:p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={posterSrc(demo.postcard.src, 640)}
                alt=""
                className="block aspect-[148/105] w-full rounded object-cover"
              />
              <div className="pt-2 text-[13px] text-navy-900">{demo.postcard.title}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="hidden lg:block" />
      )}
      <div className="flex flex-col gap-5">
        <p className={KICKER}>{block.kicker}</p>
        <h2 className="font-display text-[clamp(2rem,5vw,2.75rem)] font-semibold leading-[1.08] text-ink-strong">
          {block.title}
        </h2>
        <p className="max-w-[38ch] text-lg">{block.body}</p>
        {printPrices && printPrices.length > 0 && (
          <ul className="flex flex-col border-t border-line-quiet">
            {printPrices.map((row) => (
              <li key={row.label} className="flex justify-between gap-4 border-b border-line-quiet py-3">
                <span>{row.label}</span>
                <b className="whitespace-nowrap tabular-nums text-ink-strong">{row.price}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function How(props: SignedOutProps) {
  const { t } = useI18n();
  const how = landingHow(t, props);
  const steps = how.steps;
  return (
    <section id="how" className="scroll-mt-4 border-y border-line-quiet bg-surface-raised py-16 lg:py-22">
      <div className={`${WRAP} flex flex-col gap-10`}>
        <div className="flex flex-col gap-3">
          <p className={KICKER}>{how.kicker}</p>
          <h2 className="max-w-[20ch] font-display text-[clamp(2rem,5vw,2.75rem)] font-semibold leading-[1.08] text-ink-strong">
            {how.title}
          </h2>
        </div>
        <ol className="grid gap-4 md:grid-cols-3 md:gap-6">
          {steps.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-3 rounded-[22px] bg-surface-base p-6 lg:p-7">
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-full bg-yellow-400 font-display text-[22px] font-semibold text-navy-900"
              >
                {i + 1}
              </span>
              <h3 className="font-display text-2xl font-semibold text-ink-strong">{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Trust() {
  const { t } = useI18n();
  const cards = landingTrust(t);
  return (
    <section className={`${WRAP} py-16 lg:pb-26`}>
      <ul className="grid gap-4 md:grid-cols-3 md:gap-6">
        {cards.map((card) => (
          <li key={card.title} className="flex flex-col gap-2.5 rounded-[22px] border border-line-quiet bg-surface-raised p-6 lg:p-7">
            <h3 className="font-display text-[22px] font-semibold leading-tight text-ink-strong">{card.title}</h3>
            <p>
              {card.body}
              {card.link && (
                <>
                  {" "}
                  <Link href="/docs" className={TEXT_LINK}>
                    {card.link}
                  </Link>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Faq(props: SignedOutProps & { cta: NavLink | null }) {
  const { cta, demo } = props;
  const { t } = useI18n();
  const faq = landingFaq(t, props);
  const items = faq.items;
  return (
    <section className={`${WRAP} flex flex-col gap-9 py-16 lg:py-24`}>
      <h2 className="font-display text-[clamp(1.9rem,4.5vw,2.5rem)] font-semibold leading-[1.1] text-ink-strong">
        {faq.title}
      </h2>
      <dl className="grid gap-x-14 gap-y-7 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.q} className="flex flex-col gap-1.5">
            <dt className="font-display text-[21px] font-semibold leading-snug text-ink-strong">{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>
      {(cta || demo) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {cta && (
            <Link href={cta.href} className={PILL_PRIMARY}>
              {cta.label}
            </Link>
          )}
          {demo && (
            <Link href={demo.journalHref} className={TEXT_LINK}>
              {t("landing.demoLink")}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function Footer({ siteName, onSignIn, orgs, repository, legal, credit }: SignedOutProps) {
  const { t } = useI18n();
  const link =
    "text-[15px] text-cream-50 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
  const heading = "font-mono text-xs uppercase tracking-[0.08em] text-navy-300";
  const madeBy = credit
    ? t("landing.madeBy", { flag: flagFor("", credit.countryCode) || "", name: "\u0000" }).split("\u0000")
    : null;
  return (
    <footer className="bg-navy-900 text-navy-300">
      <div className={`${WRAP} grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:pb-12 lg:pt-16`}>
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
          <button type="button" onClick={onSignIn} className={link}>
            {t("landing.footerSignIn")}
          </button>
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
          {legal && (
            <Link href="/legal" className={link}>
              {t("landing.legal")}
            </Link>
          )}
        </div>
      </div>
      <div className={`${WRAP} flex flex-wrap gap-x-4 gap-y-1 border-t border-navy-700 py-5 text-xs text-navy-300`}>
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
