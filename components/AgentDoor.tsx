"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AgentHandover from "@/components/AgentHandover";
import HelperAsk from "@/components/HelperAsk";
import { AgentBlock } from "@/components/LandingSections";
import IdentitySignIn from "@/components/IdentitySignIn";
import SignupWizard from "@/components/SignupWizard";
import { useI18n } from "@/components/LocaleProvider";
import Why from "@/components/Why";
import type { WizardDraft } from "@/lib/helper/draft";

export type AgentJournal = {
  username: string;
  title: string;
  /** Everything unfinished in this journal, newest first — B682's resume card.
   * Empty for a journal with nothing waiting, which is the ordinary case. */
  drafts: WizardDraft[];
  /** Whether the `helper` capability is on for this journal — B685. Off, the
   * ask box is absent and the buttons below it are the whole interface. */
  helper: boolean;
  /** Whether this journal has already agreed to a model being spoken to. */
  consented: boolean;
  /** Whether the `transcription` capability is on, and whether the journal has
   * agreed to its owner's voice being sent — B686. Both separate from the two
   * above: speech is a second provider and its own switch. */
  speech: boolean;
  consentedSpeech: boolean;
  /** Who a recording actually goes to — `speechProvider()`, read on the
   *  server — so the consent panel names the real backend rather than
   *  assuming Deepgram (B744). */
  speechProvider: string;
  /** What this journal has left, or `null` where credits are switched off —
   * `balanceOf()`. Read here only so the card can say when it is nearly gone
   * (B767); the number itself lives on the account page, and no button on
   * this screen carries a price. */
  credits: number | null;
};

/** Below this, and only below this, the balance is worth a line on the door.
 * A day costs nothing to write; what runs out is the model and the
 * microphone, and five is about two of those. */
const LOW_CREDITS = 5;

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
 * **Signed in**, each owned journal gets its own card: a heading naming it,
 * one bright button into the wizard B682 built at `/agent/<user>` — the only
 * bright thing on the card, and the whole of B767's answer to a screen that
 * asked for four decisions before anybody had done anything — then the ask
 * box, quietly, then whatever else is unfinished, and — this is the same
 * panel, now that a journal is known —
 * `AgentHandover`
 * in place of the generic block, because `AgentHandover` already builds
 * exactly what the ticket asks for: a starter prompt from the journal, the
 * site's base URL and a minted handover credential. There is deliberately no
 * second, separate "bring your own agent" panel once a journal is known; one
 * panel that gets more specific as more is known is the point.
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
  siteUrl,
  docUrl,
  agentUrl,
  codeMinutes,
  signedIn,
  identityEmail,
  signupEnabled,
  journals,
}: {
  /** This instance's public base URL, from server config. */
  siteUrl: string;
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
  /** The reader's own journals — `role: "owner"` only, see the page. */
  journals: AgentJournal[];
}) {
  const { t, tn, locale, formatLongDate } = useI18n();
  const router = useRouter();

  /** B786 — which of the two forms this visitor is here for. `null` until they
   * say, which is the question itself. Nothing is remembered: a wrong answer
   * is one tap back, and the signup path already tells somebody whose address
   * has no journal so. */
  const [has, setHas] = useState<boolean | null>(null);

  /** Where a brand-new owner lands, the moment they are signed in with a
   * trip already made — B688's whole point: the wizard for the first day,
   * never a second stop to explain what a username was. */
  function intoTheWizard(username: string) {
    router.push(`/agent/${encodeURIComponent(username)}`);
  }

  return (
    // Full-bleed paper ground — B733, the same two-step as `/`: `cream-100`
    // behind, `cream-50` on every card. Scoped to this page.
    <div className="min-h-full bg-cream-100">
      <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
        <h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] font-semibold leading-tight text-navy-900">
          {t("agent.title")}
        </h1>
        <p className="mt-3 text-lg leading-7 text-navy-700">
          {t("agent.intro")}
        </p>
        {/* B781 — the door's intro was 31 words above a button. The half that
            is a promise rather than a direction is behind "why?", where the
            person who wants it can have all of it. */}
        <Why>{t("agent.introWhy")}</Why>

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
                 already knows what this is. */
              <SignupWizard email={identityEmail ?? undefined} locale={locale} codeMinutes={codeMinutes} onSignedIn={intoTheWizard} />
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
          journals.length === 0 &&
          (signupEnabled ? (
            <div className="mt-6">
              <SignupWizard email={identityEmail ?? undefined} locale={locale} codeMinutes={codeMinutes} onSignedIn={intoTheWizard} />
            </div>
          ) : (
            <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-50 p-5 text-base leading-7 text-navy-800 sm:p-6">
              {t("agent.noJournal")}
            </p>
          ))}

        {signedIn && journals.length > 0 && (
          <div className="mt-8 space-y-6">
            {journals.map((journal) => (
              <section
                key={journal.username}
                className="rounded-2xl border border-navy-200 bg-cream-50 p-5 sm:p-6"
              >
                <h2 className="font-display text-xl font-semibold text-navy-900">
                  {journal.title}
                </h2>

                {/* B767 — the balance is off this screen, and earns one line
                  only when it is nearly gone. A number nobody is about to
                  spend is a number that makes somebody hesitate; what it
                  costs is said in the panel that confirms the spending. */}
                {journal.credits !== null && journal.credits <= LOW_CREDITS && (
                  <p className="mt-2 text-sm text-navy-700">
                    {tn("agent.creditsLow", journal.credits, {
                      count: String(journal.credits),
                    })}
                  </p>
                )}

                {/* The one bright thing on the card — B767. It says what the
                  person came to do, and where a day was left half-written it
                  says that instead and names the day, because somebody with
                  unfinished work does not want a second decision. */}
                <Link
                  // B818 — a button that says "Finish Wednesday, 19 August"
                  // has to open that day, not today. The wizard reads these
                  // three off the query string on the server, so its very
                  // first render is already the day this link names.
                  href={
                    journal.drafts.length > 0
                      ? `/agent/${encodeURIComponent(journal.username)}?trip=${encodeURIComponent(journal.drafts[0].trip)}&slug=${encodeURIComponent(journal.drafts[0].slug)}&date=${journal.drafts[0].date}`
                      : `/agent/${encodeURIComponent(journal.username)}`
                  }
                  className="mt-4 inline-flex min-h-11 items-center rounded-full border border-yellow-600 bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                >
                  {journal.drafts.length > 0
                    ? t("agent.resumeDay", {
                        date: formatLongDate(journal.drafts[0].date),
                      })
                    : t("agent.wizardOpen")}
                </Link>

                {/* The accelerator, and only ever that — B685. With the
                  capability off it is simply not here, and everything above
                  works exactly as it did. Below the button since B767: it is
                  a second way in, not the first thing to read. */}
                {journal.helper && (
                  <HelperAsk
                    username={journal.username}
                    consented={journal.consented}
                    speech={journal.speech}
                    consentedSpeech={journal.consentedSpeech}
                    speechProvider={journal.speechProvider}
                  />
                )}

                {/* The rest of what is unfinished — B682, narrowed by B767 to
                  the days the button above does not already name. What it can
                  say is what is on disk: the date, how many photographs
                  reached the day, and whether anybody has written the words
                  yet. */}
                {journal.drafts.length > 1 && (
                  <div className="mt-4 rounded-xl border border-navy-200 bg-cream-100 p-4">
                    <p className="text-sm font-semibold text-navy-800">
                      {t("agent.resumeHeading")}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {journal.drafts.slice(1, 4).map((draft) => (
                        <li
                          key={`${draft.trip}/${draft.slug}`}
                          className="text-sm text-navy-700"
                        >
                          <span className="font-semibold text-navy-900">
                            {formatLongDate(draft.date)}
                          </span>
                          {" · "}
                          {draft.photos > 0
                            ? tn("agent.photoCount", draft.photos, {
                                count: String(draft.photos),
                              })
                            : t("agent.noPhotosYet")}
                          {!draft.written && ` · ${t("agent.noWordsYet")}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6 border-t border-navy-200 pt-6">
                  <AgentHandover
                    username={journal.username}
                    siteUrl={siteUrl}
                  />
                </div>
              </section>
            ))}
          </div>
        )}

        {/* B751: kept here, and only here on this page. Signed out, this is
            the second door and belongs. Signed in with journals, each
            journal's own `AgentHandover` above already does this job with a
            real key — this generic panel does not render alongside it. Signed
            in with no journal, there is no `AgentHandover` to duplicate (it
            needs a journal), so the generic panel is the only offer there
            is. */}
        {/* B804 — the panel is right and stays; what was wrong is that it sat
            here unexplained, so a 71-year-old who has never heard the word
            "Agent" in this sense read a block of English as her next
            instruction. One line in front of it, ending in permission to
            ignore it, and the block itself behind the same `<details>` the
            intro uses for "why?" — present, findable, and no longer the thing
            below the form that looks like the next step. */}
        {(!signedIn || journals.length === 0) && (
          <details className="mt-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-base leading-7 text-navy-700 underline underline-offset-4">
              {t("agent.ownAgentOptional")}
            </summary>
            <AgentBlock docUrl={docUrl} agentUrl={agentUrl} />
          </details>
        )}
      </main>
    </div>
  );
}
