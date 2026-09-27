import "server-only";
import type { Locale } from "../types";
import { renderMail, type MailBlock } from "./template";
import type { Mail } from "./types";

/**
 * The one builder behind both "you're in" mails — B2440 work item 3: the
 * welcome-link "Email" channel's let-in path (`tellLetIn`'s old
 * `invite.in.mail` case through `sendWelcomeMail`), and the owner-approval
 * mail (`sendApprovedMail`). One paragraph, one button, and — only for the
 * approval mail — the extra items (a buddy's agent instructions, the
 * reader's own manage link) that the welcome-link flow has no equivalent of.
 */
export type LetInMailInput = {
  to: string;
  locale: Locale;
  subject: string;
  title: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  why: string;
  manage?: { text: string; href: string };
  items?: { title: string; meta?: string; href: string }[];
  username?: string;
};

export function letInMail(input: LetInMailInput): Mail {
  const blocks: MailBlock[] = [
    { kind: "paragraph", text: input.body },
    { kind: "button", text: input.buttonText, href: input.buttonUrl },
    ...(input.items ?? []).map((item) => ({ kind: "item" as const, ...item })),
  ];
  return renderMail(
    input.to,
    input.subject,
    {
      template: "invite.in.mail",
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
