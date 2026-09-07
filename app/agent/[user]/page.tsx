import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AgentWizard from "@/components/AgentWizard";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { WRITE_DAY_CREDITS } from "@/lib/helper/model";
import { draftsForWizard, inboxForWizard, isHelperOwner, tripsForWizard } from "@/lib/helper/server";
import { speechProvider } from "@/lib/helper/transcribe";
import { requestLocale, translateIn } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";

// Reads a cookie and the journal's drafts on every request; there is nothing
// here to prerender, and a cached wizard would be a cached answer to "what is
// unfinished".
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "agent.wizardTitle") },
    robots: { index: false, follow: false },
  };
}

/**
 * The wizard — B682, and step 2 of `docs/plans/2026-09-07-web-helper-agent.md`.
 *
 * `/agent` is the door; this is the room behind it, one journal at a time.
 * Everything it needs to start is read here, on the server, from the same
 * functions the API reads: the journal's trips, everything unfinished in it,
 * and the currency table the day card draws money with.
 *
 * **404 rather than 403 for somebody else's journal**, and the same answer for
 * a journal that does not exist. A URL here is one somebody guessed, and it
 * must not confirm whose it is.
 */
export default async function AgentWizardPage({ params }: PageProps<"/agent/[user]">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) notFound();

  // B689 — the door to the inbox screen, and only when there is something
  // behind it. A file somebody handed over and nothing ever read is the exact
  // failure that screen exists to end, so the link is a count rather than a
  // permanent menu item nobody looks at.
  const waiting = inboxForWizard(user).length;
  const locale = await requestLocale();

  return (
    <>
    <AgentWizard
      username={user}
      trips={tripsForWizard(user)}
      drafts={draftsForWizard(user)}
      currency={currencyOptions(user)}
      // B684. Off is absent rather than broken: the wizard gets `enabled:
      // false`, draws no button and asks nothing, and every other step works
      // exactly as it did with no model on the instance at all.
      helper={{
        enabled: isEnabled("helper", user),
        consented: hasHelperConsent(user, "words"),
        consentedPhotos: hasHelperConsent(user, "photos"),
        credits: WRITE_DAY_CREDITS,
        // B686. A second switch and a second yes: an instance may run speech
        // with no model at all, and the wizard draws whichever it has.
        speech: isEnabled("transcription", user),
        consentedSpeech: hasHelperConsent(user, "speech"),
        speechProvider: speechProvider(),
      }}
    />
    {waiting > 0 && (
      <p className="mx-auto w-full max-w-2xl px-4 pb-8 text-sm text-navy-700">
        <Link href={`/agent/${user}/inbox`} className="font-semibold underline">
          {translateIn(locale, "agent.inboxLink", { count: String(waiting) })}
        </Link>
      </p>
    )}
    </>
  );
}
