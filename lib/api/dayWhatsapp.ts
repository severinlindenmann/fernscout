import type { DayWhatsappOutcome } from "../digest/dayWhatsapp";
import { maskNumber } from "../whatsapp";

/**
 * How a send outcome becomes an API response — the counterpart of
 * `mailSummary` in `lib/api/dayMail.ts`, and deliberately the same shape so
 * the two channels cannot drift in how they report.
 *
 * The request body is read elsewhere, once, by `lib/api/publishFlags.ts`.
 */

/**
 * What the API reports — counts, and never a telephone number.
 *
 * The mail summary's rule ("the count, not the addresses") applies with more
 * force here: an agent token that may publish would otherwise be able to read
 * back the phone numbers of everybody who ever filled in the guestbook, one
 * publish at a time. A failure is still visible as its message, and the
 * number it belongs to is masked to its last four digits so an operator can
 * tell two failures apart without the response carrying the number itself.
 */
export function whatsappSummary(outcome: DayWhatsappOutcome): Record<string, unknown> {
  if (!outcome.ok) {
    return { attempted: false, sent: 0, failed: 0, reason: outcome.reason };
  }
  return {
    attempted: true,
    resend: outcome.resend,
    sent: outcome.sent.length,
    failed: outcome.failed.length,
    ...(outcome.failed.length > 0
      ? { errors: outcome.failed.map((f) => ({ to: maskNumber(f.to), error: f.error })) }
      : {}),
  };
}
