import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AgentInbox from "@/components/AgentInbox";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { STATEMENT_CREDITS } from "@/lib/helper/model";
import { inboxForWizard, isHelperOwner, tripsForWizard } from "@/lib/helper/server";
import { requestLocale, translateIn } from "@/lib/locales";

// The inbox is read from disk on every visit; a cached answer to "what is
// waiting" is the one answer that must never be stale.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "agent.inboxTitle") },
    robots: { index: false, follow: false },
  };
}

/**
 * The inbox screen — B689.
 *
 * Reachable from `/agent/<user>`, and from nowhere a stranger can guess: the
 * gate is `isHelperOwner`, and a journal that is not yours — or one that does
 * not exist — is a 404 rather than a 403, the same answer the wizard gives.
 *
 * Everything the screen needs is worked out here, on the server, with **no
 * model involved in deciding what a file is**: `inboxForWizard` asks the
 * importers that already exist whether they recognise the bytes. A model is
 * asked one question, later, by one button, about one statement nothing here
 * knows how to read.
 */
export default async function AgentInboxPage({ params }: PageProps<"/agent/[user]/inbox">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) notFound();

  return (
    <AgentInbox
      username={user}
      items={inboxForWizard(user)}
      trips={tripsForWizard(user)}
      helper={{
        // Off is absent rather than broken: a location export still imports,
        // a statement from a bank the repository knows still reads, and the
        // one button that needs a model says why it is not there.
        enabled: isEnabled("helper", user),
        consented: hasHelperConsent(user, "statement"),
        credits: STATEMENT_CREDITS,
      }}
    />
  );
}
