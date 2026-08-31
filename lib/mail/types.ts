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
