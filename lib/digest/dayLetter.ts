import "server-only";
import fs from "node:fs";
import { isEnabled, hasSwitchedOff } from "../capabilities";
import { maySeePhoto, type ReaderLevel } from "../photos";
import { isOpenToLink, isTestContent } from "../access";
import {
  listContacts,
  manageTokenFor,
  manageUrl,
  unsubscribeUrlFor,
} from "../contacts";
import { mayMailContact } from "../contacts/mail";
import { pickLocale } from "../contacts/locale";
import type { UserConfig } from "../config";
import { conversionFor, costForDay } from "../costs";
import { formatMoney } from "../currency";
import { recordNotified } from "./dayNotify";
import { AS_AUTHOR, getEntryBySlug } from "../entries";
import { contactsWithReadGrant } from "../grants";
import { translateIn } from "../locales";
import { sendMail } from "../mail";
import { renderMail, type MailBlock } from "../mail/template";
import type { Mail, MailAttachment } from "../mail/types";
import { contentTypeFor, resolveMediaFile, resizedCopy } from "../media";
import { serverSite } from "../site";
import { peopleOf } from "../tripPeople";
import { getTrip } from "../trips";
import type { Entry, Locale, Trip } from "../types";
import { getUser } from "../users";
import { dayUrl, formatDigestDate } from "./content";
import { journalTimezone } from "./quiet";

/**
 * The letter one published day sends — B345.
 *
 * Deliberately not a second mail system: recipients are the same journal-wide
 * contacts the digest already knows (`listContacts`, `contactsWithReadGrant`),
 * the same trip membership `lib/tripPeople.ts` already tracks (`peopleOf`), and
 * the same template every other letter renders through
 * (`lib/mail/template.ts`). What is new is the trigger — a write, not a
 * schedule — and a richer, single-day payload sent through it.
 *
 * ## Who is reached, and who decided it
 *
 * Only **approved contacts who have opted in** (`status: "active"` and
 * `wantsEmailDigest`), plus the owner, always. A person merely named in a
 * trip's `people:` block gets no letter unless they are *also* such a
 * contact — being on the bus grants write access and read access to the
 * trip, never a mailing address this system invents on their behalf. What
 * `peopleOf` changes is not who may be reached, but which of the *already
 * reachable* contacts a closed trip reaches: a contact who is also a
 * traveller sees a `private` trip's letter even without a journal-wide read
 * grant, the same way `isTravellerOn` widens `mayReadTrip` on the site
 * itself.
 *
 * `mayMailTrip` and `mayMailCosts` below are that gate, restated without a
 * request to ask a session from. They must never admit more than
 * `mayReadTrip` / `mayViewCosts` (`lib/tripGate.ts`) would for the same
 * person, on pain of a letter carrying words and a cost to somebody the site
 * would refuse.
 *
 * **They are a second copy of a permission rule** — `mayMailTrip` is
 * `isOpenToLink || traveller || (not private && granted)`, and `mayMailCosts`
 * is `isEnabled && (costsVisibility public || isGuestOf)`, which is
 * `maySeeCosts(trip, isGuestOf(trip))` inlined — and B363 is the record that
 * "faithful when written" is not a promise a second copy keeps on its own.
 * `test/day-mail.test.ts` pins the behaviour these produce in isolation;
 * `test/day-mail-parity.test.ts` is the one that would have caught B363
 * itself — it drives `mayReadTrip`/`mayViewCosts` and these two for the same
 * viewer, over every visibility and cost-visibility combination, and fails
 * the moment either pair disagrees. A change to `mayReadTrip` or
 * `mayViewCosts` that leaves these two behind fails that suite, not silently.
 *
 * The reason they exist at all: `mayReadTrip` reads a cookie, and there is no
 * cookie when the question is "may this address be sent a letter". If that
 * ever becomes expressible without duplication — a shared pure core the two
 * wrappers call — that is the better answer and this comment is the argument
 * for it. The parity test is the smaller, safer thing done in the meantime
 * (B363): the two wrappers special-case the owner differently from the site
 * gates (`recipientsFor` includes the owner upstream of both, unconditionally
 * and for free, so neither wrapper has an owner branch to keep in step), which
 * is exactly the kind of "cannot be reduced without contortion" the ticket
 * asked to have written down.
 */

/** Mirrors `mayReadTrip` (`lib/tripGate.ts`) for one address, without a
 * session to read it from: `isTraveller` stands in for `isTravellerOn`,
 * `granted` for `isJournalGuest` — a contact who is `active` and holds a live
 * `read` grant, exactly what `isJournalGuest` tests.
 *
 * **Exported so B365's WhatsApp announcement shares it rather than copying
 * it.** The comment above this block is a warning about one permission rule
 * living in two places; a second channel with its own transcription of the
 * same three lines is precisely the drift it describes, and the second copy
 * would be the one nobody updates. Any channel that announces a trip asks
 * this function. */
export function mayMailTrip(trip: Trip, isTraveller: boolean, granted: boolean): boolean {
  if (isOpenToLink(trip)) return true;
  if (isTraveller) return true;
  if (trip.visibility === "private") return false;
  return granted;
}

/** Mirrors `mayViewCosts` + `isGuestOf` (`lib/tripGate.ts`) for one address —
 * asked per recipient, never once for the whole letter. Exported only for
 * `test/day-mail-parity.test.ts` (B363), the same way `mayMailTrip` is
 * exported for B365's WhatsApp announcement — a black-box parity test that
 * had to re-derive this formula rather than call it would not catch drift in
 * the formula itself. */
export function mayMailCosts(trip: Trip, isTraveller: boolean, granted: boolean): boolean {
  if (!isEnabled("costs", trip.username)) return false;
  if (trip.costsVisibility === "public") return true;
  if (isTraveller) return true;
  if (trip.visibility === "private") return false;
  return granted;
}

type DayLetterRecipient = {
  email: string;
  name: string | null;
  locale: Locale;
  showCosts: boolean;
  /**
   * How far this recipient has got, for a photograph's own label — B596.
   *
   * `person` for the owner and for anybody who was on the trip, `guest` for a
   * contact the owner let into the journal. Resolved here rather than in
   * `photoAttachment` because this is the only place that already knows which
   * of the two an address is, and `mayMailTrip` above has just used the same
   * two facts to decide the address gets a letter at all.
   */
  reader: ReaderLevel;
  /** Null for the owner's own copy — there is nothing to unsubscribe from
   * one's own journal. */
  manageToken: string | null;
};

async function recipientsFor(trip: Trip, user: UserConfig): Promise<DayLetterRecipient[]> {
  const owner = trip.username;
  const [contacts, granted, travellers] = await Promise.all([
    listContacts(owner),
    contactsWithReadGrant(owner, new Date()),
    peopleOf(trip),
  ]);
  const travellerSet = new Set(travellers.map((e) => e.toLowerCase()));

  const out: DayLetterRecipient[] = [];
  const seen = new Set<string>();

  // The owner, always — it is their journal and their record that it went.
  if (user.owner.email) {
    seen.add(user.owner.email.trim().toLowerCase());
    out.push({
      email: user.owner.email,
      name: user.owner.nickname || user.owner.name,
      locale: pickLocale(user.defaultLocale),
      showCosts: true,
      reader: "person",
      manageToken: null,
    });
  }

  for (const contact of contacts) {
    if (contact.status !== "active") continue;
    // The opt-in this is measured against, per the owner's decision on
    // B345: one switch, not two. A reader who turned the digest off asked
    // for no more letters, this one included.
    if (!contact.wantsEmailDigest) continue;
    // B334 — `status === "active"` is unreachable without `confirmed_at` set
    // today, which is exactly why nothing here had ever failed. Asked anyway,
    // through the one gate every contact-addressed sender routes through, so
    // a future change to what "active" means cannot quietly reopen this.
    if (!mayMailContact(contact)) continue;

    const email = contact.email.trim().toLowerCase();
    if (seen.has(email)) continue; // never the owner twice
    const isTraveller = travellerSet.has(email);
    const isGrantHolder = granted.has(contact.id);
    if (!mayMailTrip(trip, isTraveller, isGrantHolder)) continue;

    seen.add(email);
    out.push({
      email: contact.email,
      name: contact.name,
      locale: pickLocale(contact.locale, user.defaultLocale),
      showCosts: mayMailCosts(trip, isTraveller, isGrantHolder),
      reader: isTraveller ? "person" : "guest",
      manageToken: manageTokenFor(owner, contact.id),
    });
  }

  return out;
}

/** An entry's title/content in the reader's language — same fallback rule as
 * `lib/digest/content.ts`'s `localizedEntryTitle`: `en` is what days are
 * authored in and never has an override. */
function localizedTitle(locale: Locale, entry: Entry): string {
  if (locale === "en") return entry.title;
  return entry.translations?.[locale]?.title ?? entry.title;
}
function localizedContent(locale: Locale, entry: Entry): string {
  if (locale === "en") return entry.content;
  return entry.translations?.[locale]?.content ?? entry.content;
}

/** How much of the day's own words to carry — an opening, not the whole
 * entry, so the letter reads as an invitation rather than a substitute for
 * the page (see the plan's "how much of the words"). */
const LEAD_MAX_CHARS = 420;

function leadParagraph(content: string): string {
  const firstParagraph = content.trim().split(/\n\s*\n/)[0] ?? "";
  const flat = firstParagraph.replace(/\s+/g, " ").trim();
  if (flat.length <= LEAD_MAX_CHARS) return flat;
  const cut = flat.slice(0, LEAD_MAX_CHARS);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 200 ? cut.slice(0, atWord) : cut).trim()}…`;
}

/** A universal deep link — no key needed, opens in whatever map app the
 * reader has. Only when the day actually carries a coordinate. */
function mapUrlFor(lat: number | undefined, lng: number | undefined): string | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Web-sized (~35 KB), never the 2000px derivative ingest keeps — a day with
 * nine pictures still becomes one photograph in the letter. */
const PHOTO_WIDTH = 640;

/**
 * The day's first photograph, as an inline attachment — never a link.
 *
 * `app/[user]/media/[...path]/route.ts` gates every image on `mayReadTrip`,
 * and a mail client carries no session cookie: a linked `<img>` would be a
 * 404 in the inbox for every trip that is not fully public. So the bytes
 * travel with the message (`cid:`), read straight off disk the same way that
 * route resolves a path — `resolveMediaFile` is the one function that turns
 * a gallery `src` into a file, on either side.
 *
 * Best-effort: a missing or unreadable file means no photograph, not a
 * failed letter. A video is skipped — `<img src="cid:…">` cannot show one —
 * in favour of the first *image* in the gallery, if there is one.
 *
 * **`level` is this recipient's, not the trip's** — B596, and the reason the
 * entry reaches this function unfiltered. Every other reading path resolves a
 * photograph's label once, against whoever is holding the browser; a letter
 * has a different reader per copy, and the list mixes people who were on the
 * trip with contacts the owner let into the journal. Filtering the entry once
 * would either mail a private photograph to the whole list or withhold it
 * from the travellers it belongs to. So the pick happens here, per copy.
 */
async function photoAttachment(
  trip: Trip,
  entry: Entry,
  fallbackAlt: string,
  level: ReaderLevel,
): Promise<{ block: Extract<MailBlock, { kind: "image" }>; attachment: MailAttachment } | null> {
  const image = entry.gallery.find(
    (item) => item.type === "image" && maySeePhoto(item.visibility, level),
  );
  if (!image) return null;

  // `entry.gallery[*].src` is already owner-prefixed by `lib/entries.ts` —
  // `/{username}/media/{tripId}/{path}` — the exact shape the media route
  // resolves. Strip the URL prefix back to the segments that route works with.
  const prefix = `/${trip.username}/media/`;
  if (!image.src.startsWith(prefix)) return null;
  const segments = image.src.slice(prefix.length).split("/").filter(Boolean);
  const file = resolveMediaFile(trip.username, segments);
  if (!file) return null;

  let data: Buffer;
  let contentType: string;
  try {
    const resized = await resizedCopy(file, PHOTO_WIDTH);
    if (resized) {
      data = resized;
      contentType = "image/webp";
    } else {
      data = fs.readFileSync(file);
      contentType = contentTypeFor(file);
    }
  } catch {
    return null;
  }

  const contentId = "day-photo";
  return {
    attachment: {
      filename: `photo.${contentType === "image/webp" ? "webp" : "jpg"}`,
      contentType,
      data,
      contentId,
    },
    block: { kind: "image", cid: contentId, alt: image.caption ?? fallbackAlt },
  };
}

async function renderDayLetter(
  trip: Trip,
  entry: Entry,
  user: UserConfig,
  recipient: DayLetterRecipient,
  base: string,
): Promise<Mail> {
  const locale = recipient.locale;
  const title = localizedTitle(locale, entry);
  const lead = leadParagraph(localizedContent(locale, entry));
  const url = dayUrl(base, trip.username, trip.id, entry.slug);

  // Place, date, the journal's own timezone stated plainly (decided by the
  // owner: no clock computed from it, which is how B345's plan avoided
  // announcing a confidently wrong "it is 9pm there" for a day published
  // weeks late), and the cost — only for a reader this recipient-specific
  // gate actually admits.
  const metaParts = [
    [entry.location, entry.country].filter(Boolean).join(", "),
    formatDigestDate(locale, entry.date),
    translateIn(locale, "dayMail.timezone", { zone: journalTimezone() }),
  ].filter((part) => part !== "");

  if (recipient.showCosts && entry.costs.length > 0) {
    const { base: currency } = conversionFor(trip.ref);
    const amount = costForDay(trip.ref, [entry]);
    if (amount > 0) metaParts.push(formatMoney(amount, currency));
  }

  const blocks: MailBlock[] = [];
  if (recipient.name) {
    blocks.push({
      kind: "paragraph",
      text: translateIn(locale, "digest.greeting", { name: recipient.name }),
    });
  }

  const photo = await photoAttachment(trip, entry, title, recipient.reader);
  if (photo) blocks.push(photo.block);

  blocks.push({ kind: "meta", text: metaParts.join(" · ") });
  blocks.push({ kind: "paragraph", text: lead });

  const mapUrl = mapUrlFor(entry.lat, entry.lng);
  if (mapUrl) {
    blocks.push({ kind: "item", title: translateIn(locale, "dayMail.map"), href: mapUrl });
  }

  blocks.push({ kind: "button", text: translateIn(locale, "dayMail.button"), href: url });

  const manage = recipient.manageToken
    ? manageUrl(base, trip.username, recipient.manageToken)
    : undefined;
  const unsubscribe = recipient.manageToken
    ? unsubscribeUrlFor(base, trip.username, recipient.manageToken)
    : undefined;

  return renderMail(
    recipient.email,
    translateIn(locale, "dayMail.subject", { title: user.title, day: title }),
    {
      preheader: title,
      title,
      blocks,
      footer: translateIn(locale, "digest.footer", { site: user.title }),
      ...(manage
        ? { manageLink: { text: translateIn(locale, "digest.preferences"), href: manage } }
        : {}),
      unsubscribeUrl: unsubscribe,
      unsubscribeLabel: translateIn(locale, "contact.unsubscribe"),
      ...(photo ? { attachments: [photo.attachment] } : {}),
    },
    trip.username,
  );
}

/** Why nothing was attempted — every case here is not a bug, and the API
 * routes turn it into a sentence rather than a stack trace. */
type DayLetterSkipReason =
  | "unknown_trip"
  | "unknown_day"
  | "not_published"
  | "test_content"
  | "mail_off"
  /** `no_credits` was here until B840, and is gone with the charge: a letter
   *  costs nothing, so there is no balance for one to refuse on. WhatsApp
   *  keeps its own. */
  | "contacts_off";

export type DayLetterOutcome =
  | {
      ok: true;
      resend: boolean;
      sent: { email: string }[];
      failed: { email: string; error: string }[];
    }
  | {
      ok: false;
      reason: DayLetterSkipReason;
    };

/**
 * Send the letter for one published day — both of B345's triggers land here.
 *
 * Never throws for an ordinary reason not to send (a test day, mail switched
 * off, a draft that is not on the site yet); those come back as
 * `{ ok: false, reason }` for the caller to report. What it does not do is
 * fail the publish it may be called from — every recipient's send is its own
 * `try`, so one bad address never stops the rest of the run, and the whole
 * function is meant to be wrapped in a `try` of its own at the call site
 * (B272: mail is best-effort everywhere).
 */
/**
 * How many people a send to this trip would reach, without sending anything —
 * B366, and **a count of people rather than of credits since B840**.
 *
 * It was `mailWouldCost`, and it existed so the publish route could refuse
 * *before* `publishDraft` wrote to disk: it needs the figure while the day is
 * still a draft, and `sendDayLetter` cannot give it one because it declines to
 * render a letter for an unpublished day. Hence a second entry point — but
 * **not** a second answer: it calls the same `recipientsFor` the send itself
 * calls, so what is quoted and what actually happens cannot drift. A
 * hand-rolled "count the contacts who opted in" beside it is precisely the
 * duplication `mayMailTrip`'s doc comment above is an essay about.
 *
 * Nothing refuses on this number any more, because a letter is free. It is
 * still the honest answer to "who would hear about this", which is what the
 * account panel prints and what `test/entry-visibility.test.ts` uses to prove
 * a day held back from part of the trip is held back from their inbox too —
 * the leak that whole feature exists to close, wearing an inbox instead of a
 * URL. Reintroducing a price makes this the function to multiply.
 *
 * Zero for a trip or journal that does not exist, and zero for content nobody
 * lived — which is a `test: true` trip **or** a `test: true` day inside an
 * ordinary one. Both, and via `isTestContent`, because the send itself refuses
 * on exactly that predicate before it charges: quoting a price the charge
 * would never ask for is how B379 stopped an owner low on credits from
 * publishing the very content the flag exists to let them publish freely.
 *
 * `slug` is therefore not optional in practice even though the type allows it.
 * Omitting it answers for the trip alone and cannot see a test day, which is
 * the bug; it stays optional only so a caller that genuinely has no day in
 * hand — none exists today — is not forced to invent one.
 */
export async function mailWouldReach(owner: string, ref: string, slug?: string): Promise<number> {
  const user = getUser(owner);
  const trip = getTrip(ref);
  if (!user || !trip) return 0;
  const recipients = await recipientsFor(trip, user);
  if (slug !== undefined) {
    // `AS_AUTHOR`, not the closed default — this is the owner asking about
    // *their own* send, and a day they have held back from some of the list is
    // exactly the case being asked about. Reading it at `public` would make a
    // held-back day answer "no such day" and report nobody, which is the wrong
    // direction to be wrong in.
    const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
    // A day that does not exist has no send and therefore reaches nobody; the
    // route has already answered 404 for it long before this.
    if (!entry) return 0;
    if (isTestContent(trip, entry)) return 0;
    // B632 — the same narrowing a page applies, applied to who gets a letter:
    // a recipient the day's own label refuses is a recipient whose inbox this
    // day does not reach, and saying otherwise here would be the leak.
    return recipients.filter((r) => maySeePhoto(entry.visibility, r.reader)).length;
  } else if (trip.test === true) {
    return 0;
  }
  return recipients.length;
}

export async function sendDayLetter(
  owner: string,
  ref: string,
  slug: string,
  options: { resend?: boolean } = {},
): Promise<DayLetterOutcome> {
  const user = getUser(owner);
  const trip = getTrip(ref);
  if (!user || !trip) return { ok: false, reason: "unknown_trip" };

  // Read unfiltered, and this is the one path that has to be: the letter's
  // reader differs per copy, so `photoAttachment` picks per recipient. B596.
  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return { ok: false, reason: "unknown_day" };
  if (entry.draft) return { ok: false, reason: "not_published" };

  // The one rule that is not negotiable: content nobody lived reaches no
  // inbox, whatever else is true about the trip or the reader.
  if (isTestContent(trip, entry)) return { ok: false, reason: "test_content" };

  if (!isEnabled("mail") || hasSwitchedOff("mail", owner)) {
    return { ok: false, reason: "mail_off" };
  }
  if (!isEnabled("contacts", owner)) return { ok: false, reason: "contacts_off" };

  // B632. `recipientsFor` answers who may be mailed about *this trip*; a day
  // inside it may hold itself back further, the same way one photograph
  // already could — so the list this actually sends to is narrower still.
  // Filtered here, once, rather than inside `recipientsFor` (which has no
  // entry to ask about) or left to `photoAttachment` (which only ever
  // answers for one picture, never for whether a copy goes out at all).
  const recipients = (await recipientsFor(trip, user)).filter((r) =>
    maySeePhoto(entry.visibility, r.reader),
  );

  // Nothing is charged here — B840. It used to be one credit per recipient,
  // taken for the whole list before the first letter left, all or nothing.
  // A letter costs about a hundredth of a Rappen to deliver and a credit is
  // CHF 0.20, so a day announced to twenty people came to CHF 4 — and every
  // one of those addresses had been approved by hand by the owner, so the
  // fan-out the meter was guarding against could not happen anyway. The
  // charge, the refund and the `no_credits` refusal went with it; `day_mail`
  // stays in `SpendReason` so ledgers written before this still read.
  //
  // `dayWhatsapp.ts` deliberately still charges: Meta invoices per message.

  const base = serverSite().url;

  const sent: { email: string }[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const recipient of recipients) {
    try {
      const mail = await renderDayLetter(trip, entry, user, recipient, base);
      const result = await sendMail(mail);
      // `null` means mail is switched off — already refused above, so this
      // should not happen; treated as "nothing sent" rather than a failure.
      if (result !== null) sent.push({ email: recipient.email });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ email: recipient.email, error: message });
    }
  }

  // Recorded whatever happened — B633. Nothing bills for a letter, and the
  // ledger therefore has no row for one, so this is the only place "has this
  // day been announced" can be answered from.
  await recordNotified(owner, trip.id, slug, "mail");

  return { ok: true, resend: options.resend === true, sent, failed };
}
