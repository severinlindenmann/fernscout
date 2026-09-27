import "server-only";
import { getDatabase, nowIso } from "./db";
import { normaliseEmail } from "./contacts";

/**
 * "News from Fernscout" — one instance-wide tick on the notify step (B2453),
 * never a per-journal preference. See `048-news-consent`'s own note for why
 * it is its own table rather than a `contacts` column, and for why presence
 * of the row is the whole of the consent.
 *
 * Bump this when the copy shown at consent time changes in a way that
 * matters for an audit — a version an old row still names honestly, never
 * rewritten under it.
 */
export const NEWS_CONSENT_WORDING_KEY = "guide.notify.news.v1";

/** Record consent — an upsert, so ticking it twice (or on two different
 * journals) is the same row, re-timestamped. */
export async function setNewsConsent(email: string, locale: string | null): Promise<void> {
  const key = normaliseEmail(email);
  if (!key) return;
  const { db } = await getDatabase();
  await db
    .insertInto("news_consent")
    .values({ email: key, wording_key: NEWS_CONSENT_WORDING_KEY, locale, consented_at: nowIso() })
    .onConflict((oc) =>
      oc.column("email").doUpdateSet({ wording_key: NEWS_CONSENT_WORDING_KEY, locale, consented_at: nowIso() }),
    )
    .execute();
}

/** Withdraw it — deletes the row outright (see the migration's own note on
 * why this is a delete and not a flag). */
export async function clearNewsConsent(email: string): Promise<void> {
  const key = normaliseEmail(email);
  if (!key) return;
  const { db } = await getDatabase();
  await db.deleteFrom("news_consent").where("email", "=", key).execute();
}

/** Whether this address is on the list right now. */
export async function hasNewsConsent(email: string): Promise<boolean> {
  const key = normaliseEmail(email);
  if (!key) return false;
  const { db } = await getDatabase();
  const row = await db.selectFrom("news_consent").select("email").where("email", "=", key).executeTakeFirst();
  return Boolean(row);
}
