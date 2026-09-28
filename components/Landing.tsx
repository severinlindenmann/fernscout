"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, CircleUserRound } from "lucide-react";
import { AgentBlock, PublicJournals, type PublicJournal } from "@/components/LandingSections";
import SignedOut, { ReaderStrip, type InviteCta, type NavLink } from "@/components/landing/SignedOut";
import { Footer, Stripe, TAB_BAR_ROOM } from "@/components/landing/Frame";
import { WIDE } from "@/components/landing/kit";
import type { DemoDay } from "@/lib/demoDay";
import SignedInHome from "@/components/home/SignedInHome";
import SignedInHeader from "@/components/home/SignedInHeader";
import IdentitySignIn from "@/components/IdentitySignIn";
import ServerChoice from "@/components/ServerChoice";
import { useI18n } from "@/components/LocaleProvider";
import { SEEN_KEY, probeHome, type HomePayload } from "@/lib/homeProbe";

export type { PublicJournal };

/**
 * The root page — two orders of the same sections, B411.
 *
 * **Signed out** it is what it has always been: written for the person who is
 * *not* the audience of the rest of the site. Readers arrive at
 * `/alex/day/hoi-an` from a link in an email and never see this; whoever lands
 * on the bare domain is deciding whether to use the thing. So it opens with
 * what you actually hand over rather than a sales line.
 *
 * **Signed in** the order inverts, because the question has. Somebody who owns
 * a journal here, or has been let into two, does not need to be told what
 * Fernscout is — they need to know what they can open. So: their journals, the
 * public ones, then the agent instruction, then their devices. This is also
 * the installed PWA's first screen, whose `start_url` is `/`; before this it
 * launched into the pitch.
 *
 * ## Why the personal half is fetched rather than rendered
 *
 * The page holds no personal data, which is what lets B412 cache it for
 * everybody and keep the reader's own list in a separate, identity-keyed
 * cache. Server-rendering the journals into `/` would make the whole document
 * one reader's and uncacheable — and one mistake in a `Cache-Control` header
 * away from being served to the next person on a shared phone.
 */


type Phase = "unknown" | "out" | "in";

export default function Landing({
  siteName,
  docUrl,
  agentUrl,
  journals,
  locales,
  repository,
  credit,
  legal,
  codeMinutes,
  helperEnabled = false,
  appStoreUrl,
  appWaitlistAvailable = false,
  postcardsEnabled = false,
  photobookEnabled = false,
  signupEnabled = false,
  pricing,
  demo,
  inviteCta = "welcome",
  planPoint,
  planFaq,
  printPrices,
  orgs,
}: {
  siteName: string;
  docUrl: string;
  /** The full guide, with every call. B261: named alongside `docUrl` in the
   * same instruction so a fetcher that only follows URLs it was handed
   * directly — never one discovered inside a fetched page — can still reach
   * it, because both arrived in the sentence the owner pasted. */
  agentUrl: string;
  journals: PublicJournal[];
  /** The interface languages this instance offers. Outside a journal there is
   * nobody whose list to use, so it is the maintained set — see
   * `installedLocales()`. */
  locales?: string[];
  /** Where the source lives, if this instance says. */
  repository?: string;
  /** Whether `/legal` exists on this instance — see lib/legal.ts. */
  legal?: boolean;
  /** Who runs it, if this instance says. */
  credit?: { name: string; url?: string; countryCode?: string };
  /** How long a sign-in code lasts, from `CODE_TTL_MINUTES` — B426. Passed
   * because this is a client component and `lib/auth` is server-only. */
  codeMinutes: string;
  /** Whether `/agent` can actually write on this instance — B694. Decides
   * whether the hero's primary door is the hosted wizard or the
   * bring-your-own instruction box, further down either way. Defaults to
   * off, which is every instance's answer today. */
  helperEnabled?: boolean;
  /** B2341. Both resolved server-side in `app/page.tsx` and handed straight
   *  to `LandingHero`'s own `AppWaitlistDoor`. */
  appStoreUrl?: string;
  appWaitlistAvailable?: boolean;
  /**
   * Whether this instance can actually print and post a card, and lay a trip
   * out as a book — B1711. They are two of the three things the pitch below
   * the hero is made of, and a card claiming either on an instance that has
   * the capability switched off is the one kind of untruth this page cannot
   * afford: its whole audience is people deciding whether to trust it.
   * Resolved server-side in `app/page.tsx` like every other gate here.
   */
  postcardsEnabled?: boolean;
  photobookEnabled?: boolean;
  /** Whether anybody may start a journal here (`isEnabled("signup")`) —
   * B2508's "Travelling yourself soon?" card links to `/welcome` only then. */
  signupEnabled?: boolean;
  /** The pricing table, rendered by the page and handed over — B840. A server
   * component (`paid/credits/components/Pricing.tsx`) because every price it prints is
   * read from the `server-only` module that charges it, which is why it
   * arrives as an element rather than as data. `null` on an instance with
   * credits switched off, where nothing costs anything. */
  pricing?: ReactNode;
  /** The same two doors as data, for the signed-out nav and footer — B2506.
   * Empty in a public build. */
  orgs?: NavLink[];
  /** A real published day for the hero — `lib/demoDay.ts`, B2506. */
  demo?: DemoDay | null;
  /** Which door the primary button opens — see `SignedOut`. */
  inviteCta?: InviteCta;
  /** Plan facts and today's print prices, as data from `paid/credits` —
   * absent in a public build or with credits off. B2506. */
  planPoint?: string | null;
  planFaq?: { q: string; a: string }[];
  printPrices?: { label: string; price: string }[];
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("unknown");
  const [home, setHome] = useState<HomePayload | null>(null);
  /**
   * Read *after* the first render, not during it — B454.
   *
   * This began as a `useState` initialiser, which is a hydration bug: the
   * server has no `localStorage`, so it renders `false`, and a browser that
   * was signed in last time renders `true` on its very first pass. React sees
   * two different trees for the same render and discards the server's HTML —
   * "Minified React error #418", once per load, for exactly the readers this
   * flag exists to help.
   *
   * The cost of moving it into an effect is one extra paint before the
   * skeleton appears, which nobody can see. What it buys back is the thing
   * the flag was *for*: React keeping the server's markup instead of throwing
   * it away and rebuilding, which is a far bigger flash than the one being
   * avoided.
   */
  const [expected, setExpected] = useState(false);
  useEffect(() => {
    // Reading a browser store is exactly the "synchronise with an external
    // system" case the rule exempts in prose but cannot detect; the same
    // disable sits on `CurrencyProvider`, which adopts a stored currency the
    // same way and for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpected(window.localStorage.getItem(SEEN_KEY) === "1");
  }, []);
  const [signingIn, setSigningIn] = useState(false);

  /**
   * `?start=1` opens the sign-in card without a click — B1905.
   *
   * `ShowcaseBar`'s "Start your journal" button lives on a different page
   * (a showcase journal, not this one) and cannot reach `setSigningIn`
   * directly, so it links here instead and this reads the one thing a URL
   * can carry. Not a new auth path: the form it opens is the exact
   * `IdentitySignIn` a click on `ReaderInvite` opens too. Harmless if the
   * reader turns out to already be signed in — this only feeds the branch
   * below that is itself skipped once `phase` becomes `"in"`.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("start") === "1") setSigningIn(true);
  }, []);

  useEffect(() => {
    let live = true;
    // The journal-session upgrade (B1493) lives in `probeHome`, shared with
    // `/me`, which asks the same question.
    probeHome(() => live)
      .then((data) => {
        if (!live) return;
        if (!data?.id) {
          window.localStorage.removeItem(SEEN_KEY);
          setPhase("out");
          return;
        }
        window.localStorage.setItem(SEEN_KEY, "1");
        setHome(data);
        setPhase("in");
      })
      .catch(() => {
        // Offline, or the endpoint is unreachable. The landing page is the
        // honest fallback: it needs nothing from the server and is true for
        // everybody, where a half-rendered personal view would not be.
        if (live) setPhase("out");
      });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Whether to offer the way in — B426, made prominent by B427.
   *
   * Shown once we know nobody is signed in, and *also* while the answer is
   * still unknown on a browser that was not signed in last time. Waiting for
   * the fetch in that case would mean a first-time visitor — the whole
   * audience of this card — gets a beat with no door on it.
   *
   * The `expected` guard is what keeps that from flashing at somebody who is
   * signed in: a browser that was signed in a moment ago waits for the real
   * answer, which is the same trade the skeleton below makes.
   */
  const offerSignIn = phase === "out" || (phase === "unknown" && !expected);

  const publicList = <PublicJournals journals={journals} />;

  if (phase === "in" && home) {
    return (
      // B2508: a wide page on the cream ground, the boards' own — the
      // continue card and the trip grid need the width a 672px column
      // denied them.
      // B2519: the owner's header and, on a phone, a tab bar whose height
      // (plus the iPhone's safe area) the page reserves so nothing sits
      // under it.
      <div
        className={`flex min-h-full flex-col bg-surface-base ${
          home.journals.some((j) => j.role === "owner") ? TAB_BAR_ROOM : ""
        }`}
      >
        <Stripe />
        <SignedInHeader
          siteName={siteName}
          locales={locales}
          email={home.email}
          admin={home.admin}
          journals={home.journals}
          prints={postcardsEnabled || photobookEnabled}
        />
        <main id="main" className={`${WIDE} flex-1 py-6 sm:py-10`}>
          <SignedInHome
            journals={home.journals}
            photobookEnabled={photobookEnabled}
            signupEnabled={signupEnabled}
          />
          {/*
            B797: the write call to action, its paragraph, the agent
            disclosure and the docs link used to sit here for every signed-in
            reader — a second copy of what the header now carries on every
            page (`PageHeader`'s Agent and Docs symbols), on the one page
            whose reader least needs to be sold: they already have a journal.
            With the helper on, the header's door replaces this outright.
            With it off there is no header door to replace it — every
            self-hoster has it off — so the bring-your-own-agent material
            stays, for exactly the reader B751 wrote it for: one who owns no
            journal yet.
          */}
          {!helperEnabled && !home.journals.some((journal) => journal.role === "owner") && (
            <div className="mt-12 border-t border-line-quiet pt-8">
              <AgentBlock docUrl={docUrl} agentUrl={agentUrl} heading={t("home.agentTitle")} />
            </div>
          )}
          {/* Devices, sign-out and everything else about the person rather
              than a journal live on `/me` now — reached from the header's
              account chip, and as a row card here for anybody who does not
              read a chip as a door — B2532's row, same shape as every other
              card on this page rather than an underlined sentence. */}
          <Link
            href="/me"
            className="mt-12 flex items-center gap-4 rounded-3xl border border-surface-muted bg-surface-raised px-5 py-4
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <span aria-hidden className="grid size-11 flex-none place-items-center rounded-xl bg-surface-subtle">
              <CircleUserRound className="size-6 text-ink-strong" strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-display text-lg font-semibold text-ink-strong">{t("home.account.title")}</span>
              <span className="text-sm text-ink-body">{t("home.account.body")}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 flex-none text-ink-strong" />
          </Link>
          {/* B2532: the last section of the page, just above the footer —
              this instance's own journals matter least to somebody who
              already has one of their own. */}
          {publicList}
          {/* Inside the iPhone app only: which server it is talking to. */}
          <ServerChoice signedIn />
        </main>
        {/* B2531: the one footer, instead of the old two-column colophon. */}
        <Footer siteName={siteName} orgs={orgs} repository={repository} credit={credit} legal={legal} />
      </div>
    );
  }

  return (
    <>
      <SignedOut
        siteName={siteName}
        locales={locales}
        // The reader's way in, first and slim — B427's fork, redrawn by
        // B2506. The form replaces the strip in place rather than moving
        // them to another page.
        top={
          signingIn ? (
            <div className="mx-auto max-w-2xl px-4 py-6">
              <IdentitySignIn
                codeMinutes={codeMinutes}
                // The cookie is set by the server and this page renders from
                // it, so a reload rather than a state flip.
                onDone={() => window.location.reload()}
              />
            </div>
          ) : (
            offerSignIn && <ReaderStrip onSignIn={() => setSigningIn(true)} />
          )
        }
        // A browser that was signed in a moment ago, waiting on the fetch:
        // grey blocks rather than the pitch, which would flash and vanish.
        skeleton={phase === "unknown" && expected}
        onSignIn={() => setSigningIn(true)}
        helperEnabled={helperEnabled}
        docUrl={docUrl}
        agentUrl={agentUrl}
        appStoreUrl={appStoreUrl}
        appWaitlistAvailable={appWaitlistAvailable}
        postcards={postcardsEnabled}
        photobook={photobookEnabled}
        demo={demo}
        inviteCta={inviteCta}
        planPoint={planPoint}
        planFaq={planFaq}
        printPrices={printPrices}
        pricing={pricing}
        orgs={orgs}
        repository={repository}
        credit={credit}
        legal={legal}
      />
      {/* Inside the iPhone app only, and only once we know nobody is
          signed in: point the app at the reader's own server. */}
      {phase === "out" && <ServerChoice signedIn={false} />}
    </>
  );
}
