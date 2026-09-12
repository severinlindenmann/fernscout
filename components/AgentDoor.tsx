"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentBlock, OrDivider, WhatsAppButton } from "@/components/LandingSections";
import BackLink from "@/components/BackLink";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import IdentitySignIn from "@/components/IdentitySignIn";
import SignupWizard from "@/components/SignupWizard";
import { useI18n } from "@/components/LocaleProvider";
import ChatVignette from "@/components/ChatVignette";
import { JOURNAL_COOKIE } from "@/lib/requestKeys";

/**
 * The door at `/agent`, signed out and signed in — B681.
 *
 * **Signed out**, the page has exactly two things to offer, because nothing
 * past this door exists yet: `IdentitySignIn`, the same instance-wide
 * six-digit-code flow `/` uses (not `GuestSignIn` — there is no journal in
 * the URL to sign into one of), and the bring-your-own-agent panel, which
 * cannot know a journal yet either and so falls back to the generic
 * `AgentBlock` — the base URL and the guide, nothing personal.
 *
 * **Signed in**, a reader who already owns a journal goes straight into
 * `SignupWizard`'s onboarding flow toward `/agent/<user>` — the same wizard a
 * signed-*out* visitor sees below `IdentitySignIn` — or, with `signup` off,
 * a plain sentence. B984 deleted the per-journal card this page used to draw
 * here (a heading, a resume button, the ask box and `AgentHandover`); nothing
 * on this page is specific to a journal any more.
 *
 * A signed-in reader who owns no journal gets `SignupWizard` in place of the
 * plain sentence, where `signup` is on — B688: email and code (skipped where
 * an identity cookie already proved the address, though a signup token still
 * needs its own fresh code), a journal name and address, and a first trip,
 * ending signed in and inside `/agent/<user>`. The same wizard is what a
 * signed-*out* visitor sees below `IdentitySignIn`, since an identity proves
 * an address and grants nothing — it is never a journal on its own. Off, both
 * places fall back to a plain sentence rather than a form that cannot work.
 */
export default function AgentDoor({
  docUrl,
  agentUrl,
  codeMinutes,
  signedIn,
  identityEmail,
  signupEnabled,
  siteName,
  whatsappNumber,
}: {
  docUrl: string;
  agentUrl: string;
  /** How long a sign-in code lasts, from `CODE_TTL_MINUTES` — passed rather
   * than imported because `lib/auth` is server-only. */
  codeMinutes: string;
  /** Whether the request carried a live `fs_identity` cookie. */
  signedIn: boolean;
  /** The address behind that cookie, prefilled into the signup wizard so a
   * visitor who already proved it once is not asked to type it again — B688. */
  identityEmail: string | null;
  /** Whether `signup` is on for this instance — B688. Off is absent rather
   * than broken: no form, a plain sentence instead. */
  signupEnabled: boolean;
  /** For the back link's own label — B1121. `app/agent/layout.tsx` used to
   *  draw this above every page under `/agent`; it draws nothing now, so the
   *  door carries its own. */
  siteName: string;
  /**
   * This instance's own `wa.me` number, resolved server-side —
   * `whatsappDisplayNumber()`, B1310. A stranger at this door has no proven
   * number of their own to gate on, unlike `RoomOpening`'s prop of the same
   * name, so the only check is whether the instance has one configured at
   * all. B1314 moved where it is drawn: a third action inside the "do you
   * already have a journal?" card, after the owner rejected the loose line
   * B1310 shipped.
   */
  whatsappNumber?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();

  /** B786 — which of the two forms this visitor is here for. `null` until they
   * say, which is the question itself. Nothing is remembered: a wrong answer
   * is one tap back, and the signup path already tells somebody whose address
   * has no journal so. */
  const [has, setHas] = useState<boolean | null>(null);

  /**
   * Where a brand-new owner lands, the moment they are signed in with a
   * trip already made — B688's whole point: the wizard for the first day,
   * never a second stop to explain what a username was.
   *
   * `/agent` rather than `/agent/<username>` since B1102: signing in used to
   * push straight past the room B984 made the whole of `/agent`, into the
   * wizard behind it. The journal cookie is what `/agent` reads to know whose
   * conversation this is, the same cookie the room's own switcher already
   * writes — set here for the same reason: a signup that just made a second
   * journal must not have `/agent` fall back to the first one it finds.
   */
  function intoTheWizard(username: string) {
    document.cookie = `${JOURNAL_COOKIE}=${encodeURIComponent(username)};path=/;max-age=31536000;samesite=lax`;
    router.push("/agent");
  }

  return (
    // Full-bleed paper ground — B733, the same two-step as `/`: `cream-100`
    // behind, `cream-50` on every card. Scoped to this page.
    //
    // B1325: `min-h-full` resolves against the ancestor chain's height, and
    // neither `html` nor `body` sets one — so on short content (signed out,
    // signup off) this div stopped at its own content height instead of the
    // viewport, and the `body` background (`--background`, `cream-50`) showed
    // through below it as a second, slightly different tone. `min-h-screen`
    // is the idiom every other full-bleed page here already uses instead.
    <div className="min-h-screen bg-cream-100">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 pt-6">
        {/* B1121 — `app/agent/layout.tsx` used to draw this above every page
            under `/agent`; it draws nothing now, so the door carries its own
            way back to the landing page. */}
        <BackLink
          fallbackHref="/"
          fallbackLabel={t("docs.backToSite", { name: siteName })}
          retraceLabel={t("nav.back")}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-700
                     transition-colors hover:text-navy-900
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        />
        {/* The one page a stranger meets first, and it had no language
            control at all — B1184. */}
        <LocaleSwitcher subtle />
      </div>
      <main className="mx-auto max-w-2xl px-6 pb-12 pt-4 sm:pb-16">
        {/* B1329 — the door used to be a title and a card, with nothing to
            show what the product actually is. The chat vignette is that:
            a static, once-only conversation naming a real day and three real
            photographs, arriving bubble by bubble on first paint. */}
        <h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] font-semibold leading-tight text-navy-900">
          {t("agent.chatHeroTitle")}
        </h1>
        <p className="mt-2 max-w-md text-lg leading-7 text-navy-700">
          {t("agent.chatHeroLede")}
        </p>
        <ChatVignette />

        {/* B786 — one question, then one email field.
            Signed out, this screen used to draw `IdentitySignIn` and
            `SignupWizard` one above the other: the same label, the same
            button, the same shape, two centimetres apart, and nothing saying
            which was whose. A 71-year-old tester read both paragraphs three
            times and telephoned her son. Better headings were not the fix —
            two identical forms stay confusing however they are labelled — so
            the screen asks first and shows one.

            With signup switched off there is only ever one form, so there is
            nothing to ask: the question is not drawn at all. */}
        {!signedIn && !signupEnabled && (
          <>
            <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.reload()} />
            <p className="mt-6 text-base leading-7 text-navy-600">{t("agent.signupOff")}</p>
          </>
        )}

        {!signedIn && signupEnabled && (
          <div className="mt-6">
            {has === null ? (
              <section className="rounded-2xl border border-navy-200 bg-cream-50 p-5 sm:p-6">
                <h2 className="font-display text-xl font-semibold text-navy-900">
                  {t("agent.haveJournal")}
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setHas(true)}
                    className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  >
                    {t("agent.haveJournalYes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHas(false)}
                    className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800 transition-colors hover:bg-cream-100"
                  >
                    {t("agent.haveJournalNo")}
                  </button>
                  {/* B1314 — the third answer to the same question, inside
                      the one decision surface the door has, rather than a
                      loose line above it (B1310's shape, which the owner
                      rejected in review). */}
                  {whatsappNumber && (
                    <>
                      <OrDivider />
                      <WhatsAppButton number={whatsappNumber} label={t("agent.doorWhatsapp")} className="w-full" />
                    </>
                  )}
                </div>
              </section>
            ) : has ? (
              // Reloads on success, like the same form on `/` — the page
              // re-renders from the cookie the server just set rather than the
              // client pretending to know what it now opens.
              <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.reload()} />
            ) : (
              /* B688: a visitor with no journal completes the whole of signup
                 right here — email, a name, an address, a first trip — and
                 never sees `/welcome`, which was written for somebody who
                 already knows what this is.

                 `onAlreadyOwns` — B1568: the wizard's own code step now finds
                 out when the proven address already owns a journal, and the
                 way forward from there is the sign-in form, the same one the
                 "yes" answer above shows. */
              <SignupWizard
                email={identityEmail ?? undefined}
                locale={locale}
                codeMinutes={codeMinutes}
                onSignedIn={intoTheWizard}
                onAlreadyOwns={() => setHas(true)}
              />
            )}

            {/* Choosing wrongly costs one tap and no reload — which is what
                makes asking safe to ask. */}
            {has !== null && (
              <button
                type="button"
                onClick={() => setHas(null)}
                className="mt-3 min-h-11 text-base text-navy-600 underline underline-offset-4 hover:text-navy-900"
              >
                {t("agent.haveJournalAgain")}
              </button>
            )}
          </div>
        )}

        {signedIn &&
          (signupEnabled ? (
            <div className="mt-6">
              {/* `has` doubles as the escape hatch here too — B1568: an
                  identity whose journal-owning address is a *different* one
                  still reaches the wizard, and the wizard's code step may
                  find that address already owns a journal. The way forward
                  is signing in as it, exactly as in the signed-out branch. */}
              {has === true ? (
                <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.reload()} />
              ) : (
                <SignupWizard
                  email={identityEmail ?? undefined}
                  locale={locale}
                  codeMinutes={codeMinutes}
                  onSignedIn={intoTheWizard}
                  onAlreadyOwns={() => setHas(true)}
                />
              )}
            </div>
          ) : (
            <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-50 p-5 text-base leading-7 text-navy-800 sm:p-6">
              {t("agent.noJournal")}
            </p>
          ))}


        {/* B1329 — the door used to scatter "why?", the demo trigger and the
            bring-your-own-agent line above and below the card, three
            differently-styled underlined links a reader met at three
            different moments. They fold into one quiet line under the card
            instead. The owner then dropped "why?" and the demo from it
            entirely (2026-09-10) — the vignette above does their job now;
            only the own-agent guide (B751/B804) remains. */}
        <div className="mt-6 text-sm text-navy-600">
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-navy-600 underline underline-offset-4">
              {t("agent.ownAgentOptional")}
            </summary>
            <AgentBlock docUrl={docUrl} agentUrl={agentUrl} />
          </details>
        </div>
      </main>
    </div>
  );
}
