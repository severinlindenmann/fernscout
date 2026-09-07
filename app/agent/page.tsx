import type { Metadata } from "next";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import AgentDoor from "@/components/AgentDoor";
import { hasHelperConsent, helperConsent } from "@/lib/helper/consent";
import { draftsForWizard } from "@/lib/helper/server";
import { journalsFor } from "@/lib/home";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

// Reads the identity cookie on every request; there is nothing here to
// prerender, the same reasoning as `/[user]/me`.
export const dynamic = "force-dynamic";

/** Never indexed: signed in, this page names the reader's own journal — the
 * same bargain `/[user]/me` makes. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "agent.metaTitle", { name: serverSite().name }) },
    description: translateIn(locale, "agent.metaDescription"),
    robots: { index: false, follow: false },
  };
}

/**
 * The door at `/agent` — B681.
 *
 * `docs/plans/2026-09-07-web-helper-agent.md` calls this "one door, journal
 * chosen after sign-in": signed out this page can only offer the two things
 * that work with nothing switched on — sign in, or bring your own agent — and
 * signed in it names the journal, says what is unfinished in it, and opens
 * the wizard.
 *
 * Since B685 a signed-in card may also carry the ask box, and only where the
 * `helper` capability is on for that journal. Nothing else on the page moves
 * when it is off: the box is absent and the buttons are the whole interface,
 * which is the plan's rule that the router is an accelerator over a UI that
 * works without it. Nothing here calls a model.
 *
 * Which journal is "the journal" comes from the same place `/` already
 * answers it for a signed-in reader — `journalsFor()`, off the identity
 * cookie via `resolveIdentity()`, kept apart from a journal-scoped
 * `fs_session` for the reason `lib/auth/handshake.ts` gives at length. Only
 * `owner` journals are named here: writing a day is what this door is for,
 * and a traveller's write access is scoped to one trip on one journal rather
 * than to "start a day" in general, which is a distinction the wizard (B682)
 * has to make and this shell does not.
 */
export default async function AgentPage() {
  const site = serverSite();
  const identity = isEnabled("auth") ? await resolveIdentity() : null;
  const owned = identity
    ? (await journalsFor(identity.email)).filter((journal) => journal.role === "owner")
    : [];

  return (
    <AgentDoor
      siteUrl={site.url}
      docUrl={`${site.url}/documentation.txt`}
      agentUrl={`${site.url}/agent.md`}
      codeMinutes={CODE_TTL_MINUTES}
      signedIn={Boolean(identity)}
      journals={owned.map((journal) => ({
        username: journal.username,
        title: journal.title,
        // Read here rather than in the card, because the card is a client
        // component and this is a directory walk — and because it is the same
        // read `GET /api/v1/<user>/drafts` makes, which is what makes the
        // resume card and an agent's own queue agree about what is waiting.
        drafts: draftsForWizard(journal.username),
        // B685: the ask box, and whether it has to ask for consent first.
        helper: isEnabled("helper", journal.username),
        consented: Boolean(helperConsent(journal.username)),
        // B686: the microphone, on its own switch and its own consent.
        speech: isEnabled("transcription", journal.username),
        consentedSpeech: hasHelperConsent(journal.username, "speech"),
      }))}
    />
  );
}
