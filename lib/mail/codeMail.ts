import "server-only";
import { CODE_TTL_MINUTES } from "../auth";
import { translateIn } from "../locales";
import type { TemplateId } from "../messages/registry";
import type { Composition } from "../messages/previews/types";
import type { Locale } from "../types";
import type { MailBlock } from "./template";

/** Composition's mail branch, narrowed so a composer's own return type
 * carries `subject`/`content` without a runtime `channel` check every
 * caller would otherwise need — B2493. */
type MailComposition = Extract<Composition, { channel: "mail" }>;

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
  locale: Locale;
  code: string;
  /** What this journal or site is called — the subject's "{place}". */
  place: string;
  title: string;
  /** The small label over the code; defaults to "Your sign-in code". */
  label?: string;
  /** What this door says besides the code — small print, one string or a
   * few short lines. */
  purpose?: string[] | string;
  /** A secondary text link, when this door has one to press instead of
   * typing the code back in. */
  url?: string;
  linkText?: string;
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
};

/**
 * Every `code.*` mail's shared composition — subject and `MailContent`, with
 * no `to` and no `renderMail` call — B2493. Each send site (or, for a route
 * handler, `lib/mail/accountCodeCompositions.ts`) builds its own
 * `CodeMailInput` and reduces it through this exact function for both the
 * real send and the preview, so a preview can never drift from what a code
 * mail actually says.
 */
export function composeCodeMailContent(input: CodeMailInput): MailComposition {
  const minutes = input.minutes ?? CODE_TTL_MINUTES;
  const vars = { code: input.code, place: input.place, minutes: String(minutes) };
  const valid = translateIn(input.locale, "mail.codeValid", vars);
  const purpose = input.purpose === undefined ? [] : typeof input.purpose === "string" ? [input.purpose] : input.purpose;
  const blocks: MailBlock[] = [
    { kind: "passcode", label: input.label ?? translateIn(input.locale, "mail.codeLabel"), text: input.code, note: valid },
    ...(input.url ? ([{ kind: "link", text: input.linkText ?? "", href: input.url }] as const) : []),
    { kind: "rule" },
    ...[...purpose, input.ignoreText, ...(input.askedAt ? [input.askedAt] : [])].map(
      (text): MailBlock => ({ kind: "fine", text }),
    ),
  ];
  const subject = translateIn(input.locale, "mail.codeSubject", vars);
  return {
    channel: "mail",
    subject,
    content: {
      template: input.template,
      preheader: `${input.code} — ${valid}`,
      title: input.title,
      blocks,
      why: input.why,
      locale: input.locale,
    },
  };
}
