import "server-only";
import { translateIn } from "../locales";
import type { Composition } from "../messages/previews/types";
type MailComposition = Extract<Composition, { channel: "mail" }>;

/**
 * `notice.operatorMessage`'s composition — B2493. Mirrors `POST` in
 * `app/api/admin/message/route.ts`, which cannot export a non-HTTP function
 * itself. English-only on purpose (see that route's own comment): there is
 * no operator-locale setting to resolve, so a preview ignores `locale` too.
 */
export function composeOperatorMessageMail(params: {
  subject: string;
  text: string;
  siteName: string;
  username: string;
}): MailComposition {
  const { subject, text, siteName, username } = params;
  return {
    channel: "mail",
    subject,
    content: {
      template: "notice.operatorMessage",
      preheader: text.slice(0, 90),
      title: subject,
      blocks: text.split(/\n{2,}/).map((paragraph) => ({ kind: "paragraph" as const, text: paragraph })),
      why: translateIn("en", "op.messageFooter", { site: siteName, user: username }),
    },
  };
}
