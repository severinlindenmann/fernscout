import { headers } from "next/headers";
import { notFound } from "next/navigation";
import InviteRedeem from "@/components/InviteRedeem";
import NoticeShell from "@/components/NoticeShell";
import { isEnabled } from "@/lib/capabilities";
import { resolveInvite } from "@/lib/contacts/invites";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { isJournalGuest, isOwner, journalReader } from "@/lib/contacts/session";
import { dictionariesFor, localesFor, translateIn } from "@/lib/locales";
import { getTrip, tripRef } from "@/lib/trips";
import { isPersonOn } from "@/lib/tripPeople";
import { getUser } from "@/lib/users";

/**
 * The landing page both B33 links share.
 *
 * Two routes rather than one dynamic `[kind]` segment, because the kind is a
 * fixed vocabulary of two and a route that accepted `/invite/anything/<token>`
 * would be a URL shape nobody meant. They differ in one argument and nothing
 * else, so the page itself is here: a guest link and a buddy link must not
 * drift into two experiences of being invited.
 *
 * Four things it decides before rendering anything:
 *
 * - **Is the link live?** A dead one says so, in words, and is not a 404 — the
 *   same reasoning `/{user}/i/<token>` gives. People forward these.
 * - **Is it the right kind for this address?** A buddy token at the guest URL
 *   reads as dead. The path is the promise; honouring a token that contradicts
 *   it would make the path meaningless.
 * - **Are they already in?** Somebody who is already an approved guest, or
 *   already on the trip, is told so rather than shown a form that would put a
 *   second request in the owner's queue.
 * - **Is it the owner?** Following your own link is not a way of joining your
 *   own journal, and the form would be a dead end for them.
 */
export default async function RedeemPage({
  username,
  token,
  kind,
}: {
  username: string;
  token: string;
  kind: "guest" | "buddy";
}) {
  const user = getUser(username);
  if (!user || !isEnabled("contacts", username)) notFound();

  const invite = await resolveInvite(username, token);
  const accept = (await headers()).get("accept-language");
  const locale = pickLocale(invite?.locale, fromAcceptLanguage(accept), user.defaultLocale);
  const home = {
    href: `/${username}`,
    label: translateIn(locale, "err.goToJournal", { title: user.title }),
  };

  const trip = invite?.tripId ? getTrip(tripRef(username, invite.tripId)) : null;

  // `kind` is the path's promise about what this link does. A token of the
  // other kind, a buddy link with no trip left, and an invented token are all
  // the same answer: this link does not work, ask for another.
  if (!invite || invite.kind !== kind || (kind === "buddy" && !trip)) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "err.linkExpiredTitle")}
        body={translateIn(locale, "err.linkExpiredBody")}
        actions={[home]}
      />
    );
  }

  if (await isOwner(username)) {
    return (
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "invite.ownerTitle")}
        body={translateIn(locale, "invite.ownerBody")}
        actions={[home]}
      />
    );
  }

  const reader = await journalReader(username);
  const alreadyIn =
    kind === "buddy" && trip
      ? await isPersonOn(trip, reader.email)
      : await isJournalGuest(username);

  return (
    <InviteRedeem
      username={username}
      journalTitle={user.title}
      kind={kind}
      tripTitle={trip?.title ?? null}
      token={token}
      initialLocale={locale}
      locales={localesFor(username)}
      dictionaries={dictionariesFor(username)}
      // The address on a session for *this* journal only. A session for
      // another journal on this instance is not proof here — sessions belong
      // to one journal, and inventing an instance-wide identity to save one
      // email would be a new kind of credential nobody asked for.
      knownEmail={reader.email}
      // Their own name if this journal knows it, otherwise the one the owner
      // wrote into the link. Prefill, never identity: whoever is sitting there
      // can overwrite it, and it is the submitted address that decides who
      // this is.
      initialName={reader.contact?.name ?? invite.name ?? ""}
      // B338 — decision 1, disclosure. `invite.email` is set only when the
      // owner asked the server to *mail* this link to somebody named
      // (B319); a link the owner copied and pasted by hand carries no
      // address and this is null. That split is the whole answer to "a
      // guest link is safe to forward": whoever holds a mailed link is
      // expected to be the person it was addressed to — they already read
      // the address once, in their own inbox, to get here — so showing it
      // back to them discloses nothing they do not already hold. A
      // hand-copied link has no such expectation (it may legitimately reach
      // several people, each proving their own address), so it prefills
      // nothing, exactly as before this ticket. The field stays visible and
      // editable either way; nothing here is hidden.
      invitedEmail={invite.email}
      alreadyIn={alreadyIn}
      // B360: a server with no postcard provider cannot act on a postal
      // address, so the form stops asking for one — the same check every
      // other capability on this site is gated on.
      postcardsEnabled={isEnabled("postcards", username)}
      // B376: same reasoning, for the phone hint's own mention of WhatsApp.
      whatsappEnabled={isEnabled("whatsapp", username)}
    />
  );
}
