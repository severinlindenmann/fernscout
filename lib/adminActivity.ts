import type { Ack } from "./adminAcks";
import type { Trouble } from "./adminConsole";
import type { Payment } from "@paid/credits/lib/payments";
import type { Tombstone } from "./tombstones";

/**
 * What happened on this instance lately, newest first — the Activity section
 * of `/admin`.
 *
 * **Nothing here is recorded for the feed.** Every line is read back out of a
 * record something else already keeps for its own reasons: a signup's date, a
 * payment's settlement, a day file's timestamp, a backup's history line, the
 * operator's own acknowledgements, a tombstone. So there is no event table to
 * fall out of step with the things it describes, and no line in it can claim
 * something the underlying record does not say.
 *
 * That also bounds what it can say. A day file's timestamp says a journal was
 * written to, not what was written or whether it was published, so the line
 * says exactly that. An SMS is counted by direction and never quoted.
 *
 * Pure, so the page's server component can hand it everything it already
 * loaded and a test can check the ordering without a database.
 */

type FeedKind = "signup" | "purchase" | "wrote" | "backup" | "ack" | "trouble" | "sms" | "deleted";

export type FeedEntry = {
  /** ISO, or `YYYY-MM-DD` for a source that only knows the day. */
  at: string;
  kind: FeedKind;
  text: string;
  /** The journal it is about, when it is about one. */
  owner: string | null;
  /** Whether it is bad news — drawn in the alert colour. */
  alert: boolean;
};

export type FeedSources = {
  /** Username to the ISO time the journal was started. Null with no database. */
  signups: Record<string, string> | null;
  payments: Payment[];
  /** Username to the last time a day file was touched. */
  wrote: Record<string, string | null>;
  backups: { at: string; which: "primary" | "secondary"; outcome: "ok" | "failed" }[];
  acks: Ack[];
  troubles: Trouble[];
  sms: { direction: "in" | "out"; createdAt: string }[];
  tombstones: Tombstone[];
};

const ACKED: Record<string, string> = {
  fixed: "stopped being raised",
  unhidden: "brought back",
  superseded: "acknowledged again",
  woke: "snooze ended",
};

export function activityFeed(sources: FeedSources, since: string, limit = 40): FeedEntry[] {
  const out: FeedEntry[] = [];

  for (const [owner, at] of Object.entries(sources.signups ?? {})) {
    out.push({ at, kind: "signup", text: `${owner} started a journal`, owner, alert: false });
  }

  for (const one of sources.payments) {
    if (one.status === "paid" && one.paidAt) {
      out.push({
        at: one.paidAt,
        kind: "purchase",
        text:
          one.method === "admin"
            ? `${one.credits} credits granted by hand to ${one.owner}`
            : `${one.owner} bought ${one.credits} credits`,
        owner: one.owner,
        alert: false,
      });
    } else if (one.status === "refunded") {
      out.push({
        at: one.paidAt ?? one.createdAt,
        kind: "purchase",
        text: `A purchase by ${one.owner} was refunded`,
        owner: one.owner,
        alert: false,
      });
    }
  }

  for (const [owner, at] of Object.entries(sources.wrote)) {
    if (at) out.push({ at, kind: "wrote", text: `${owner} wrote in their journal`, owner, alert: false });
  }

  for (const one of sources.backups) {
    const where = one.which === "primary" ? "Nightly backup" : "Off-site copy";
    out.push({
      at: one.at,
      kind: "backup",
      text: one.outcome === "ok" ? `${where} finished` : `${where} failed`,
      owner: null,
      alert: one.outcome === "failed",
    });
  }

  for (const one of sources.acks) {
    const verb = one.until ? "snoozed" : "acknowledged";
    out.push({ at: one.ackedAt, kind: "ack", text: `You ${verb} ${one.entryId}`, owner: null, alert: false });
    if (one.endedAt && one.endedWhy !== "superseded") {
      out.push({
        at: one.endedAt,
        kind: "ack",
        text: `${one.entryId}: ${ACKED[one.endedWhy] ?? one.endedWhy}`,
        owner: null,
        alert: false,
      });
    }
  }

  for (const one of sources.troubles) {
    out.push({
      at: one.when,
      kind: "trouble",
      text: one.owner ? `${one.what} · ${one.owner}` : one.what,
      owner: one.owner,
      alert: true,
    });
  }

  for (const one of sources.sms) {
    out.push({
      at: one.createdAt,
      kind: "sms",
      text: one.direction === "in" ? "An SMS arrived" : "An SMS was sent",
      owner: null,
      alert: false,
    });
  }

  for (const one of sources.tombstones) {
    out.push({
      at: one.deletedAt,
      kind: "deleted",
      text: one.kind === "journal" ? `${one.username} was deleted` : `A trip of ${one.username} was deleted`,
      owner: one.username,
      alert: false,
    });
  }

  return out
    .filter((one) => one.at >= since)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
