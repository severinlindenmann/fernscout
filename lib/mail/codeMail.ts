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
  /** The door's own purpose, ahead of the code block — a string for one
   * sentence, or several blocks for a door that needs more (a scoped-trip
   * note, an app-vs-browser fork). */
  purpose: MailBlock[] | string;
  /** A sign-in / redeem button, when this door has a link to press instead
   * of typing the code back in. */
  url?: string;
  buttonText?: string;
  /** A line directly under the button — what pressing it does beyond the code. */
  urlNote?: string;
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
  const purposeBlocks: MailBlock[] =
    typeof input.purpose === "string" ? [{ kind: "paragraph", text: input.purpose }] : input.purpose;
  const blocks: MailBlock[] = [
    ...purposeBlocks,
    ...(input.url
      ? ([{ kind: "button", text: input.buttonText ?? "", href: input.url }] as const)
      : []),
    ...(input.url && input.urlNote ? ([{ kind: "paragraph", text: input.urlNote }] as const) : []),
    { kind: "code", text: input.code },
    ...(input.askedAt ? ([{ kind: "paragraph", text: input.askedAt }] as const) : []),
    { kind: "paragraph", text: input.ignoreText },
  ];
  const vars = { code: input.code, place: input.place, minutes: String(minutes) };
  const subject = translateIn(input.locale, "mail.codeSubject", vars);
  return {
    channel: "mail",
    subject,
    content: {
      template: input.template,
      preheader: subject,
      title: input.title,
      blocks,
      why: input.why,
      locale: input.locale,
    },
  };
}
