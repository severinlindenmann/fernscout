import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import { isEnabled } from "@/lib/capabilities";
import { getContactByEmail } from "@/lib/contacts";
import { resolveInvite } from "@/lib/contacts/invites";
import { joinCodeFor, welcomeCodeFor } from "@/lib/contacts/welcome";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { translateIn } from "@/lib/locales";
import { getTrip, tripRef } from "@/lib/trips";
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
 * Since B2293 it renders nothing of its own for a live link: it redirects to
 * the short link the design gave each (B2291 "Links"). A dead link — or one of
 * the other kind than its path promises — still says so in words, and is not
 * a 404: people forwarded these.
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

  // B2293 — the page these links used to open is two short links now. A
  // mailed (pre-approved) invite whose person is already on the page goes to
  // that person's welcome guide; any other live link goes to its join flow.
  // Neither grants anything: both end at a code, and the join flow at the
  // owner's Let in.
  if (invite.email) {
    const contact = await getContactByEmail(username, invite.email);
    const welcome = contact && contact.status !== "blocked" ? await welcomeCodeFor(username, contact.id) : null;
    if (welcome) redirect(`/w/${welcome}`);
  }
  const join = await joinCodeFor(username, invite.id);
  if (join) redirect(`/j/${join}`);
  // A short code shown once on a server that keeps only its hash: there is
  // nothing to send them to, so say the link does not work, as for a dead one.
  return (
    <NoticeShell
      lang={locale}
      title={translateIn(locale, "err.linkExpiredTitle")}
      body={translateIn(locale, "err.linkExpiredBody")}
      actions={[home]}
    />
  );
}
