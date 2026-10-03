import JournalLocaleProvider from "@/components/JournalLocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";
import StudioSignIn from "@/components/studio/StudioSignIn";
import { TITLE_H1 } from "@/components/landing/kit";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { resolveAccess } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";
import { offlineKeepTrips } from "@/lib/studio/day";

/**
 * One `StudioBarProvider` over every studio page — B2001.
 *
 * The provider itself renders the page's children, then one `ActionBar` as
 * the last node — see `StudioBar.tsx`'s own doc comment for why every
 * studio subpage now gets a bottom bar without rendering one itself, and
 * why the four pages that already had one (`useStudioBar`'s callers) still
 * control it fully.
 *
 * Under the studio's own strings: the journal layout ships a reader's, and
 * the studio's flows are most of the dictionary (`lib/localeScopes.json`).
 *
 * B2330, D6 — `offlineKeepTrips` names the current trip and the soonest
 * upcoming one, read here once per navigation into the studio rather than
 * through a new route: the provider is already the one client component
 * every studio page mounts, so it is where "the studio is open" already
 * means something.
 */
export default async function StudioLayout({ children, params }: LayoutProps<"/at/[user]/studio">) {
  const { user } = await params;
  /**
   * B-2779. Nobody signed in at all: one generic sign-in card, the same bytes
   * for a journal that exists and one that does not (B1829's no-oracle rule
   * holds — it names no journal). Anyone signed in falls through to each
   * page's own gate, so a non-owner still gets the 404.
   */
  if (isEnabled("auth") && (await resolveAccess(user)).email === null) {
    const locale = await requestLocale();
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className={TITLE_H1}>{translateIn(locale, "err.notSignedInTitle")}</h1>
        <StudioSignIn codeMinutes={CODE_TTL_MINUTES} />
      </main>
    );
  }
  return (
    <JournalLocaleProvider username={user} scope="studio">
      <StudioBarProvider username={user} autoKeepTrips={offlineKeepTrips(user)}>
        {children}
      </StudioBarProvider>
    </JournalLocaleProvider>
  );
}
