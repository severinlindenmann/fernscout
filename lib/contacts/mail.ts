import "server-only";
import type { UserConfig } from "../config";
import { CODE_TTL_MINUTES, issueStandingLink, signInUrl } from "../auth";
import { isEnabled } from "../capabilities";

import { translateIn } from "../locales";
import { logMessage } from "../messages/log";
import { ownerLocale } from "../messages/locale";
import { sendMail, type SendResult } from "../mail";
import { composeCodeMailContent } from "../mail/codeMail";
import { inviteMail } from "../mail/inviteMail";
import { letInMail } from "../mail/letInMail";
import { renderMail } from "../mail/template";
import type { Composition } from "../messages/previews/types";
type MailComposition = Extract<Composition, { channel: "mail" }>;
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
import { isInviteSuppressed, neverInviteAvailable, neverInviteToken } from "./suppressions";

/** The public "never invite this address" page — B2442. */
function neverInviteUrl(base: string, addressOrNumber: string): string {
  return `${base.replace(/\/$/, "")}/x/${neverInviteToken(addressOrNumber)}`;
}

/** The page's own POST route — its own segment, since Next refuses a
 * `route.ts` and a `page.tsx` sharing one (`app/x/[token]/confirm/route.ts`).
 * `List-Unsubscribe`'s actual target (M2): the page above answers no POST at
 * all, so a mail client's own one-click button needs this address instead. */
function neverInviteConfirmUrl(base: string, addressOrNumber: string): string {
  return `${neverInviteUrl(base, addressOrNumber)}/confirm`;
}

/**
 * The one gate every contact-addressed send must pass through — B334.
 *
 * Nothing enforced that a mail only ever goes to a confirmed address; six
 * senders each happened to be right on their own — `sendConfirmedMail` and
 * `sendApprovedMail` because the calls that trigger them cannot happen before
 * `confirmed_at` is set, `sendDayLetter`'s per-recipient loop because it only
 * ever iterates contacts already filtered to `status === "active"`, which is
 * unreachable without it. Six separate arguments, and not one line of code
 * that would stop a seventh sender from being wrong. This is that line.
 *
 * **The two mails whose whole purpose is to reach an unproven address name
 * that at the call site.** `sendCodeMail` is the passcode itself, and
 * `sendInviteMail` is the owner directly handing somebody a link — both pass
 * `{ allowUnconfirmed: true }` rather than being quietly exempted by some rule
 * about "transactional" mail, so a reader can grep for the exceptions
 * instead of having to trust a comment that they are the only ones.
 * `sendImportedMail` (B2055) used to be a third, sent the moment "who was on
 * the trip" was imported; B2296 removed it — importing sends no mail, and an
 * imported row shows up on Studio › Readers under "Not invited yet" instead.
 *
 * Owner mail — the welcome mail, the deletion link, `notifyOwnerOfRequest` —
 * does not call this at all: it is not addressed to a *contact*, there is no
 * `confirmed_at` to ask about, and the recipient is `config.json`'s own
 * `owner.email` rather than an address a stranger typed into a form. That is
 * a different question, not an exception to this one.
 *
 * Refuses loudly rather than silently dropping: a refusal is logged with the
 * address and the reason, the way `sendDayLetter`'s own skips are, so a
 * caller that gets `false` back can decide what "not sent" means to it
 * instead of a swallowed exception burning a real event.
 */
export function mayMailContact(
  contact: Pick<ContactRecord, "email" | "confirmedAt">,
  options: { allowUnconfirmed?: boolean } = {},
): boolean {
  // A contact with a mobile number and no address (B2294) stores `""`: there
  // is nowhere to mail, whatever the reason for the letter.
  if (!contact.email.includes("@")) return false;
  if (options.allowUnconfirmed) return true;
  if (contact.confirmedAt) return true;
  console.warn(
    `[contacts] refused to mail ${contact.email}: address has not confirmed via the passcode ` +
      "flow (confirmed_at is null). Pass { allowUnconfirmed: true } if this send's whole " +
      "purpose is to reach an unproven address, and say why at the call site.",
  );
  return false;
}

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

/** The "why you got this" sentence (W44, B2440) for each kind of mail this
 * file sends — one per family, never a bare "Sent by". */
type WhyKind = "codeJournal" | "invite" | "reader" | "owner";
const WHY_KEY = {
  codeJournal: "mail.why.codeJournal",
  invite: "mail.why.invite",
  reader: "mail.why.reader",
  owner: "mail.why.owner",
} as const;
function footerFor(locale: Locale, user: UserConfig, kind: WhyKind): string {
  return translateIn(locale, WHY_KEY[kind], { site: user.title });
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

/**
 * The one-time code (C12). Transactional: no unsubscribe link, because there
 * is nothing yet to unsubscribe from.
 *
 * **And, since B798, a button — when the caller has a link token to hang one
 * off.** The reader this mail is for is a 66-year-old following one link from
 * a group chat, and the step she gives up at is leaving the browser, finding
 * six digits in a mail app, and typing them back into a form she left open
 * behind her. The approval mail two steps later is already one press
 * (`sendApprovedMail`); this is the same mechanism, on the step that actually
 * loses people.
 *
 * **The code stays, underneath, and that is not a formality.** A mail client
 * that mangles a long URL is a real failure with a real frequency, and the six
 * digits are what rescues it — the same reasoning `/{user}/s/{token}` gives
 * for keeping the code in the sign-in mail.
 *
 * `linkToken` is `issueCode`'s own — one row, one code, one link, so following
 * the button retires the code and vice versa. Guarded on
 * `isEnabled("auth", …)`, exactly as `sendApprovedMail` guards its own: a
 * journal with `contacts` on and `auth` off has no `/{user}/s/…` page, and a
 * button pointing at a 404 is worse than no button.
 */
/**
 * `code.mail`'s composition — B2493. Pure: `link` is already resolved (the
 * `isEnabled`/`signInUrl` call stays in `sendCodeMail`, below), so this is
 * the exact function a preview calls too.
 */
export function composeCodeMail(params: {
  title: string;
  locale: Locale;
  code: string;
  link?: string | null;
  preapproved?: boolean;
}): MailComposition {
  const { title, locale, code, link = null, preapproved = false } = params;
  return composeCodeMailContent({
    template: "code.mail",
    locale,
    code,
    place: title,
    title: translateIn(locale, link ? "contact.mailCodeLinkTitle" : "contact.mailCodeTitle"),
    purpose: link
      ? translateIn(locale, preapproved ? "contact.mailCodeLinkBodyPreapproved" : "contact.mailCodeLinkBody")
      : translateIn(locale, "contact.mailCodePurpose"),
    url: link ?? undefined,
    buttonText: link ? translateIn(locale, "contact.mailCodeButton") : undefined,
    ignoreText: translateIn(locale, "contact.mailCodeIgnore"),
    why: translateIn(locale, WHY_KEY.codeJournal, { site: title }),
  });
}

export async function sendCodeMail(
  username: string,
  user: UserConfig,
  to: string,
  locale: Locale,
  code: string,
  linkToken?: string | null,
  /** B1132: whether the address this code is proving is already
   * pre-approved on the invite it arrived on (`preapprovedEmailFor`). The
   * link, when there is one, is the whole of what stands between this
   * reader and being let in — "nothing opens yet" is true for the ordinary
   * queued reader and false for this one, so the mail must not say it. */
  preapproved = false,
) {
  // The one named exception (B334): an unconfirmed address is the whole point
  // of a passcode mail — there is nothing yet to have confirmed.
  mayMailContact({ email: to, confirmedAt: null }, { allowUnconfirmed: true });
  const link = linkToken && isEnabled("auth", username)
    ? signInUrl(baseUrl(), username, linkToken, locale)
    : null;
  const { subject, content } = composeCodeMail({ title: user.title, locale, code, link, preapproved });
  return sendMail(renderMail(to, subject, content, username));
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
  /** B2442 — the address asked never to be invited again. Reports why the
   * studio saw nothing sent, distinct from mail simply failing. */
): Promise<SendResult | "suppressed" | null> {
  // The other named exception (B334): this is the owner directly handing
  // somebody a link, before that address has proved anything at all.
  mayMailContact({ email: input.email, confirmedAt: null }, { allowUnconfirmed: true });
  if (await isInviteSuppressed(input.email)) {
    await logMessage({
      template: "invite.mail",
      channel: "mail",
      to: input.email,
      owner: username,
      locale: input.locale,
      status: "skipped",
      reason: "suppressed",
    });
    return "suppressed";
  }
  const buddy = input.kind === "buddy";
  const vars = {
    title: user.title,
    nickname: user.owner.nickname,
    trip: input.tripTitle ?? "",
  };
  try {
    return await sendMail(
      inviteMail({
        to: input.email,
        locale: input.locale,
        subject: translateIn(input.locale, buddy ? "contact.mailInviteBuddySubject" : "contact.mailInviteGuestSubject", vars),
        title: translateIn(input.locale, "contact.mailInviteTitle"),
        body: translateIn(input.locale, buddy ? "contact.mailInviteBuddyBody" : "contact.mailInviteGuestBody", vars),
        buttonText: translateIn(input.locale, "contact.mailInviteButton"),
        buttonUrl: input.url,
        why: footerFor(input.locale, user, "invite"),
        manage: neverInviteAvailable()
          ? {
          text: translateIn(input.locale, "contact.neverInvite"),
          href: neverInviteUrl(baseUrl(), input.email),
          unsubscribeHref: neverInviteConfirmUrl(baseUrl(), input.email),
        }
          : undefined,
        username,
      }),
    );
  } catch (err) {
    console.error(`[contacts] invite mail to ${input.email} failed:`, err);
    return null;
  }
}

/**
 * The welcome link, by email — B2292. The owner pressed "Email" in step 2 of
 * Add a person (or "Resend by email" on the card), naming the address
 * themselves: the same exception `sendInviteMail` is to B334, since a person
 * the owner added may not have proved anything yet.
 *
 * Not best effort: the caller reports what happened on the button the owner
 * pressed, so a throw is its to catch, and `null` means mail is off.
 */
export async function sendWelcomeMail(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
  message: { locale: Locale; url: string; text: string; subject: string },
  /** Which registry id this is — `invite.mail` when this is the owner
   * handing somebody a link (Add a person), `invite.in.mail` when it is
   * telling somebody already let in that they're in (`tellLetIn`). Both
   * callers name it explicitly (B2438) since this one function serves both
   * purposes. */
  template: "invite.mail" | "invite.in.mail" = "invite.mail",
): Promise<SendResult | null> {
  if (!mayMailContact(contact, { allowUnconfirmed: true })) return null;
  const token = manageTokenFor(username, contact.id);
  const buttonText = translateIn(message.locale, "welcomeLink.mailButton");
  const why = footerFor(message.locale, user, "invite");
  if (template === "invite.mail") {
    // B2442 — this is the one still asking somebody in, so the manage line
    // is "never invite this address again", not "stop these emails": a
    // suppression check already ran, in `sendInvite` (welcome.ts), before
    // this was ever called.
    return sendMail(
      inviteMail({
        to: contact.email,
        locale: message.locale,
        subject: message.subject,
        title: message.subject,
        body: message.text,
        buttonText,
        buttonUrl: message.url,
        why,
        manage: neverInviteAvailable()
          ? {
          text: translateIn(message.locale, "contact.neverInvite"),
          href: neverInviteUrl(baseUrl(), contact.email),
          unsubscribeHref: neverInviteConfirmUrl(baseUrl(), contact.email),
        }
          : undefined,
        username,
      }),
    );
  }
  return sendMail(
    letInMail({
      to: contact.email,
      locale: message.locale,
      subject: message.subject,
      title: message.subject,
      body: message.text,
      buttonText,
      buttonUrl: message.url,
      why,
      manage: {
        text: translateIn(message.locale, "contact.unsubscribe"),
        href: unsubscribeUrlFor(baseUrl(), username, token),
      },
      username,
    }),
  );
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
/**
 * `notice.request`'s composition — B2493. Covers all three shapes
 * `notifyOwnerOfRequest` sends: a plain reader confirming their address
 * (`tripTitle` and `asked` both absent — the preview's main path), a buddy
 * link asking for write access (`tripTitle` set — B349), and somebody who
 * pressed "ask to be let in" in front of a closed trip (`asked: true` — B601).
 */
export function composeRequestMail(params: {
  username: string;
  title: string;
  locale: Locale;
  contactId: string;
  name: string;
  email: string;
  tripTitle?: string | null;
  asked?: boolean;
}): MailComposition {
  const { username, title, locale, contactId, name, email, tripTitle = null, asked = false } = params;
  const bodyVars = { name, email, trip: tripTitle ?? "" };
  const bodyKey = tripTitle
    ? "contact.mailRequestBuddyBody"
    : asked
    ? "contact.mailRequestAskedBody"
    : "contact.mailRequestBody";
  // B362 — the subject calling this a follow request was the other half of
  // what B349 fixed in the body; a buddy link is asking to write, not to
  // follow.
  const subjectKey = tripTitle
    ? "contact.mailRequestBuddySubject"
    : asked
    ? "contact.mailRequestAskedSubject"
    : "contact.mailRequestSubject";
  return {
    channel: "mail",
    subject: translateIn(locale, subjectKey, { title, trip: tripTitle ?? "" }),
    content: {
      template: "notice.request",
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
        // B800 — the other half of a sentence the reader is now told:
        // "most people are let in within a day or two". Neither side used
        // to be told *when*, so a reader could not tell "not yet" from
        // "broken" and the owner had no sense that anybody was blocked on
        // them. One line, in the owner's language, saying somebody is
        // waiting on this.
        { kind: "paragraph", text: translateIn(locale, "contact.mailRequestSoon") },
        {
          kind: "button",
          text: translateIn(locale, "contact.mailRequestButton"),
          href: `${baseUrl()}/${username}/studio/readers?contact=${encodeURIComponent(contactId)}`,
        },
      ],
      why: translateIn(locale, WHY_KEY.owner, { site: title }),
      locale,
    },
  };
}

export async function notifyOwnerOfRequest(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
): Promise<boolean> {
  // Does not call `mayMailContact` (B334): this letter is addressed to
  // `user.owner.email` from `config.json`, never to `contact.email` — the
  // owner is not the contact confirming, so there is no `confirmed_at` on the
  // recipient to be asking about. A different question, not an exception.
  if (!user.owner.email) return false;
  const locale = await ownerLocale(username, user.owner.email, user.defaultLocale);
  // B349 — a buddy link is asking for write access to a trip, not to
  // "follow along". Same two facts the contacts page already shows for this
  // row (`viaLabel()` in `ContactsAdmin.tsx`): which kind of link, and which
  // trip. Null for everyone else, and the sentence is unchanged for them.
  const trip = await buddyTripFor(username, contact);
  // B601 — somebody who pressed "ask to be let in" in front of a closed trip
  // did not "confirm their email address and would like to follow along":
  // they were already signed in, met a locked trip, and asked. Saying so is
  // what tells the owner whether this is a stranger who found the journal or
  // somebody they had already sent a link to.
  const asked = contact.createdVia === "asked";
  const { subject, content } = composeRequestMail({
    username,
    title: user.title,
    locale,
    contactId: contact.id,
    name: contact.name ?? contact.email,
    email: contact.email,
    tripTitle: trip?.title,
    asked,
  });
  try {
    const result = await sendMail(renderMail(user.owner.email, subject, content, username));
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
 * There is no longer a journal to guard against — B938. `contacts` declares
 * that it needs `auth`, so an instance without `/{user}/s/{token}` has no
 * approval queue to send this from. The fallback that used to stand here
 * mailed the front page instead, which is the gate she had just been told she
 * was past.
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
  if (!mayMailContact(contact)) return null;
  const locale = pickLocale(contact.locale);
  try {
    // Recomputed rather than carried around: the manage token is derived from
    // the contact id, so a mail written months later still has the working
    // link.
    const token = manageTokenFor(username, contact.id);
    /**
     * Always a sign-in link — B938.
     *
     * There used to be a fallback to the journal's front page for an instance
     * with `auth` off, and it was the one link in this mail that could not
     * work: she would arrive at the gate she had just been told she was past.
     * `contacts` now declares that it needs `auth` (`lib/capabilities.ts`), so
     * there is no such instance to write a link for.
     */
    const openUrl = signInUrl(
      baseUrl(),
      username,
      await issueStandingLink(username, contact.email),
      locale,
    );
    // B347 — this contact may hold write access to a trip, not only reading
    // rights, and the only mail they ever get about being approved is this
    // one. `buddyTripFor` is null for a guest link, and the mail is unchanged
    // for them.
    const trip = await buddyTripFor(username, contact);
    const bodyKey = trip ? "contact.mailApprovedBuddyBody" : "contact.mailApprovedBody";
    const bodyVars = { title: user.title, trip: trip?.title ?? "" };
    return await sendMail(
      letInMail({
        to: contact.email,
        locale,
        subject: translateIn(locale, "contact.mailApprovedSubject", { title: user.title }),
        title: translateIn(locale, "contact.mailApprovedTitle"),
        body: translateIn(locale, bodyKey, bodyVars),
        buttonText: translateIn(locale, "contact.mailApprovedButton", { title: user.title }),
        buttonUrl: openUrl,
        items: [
          ...(trip
            ? [
                {
                  title: translateIn(locale, "contact.mailApprovedMeLink"),
                  href: `${baseUrl()}/${username}/me`,
                },
              ]
            : []),
          {
            title: translateIn(locale, "contact.mailManageButton"),
            meta: translateIn(locale, "contact.mailManageCaption"),
            href: manageUrl(baseUrl(), username, token),
          },
        ],
        why: footerFor(locale, user, "reader"),
        manage: {
          text: translateIn(locale, "contact.unsubscribe"),
          href: unsubscribeUrlFor(baseUrl(), username, token),
        },
        username,
      }),
    );
  } catch (err) {
    console.error(`[contacts] approval mail to ${contact.email} failed:`, err);
    return null;
  }
}
