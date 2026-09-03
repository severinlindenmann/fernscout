/** One message, independent of how it gets sent. */
export type Mail = {
  to: string;
  subject: string;
  html: string;
  /** Always required. A mail with no text alternative is a mail some readers
   * cannot read, and it also reads as spam to most filters. */
  text: string;
  /** Extra headers — List-Unsubscribe and friends. */
  headers?: Record<string, string>;
  /** Whose mail this is. Determines where the file transport writes it. */
  username?: string;
};

export type SendResult = {
  transport: string;
  /** Where it went: a file path in development, a message id in production. */
  reference: string;
};

export interface MailTransport {
  readonly name: string;
  send(mail: Mail): Promise<SendResult>;
}

/**
 * What a journal's own `features.mail.enabled: false` does **not** stop.
 *
 * The per-journal switch governs the letters a journal sends *to its readers*
 * — the digest, the contact letters, the welcome. It does not govern letters
 * about access to the journal itself, because suppressing those takes control
 * away from the owner rather than giving it to them: a sign-in code nobody
 * receives is a journal nobody can get back into, and a deletion link nobody
 * receives makes B38's second step unreachable while the API still answers
 * 202.
 *
 * Kept as one string so `/api/health` and the docs cannot drift apart. See
 * `sendTransactional` in ./index.ts, and B60.
 */
export const TRANSACTIONAL_MAIL_NOTE =
  "sign-in codes, deletion confirmations and operator alerts are still sent — a journal's " +
  "mail switch governs the letters it sends to its readers";
