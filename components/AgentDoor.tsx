"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AgentHandover from "@/components/AgentHandover";
import HelperAsk from "@/components/HelperAsk";
import { AgentBlock, Kicker } from "@/components/LandingSections";
import IdentitySignIn from "@/components/IdentitySignIn";
import SignupWizard from "@/components/SignupWizard";
import { useI18n } from "@/components/LocaleProvider";
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
};

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
 * whatever is unfinished in it, the way into the wizard B682 built at
 * `/agent/<user>`, and — this is the same panel, now that a journal is known —
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

        {!signedIn && (
          // Reloads on success, like the same form on `/` — the page re-renders
          // from the cookie the server just set rather than the client
          // pretending to know what it now opens.
          <IdentitySignIn
            codeMinutes={codeMinutes}
            onDone={() => window.location.reload()}
          />
        )}

        {/* B688: a visitor with no journal completes the whole of signup
          right here — email, a name, an address, a first trip — and never
          sees `/welcome`, which was written for somebody who already knows
          what this is. Shown whether or not they are signed in: an identity
          cookie proves an address but grants nothing, so it is never a
          journal on its own. */}
        {!signedIn &&
          (signupEnabled ? (
            <div className="mt-6">
              <SignupWizard email={identityEmail ?? undefined} locale={locale} codeMinutes={codeMinutes} onSignedIn={intoTheWizard} />
            </div>
          ) : (
            <p className="mt-6 text-base leading-7 text-navy-600">{t("agent.signupOff")}</p>
          ))}

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

                {/* The accelerator, and only ever that — B685. With the
                  capability off it is simply not here, and everything below
                  works exactly as it did. */}
                {journal.helper && (
                  <HelperAsk
                    username={journal.username}
                    consented={journal.consented}
                    speech={journal.speech}
                    consentedSpeech={journal.consentedSpeech}
                  />
                )}

                {/* The resume card — B682. It is above the "write a day" button
                  rather than below it because somebody who left a day
                  half-written on a bus came back for that day, not to start
                  another one. What it can say is what is on disk: the date,
                  how many photographs reached the day, and whether anybody has
                  written the words yet. */}
                {journal.drafts.length > 0 && (
                  <div className="mt-4 rounded-xl border border-navy-200 bg-cream-100 p-4">
                    <Kicker>{t("agent.resumeHeading")}</Kicker>
                    <ul className="mt-2 space-y-1">
                      {journal.drafts.slice(0, 3).map((draft) => (
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

                <Link
                  href={`/agent/${encodeURIComponent(journal.username)}`}
                  className="mt-4 inline-flex min-h-11 items-center rounded-full border border-yellow-600 bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                >
                  {journal.drafts.length > 0
                    ? t("agent.resumeOpen")
                    : t("agent.wizardOpen")}
                </Link>

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

        {(!signedIn || journals.length === 0) && (
          <div className="mt-2">
            <AgentBlock docUrl={docUrl} agentUrl={agentUrl} />
          </div>
        )}
      </main>
    </div>
  );
}
