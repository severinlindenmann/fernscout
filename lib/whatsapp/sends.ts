import "server-only";
import { NO_JOURNAL } from "../auth";
import { getDatabaseOrNull, newId, nowIso } from "../db";

/**
 * The money log for this channel — B1347.
 *
 * Meta bills WhatsApp per conversation, by category, and until this table
 * nothing recorded which category a message went out under — or that most
 * of them went out at all: `day_notifications` dedupes to one row per day
 * announcement, and reminders, one-time codes and free-form replies left no
 * trace. `/admin`'s money page counts these rows per category and prices
 * them from `costs.whatsappPerMessageRappen`.
 *
 * One row per recipient, written after the provider answered. `service` is
 * a reply inside Meta's 24-hour customer-service window, which is free by
 * their own rule (lib/whatsapp/window.ts) — counted so the volume is
 * visible, never priced.
 */

export const WHATSAPP_CATEGORIES = ["marketing", "utility", "authentication", "service"] as const;
export type WhatsappCategory = (typeof WHATSAPP_CATEGORIES)[number];

/**
 * Record one delivered message. Never throws and needs no database — by the
 * time this runs the message has gone, and losing a send to an accounting
 * insert would be trading the product for the bookkeeping (`recordUsage`'s
 * own rule, one channel over).
 */
export async function recordWhatsappSend(row: {
  /** The journal the send was on behalf of; null when there is none yet —
   * a signup code, a stranger reply. */
  owner: string | null;
  category: WhatsappCategory;
  /** The template's approved name, or `reply` for a free-form message. */
  template: string;
}): Promise<void> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return;
    await handle.db
      .insertInto("whatsapp_sends")
      .values({
        id: newId(),
        owner_id: row.owner ?? NO_JOURNAL,
        category: row.category,
        template: row.template,
        sent_at: nowIso(),
      })
      .execute();
  } catch {
    // Bookkeeping only; the message is already sent.
  }
}
