import "server-only";
import { isTestContent } from "../access";
import { isEnabled } from "../capabilities";
import { whatsappCountryCode } from "../contactNumber";
import { listContacts } from "../contacts";
import { pickLocale } from "../contacts/locale";
import { capText } from "../contacts/welcome";
import { balanceOf, refund, spend } from "../credits";
import { AS_AUTHOR, getEntryBySlug } from "../entries";
import { contactsWithReadGrant } from "../grants";
import { translateIn } from "../locales";
import { maskNumber, toE164 } from "../phone";
import { maySeePhoto, type ReaderLevel } from "../photos";
import { serverSite } from "../site";
import { sendSms, smsUnreachable } from "../sms";
import { peopleOf } from "../tripPeople";
import { getTrip } from "../trips";
import type { Entry, Trip } from "../types";
import { getUser } from "../users";
import { dayUrl } from "./content";
import { mayMailTrip } from "./dayLetter";
import { recordNotified } from "./dayNotify";

/**
 * A published day, announced by SMS — B2292 (B2291 D5), the channel beside
 * `paid/whatsapp/lib/digest/dayWhatsapp.ts` and shaped exactly like it: who
 * may be told is `dayLetter.ts`'s `mayMailTrip`, narrowed per recipient by
 * the day's own visibility; one credit per paying recipient, charged for the
 * whole list before the first text leaves, refunded for every text that did
 * not go.
 *
 * Differences from WhatsApp, both deliberate:
 * - **A plain text**, no template: an SMS is a string to a number.
 * - **Only people who ticked SMS** (`wants_sms`), the owner included: an
 *   owner's contact row with the tick gets a free copy, but the number in
 *   `owner.tel` alone does not opt anybody into texts.
 */

type SmsRecipient = { to: string; locale: string; free: boolean; reader: ReaderLevel };

async function recipientsFor(trip: Trip, entry: Entry | null): Promise<SmsRecipient[]> {
  const owner = trip.username;
  const user = getUser(owner);
  if (!user) return [];
  const [contacts, granted, travellers] = await Promise.all([
    listContacts(owner),
    contactsWithReadGrant(owner, new Date()),
    peopleOf(trip),
  ]);
  const travellerSet = new Set(travellers.map((e) => e.toLowerCase()));
  const ownerEmail = user.owner.email?.trim().toLowerCase() ?? null;
  const out: SmsRecipient[] = [];
  const seen = new Set<string>();
  for (const contact of contacts) {
    if (contact.status !== "active" || !contact.wantsSms || !contact.phone) continue;
    const to = toE164(contact.phone, whatsappCountryCode());
    if (!to || seen.has(to) || smsUnreachable(to)) continue;
    const email = contact.email.trim().toLowerCase();
    const isTraveller = email !== "" && travellerSet.has(email);
    if (!mayMailTrip(trip, isTraveller, granted.has(contact.id))) continue;
    const reader: ReaderLevel = isTraveller ? "person" : "guest";
    if (entry && !maySeePhoto(entry.visibility, reader)) continue;
    seen.add(to);
    out.push({
      to,
      locale: pickLocale(contact.locale, user.defaultLocale),
      free: email !== "" && email === ownerEmail,
      reader,
    });
  }
  return out;
}

/** The recipients a send would reach — empty for content nobody lived. */
async function wouldSendTo(owner: string, ref: string, slug: string): Promise<SmsRecipient[]> {
  const trip = getTrip(ref);
  const entry = trip ? getEntryBySlug(ref, slug, AS_AUTHOR) : null;
  if (!trip || !entry || isTestContent(trip, entry)) return [];
  return recipientsFor(trip, entry);
}

export async function smsWouldReach(owner: string, ref: string, slug: string): Promise<number> {
  return (await wouldSendTo(owner, ref, slug)).length;
}

export async function smsWouldCost(owner: string, ref: string, slug: string): Promise<number> {
  return (await wouldSendTo(owner, ref, slug)).filter((r) => !r.free).length;
}

export type DaySmsOutcome =
  | { ok: true; sent: { to: string }[]; failed: { to: string; error: string }[] }
  | {
      ok: false;
      reason: "unknown_trip" | "unknown_day" | "not_published" | "test_content" | "sms_off" | "contacts_off" | "no_credits";
      needed?: number;
      balance?: number;
    };

export async function sendDaySms(owner: string, ref: string, slug: string): Promise<DaySmsOutcome> {
  const user = getUser(owner);
  const trip = getTrip(ref);
  if (!user || !trip) return { ok: false, reason: "unknown_trip" };
  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return { ok: false, reason: "unknown_day" };
  if (entry.draft) return { ok: false, reason: "not_published" };
  if (isTestContent(trip, entry)) return { ok: false, reason: "test_content" };
  if (!isEnabled("sms")) return { ok: false, reason: "sms_off" };
  if (!isEnabled("contacts", owner)) return { ok: false, reason: "contacts_off" };

  const recipients = await recipientsFor(trip, entry);
  const needed = recipients.filter((r) => !r.free).length;
  const ledgerRef = `${ref}/${slug}`;
  if (!(await spend(owner, needed, "day_sms", ledgerRef))) {
    return { ok: false, reason: "no_credits", needed, balance: (await balanceOf(owner)) ?? 0 };
  }

  const url = dayUrl(serverSite().url, owner, trip.id, slug);
  const sent: { to: string }[] = [];
  const failed: { to: string; error: string }[] = [];
  let owed = 0;
  for (const recipient of recipients) {
    // Capped (security review L2): one credit buys a text of a segment or
    // two, whatever the titles are.
    const body = translateIn(recipient.locale, "daySms.body", {
      trip: capText(trip.title, 60),
      day: capText(entry.title, 60),
      url,
    });
    try {
      await sendSms({ to: recipient.to, body });
      sent.push({ to: recipient.to });
    } catch (err) {
      failed.push({ to: recipient.to, error: err instanceof Error ? err.message : String(err) });
      if (!recipient.free) owed++;
    }
  }
  if (owed > 0) await refund(owner, owed, ledgerRef);

  await recordNotified(owner, trip.id, slug, "sms");
  return { ok: true, sent, failed };
}

/** What a route reports: counts, never a number — `whatsappSummary`'s shape. */
export function smsSummary(outcome: DaySmsOutcome): Record<string, unknown> {
  if (!outcome.ok) {
    return {
      attempted: false,
      sent: 0,
      failed: 0,
      reason: outcome.reason,
      ...(outcome.reason === "no_credits" ? { needed: outcome.needed, balance: outcome.balance } : {}),
    };
  }
  return {
    attempted: true,
    sent: outcome.sent.length,
    failed: outcome.failed.length,
    ...(outcome.failed.length > 0
      ? { errors: outcome.failed.map((f) => ({ to: maskNumber(f.to), error: f.error })) }
      : {}),
  };
}
