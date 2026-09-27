import "server-only";
import type { Locale } from "../types";
import { renderMail, type MailBlock } from "./template";
import type { Mail } from "./types";

/**
 * The one builder behind both Fernscout-sent invite mails — B2440 work item
 * 3: the owner asking the server to mail a link directly
 * (`sendInviteMail`), and the welcome-link "Email" channel (the `invite.mail`
 * case `sendWelcomeMail` used to also serve). Both are "here is a link,
 * press it" mail — one paragraph, one button — with the subject, body and
 * button text staying the caller's own, since those are the actual content
 * difference (who invited whom, to what) rather than duplicated layout.
 */
export type InviteMailInput = {
  to: string;
  locale: Locale;
  subject: string;
  title: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  why: string;
  /** The never-invite suppression link (B2442) — this family's manage
   * line. `href` is the page; `unsubscribeHref` (M2), the confirm route a
   * mail client's own One-Click POST actually needs, is what
   * `List-Unsubscribe` points at. */
  manage?: { text: string; href: string; unsubscribeHref?: string };
  username?: string;
};

export function inviteMail(input: InviteMailInput): Mail {
  const blocks: MailBlock[] = [
    { kind: "paragraph", text: input.body },
    { kind: "button", text: input.buttonText, href: input.buttonUrl },
  ];
  return renderMail(
    input.to,
    input.subject,
    {
      template: "invite.mail",
      preheader: input.body,
      title: input.title,
      blocks,
      why: input.why,
      manage: input.manage,
      locale: input.locale,
    },
    input.username,
  );
}
