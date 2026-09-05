"use client";

import { useEffect, useState } from "react";
import {
  AgentBlock,
  Colophon,
  DocsLink,
  LandingHero,
  LandingSteps,
  PublicJournals,
  ReaderInvite,
  SiteHeader,
  type PublicJournal,
} from "@/components/LandingSections";
import {
  YourDevices,
  YourJournals,
  type HomeDevice,
  type HomeJournal,
} from "@/components/HomeJournals";
import IdentitySignIn from "@/components/IdentitySignIn";
import { useI18n } from "@/components/LocaleProvider";

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

type Home = {
  id: string | null;
  email: string;
  journals: HomeJournal[];
  devices: HomeDevice[];
};

/**
 * Whether this browser was signed in last time it looked.
 *
 * Not a credential and not trusted as one — the server decides, every time,
 * and the worst a forged value can do is show a skeleton to a stranger for one
 * network round trip. What it buys is the absence of a flash: without it, a
 * signed-in reader sees the marketing hero and then watches it be replaced by
 * their own journals, every single load.
 */
const SEEN_KEY = "fs-home-signed-in";

type Phase = "unknown" | "out" | "in";

export default function Landing({
  siteName,
  docUrl,
  agentUrl,
  journals,
  locales,
  repository,
  credit,
  codeMinutes,
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
  /** Who runs it, if this instance says. */
  credit?: { name: string; url?: string; countryCode?: string };
  /** How long a sign-in code lasts, from `CODE_TTL_MINUTES` — B426. Passed
   * because this is a client component and `lib/auth` is server-only. */
  codeMinutes: string;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("unknown");
  const [home, setHome] = useState<Home | null>(null);
  // Read once, before the fetch resolves, to decide what to show meanwhile.
  const [expected] = useState(() =>
    typeof window === "undefined" ? false : window.localStorage.getItem(SEEN_KEY) === "1",
  );
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/me/home", { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          // 401 is the ordinary answer for a stranger, and also what a revoked
          // identity gets. Both mean the same thing to this page and to the
          // remembered flag: not signed in.
          window.localStorage.removeItem(SEEN_KEY);
          setPhase("out");
          return;
        }
        const data = (await res.json()) as Home;
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

  const header = <SiteHeader siteName={siteName} locales={locales} />;
  const publicList = <PublicJournals journals={journals} />;
  const colophon = <Colophon repository={repository} credit={credit} />;

  if (phase === "in" && home) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
        {header}
        <YourJournals email={home.email} journals={home.journals} />
        {publicList}
        {/* The agent block, retitled. Somebody who already has a journal is
            not being pitched — they are being handed the line they paste in
            when they want to write today's day. */}
        <div className="mt-12 border-t border-navy-200 pt-8">
          <AgentBlock docUrl={docUrl} agentUrl={agentUrl} heading={t("home.agentTitle")} />
          <DocsLink />
        </div>
        <YourDevices
          devices={home.devices}
          onRevoke={(id) =>
            setHome((prev) =>
              prev ? { ...prev, devices: prev.devices.filter((d) => d.id !== id) } : prev,
            )
          }
        />
        {colophon}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      {header}
      {/*
        The reader's half of the page, and it comes first — B427.

        Two people arrive at the bare domain and only one of them was ever
        addressed here. The card names the other one in their own words
        ("a guest, or you were on the trip yourself") so they can recognise
        themselves without knowing what a journal, a trip or a grant is, and
        the form replaces it in place rather than moving them to another page:
        somebody who has already lost one link should not be asked to follow
        another.
      */}
      {signingIn ? (
        <IdentitySignIn
          codeMinutes={codeMinutes}
          // The cookie is set by the server and this page renders from it, so
          // a reload rather than a state flip — the same reason `GuestSignIn`
          // reloads. What comes back is the signed-in order of this page.
          onDone={() => window.location.reload()}
        />
      ) : (
        offerSignIn && <ReaderInvite onSignIn={() => setSigningIn(true)} />
      )}
      {phase === "unknown" && expected ? (
        /* A browser that was signed in a moment ago, waiting on the fetch.
           Two grey blocks rather than the hero: showing the pitch here and
           swapping it out is the flash this exists to prevent. */
        <div aria-hidden className="mt-6 animate-pulse space-y-4">
          <div className="h-9 w-2/3 rounded bg-cream-100" />
          <div className="h-24 rounded-xl bg-cream-100" />
          <div className="h-24 rounded-xl bg-cream-100" />
        </div>
      ) : (
        <>
          <LandingHero />
          <AgentBlock docUrl={docUrl} agentUrl={agentUrl} />
          <LandingSteps />
          <DocsLink />
        </>
      )}
      {publicList}
      {colophon}
    </main>
  );
}
