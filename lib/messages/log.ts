import "server-only";
import { createHash, createHmac } from "node:crypto";
import { NO_JOURNAL } from "../auth";
import { getDatabase, getDatabaseOrNull, newId, nowIso } from "../db";
import type { Channel, Flow, TemplateId } from "./registry";

/**
 * The one send log every channel writes to — B2438
 * (docs/plans/W44-messages.md, "The log"). Never a body, never a raw
 * address: only a hash and a mask ever reach the row.
 */

const MESSAGE_STATUSES = ["sent", "skipped", "failed", "held", "test"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * A stable, non-reversible id for one recipient — HMAC-SHA256 keyed by
 * `SESSION_SECRET` when it is set (every real deployment), plain SHA-256
 * otherwise (a from-scratch dev checkout with no secret configured yet, where
 * the log is still worth having). Normalised first so `Mara@Example.com` and
 * `mara@example.com`, or `+41 76 000 00 00` and `41760000000`, hash to the
 * same recipient.
 */
export function recipientHash(to: string): string {
  const normalised = normaliseRecipient(to);
  const secret = process.env.SESSION_SECRET;
  return secret
    ? createHmac("sha256", secret).update(normalised).digest("hex")
    : createHash("sha256").update(normalised).digest("hex");
}

function normaliseRecipient(to: string): string {
  return to.includes("@") ? to.trim().toLowerCase() : to.replace(/\D/g, "");
}

/** `m•••@gmail.com` for an address, or a masked form of the documentation
 * number (test/depersonalised.test.ts) for a phone number — never the real
 * value. */
function recipientMask(to: string): string {
  if (to.includes("@")) {
    const [local, domain] = to.trim().toLowerCase().split("@");
    return `${(local ?? "").slice(0, 1)}•••@${domain ?? "?"}`;
  }
  const digits = to.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  return `+${digits.slice(0, 2)} ${"•".repeat(Math.max(1, digits.length - 4))} ${digits.slice(-2)}`;
}

export type LogMessageInput = {
  template: TemplateId;
  channel: Channel;
  /** The recipient address or number — hashed and masked, never stored raw. */
  to: string;
  /** The journal this send is on behalf of, or omitted for one that belongs
   * to no journal yet (a signup code, an operator alert) — written as
   * `NO_JOURNAL`, the same convention `sms_messages`/`whatsapp_sends` use. */
  owner?: string;
  locale?: string;
  status: MessageStatus;
  /** Required for `skipped`/`failed`/`held`; ignored otherwise. */
  reason?: string;
  flow?: Flow["id"];
};

/**
 * Write one row. **Never throws** — a message that was already sent (or
 * skipped, or failed) must not become a second failure because the
 * bookkeeping insert did, the same rule `recordSms`/`recordWhatsappSend`
 * already follow. A no-op with no database, so a from-scratch checkout with
 * no `DATABASE_URL` still sends every message; there is simply no log to
 * read.
 */
export async function logMessage(input: LogMessageInput): Promise<void> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return;
    await handle.db
      .insertInto("message_log")
      .values({
        id: newId(),
        owner_id: input.owner ?? NO_JOURNAL,
        template: input.template,
        channel: input.channel,
        flow: input.flow ?? null,
        recipient_hash: recipientHash(input.to),
        recipient_mask: recipientMask(input.to),
        locale: input.locale ?? null,
        status: input.status,
        reason: input.reason ?? null,
        created_at: nowIso(),
      })
      .execute();
  } catch (err) {
    console.warn("[messages] could not log a send:", err);
  }
}

export type MessageLogRow = {
  id: string;
  ownerId: string;
  template: string;
  channel: string;
  flow: string | null;
  recipientHash: string;
  recipientMask: string;
  locale: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

/** The rows admin's Log tab (a later ticket) and the person lookup read.
 * Empty with no database. */
export async function listMessages(
  options: { limit?: number; template?: TemplateId; status?: MessageStatus; hash?: string; since?: string } = {},
): Promise<MessageLogRow[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  let query = handle.db.selectFrom("message_log").selectAll().orderBy("created_at", "desc");
  if (options.template) query = query.where("template", "=", options.template);
  if (options.status) query = query.where("status", "=", options.status);
  if (options.hash) query = query.where("recipient_hash", "=", options.hash);
  if (options.since) query = query.where("created_at", ">=", options.since);
  const rows = await query.limit(options.limit ?? 200).execute();
  return rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    template: r.template,
    channel: r.channel,
    flow: r.flow,
    recipientHash: r.recipient_hash,
    recipientMask: r.recipient_mask,
    locale: r.locale,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** Counts since a timestamp, grouped by template and status — the shape
 * admin's catalogue (a later ticket) wants for "how many of this went out". */
export async function countMessages(sinceIso: string): Promise<{ template: string; status: string; count: number }[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("message_log")
    .select(({ fn }) => ["template", "status", fn.countAll().as("count")])
    .where("created_at", ">=", sinceIso)
    .groupBy(["template", "status"])
    .execute();
  return rows.map((r) => ({ template: r.template, status: r.status, count: Number(r.count) }));
}

/** Rows older than 90 days — swept nightly by `scripts/messages-sweep.mts`. */
export const RETENTION_DAYS = 90;

export async function sweepOldMessages(now: Date = new Date()): Promise<number> {
  const { db } = await getDatabase();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.deleteFrom("message_log").where("created_at", "<", cutoff).executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
