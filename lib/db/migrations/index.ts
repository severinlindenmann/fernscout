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
import * as identity from "./019-identity";

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
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return MIGRATIONS;
  },
};
