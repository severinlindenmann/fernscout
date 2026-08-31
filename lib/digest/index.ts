import "server-only";
import { isEnabled } from "../capabilities";
import {
  listContacts,
  manageTokenFor,
  manageUrl,
  unsubscribeUrlFor,
  type ContactRecord,
} from "../contacts";
import { pickLocale } from "../contacts/locale";
import { sendMail } from "../mail";
import { serverSite } from "../site";
import { getTrips } from "../trips";
import type { Locale } from "../types";
import { getUser } from "../users";
import { buildDigestContent, type DigestContent } from "./content";
import { renderDigest } from "./mail";
import {
  claimDigest,
  lastDigestsByContact,
  markDigestFailed,
  markDigestSent,
} from "./record";
import {
  alreadySentToday,
  isAwake,
  journalTimezone,
  localDate,
  timezoneFor,
  DEFAULT_WINDOW,
  type QuietWindow,
} from "./quiet";
import { digestableTrips, readGrantsByContact } from "./visibility";

/**
 * The digest — ROADMAP D2, and the only notification channel that reaches
 * everybody (decision 6: ~20–50 readers, most of whom will never install
 * anything). Push is the bonus; this is the feature.
 *
 * The run is in two halves on purpose:
 *
 * - **`planDigest`** decides who gets what. It writes nothing, so `--dry-run`
 *   is the same code path as a real run rather than an approximation of it —
 *   the thing you check before pressing send is the thing that then happens.
 * - **`runDigest`** sends, recording each mail *before* the transport is
 *   called. A crash therefore loses at most one reader's digest and never
 *   duplicates one; see `./record.ts` for why that asymmetry is the right way
 *   round.
 *
 * Every decision that could leak something private lives in `./visibility.ts`,
 * and every decision about *when* it is decent to write lives in `./quiet.ts`.
 * This file only sequences them.
 */

export { buildDigestContent, formatDigestDate, MAX_DAYS_LISTED } from "./content";
export type { DigestContent, DigestDay, DigestTripSummary } from "./content";
export { renderDigest } from "./mail";
export { digestableTrips, readGrantsByContact } from "./visibility";
export {
  alreadySentToday,
  isAwake,
  journalTimezone,
  localDate,
  localHour,
  timezoneFor,
  DEFAULT_TIMEZONE,
  DEFAULT_WINDOW,
} from "./quiet";
export type { QuietWindow } from "./quiet";
export { lastDigestsByContact } from "./record";
export type { DigestSendRecord, DigestSendStatus } from "./record";

/** Why somebody is not being written to. Every one of these is printable. */
export type DigestSkipReason =
  | "not-approved"
  | "no-consent"
  | "nothing-new"
  | "already-today"
  | "quiet-hours";

export type DigestRecipientPlan = {
  contactId: string;
  email: string;
  name: string | null;
  locale: Locale;
  timezone: string;
  /** The watermark this digest starts from, or null for "everything". */
  since: string | null;
  content: DigestContent;
};

export type DigestSkipped = {
  contactId: string;
  email: string;
  reason: DigestSkipReason;
  /** A human-readable "why", for the dry run. */
  detail?: string;
};

export type DigestPlan = {
  owner: string;
  now: Date;
  ready: DigestRecipientPlan[];
  skipped: DigestSkipped[];
};

export type DigestOptions = {
  /** Injected so the quiet rules can be tested without waiting for 3am. */
  now?: Date;
  /** `YYYY-MM-DD` — override every reader's watermark. */
  since?: string;
  /** Ignore the quiet rules. For "the trip ended, send the last one now". */
  force?: boolean;
  window?: QuietWindow;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where a reader who has never been written to starts from.
 *
 * Not the beginning of the journal: somebody approved this morning would get a
 * five-month trip in one email. The day they were let in is the honest answer —
 * everything since then is genuinely "new since you last looked", because they
 * were not looking before that.
 */
function firstWatermarkFor(contact: ContactRecord): string {
  const stamp = contact.approvedAt ?? contact.confirmedAt ?? contact.createdAt;
  return stamp.slice(0, 10);
}

/** Who would get what, and why everybody else would not. Writes nothing. */
export async function planDigest(
  owner: string,
  options: DigestOptions = {},
): Promise<DigestPlan> {
  const user = getUser(owner);
  if (!user) throw new Error(`No such user: "${owner}".`);
  if (options.since && !DATE_RE.test(options.since)) {
    throw new Error(`--since must be a date like 2026-08-30, not "${options.since}".`);
  }

  const now = options.now ?? new Date();
  const window = options.window ?? DEFAULT_WINDOW;
  const base = serverSite().url;
  const today = localDate(now, journalTimezone());

  const trips = getTrips(owner);
  const [contacts, grants, lastSends] = await Promise.all([
    listContacts(owner),
    readGrantsByContact(owner, now),
    lastDigestsByContact(owner),
  ]);

  const ready: DigestRecipientPlan[] = [];
  const skipped: DigestSkipped[] = [];

  for (const contact of contacts) {
    if (contact.status !== "active") {
      skipped.push({
        contactId: contact.id,
        email: contact.email,
        reason: "not-approved",
        detail: contact.status,
      });
      continue;
    }
    if (!contact.wantsEmailDigest) {
      skipped.push({ contactId: contact.id, email: contact.email, reason: "no-consent" });
      continue;
    }

    const locale = pickLocale(contact.locale, user.defaultLocale);
    const timezone = timezoneFor(locale);
    const last = lastSends.get(contact.id);
    const previous = options.since ?? last?.cursor;
    const since = previous ?? firstWatermarkFor(contact);
    // Only the first send treats its watermark as inclusive — see includeSince.
    const includeSince = previous === undefined;

    // Content first, so that somebody with nothing to hear about is reported
    // as "nothing new" rather than as "it is the middle of their night" — the
    // second is true and useless.
    const content = buildDigestContent({
      username: owner,
      trips: digestableTrips(trips, grants.get(contact.id) ?? new Set()),
      since,
      includeSince,
      today,
      locale,
      base,
    });
    if (!content) {
      skipped.push({
        contactId: contact.id,
        email: contact.email,
        reason: "nothing-new",
        detail: `since ${since}`,
      });
      continue;
    }

    if (!options.force) {
      if (alreadySentToday(last?.createdAt, now, timezone)) {
        skipped.push({
          contactId: contact.id,
          email: contact.email,
          reason: "already-today",
          detail: `last ${last?.createdAt} (${timezone})`,
        });
        continue;
      }
      if (!isAwake(now, timezone, window)) {
        skipped.push({
          contactId: contact.id,
          email: contact.email,
          reason: "quiet-hours",
          detail: timezone,
        });
        continue;
      }
    }

    ready.push({
      contactId: contact.id,
      email: contact.email,
      name: contact.name,
      locale,
      timezone,
      since,
      content,
    });
  }

  return { owner, now, ready, skipped };
}

export type DigestSent = {
  contactId: string;
  email: string;
  locale: Locale;
  dayCount: number;
  subject: string;
  /** Where it went: a `.eml` path in development, a message id in production. */
  reference: string | null;
};

export type DigestFailure = { contactId: string; email: string; error: string };

export type DigestOutcome = {
  owner: string;
  dryRun: boolean;
  plan: DigestPlan;
  sent: DigestSent[];
  failed: DigestFailure[];
};

/**
 * Send it.
 *
 * `dryRun` stops after the plan: no rows, no mail, no watermark moved, so the
 * same command can be run again for real and behave identically.
 */
export async function runDigest(
  owner: string,
  options: DigestOptions & { dryRun?: boolean } = {},
): Promise<DigestOutcome> {
  const user = getUser(owner);
  if (!user) throw new Error(`No such user: "${owner}".`);

  const dryRun = options.dryRun === true;
  if (!dryRun && !isEnabled("mail")) {
    throw new Error(
      "Mail is not enabled on this server, so nothing can be sent. Set " +
        'features.mail to { "enabled": true, "transport": "file" } in ' +
        "content/config.json to write .eml files locally, or run with --dry-run.",
    );
  }
  if (!isEnabled("contacts", owner)) {
    throw new Error(
      `Contacts are not enabled for "${owner}", so there is nobody to write to. ` +
        "See docs/plans/W10-contacts.md.",
    );
  }

  const plan = await planDigest(owner, options);
  const sent: DigestSent[] = [];
  const failed: DigestFailure[] = [];
  if (dryRun) return { owner, dryRun, plan, sent, failed };

  const base = serverSite().url;

  for (const recipient of plan.ready) {
    // Derived, not stored: the same token this reader has had in every footer
    // since they confirmed, so an old mail's unsubscribe link keeps working.
    const token = manageTokenFor(owner, recipient.contactId);
    const mail = renderDigest({
      username: owner,
      title: user.title,
      recipient: {
        email: recipient.email,
        name: recipient.name,
        locale: recipient.locale,
      },
      content: recipient.content,
      manageUrl: manageUrl(base, owner, token),
      unsubscribeUrl: unsubscribeUrlFor(base, owner, token),
    });

    // Claimed before the send: see ./record.ts. The window in which a crash
    // costs somebody a digest is the transport call itself; the window in
    // which it would have cost them a duplicate is now empty.
    const id = await claimDigest(owner, {
      contactId: recipient.contactId,
      cursor: recipient.content.cursor,
      dayCount: recipient.content.dayCount,
      locale: recipient.locale,
      trips: recipient.content.trips.map((trip) => ({ ref: trip.ref, days: trip.newDays })),
      now: plan.now,
    });

    try {
      const result = await sendMail(mail);
      await markDigestSent(owner, id, result?.reference ?? null, new Date());
      sent.push({
        contactId: recipient.contactId,
        email: recipient.email,
        locale: recipient.locale,
        dayCount: recipient.content.dayCount,
        subject: mail.subject,
        reference: result?.reference ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Marked failed, not left at `sending`: this reader definitely got
      // nothing, so the next run should try again rather than skip them.
      await markDigestFailed(owner, id, message);
      failed.push({ contactId: recipient.contactId, email: recipient.email, error: message });
    }
  }

  return { owner, dryRun, plan, sent, failed };
}
