import type { TranslationKey } from "../i18n";

/**
 * What a failed `/api/contacts/confirm` response means for a reader looking
 * at a six-digit code — B272.
 *
 * A `401` is `confirmContact` saying the code itself was wrong; nothing else
 * ever meant that, and both `InviteRedeem` and `ContactForm` used to collapse
 * every non-2xx response into the same "that code didn't work" regardless.
 * Since B272 the two mails a confirmation sends are best-effort
 * (`lib/contacts/mail.ts`), so the route no longer 500s over a mail server
 * having a bad minute — but nothing here can promise no other failure ever
 * will, and when one does the reader already typed the right code. Telling
 * them it was wrong would be false, and there is no retry the code itself
 * could make: the address is already confirmed.
 *
 * One function rather than the same `status === 401 ? … : …` written twice —
 * the two components shared the bug and now share the fix, in one place a
 * test can reach without a DOM.
 */
export function codeConfirmErrorKey(status: number): TranslationKey {
  return status === 401 ? "contact.codeWrong" : "contact.codeServerError";
}
