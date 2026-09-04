import "server-only";
import type { UserConfig } from "../config";
import { CODE_TTL_MINUTES, issueStandingLink, signInUrl } from "../auth";
import { isEnabled } from "../capabilities";

import { translateIn } from "../locales";
import { sendMail, type SendResult } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import { getTrip, tripRef } from "../trips";
import type { Locale } from "../types";
import {
  manageTokenFor,
  manageUrl,
  unsubscribeUrlFor,
  type ContactRecord,
} from "./index";
import { listInvites, type InviteKind } from "./invites";
import { pickLocale } from "./locale";

/**
 * The five letters this feature writes.
 *
 * Each one is written in the *recipient's* language, which is the whole point
 * of keeping a locale on the contact: the digest picking `preferred_locale` per
 * recipient (ROADMAP §3.1) starts here. The one exception is the note to the
 * owner, which is in the owner's language — they are the recipient of that one.
 *
 * **No letter ever contains a postal address.** Not the confirmation, not the
 * note to the owner. Mail is the least private channel in this system and an
 * address in a subject line would undo the encrypted column entirely.
 *
 * Every letter to a reader carries the self-serve link in its footer, so
 * `List-Unsubscribe` works from any mail client and no reader ever has to find
 * a login to make the mail stop.
 */

function baseUrl(): string {
  return serverSite().url;
}

function footerFor(locale: Locale, user: UserConfig): string {
  return translateIn(locale, "contact.mailFooter", { site: user.title });
}

/**
 * Which trip a contact was let onto, if they came in on a buddy link — B347,
 * B349.
 *
 * `createdVia` only carries `invite:<id>`; the kind and the trip live on the
 * invite row, the same lookup `viaLabel()` in `ContactsAdmin.tsx` does for the
 * contacts page. Null for a guest link, a personal link, `open` or `owner` —
 * every case where the mail this feeds stays exactly as it was.
 */
async function buddyTripFor(
  username: string,
  contact: Pick<ContactRecord, "createdVia">,
): Promise<{ title: string } | null> {
  const via = contact.createdVia;
  if (!via?.startsWith("invite:")) return null;
  const invites = await listInvites(username);
  const invite = invites.find((candidate) => candidate.id === via.slice("invite:".length));
  if (!invite || invite.kind !== "buddy" || !invite.tripId) return null;
  const trip = getTrip(tripRef(username, invite.tripId));
  return trip ? { title: trip.title } : null;
}

/** The one-time code (C12). Transactional: no unsubscribe link, because there
 * is nothing yet to unsubscribe from. */
export async function sendCodeMail(
  username: string,
  user: UserConfig,
  to: string,
  locale: Locale,
  code: string,
) {
  return sendMail(
    renderMail(
      to,
      translateIn(locale, "contact.mailCodeSubject", { title: user.title }),
      {
        preheader: translateIn(locale, "contact.mailCodeBody", { code, minutes: CODE_TTL_MINUTES }),
        title: translateIn(locale, "contact.mailCodeTitle"),
        blocks: [
          { kind: "paragraph", text: translateIn(locale, "contact.mailCodeBody", { code, minutes: CODE_TTL_MINUTES }) },
          { kind: "paragraph", text: translateIn(locale, "contact.mailCodeIgnore") },
        ],
        footer: footerFor(locale, user),
      },
      username,
    ),
  );
}

/**
 * "You're invited" — the owner asked the server to mail it, rather than
 * copying the link out by hand (B319).
 *
 * Transactional, like `sendCodeMail`: nobody has a contact row yet, so there
 * is nothing on file to unsubscribe from — the row this makes only exists
 * once whoever received this opens the link and proves the address.
 *
 * Best effort. By the time this is called `createInvite` has already
 * succeeded and, when the address matches, pre-approved itself — a failed
 * send must not undo either: the owner still holds the link this mail would
 * have carried and can pass it on another way. See B272 for why a mail
 * failure here is logged and swallowed rather than allowed to fail the call
 * that made the invite.
 */
export async function sendInviteMail(
  username: string,
  user: UserConfig,
  input: {
    email: string;
    locale: Locale;
    kind: InviteKind;
    url: string;
    /** The trip a buddy link names, for the sentence that says so. Ignored
     * for every other kind. */
    tripTitle?: string | null;
  },
): Promise<SendResult | null> {
  const buddy = input.kind === "buddy";
  const vars = {
    title: user.title,
    nickname: user.owner.nickname,
    trip: input.tripTitle ?? "",
  };
  try {
    return await sendMail(
      renderMail(
        input.email,
        translateIn(input.locale, buddy ? "contact.mailInviteBuddySubject" : "contact.mailInviteGuestSubject", vars),
        {
          preheader: translateIn(input.locale, buddy ? "contact.mailInviteBuddyBody" : "contact.mailInviteGuestBody", vars),
          title: translateIn(input.locale, "contact.mailInviteTitle"),
          blocks: [
            {
              kind: "paragraph",
              text: translateIn(input.locale, buddy ? "contact.mailInviteBuddyBody" : "contact.mailInviteGuestBody", vars),
            },
            { kind: "button", text: translateIn(input.locale, "contact.mailInviteButton"), href: input.url },
          ],
          footer: footerFor(input.locale, user),
        },
        username,
      ),
    );
  } catch (err) {
    console.error(`[contacts] invite mail to ${input.email} failed:`, err);
    return null;
  }
}

/**
 * "We have your details, the owner will let you in." Carries the manage link
 * — the first mail that can, because the address has just been proved.
 *
 * Best effort (B272). By the time this is called, `confirmContact` has
 * already succeeded and the reader has proved their code was right — an SMTP
 * hiccup here must not turn that into a 500 the UI renders as "that code
 * didn't work". Failure is logged and swallowed; there is no state to retry
 * from because this letter carries nothing the reader cannot get again from
 * `/{user}/c/manage` once they are approved.
 */
export async function sendConfirmedMail(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
  manageToken: string,
): Promise<SendResult | null> {
  const locale = pickLocale(contact.locale, user.defaultLocale);
  const manage = manageUrl(baseUrl(), username, manageToken);
  try {
    return await sendMail(
      renderMail(
        contact.email,
        translateIn(locale, "contact.doneTitle"),
        {
          preheader: translateIn(locale, "contact.doneBody", { title: user.title }),
          title: translateIn(locale, "contact.doneTitle"),
          blocks: [
            { kind: "paragraph", text: translateIn(locale, "contact.doneBody", { title: user.title }) },
            {
              kind: "button",
              text: translateIn(locale, "contact.mailManageButton"),
              href: manage,
            },
          ],
          footer: footerFor(locale, user),
          unsubscribeUrl: unsubscribeUrlFor(baseUrl(), username, manageToken),
        },
        username,
      ),
    );
  } catch (err) {
    console.error(`[contacts] confirmation mail to ${contact.email} failed:`, err);
    return null;
  }
}

/**
 * C16 — the owner hears about it.
 *
 * Sent the moment somebody confirms, not on a schedule, because the failure
 * this exists to prevent is a request sitting unseen for a fortnight while the
 * owner is on a bus. It links straight into the overview rather than asking
 * them to go and find it — and, since B319, straight to *this* request within
 * it (`?contact=<id>`), so the button opens the queue with the person who
 * just confirmed already in front of the owner rather than at the top of a
 * list they still have to scroll. That is the cheaper of the two ways an
 * owner can act from their inbox: the button does not itself approve
 * anybody — it is still the owner's page, still gated by `isOwner`, still one
 * press away rather than none — which is what keeps this a plain link rather
 * than a credential that needs `lib/deletions.ts`'s single-use pattern.
 *
 * Best effort (B272), and unlike `sendConfirmedMail` there **is** state to
 * retry from: this letter is the one thing standing between a confirmed
 * request and an owner who never hears about it, which is exactly what went
 * missing in production when it threw straight out of the route. Failure is
 * logged and swallowed here; the return value says whether it actually went,
 * so the caller can persist that with `markOwnerNotified` and only then. A
 * `false` leaves `contacts.notified_at` null, which is what lets the next
 * confirmation for the same address try again instead of the notice being
 * lost for good.
 */
export async function notifyOwnerOfRequest(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
): Promise<boolean> {
  if (!user.owner.email) return false;
  const locale = pickLocale(user.defaultLocale);
  // B349 — a buddy link is asking for write access to a trip, not to
  // "follow along". Same two facts the contacts page already shows for this
  // row (`viaLabel()` in `ContactsAdmin.tsx`): which kind of link, and which
  // trip. Null for everyone else, and the sentence is unchanged for them.
  const trip = await buddyTripFor(username, contact);
  const bodyVars = { name: contact.name ?? contact.email, email: contact.email, trip: trip?.title ?? "" };
  const bodyKey = trip ? "contact.mailRequestBuddyBody" : "contact.mailRequestBody";
  try {
    const result = await sendMail(
      renderMail(
        user.owner.email,
        translateIn(locale, "contact.mailRequestSubject", { title: user.title }),
        {
          preheader: translateIn(locale, bodyKey, bodyVars),
          title: translateIn(locale, "contact.mailRequestTitle"),
          blocks: [
            {
              kind: "paragraph",
              // Name and address, and nothing else. Whether they asked for a
              // postcard is on the overview page; where they live is not in a
              // mail.
              text: translateIn(locale, bodyKey, bodyVars),
            },
            {
              kind: "button",
              text: translateIn(locale, "contact.mailRequestButton"),
              href: `${baseUrl()}/${username}/contacts?contact=${encodeURIComponent(contact.id)}`,
            },
          ],
          footer: footerFor(locale, user),
        },
        username,
      ),
    );
    // `sendMail` returns null rather than throwing when this server or this
    // journal has mail switched off — not a failure, but nothing was told
    // either. Reading that as "notified" would let `notified_at` lie.
    return result !== null;
  } catch (err) {
    console.error(`[contacts] could not notify the owner of ${username} about ${contact.email}:`, err);
    return false;
  }
}

/**
 * "You're in." Sent when the owner approves, in the reader's language.
 *
 * The button used to be the journal's plain address — `${baseUrl()}/{user}`
 * — which for a `guest` journal shows an unauthenticated arrival nothing at
 * all: the gate, not the trip (B319). It now carries a **standing sign-in
 * link**, the exact mechanism the owner's own welcome mail has used since
 * `006-standing-link`: `issueStandingLink` mints a `guest`-kind row with no
 * time expiry, and `signInUrl` points it at `/{user}/s/{token}`, the page
 * B142 built so a mail scanner following the link cannot spend it before the
 * reader does — it only *shows* a button; pressing it is what redeems the
 * link. That is the property this letter needs: it may sit in an inbox for a
 * week, same as the welcome mail's copy, and a machine reading it first must
 * not burn the reader's own single use.
 *
 * **Why no expiry, deliberately, rather than a short-lived relay link**
 * (B283's `issueRelayLink`, fifteen minutes). That shape is for a credential
 * that passes through an agent's transcript in the middle of a live
 * conversation — used within the minute or not at all. This one is a mail a
 * newly-approved reader opens whenever they next check their inbox, which the
 * welcome mail already established is not "now". The cost the short-lived
 * link avoids — a copy sitting in a chat log — does not apply to a letter
 * that lives in exactly one place, the reader's own mailbox, and single use
 * is still the whole of what bounds it: the first press spends it, same as
 * every standing link.
 *
 * Only reached when `isEnabled("auth", username)` — the capability that owns
 * `/{user}/s/{token}` and `POST /api/auth/link` (AGENTS.md: "absent rather
 * than broken when disabled"). A journal running with `contacts` and `mail`
 * on but `auth` off falls back to the plain address exactly as before, rather
 * than mailing a link to a page that would 404.
 *
 * Best effort (B272's rule, extended here to a caller it did not originally
 * cover): minting the standing link is one more thing that can throw before
 * `sendMail` ever runs, and this is now called from the moment a pre-approved
 * address confirms — a path with no owner-approval click behind it for
 * anyone to retry from. A failure here must log and return `null`, never
 * surface as a 500 to a reader who did everything right.
 */
export async function sendApprovedMail(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
): Promise<SendResult | null> {
  const locale = pickLocale(contact.locale, user.defaultLocale);
  try {
    // Recomputed rather than carried around: the manage token is derived from
    // the contact id, so a mail written months later still has the working
    // link.
    const token = manageTokenFor(username, contact.id);
    const openUrl = isEnabled("auth", username)
      ? signInUrl(baseUrl(), username, await issueStandingLink(username, contact.email))
      : `${baseUrl()}/${username}`;
    // B347 — this contact may hold write access to a trip, not only reading
    // rights, and the only mail they ever get about being approved is this
    // one. `buddyTripFor` is null for a guest link, and the mail is unchanged
    // for them.
    const trip = await buddyTripFor(username, contact);
    const bodyKey = trip ? "contact.mailApprovedBuddyBody" : "contact.mailApprovedBody";
    const bodyVars = { title: user.title, trip: trip?.title ?? "" };
    return await sendMail(
      renderMail(
        contact.email,
        translateIn(locale, "contact.mailApprovedSubject", { title: user.title }),
        {
          preheader: translateIn(locale, bodyKey, bodyVars),
          title: translateIn(locale, "contact.mailApprovedTitle"),
          blocks: [
            {
              kind: "paragraph",
              text: translateIn(locale, bodyKey, bodyVars),
            },
            {
              kind: "button",
              text: translateIn(locale, "contact.mailApprovedButton", { title: user.title }),
              href: openUrl,
            },
            ...(trip
              ? [
                  {
                    kind: "item" as const,
                    title: translateIn(locale, "contact.mailApprovedMeLink"),
                    href: `${baseUrl()}/${username}/me`,
                  },
                ]
              : []),
            {
              kind: "item",
              title: translateIn(locale, "contact.mailManageButton"),
              href: manageUrl(baseUrl(), username, token),
            },
          ],
          footer: footerFor(locale, user),
          unsubscribeUrl: unsubscribeUrlFor(baseUrl(), username, token),
        },
        username,
      ),
    );
  } catch (err) {
    console.error(`[contacts] approval mail to ${contact.email} failed:`, err);
    return null;
  }
}
