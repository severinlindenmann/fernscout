import "server-only";
import { isEmail } from "./auth";
import { hasDatabase, isEnabled } from "./capabilities";
import { loadServerConfig } from "./config";
import { getDatabaseOrNull, NO_JOURNAL, nowIso } from "./db";
import { MAINTAINED_LOCALES } from "./i18n";
import { sendMail } from "./mail";
import { renderMail, type MailBlock } from "./mail/template";
import { translateIn } from "./locales";
import type { TranslationKey } from "./i18n";

/**
 * Visitors waiting for the iPhone app — B2341.
 *
 * The instance's App Store link is `features.iosApp.storeUrl`, with no
 * default (see lib/config.ts). Until an operator sets it, "Get the iPhone
 * app" collects an address here instead of leading nowhere. See
 * lib/capabilities.ts's `iosAppNote` for how the three states — a link, a
 * form, or nothing at all — are decided.
 */

/** The App Store URL an operator has configured, or undefined. Never a
 *  default: a self-hoster who has not set one gets no link at all. */
export function iosAppStoreUrl(): string | undefined {
  const raw = loadServerConfig().features.iosApp.storeUrl;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/** Whether the waitlist half of the door can actually work — mail to
 *  confirm with, and somewhere to keep the row. Same env-presence check
 *  `resolveOne` itself uses for `db: true` capabilities (see `hasDatabase`
 *  in lib/capabilities.ts), not a live connection: this is a render-time
 *  question, asked on every load of the signed-out landing page. */
export function iosAppWaitlistAvailable(): boolean {
  return isEnabled("mail") && hasDatabase();
}

/** The stored form of an address — one spelling per person. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export type WaitlistEntry = {
  email: string;
  locale: string | null;
  createdAt: string;
};

/**
 * Every address waiting, newest first — read by `/admin`.
 *
 * Empty with no database, the same "cannot tell" fails safely as
 * `lib/inviteList.ts`'s own `listInvites` — an admin page with nothing to
 * show is honest here; the capability being off is what `/api/health` says.
 */
export async function listAppWaitlist(): Promise<WaitlistEntry[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("app_waitlist")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
  return rows.map((row) => ({ email: row.email, locale: row.locale, createdAt: row.created_at }));
}

/**
 * Add an address to the waitlist and mail a confirmation.
 *
 * Idempotent on the row (`onConflict … doNothing`, like `addInvite`) so a
 * second submission from the same address is a no-op rather than a second
 * row or a thrown error — which is also what keeps the route's response
 * from ever telling a caller whether the address was already on the list.
 * The confirmation mail still goes out every time: it is harmless (nobody
 * new is told an address is "already known" by a *different* letter arriving
 * or not) and simpler than adding a second no-enumeration surface in the
 * mail itself.
 *
 * Returns false only when nothing could be done at all — no database, so
 * there is nowhere to keep the row. The caller still answers the same
 * uniform response either way (see the route); this is for logging.
 */
export async function addToWaitlist(
  email: string,
  locale: string | undefined,
): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const normalized = normalize(email);
  const askedLocale =
    locale && (MAINTAINED_LOCALES as readonly string[]).includes(locale) ? locale : undefined;
  await handle.db
    .insertInto("app_waitlist")
    .values({
      owner_id: NO_JOURNAL,
      email: normalized,
      locale: askedLocale ?? null,
      created_at: nowIso(),
    })
    .onConflict((c) => c.column("email").doNothing())
    .execute();

  const mailLocale = askedLocale ?? "en";
  const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn(mailLocale, key, vars);
  const blocks: MailBlock[] = [
    { kind: "paragraph", text: t("appWaitlist.mailBody") },
  ];
  await sendMail(
    renderMail(normalized, t("appWaitlist.mailSubject"), {
      preheader: t("appWaitlist.mailSubject"),
      title: t("appWaitlist.mailSubject"),
      blocks,
      footer: t("appWaitlist.mailFooter"),
    }),
  ).catch((err) => {
    console.error(`[app-waitlist] confirmation mail to a waitlist entry could not be sent:`, err);
  });
  return true;
}

/** Address validation at the boundary — the same `isEmail` every other
 *  public form on this server uses. */
export function isValidWaitlistEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && isEmail(value.trim());
}
