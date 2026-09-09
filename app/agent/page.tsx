import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import AgentDoor from "@/components/AgentDoor";
import HelperRoom from "@/components/HelperRoom";
import LocaleProvider from "@/components/LocaleProvider";
import { hasHelperConsent } from "@/lib/helper/consent";
import { filesForRoom, isHelperOwner } from "@/lib/helper/server";
import { openingFor } from "@/lib/helper/opening";
import { turnsIn } from "@/lib/helper/sessions";
import { adopt, forget, liveSession, note } from "@/lib/helper/thread";
import { speechProvider } from "@/lib/helper/transcribe";
import { journalsFor } from "@/lib/home";
import { dictionaryFor, requestLocale, translateIn } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { JOURNAL_COOKIE } from "@/lib/requestKeys";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { whatsappDisplayNumber } from "@/lib/whatsapp/settings";

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
 *
 * **A bare `/agent` resumes only a conversation that is actually live** —
 * B1168, revising B1109's resume-the-latest. Drawing last week's stored
 * turns on arrival looked like a conversation the next sentence would
 * extend, while the thread that actually answers had long expired and the
 * sentence silently opened a new session. Now the drawn conversation and
 * the answering thread are always the same one: a live thread resumes, a
 * reopened `?c=` is adopted into the thread, `?c=new` (the + button) is
 * blank, and everything else opens fresh with the history one tap away.
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
       * Which day the preview opens on: `?about=` — a person arriving from a
       * day, B994 — and nothing else. It used to fall back to whatever was
       * unfinished, which put a months-old draft on the screen before the
       * person had done anything, on every arrival; the conversation's own
       * opening already says what is waiting, in words, with a button. B1170.
       */
      const about = typeof asked.about === "string" ? asked.about : "";
      const [aboutTrip, aboutSlug] = about.split("/");
      const opening = aboutTrip && aboutSlug ? { trip: aboutTrip, slug: aboutSlug } : null;

      /**
       * A link from a day starts a fresh conversation that already knows
       * what it was opened from — B994. The note is B924's mechanism: a
       * line the model reads and the person never sees, so their first
       * sentence — "rewrite it", "this day" — is answerable without their
       * having to describe the day the preview is already showing. The
       * room strips `about` from the address once mounted, so a reload
       * resumes this conversation rather than wiping it for another.
       */
      if (opening) {
        forget(user);
        note(
          user,
          `[they arrived from the day ${opening.slug} of the trip ${opening.trip} and are looking at it in the preview; when they say "this day" it is that one]`,
        );
      }

      /**
       * Which conversation this page is — B1168, revising B1109's resume.
       *
       * `?c=new` is the + button: a genuinely blank room, whatever is stored.
       * `?c=<id>` is a conversation reopened from the history panel — and it
       * is **adopted**, not merely drawn: the live thread takes that id and
       * those turns, so the next sentence really continues what is on the
       * screen and is recorded under it. A bare visit resumes only a
       * conversation that is actually live (within the thread's own TTL);
       * resuming a dead one drew last week's turns as though typing would
       * extend them, while the next sentence silently opened a new session.
       */
      const named = typeof asked.c === "string" ? asked.c : "";
      const session =
        opening || named === "new" ? "" : named !== "" ? named : ((await liveSession(user)) ?? "");
      const history = session ? await turnsIn(user, session) : [];
      if (named !== "" && named !== "new" && history.length > 0) await adopt(user, session, history);
      /**
       * A provider of its own, for one prop the root's cannot carry —
       * B1200. The room previews a real `DayCard`, and a day's fallback
       * banner compares the reading locale against the journal's own
       * `defaultLocale` (`writtenLocale`); under the root provider that
       * defaulted to English, and a German day previewed with "Auf
       * Englisch geschrieben" over plainly German words.
       */
      const roomLocale = await requestLocale();
      return (
        <LocaleProvider
          locale={roomLocale}
          dictionary={dictionaryFor(roomLocale)}
          writtenLocale={journal.defaultLocale}
        >
        <HelperRoom
          username={user}
          title={journal.title}
          files={filesForRoom(user)}
          currency={currencyOptions(user)}
          opening={opening}
          // Drawn from what was stored. Empty for anything that is not this
          // journal's, which `turnsIn` decides.
          history={history}
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
          // B1127 — both gating facts checked here, server-side: a proven
          // number and this journal's own opt-in. Absent either, or with no
          // number configured for the instance at all, and the prop is
          // simply not there — the component draws nothing rather than a
          // chip that would fail.
          whatsappNumber={
            journal.owner.telProvenAt && isEnabled("whatsappInbound", user)
              ? whatsappDisplayNumber()
              : undefined
          }
        />
        </LocaleProvider>
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
