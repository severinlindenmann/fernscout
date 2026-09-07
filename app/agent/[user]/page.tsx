import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AgentWizard from "@/components/AgentWizard";
import { draftsForWizard, isHelperOwner, tripsForWizard } from "@/lib/helper/server";
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

  return (
    <AgentWizard
      username={user}
      trips={tripsForWizard(user)}
      drafts={draftsForWizard(user)}
      currency={currencyOptions(user)}
    />
  );
}
