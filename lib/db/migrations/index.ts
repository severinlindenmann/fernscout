import type { Migration, MigrationProvider } from "kysely/migration";
import * as initial from "./001-initial";
import * as auth from "./002-auth";
import * as contacts from "./003-contacts";
import * as digest from "./004-digest";
import * as signinLink from "./005-signin-link";
import * as standingLink from "./006-standing-link";
import * as journalWideGrants from "./007-journal-wide-grants";
import * as deletions from "./008-deletions";
import * as signinDestination from "./009-signin-destination";
import * as inviteLinks from "./010-invite-links";
import * as codeTripBinding from "./011-code-trip-binding";
import * as contactNotified from "./012-contact-notified";
import * as inviteTokenCipher from "./013-invite-token-cipher";
import * as invitePreapproval from "./014-invite-preapproval";
import * as contactWhatsapp from "./015-contact-whatsapp";
import * as credits from "./016-credits";
import * as dropDigestSends from "./017-drop-digest-sends";
import * as payments from "./018-payments";
import * as paymentApproval from "./020-payment-approval";
import * as identity from "./019-identity";
import * as analytics from "./021-analytics";
import * as dayNotifications from "./022-day-notifications";
import * as usage from "./023-usage";
import * as paymentProviderRef from "./024-payment-provider-ref";
import * as idempotency from "./025-idempotency";
import * as helperSessions from "./026-helper-sessions";
import * as creditsHundredths from "./027-credits-hundredths";
import * as signupPhone from "./028-signup-phone";
import * as helperThreads from "./029-helper-threads";
import * as adminAcks from "./030-admin-acks";
import * as smsMessages from "./031-sms-messages";
import * as whatsappSends from "./032-whatsapp-sends";
import * as builtStatus from "./033-built-status";
import * as ownerTel from "./034-owner-tel";
import * as signupInvites from "./035-signup-invites";
import * as usageCacheTokens from "./036-usage-cache-tokens";
import * as photobookDrafts from "./037-photobook-drafts";

/**
 * Every migration, listed by hand.
 *
 * Kysely ships a `FileMigrationProvider` that reads a directory at runtime.
 * We don't use it: this code runs inside a bundled Next.js server where the
 * migration files are no longer separate files on disk. A static map is also
 * the version that a `grep` can answer questions about.
 *
 * Names are ordered lexicographically by Kysely, so the numeric prefix is
 * load-bearing. Never rename or renumber one that has run anywhere — the name
 * is the primary key in `kysely_migration`.
 */
export const MIGRATIONS: Record<string, Migration> = {
  "001-initial": initial,
  "002-auth": auth,
  "003-contacts": contacts,
  "004-digest": digest,
  "005-signin-link": signinLink,
  "006-standing-link": standingLink,
  "007-journal-wide-grants": journalWideGrants,
  "008-deletions": deletions,
  "009-signin-destination": signinDestination,
  "010-invite-links": inviteLinks,
  "011-code-trip-binding": codeTripBinding,
  "012-contact-notified": contactNotified,
  "013-invite-token-cipher": inviteTokenCipher,
  "014-invite-preapproval": invitePreapproval,
  "015-contact-whatsapp": contactWhatsapp,
  "016-credits": credits,
  "017-drop-digest-sends": dropDigestSends,
  "018-payments": payments,
  "019-identity": identity,
  "020-payment-approval": paymentApproval,
  "021-analytics": analytics,
  "022-day-notifications": dayNotifications,
  "023-usage": usage,
  "024-payment-provider-ref": paymentProviderRef,
  "025-idempotency": idempotency,
  "026-helper-sessions": helperSessions,
  "027-credits-hundredths": creditsHundredths,
  "028-signup-phone": signupPhone,
  "029-helper-threads": helperThreads,
  "030-admin-acks": adminAcks,
  "031-sms-messages": smsMessages,
  "032-whatsapp-sends": whatsappSends,
  "033-built-status": builtStatus,
  "034-owner-tel": ownerTel,
  "035-signup-invites": signupInvites,
  "036-usage-cache-tokens": usageCacheTokens,
  "037-photobook-drafts": photobookDrafts,
};

/**
 * B1146 — two branches in flight both numbered a migration 028. Git cannot
 * catch this: the filenames differ, so both branches merge cleanly and the
 * duplicate ordinal only shows up once somebody notices the schema the
 * second one was meant to create never happened. This is the migration
 * analogue of the task-id collision `nextId()` guards against — the
 * cheapest fix from B1146's own list, applied at the earliest possible
 * moment: module load, before a single migration ever runs, and before
 * `verify` gets anywhere near vitest.
 *
 * Exported so a test can call it against a synthetic list without needing
 * two real files with the same ordinal on disk.
 */
export function assertUniqueOrdinals(names: string[]): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    const ordinal = name.slice(0, 3);
    const existing = seen.get(ordinal);
    if (existing) {
      throw new Error(
        `lib/db/migrations: "${existing}" and "${name}" both claim ordinal ${ordinal} — ` +
          "renumber one of them before merging.",
      );
    }
    seen.set(ordinal, name);
  }
}

assertUniqueOrdinals(Object.keys(MIGRATIONS));

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return MIGRATIONS;
  },
};
