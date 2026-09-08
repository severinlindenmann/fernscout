import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HelperRoom from "@/components/HelperRoom";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent, helperConsent } from "@/lib/helper/consent";
import {
  draftsForWizard,
  filesForRoom,
  isHelperOwner,
} from "@/lib/helper/server";
import { speechProvider } from "@/lib/helper/transcribe";
import { requestLocale, translateIn } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { getUser } from "@/lib/users";

// The inbox, the trip's photographs and what is unfinished are all read from
// disk here. A cached answer to "what is waiting" is the one answer that must
// never be stale — the same reasoning as the inbox screen's.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "agent.room.title") },
    robots: { index: false, follow: false },
  };
}

/**
 * The room — B901 and B902, rounds 4 to 6 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * Three panes on a wide screen, one thing at a time on a phone, and the
 * conversation in the middle of both. Everything it needs is read here, on the
 * server, from the functions the rest of the helper already reads: the files
 * pane's two folders, the newest unfinished day so the preview has something
 * in it before anybody speaks, and the currency table the day card draws money
 * with.
 *
 * **404 where `helper` is off**, not a broken room: without a model there is
 * no conversation, and the wizard at `/agent/<user>` is the whole product for
 * that instance exactly as it was. Absent rather than broken is the rule every
 * capability here follows.
 *
 * **404 rather than 403 for somebody else's journal**, and the same answer for
 * one that does not exist — a URL here is one somebody guessed.
 */
export default async function HelperRoomPage({
  params,
  searchParams,
}: PageProps<"/agent/[user]/chat">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) notFound();
  if (!isEnabled("helper", user)) notFound();

  const journal = getUser(user);
  if (!journal) notFound();

  // The day somebody is most likely still talking about. Not a claim about
  // what they want — the first sentence they say moves the pane — only a
  // better opening than an empty rectangle.
  //
  // B979 — unless they arrived from a day, in which case that is the day, and
  // it is not a guess at all: the link under the owner block on `<trip>/<day>`
  // carries it. Read as two plain strings and handed to the same prop; the
  // pane loads the day itself and a pair naming nothing simply loads nothing,
  // so a hand-typed query is a preview that stays empty rather than an error.
  const asked = await searchParams;
  const trip = typeof asked.trip === "string" ? asked.trip : null;
  const slug = typeof asked.slug === "string" ? asked.slug : null;
  const [waiting] = draftsForWizard(user);
  const opening =
    trip && slug
      ? { trip, slug }
      : waiting
        ? { trip: waiting.trip, slug: waiting.slug }
        : null;

  return (
    <HelperRoom
      username={user}
      title={journal.title}
      files={filesForRoom(user)}
      currency={currencyOptions(user)}
      opening={opening}
      consented={Boolean(helperConsent(user))}
      speech={isEnabled("transcription", user)}
      consentedSpeech={hasHelperConsent(user, "speech")}
      speechProvider={speechProvider()}
    />
  );
}
