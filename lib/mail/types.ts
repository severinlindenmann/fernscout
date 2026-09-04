/**
 * One file carried inline in the message, referenced from the HTML part by
 * `cid:<contentId>` — never a linked `<img src="https://…">`. A mail client
 * has no session cookie, so a URL into `/media/…` is a 404 in the inbox for
 * every trip that is not fully public (B345). The bytes travel with the
 * message instead.
 */
export type MailAttachment = {
  /** Shown to a client that offers to save it; cosmetic only. */
  filename: string;
  contentType: string;
  data: Buffer;
  /** The `<img src="cid:…">` this attachment answers. */
  contentId: string;
};

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
  /** Inline images, referenced by `cid:` from `html`. Absent for every
   * letter but the day-published one. */
  attachments?: MailAttachment[];
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
