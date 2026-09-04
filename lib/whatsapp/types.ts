/**
 * One WhatsApp message, independent of how it gets sent — the shape
 * `lib/mail/types.ts` has for a letter.
 *
 * **It is always a template**, and that is not a simplification. Outside a
 * 24-hour customer service window the Cloud API accepts nothing else, and a
 * publish notice is by definition business-initiated: nobody messaged us
 * first. So there is no free-form variant here to reach for by mistake, and
 * the fields are the ones a template actually has — an approved name, a
 * language, positional body variables, and the two things Meta lets a caller
 * vary at send time.
 */
export type WhatsappMessage = {
  /** E.164 digits, no `+`. See `toE164` — nothing else may build this. */
  to: string;
  /** The template's name, as approved. Chosen per recipient locale. */
  template: string;
  /** The template's language code, e.g. `de`. Part of its identity to Meta. */
  language: string;
  /**
   * Body variables in order, filling `{{1}}`, `{{2}}` … of the approved text.
   *
   * Positional rather than named because that is what the template was
   * registered with; a mismatch in *count* is rejected by Meta at send time,
   * which is the failure we want — loud, and before anybody reads it.
   */
  body: string[];
  /**
   * What is appended to the URL button's fixed base — the day's path.
   *
   * Meta permits exactly one variable, and only at the end of a base URL
   * fixed at approval time. That is why this is a path fragment and not a
   * URL: the origin is the template's, not ours to send.
   */
  buttonPath?: string;
  /** The header photograph. JPEG or PNG only, ≤5 MB — see `headerPhoto`. */
  photo?: WhatsappPhoto;
  /** Whose message this is. Decides where the dry-run backend writes it. */
  username?: string;
};

export type WhatsappPhoto = {
  data: Buffer;
  /** `image/jpeg` or `image/png`. WhatsApp accepts no other header format. */
  contentType: string;
  filename: string;
};

export type WhatsappSendResult = {
  backend: string;
  /** A file path under dry-run, a `wamid.…` in production. */
  reference: string;
};

export interface WhatsappTransport {
  readonly name: string;
  send(message: WhatsappMessage): Promise<WhatsappSendResult>;
}
