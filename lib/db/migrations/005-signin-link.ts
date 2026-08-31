import type { MigrationDb } from "./types";

/**
 * A one-click sign-in link, alongside the six-digit code.
 *
 * Typing a code from a phone screen into a laptop is the step where a reader
 * who is not comfortable with computers gives up, and this journal is read by
 * people who open it once a month from a link somebody sent them. So the mail
 * now carries both: a button that signs you in, and the code underneath for
 * anyone whose mail client mangles links or who prefers to type.
 *
 * **Two credentials on one row, consumed separately**, which is the part worth
 * understanding. The link travels in a URL: it is prefetched by mail scanners,
 * copied into chat windows, and written to browser history. The code does not.
 * So the link is the weaker of the two, and they cannot share a `consumed_at`:
 * a corporate mail scanner following the link at 03:00 would otherwise burn
 * the reader's code before they ever saw the message, and the fallback that
 * exists precisely for that case would already be gone.
 *
 * Hence: redeeming the *code* consumes the whole row, link included — the
 * strong credential retires the weak one. Redeeming the *link* consumes only
 * itself, and the code stays live for the rest of its ten minutes.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .alterTable("login_codes")
    // sha-256 of the link token, like every other bearer secret here. Nullable
    // because agent codes have no link: an agent is a program with no cookie
    // jar, and a URL that silently creates a browser session is not something
    // to hand one.
    .addColumn("link_hash", "text")
    .execute();

  await db.schema.alterTable("login_codes").addColumn("link_consumed_at", "text").execute();

  // The link token is the entire lookup key — there is no email in the URL to
  // narrow by, on purpose, so that a sign-in link cannot be read as a
  // disclosure of who reads this journal.
  await db.schema
    .createIndex("login_codes_link")
    .on("login_codes")
    .columns(["link_hash"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("login_codes_link").execute();
  await db.schema.alterTable("login_codes").dropColumn("link_consumed_at").execute();
  await db.schema.alterTable("login_codes").dropColumn("link_hash").execute();
}
