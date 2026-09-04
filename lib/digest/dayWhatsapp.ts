import "server-only";
import { hasSwitchedOff, isEnabled } from "../capabilities";
import { isTestContent } from "../access";
import { balanceOf, refund, spend } from "../credits";
import { listContacts } from "../contacts";
import { pickLocale } from "../contacts/locale";
import type { UserConfig } from "../config";
import { getEntryBySlug } from "../entries";
import { contactsWithReadGrant } from "../grants";
import { peopleOf } from "../tripPeople";
import { getTrip } from "../trips";
import type { Locale, Trip } from "../types";
import { getUser } from "../users";
import { sendWhatsapp } from "../whatsapp";
import { toE164 } from "../whatsapp/phone";
import { templateFor, whatsappCountryCode } from "../whatsapp/settings";
import type { WhatsappMessage } from "../whatsapp/types";
import { headerPhoto } from "./dayPhoto";
import { mayMailTrip } from "./dayLetter";

/**
 * The WhatsApp a published day announces — B365, and the second half of
 * B345's idea rather than a system of its own.
 *
 * Everything about *who may be told* is `dayLetter.ts`'s and is imported from
 * it (`mayMailTrip`), because that gate is a transcription of `mayReadTrip`
 * and one transcription is already one more than is safe. What differs here
 * is only the channel, and the channel differs in three ways worth stating up
 * front:
 *
 * 1. **It is always a template.** Outside a 24-hour customer service window
 *    Meta accepts nothing else, and nobody messaged us first. So there is no
 *    prose to compose: the words were approved days ago and this fills three
 *    blanks in them.
 * 2. **The owner is not automatically a recipient.** The mail path always
 *    copies the owner because `user.owner.email` exists; there is no
 *    `owner.tel` and inventing one would be this codebase deciding somebody's
 *    phone number belongs to it. An owner who wants the announcement is a
 *    contact of their own journal, like anybody else.
 * 3. **Costs never travel.** The letter renders a day's spend for readers
 *    permitted to see it; a template has no room for it and no per-recipient
 *    variation of its shape. `mayMailCosts` therefore has no counterpart
 *    here, which is the safe direction to differ in.
 */

/** Meta rejects a body parameter containing a newline, a tab, or more than
 * four consecutive spaces, and rejects an empty one outright. A day titled
 * with a line break is not a reason for a whole announcement to fail. */
function asParameter(value: string, fallback: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return flattened === "" ? fallback : flattened.slice(0, 300);
}

type WhatsappRecipient = {
  /** E.164 digits, already normalised — never the raw stored string. */
  to: string;
  name: string | null;
  locale: Locale;
};

/**
 * Who gets the message: approved contacts who opted in *to this channel* and
 * left a number that normalises.
 *
 * The three conditions are separate on purpose. `status: "active"` is the
 * owner's approval, `wantsWhatsapp` is the reader's consent, and a number
 * that survives `toE164` is the only evidence there is somewhere to send it.
 * A contact failing the third is silently skipped rather than reported as a
 * failure — they never asked for a message they could not receive, and an
 * error for every such row would make the summary useless.
 */
async function recipientsFor(trip: Trip, user: UserConfig): Promise<WhatsappRecipient[]> {
  const owner = trip.username;
  const [contacts, granted, travellers] = await Promise.all([
    listContacts(owner),
    contactsWithReadGrant(owner, new Date()),
    peopleOf(trip),
  ]);
  const travellerSet = new Set(travellers.map((e) => e.toLowerCase()));
  const countryCode = whatsappCountryCode();

  const out: WhatsappRecipient[] = [];
  const seen = new Set<string>();

  for (const contact of contacts) {
    if (contact.status !== "active") continue;
    if (!contact.wantsWhatsapp) continue;

    const tel = contact.postalAddress?.tel;
    if (!tel) continue;
    const to = toE164(tel, countryCode);
    if (!to) continue;
    // Two contacts may share a household number. One message, not two.
    if (seen.has(to)) continue;

    const email = contact.email.trim().toLowerCase();
    const isTraveller = travellerSet.has(email);
    if (!mayMailTrip(trip, isTraveller, granted.has(contact.id))) continue;

    seen.add(to);
    out.push({
      to,
      name: contact.name,
      locale: pickLocale(contact.locale, user.defaultLocale),
    });
  }

  return out;
}

/** Why nothing was attempted. Every case is an ordinary answer, not a bug. */
export type DayWhatsappSkipReason =
  | "unknown_trip"
  | "unknown_day"
  | "not_published"
  | "test_content"
  | "whatsapp_off"
  | "contacts_off"
  | "no_template"
  | "no_credits";

export type DayWhatsappOutcome =
  | {
      ok: true;
      resend: boolean;
      /** Masked, never the numbers — see `mailSummary`'s note on addresses. */
      sent: { to: string }[];
      failed: { to: string; error: string }[];
    }
  | {
      ok: false;
      reason: DayWhatsappSkipReason;
      /** Only set for `reason === "no_credits"`. */
      needed?: number;
      balance?: number;
    };

/**
 * Announce one published day on WhatsApp.
 *
 * Shaped exactly like `sendDayLetter`, including that it never throws for an
 * ordinary reason not to send and that each recipient's send is its own
 * `try`. The call sites wrap it again anyway (B272): an announcement must
 * never be able to turn a successful publish into a failure response.
 */
/**
 * How many credits a send to this trip would take, without sending anything —
 * B366.
 *
 * The publish route has to refuse *before* `publishDraft` writes to disk, so it
 * needs the count while the day is still a draft, and `sendDayLetter` cannot
 * give it one because it declines to render a letter for an unpublished day.
 * Hence a second entry point — but **not** a second answer: it calls the same
 * `recipientsFor` the charge itself calls, so the number quoted in a `402` and
 * the number actually debited cannot drift. A hand-rolled "count the contacts
 * who opted in" beside it is precisely the duplication `mayMailTrip`'s doc
 * comment above is an essay about.
 *
 * One credit per recipient, so the count *is* the cost; if that ever stops
 * being true this is the one place to change.
 *
 * Zero for a trip or journal that does not exist, and for a `test: true` trip —
 * content nobody lived reaches no inbox and therefore costs nothing.
 */
export async function whatsappWouldCost(owner: string, ref: string): Promise<number> {
  const user = getUser(owner);
  const trip = getTrip(ref);
  if (!user || !trip) return 0;
  if (trip.test === true) return 0;
  return (await recipientsFor(trip, user)).length;
}

export async function sendDayWhatsapp(
  owner: string,
  ref: string,
  slug: string,
  options: { resend?: boolean } = {},
): Promise<DayWhatsappOutcome> {
  const user = getUser(owner);
  const trip = getTrip(ref);
  if (!user || !trip) return { ok: false, reason: "unknown_trip" };

  const entry = getEntryBySlug(ref, slug, { includeDrafts: true });
  if (!entry) return { ok: false, reason: "unknown_day" };
  if (entry.draft) return { ok: false, reason: "not_published" };

  // The rule that is not negotiable anywhere: content nobody lived reaches
  // nobody's phone, whatever else is true.
  if (isTestContent(trip, entry)) return { ok: false, reason: "test_content" };

  if (!isEnabled("whatsapp") || hasSwitchedOff("whatsapp", owner)) {
    return { ok: false, reason: "whatsapp_off" };
  }
  if (!isEnabled("contacts", owner)) return { ok: false, reason: "contacts_off" };

  const recipients = await recipientsFor(trip, user);

  // One credit per recipient, charged for the whole list before the first
  // message leaves — B366, matching `sendDayLetter`. All or nothing: an
  // insufficient balance sends nothing rather than reaching some of the
  // list and not the rest.
  const needed = recipients.length;
  const ledgerRef = `${ref}/${slug}`;
  if (!(await spend(owner, needed, "day_whatsapp", ledgerRef))) {
    return { ok: false, reason: "no_credits", needed, balance: (await balanceOf(owner)) ?? 0 };
  }

  // Read once, not per recipient: the day's photograph is the same for
  // everybody, and re-encoding it fifty times would be fifty times the work
  // for one identical buffer.
  const photo = await headerPhoto(trip, entry);

  const sent: { to: string }[] = [];
  const failed: { to: string; error: string }[] = [];
  let anyTemplate = false;
  // A recipient with no template for their language was charged above along
  // with everybody else, and no message reaches them — that credit is owed
  // back exactly like a `failed` one, even though it never enters that array
  // (it is a config gap, not a send that threw).
  let skippedNoTemplate = 0;

  for (const recipient of recipients) {
    const template = templateFor(recipient.locale, user.defaultLocale);
    if (!template) {
      skippedNoTemplate++;
      continue;
    }
    anyTemplate = true;

    const message: WhatsappMessage = {
      to: recipient.to,
      template: template.name,
      language: template.language,
      body: [
        asParameter(recipient.name ?? "", "Hallo"),
        asParameter(trip.title, trip.id),
        asParameter(entry.title, entry.date),
      ],
      // No leading slash: the approved template owns the origin and appends
      // this to it. `dayUrl`'s shape, minus the base.
      buttonPath: `${trip.username}/trips/${trip.id}/day/${slug}`,
      photo: photo ?? undefined,
      username: owner,
    };

    try {
      const result = await sendWhatsapp(message);
      // `null` means the feature is off, already refused above; treated as
      // nothing sent rather than as a failure.
      if (result !== null) sent.push({ to: recipient.to });
    } catch (err) {
      failed.push({ to: recipient.to, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Give back only for messages that did not go out — never a blanket
  // reversal. A message that was delivered is spent whatever happens
  // afterwards.
  const notSent = failed.length + skippedNoTemplate;
  if (notSent > 0) await refund(owner, notSent, ledgerRef);

  // Told apart from "nobody opted in", which is not a misconfiguration. This
  // one means somebody ticked the box and the operator never registered a
  // template for any language they could be written in — silence there would
  // look identical to having no readers.
  if (recipients.length > 0 && !anyTemplate) return { ok: false, reason: "no_template" };

  return { ok: true, resend: options.resend === true, sent, failed };
}
