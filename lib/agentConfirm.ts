import "server-only";
import crypto from "node:crypto";
import { accessSecret } from "./access";

/**
 * The second time of asking, for things that cannot be undone.
 *
 * An agent that can write can be talked into deleting. The draft rule protects
 * readers from invention; nothing protected the author from an agent that
 * decided, on its own, that a day was a mistake — or that a photobook wanted
 * ordering.
 *
 * So a destructive call is refused once, with a code, and the refusal asks the
 * question the agent should have asked the person: *did they tell you to?* The
 * agent repeats the call carrying the code.
 *
 * Four properties, and each of them is load-bearing:
 *
 * - **Bound to the exact operation.** The signature covers the journal, the
 *   trip, the target and the verb, so a code issued to delete one day cannot
 *   be replayed to delete another. This is the property that makes the whole
 *   thing worth more than an `"are_you_sure": true` flag, which an agent can
 *   simply set.
 * - **Issued by the server.** An agent cannot construct one, because it does
 *   not hold `SESSION_SECRET`.
 * - **Short-lived.** Five minutes: long enough to ask a person, short enough
 *   that a code found in a log is worthless.
 * - **Stateless.** An HMAC over the operation and the minute it was issued —
 *   there is no table of outstanding codes to grow, expire or leak.
 *
 * What it deliberately is *not* is single-use. Burning a code needs somewhere
 * to record that it burned, and a store shared across processes; within the
 * five-minute window a replay does the same thing the agent has already been
 * told to do, which is the case this exists to make it stop and think about,
 * not to make cryptographically impossible. `docs/plans/W28` records that.
 */

/** Long enough to ask a person, short enough to be worthless in a log. */
export const CONFIRM_TTL_MS = 5 * 60 * 1000;

/** What an agent may be asked to confirm. */
export type ConfirmableAction =
  | "delete_draft"
  /**
   * Deleting something people have already read.
   *
   * A separate verb from `delete_draft` on purpose. The action is part of the
   * signature, so a code obtained to remove an unpublished scrap cannot be
   * turned on a published day — the agent has to be refused a second time, and
   * read a second, more serious sentence, before that becomes possible.
   */
  | "delete_published"
  | "delete_media"
  | "overwrite_day"
  | "order";

export type Operation = {
  action: ConfirmableAction;
  /** The qualified trip ref, or the journal when the action is not a trip's. */
  scope: string;
  /** What inside it — a slug, a filename, an order id. */
  target: string;
};

function sign(operation: Operation, issued: number): string {
  return crypto
    .createHmac("sha256", accessSecret())
    .update(`${operation.action}.${operation.scope}.${operation.target}.${issued}`)
    .digest("base64url")
    .slice(0, 32);
}

/** The code to hand back, which the agent must repeat. */
export function issueConfirmation(operation: Operation, now = Date.now()): string {
  return `cf_${now.toString(36)}_${sign(operation, now)}`;
}

/**
 * Whether this code authorises this operation, right now.
 *
 * Re-derives the signature from the operation being attempted rather than from
 * anything in the code itself, so a code for a different target simply does
 * not verify. Constant-time compared, because it is a MAC.
 */
export function confirmationMatches(
  code: string | undefined,
  operation: Operation,
  now = Date.now(),
): boolean {
  if (!code) return false;
  // Split into exactly three, because base64url's alphabet includes `_` and a
  // plain `split("_")` therefore truncated the signature at whatever byte
  // happened to encode to one. Roughly one code in three, and the unit tests
  // passed on the other two — found by deleting a real draft.
  const [prefix, issuedPart, ...rest] = code.split("_");
  const mac = rest.join("_");
  if (prefix !== "cf" || !issuedPart || !mac) return false;

  const issued = Number.parseInt(issuedPart, 36);
  if (!Number.isFinite(issued)) return false;
  const age = now - issued;
  if (age < 0 || age > CONFIRM_TTL_MS) return false;

  const expected = sign(operation, issued);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The body of a 409, and the words an agent reads when it is refused. */
export function confirmationRequired(operation: Operation, sentence: string) {
  return {
    error: "confirmation_required",
    confirm: issueConfirmation(operation),
    message:
      `${sentence} Did the person actually ask you to? If they did, repeat the ` +
      `request with "confirm" set to the value above. If you are not sure, ask ` +
      `them — this code expires in five minutes and there is no hurry.`,
  };
}
