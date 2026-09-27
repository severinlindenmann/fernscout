import "server-only";
import { isEmail, NO_JOURNAL } from "./auth";
import { hasDatabase, isEnabled } from "./capabilities";
import { getDatabaseOrNull, nowIso } from "./db";
import { inviteOnly } from "./inviteList";
import { MAINTAINED_LOCALES } from "./i18n";
import { afterResponse } from "./afterResponse";
import { sendMail } from "./mail";
import { logMessage } from "./messages/log";
import { renderMail, type MailBlock } from "./mail/template";
import { translateIn } from "./locales";
import type { TranslationKey } from "./i18n";

/**
 * A stranger, on an invite-only instance, asking to be let in — B2507.
 *
 * Modeled closely on `lib/appWaitlist.ts` (B2341): same table shape, same
 * "answer every outcome the same way" route contract, same confirmation-mail
 * pattern. The difference is what the row is *for* — a waitlist entry is
 * mailed once and otherwise inert; a request here is meant to be read by the
 * operator in `/admin` and turned into a real `signup_invites` row with the
 * existing "Allow this address" button, through `POST /api/admin/invites`.
 * Nothing here grants signup on its own.
 */

/** Whether the door can actually work: the instance is closed enough to need
 *  it (`inviteOnly()`), and both mail and a database are present to run it —
 *  the same "server capability is a ceiling" question `iosAppWaitlistAvailable`
 *  asks for the app waitlist. Read by `/invite`'s page (404s without it) and
 *  by the homepage's own button (B2506). */
export function inviteRequestAvailable(): boolean {
  return inviteOnly() && isEnabled("mail") && hasDatabase();
}

/** The stored form of an address — one spelling per person. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export type InviteRequestEntry = {
  email: string;
  locale: string | null;
  createdAt: string;
};

/** Every address waiting on an invite, newest first — read by `/admin`. */
export async function listInviteRequests(): Promise<InviteRequestEntry[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("invite_requests")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
  return rows.map((row) => ({ email: row.email, locale: row.locale, createdAt: row.created_at }));
}

/**
 * Record a request and mail a neutral confirmation — once.
 *
 * Idempotent on the row (`onConflict … doNothing`), so a second request from
 * the same address is a no-op rather than a second row or a thrown error.
 * The confirmation goes out only when the insert actually added a row (the
 * same `numInsertedOrUpdatedRows` check `addToWaitlist` and B2445 use) —
 * a repeat request is a silent no-op rather than a second letter. The
 * caller (the route) answers the same way either way; this is only for the
 * mail and the log.
 *
 * The confirmation text never says whether the address was already invited,
 * already requested, or brand new — an operator reads that distinction in
 * `/admin`, a stranger never does (no enumeration).
 *
 * Returns false only when there is nowhere to keep the row at all.
 */
export async function addInviteRequest(
  email: string,
  locale: string | undefined,
): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const normalized = normalize(email);
  const askedLocale =
    locale && (MAINTAINED_LOCALES as readonly string[]).includes(locale) ? locale : undefined;
  const result = await handle.db
    .insertInto("invite_requests")
    .values({
      owner_id: NO_JOURNAL,
      email: normalized,
      locale: askedLocale ?? null,
      created_at: nowIso(),
    })
    .onConflict((c) => c.column("email").doNothing())
    .executeTakeFirst();
  const inserted = Number(result.numInsertedOrUpdatedRows ?? 0) === 1;
  if (!inserted) {
    await logMessage({ template: "notice.inviteRequest", channel: "mail", to: normalized, status: "skipped", reason: "deduped" });
    console.log(`[invite-request] skipped: deduped`);
    return true;
  }

  const mailLocale = askedLocale ?? "en";
  const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn(mailLocale, key, vars);
  const blocks: MailBlock[] = [{ kind: "paragraph", text: t("inviteRequest.mailBody") }];
  // After the response, for the same reason B159/B37 give in
  // lib/afterResponse.ts: a real send takes measurably longer than a
  // deduped skip, and the response must not let that difference leak.
  afterResponse("invite-request-mail", () => sendMail(
    renderMail(normalized, t("inviteRequest.mailSubject"), {
      template: "notice.inviteRequest",
      preheader: t("inviteRequest.mailSubject"),
      title: t("inviteRequest.mailSubject"),
      blocks,
      why: t("inviteRequest.mailFooter"),
    }),
  ).catch((err) => {
    console.error(`[invite-request] confirmation mail could not be sent:`, err);
  }));
  return true;
}

/** Address validation at the boundary — the same `isEmail` every other
 *  public form on this server uses. */
export function isValidInviteRequestEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && isEmail(value.trim());
}
