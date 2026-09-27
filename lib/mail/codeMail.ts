import "server-only";
import { CODE_TTL_MINUTES } from "../auth";
import { translateIn } from "../locales";
import type { TemplateId } from "../messages/registry";
import type { Locale } from "../types";
import { renderMail, type MailBlock } from "./template";
import type { Mail } from "./types";

/**
 * The one builder behind every sign-in code mail — B2440 work item 3.
 *
 * Six call sites (a reader's confirm code, an identity code, a journal
 * read/write code, a signup code, an owner-email-change code) each wrote
 * their own subject and laid the code out differently — three subject
 * styles, and the code itself sometimes a separate block, sometimes buried
 * in a sentence. This is the one layout: the door's own purpose (one or two
 * sentences, in order — a scoped-trip note or a "press this instead of
 * typing" line belongs here), the code as its own block, a sign-in button
 * when the door has a link to press instead, and the one subject pattern
 * "{code} is your code for {place}". Only the purpose, the button (if any)
 * and the door-specific ignore line differ between callers now.
 */
export type CodeMailInput = {
  template: TemplateId;
  to: string;
  locale: Locale;
  code: string;
  /** What this journal or site is called — the subject's "{place}". */
  place: string;
  title: string;
  /** The door's own purpose, ahead of the code block — a string for one
   * sentence, or several blocks for a door that needs more (a scoped-trip
   * note, an app-vs-browser fork). */
  purpose: MailBlock[] | string;
  /** A sign-in / redeem button, when this door has a link to press instead
   * of typing the code back in. */
  url?: string;
  buttonText?: string;
  /** The one line that differs per door: what "if you did not ask for
   * this" actually means here (nothing has changed / opened / been
   * created). */
  ignoreText: string;
  /** The "asked for at HH:MM" stamp — only the doors where two identical
   * mails could otherwise be told apart no other way (signup, journal). */
  askedAt?: string;
  minutes?: number;
  /** Already localized — differs by recipient kind (site vs journal). */
  why: string;
  username?: string;
};

export function codeMail(input: CodeMailInput): Mail {
  const minutes = input.minutes ?? CODE_TTL_MINUTES;
  const purposeBlocks: MailBlock[] =
    typeof input.purpose === "string" ? [{ kind: "paragraph", text: input.purpose }] : input.purpose;
  const blocks: MailBlock[] = [
    ...purposeBlocks,
    ...(input.url
      ? ([{ kind: "button", text: input.buttonText ?? "", href: input.url }] as const)
      : []),
    { kind: "code", text: input.code },
    ...(input.askedAt ? ([{ kind: "paragraph", text: input.askedAt }] as const) : []),
    { kind: "paragraph", text: input.ignoreText },
  ];
  const vars = { code: input.code, place: input.place, minutes: String(minutes) };
  return renderMail(
    input.to,
    translateIn(input.locale, "mail.codeSubject", vars),
    {
      template: input.template,
      preheader: translateIn(input.locale, "mail.codeSubject", vars),
      title: input.title,
      blocks,
      why: input.why,
      locale: input.locale,
    },
    input.username,
  );
}
