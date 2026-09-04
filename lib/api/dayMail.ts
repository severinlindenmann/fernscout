import type { DayLetterOutcome } from "../digest/dayLetter";

/**
 * How a `DayLetterOutcome` becomes an API response, for both of B345's doors.
 *
 * `send_mail` itself is read by `lib/api/publishFlags.ts`, together with
 * B365's `send_whatsapp` — one parse of a body that may only be read once.
 */

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
