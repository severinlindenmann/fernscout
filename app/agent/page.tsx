import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import AgentDoor from "@/components/AgentDoor";
import HelperRoom from "@/components/HelperRoom";
import { hasHelperConsent } from "@/lib/helper/consent";
import { draftsForWizard, filesForRoom, isHelperOwner } from "@/lib/helper/server";
import { openingFor } from "@/lib/helper/opening";
import { turnsIn } from "@/lib/helper/sessions";
import { speechProvider } from "@/lib/helper/transcribe";
import { journalsFor } from "@/lib/home";
import { requestLocale, translateIn } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { JOURNAL_COOKIE } from "@/lib/requestKeys";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

// Reads the identity cookie on every request; there is nothing here to
// prerender, the same reasoning as `/[user]/me`.
export const dynamic = "force-dynamic";

/** Never indexed: signed in, this page is somebody's own conversation. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "agent.metaTitle", { name: serverSite().name }) },
    description: translateIn(locale, "agent.metaDescription"),
    robots: { index: false, follow: false },
  };
}

/**
 * `/agent` — and it is the whole of it now, B984.
 *
 * There were three pages: this one as a door, `/agent/<user>` as the wizard,
 * `/agent/<user>/chat` as the room. The journal's name was in the address bar
 * of two of them, and the room — the thing somebody actually uses — was two
 * clicks and a path segment away from the URL they had been given.
 *
 * **Signed in, this is the room.** No card of buttons in front of it: an owner
 * arriving here has arrived at the conversation. The door below is what
 * somebody signed *out* meets, and it is the only thing left of it — signing
 * in, and the note for people bringing their own agent.
 *
 * ## Two things are remembered, and neither is in the path
 *
 * **The journal**, in a cookie. Almost nobody owns two; putting the name back
 * in the URL is exactly what this ticket exists to stop. A cookie naming a
 * journal the person no longer owns falls through to their first rather than
 * answering 404 — it is a preference, not a permission, and every read below
 * re-checks ownership anyway.
 *
 * **The conversation**, as `?c=`. That is what a copied URL brings somebody
 * back to, and what the list of past conversations links to. Scoped to the
 * journal when it is read (`turnsIn`), because a session id is a random string
 * and is still not a thing to look up on its own.
 *
 * `?about=<trip>/<slug>` is the third, and it is B994's: a link from a day,
 * opening a conversation that already knows what it was opened from.
 */
export default async function AgentPage({ searchParams }: PageProps<"/agent">) {
  const site = serverSite();
  const identity = isEnabled("auth") ? await resolveIdentity() : null;
  const owned = identity
    ? // Even with nothing in it — B1019. This page asks whose journals these
      // are, not what there is to read, and a journal made a minute ago has
      // nothing to read in it. Without this a new owner fell out of the list
      // and was shown a form to start the journal they had just made.
      (await journalsFor(identity.email, { evenIfEmpty: true })).filter(
        (journal) => journal.role === "owner",
      )
    : [];

  const asked = await searchParams;
  const remembered = (await cookies()).get(JOURNAL_COOKIE)?.value;
  // The remembered journal if it is still theirs, otherwise the first. Never a
  // 404: a stale cookie is somebody who used to own something, and the honest
  // answer to that is their own journal rather than an error.
  const chosen = owned.find((journal) => journal.username === remembered) ?? owned[0];

  if (chosen && isEnabled("helper", chosen.username) && (await isHelperOwner(chosen.username))) {
    const user = chosen.username;
    const journal = getUser(user);
    if (journal) {
      /**
       * Which day the preview opens on. `?about=` is a person arriving from
       * one — not a guess at all — and otherwise it is whatever is unfinished,
       * which is a better opening than an empty rectangle and no claim about
       * what they want.
       */
      const about = typeof asked.about === "string" ? asked.about : "";
      const [aboutTrip, aboutSlug] = about.split("/");
      const [waiting] = draftsForWizard(user);
      const opening =
        aboutTrip && aboutSlug
          ? { trip: aboutTrip, slug: aboutSlug }
          : waiting
            ? { trip: waiting.trip, slug: waiting.slug }
            : null;

      const session = typeof asked.c === "string" ? asked.c : "";
      return (
        <HelperRoom
          username={user}
          title={journal.title}
          files={filesForRoom(user)}
          currency={currencyOptions(user)}
          opening={opening}
          // A conversation reopened by URL, drawn from what was stored. Empty
          // for anything that is not this journal's, which `turnsIn` decides.
          history={session ? await turnsIn(user, session) : []}
          // What the room says before anybody has said anything — B984. Read
          // from disk here, drawn locally there: a page that spent a credit to
          // say hello would be charging somebody for arriving.
          first={openingFor(user, new Date().toISOString().slice(0, 10))}
          journals={owned.map((one) => ({ username: one.username, title: one.title }))}
          // The scope rather than the file — B976.
          consented={hasHelperConsent(user, "words")}
          speech={isEnabled("transcription", user)}
          consentedSpeech={hasHelperConsent(user, "speech")}
          speechProvider={speechProvider()}
        />
      );
    }
  }

  /**
   * Signed out, or a journal with the helper switched off. What is left of the
   * door is the way in and the note for somebody bringing their own agent —
   * everything that used to be a menu of buttons is now the conversation
   * above, and this is not a smaller version of it.
   */
  return (
    <AgentDoor
      docUrl={`${site.url}/documentation.txt`}
      agentUrl={`${site.url}/agent.md`}
      codeMinutes={CODE_TTL_MINUTES}
      signedIn={Boolean(identity)}
      identityEmail={identity?.email ?? null}
      signupEnabled={isEnabled("signup")}
      siteName={site.name}
    />
  );
}
