"use client";

import AgentHandover from "@/components/AgentHandover";
import { AgentBlock } from "@/components/LandingSections";
import IdentitySignIn from "@/components/IdentitySignIn";
import { useI18n } from "@/components/LocaleProvider";

export type AgentJournal = { username: string; title: string };

const WIZARD_STEPS = [
  "agent.stepTrip",
  "agent.stepDate",
  "agent.stepPhotos",
  "agent.stepWords",
  "agent.stepPreview",
  "agent.stepPublish",
] as const;

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
 * a row of disabled buttons standing in for the wizard steps B682 fills in,
 * and — this is the same panel, now that a journal is known — `AgentHandover`
 * in place of the generic block, because `AgentHandover` already builds
 * exactly what the ticket asks for: a starter prompt from the journal, the
 * site's base URL and a minted handover credential. There is deliberately no
 * second, separate "bring your own agent" panel once a journal is known; one
 * panel that gets more specific as more is known is the point.
 *
 * A signed-in reader who owns no journal here gets a plain sentence and the
 * generic panel — there is nothing to write into yet, and no signup wizard
 * either (that is its own later step, item 8 in the plan).
 */
export default function AgentDoor({
  siteUrl,
  docUrl,
  agentUrl,
  codeMinutes,
  signedIn,
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
  /** The reader's own journals — `role: "owner"` only, see the page. */
  journals: AgentJournal[];
}) {
  const { t } = useI18n();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] font-semibold leading-tight text-navy-900">
        {t("agent.title")}
      </h1>
      <p className="mt-3 text-lg leading-7 text-navy-700">{t("agent.intro")}</p>

      {!signedIn && (
        // Reloads on success, like the same form on `/` — the page re-renders
        // from the cookie the server just set rather than the client
        // pretending to know what it now opens.
        <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.reload()} />
      )}

      {signedIn && journals.length === 0 && (
        <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-5 text-base leading-7 text-navy-800 sm:p-6">
          {t("agent.noJournal")}
        </p>
      )}

      {signedIn && journals.length > 0 && (
        <div className="mt-8 space-y-6">
          {journals.map((journal) => (
            <section
              key={journal.username}
              className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6"
            >
              <h2 className="font-display text-xl font-semibold text-navy-900">{journal.title}</h2>

              <h3 className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-navy-600">
                {t("agent.wizardTitle")}
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {WIZARD_STEPS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled
                    className="min-h-11 rounded-full border border-navy-200 bg-cream-100 px-4 text-base text-navy-500"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-sm leading-6 text-navy-600">{t("agent.wizardComingSoon")}</p>

              <div className="mt-6 border-t border-navy-200 pt-6">
                <AgentHandover username={journal.username} siteUrl={siteUrl} />
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
  );
}
