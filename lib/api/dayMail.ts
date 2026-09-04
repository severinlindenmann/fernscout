import type { DayLetterOutcome } from "../digest/dayLetter";

/**
 * The two API doors onto B345's letter share this: how `send_mail` arrives on
 * the publish call, and how a `DayLetterOutcome` becomes an API response.
 */

/**
 * `send_mail` from the publish body — absent or anything but `true` means no
 * letter. Never throws: an empty or malformed body reads the same as
 * `false`, which is the safe default publishing must not silently widen.
 */
export async function readSendMailFlag(request: Request): Promise<boolean> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return false;
  }
  if (typeof body !== "object" || body === null) return false;
  return (body as Record<string, unknown>).send_mail === true;
}

/**
 * What the API reports about a send — a count, never the addresses (the plan
 * is explicit: "the count, not the addresses"). A failure is still visible,
 * as its message rather than who it was to, so B272's failure mode — a send
 * that silently disappears — cannot repeat here.
 */
export function mailSummary(outcome: DayLetterOutcome): Record<string, unknown> {
  if (!outcome.ok) {
    return { attempted: false, sent: 0, failed: 0, reason: outcome.reason };
  }
  return {
    attempted: true,
    resend: outcome.resend,
    sent: outcome.sent.length,
    failed: outcome.failed.length,
    ...(outcome.failed.length > 0 ? { errors: outcome.failed.map((f) => f.error) } : {}),
  };
}
