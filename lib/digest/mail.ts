
import { translateIn } from "../locales";
import { renderMail, type MailBlock } from "../mail/template";
import type { Mail } from "../mail/types";
import type { Locale } from "../types";
import { formatDigestDate, type DigestContent } from "./content";

/**
 * One digest, as a message — the same template every other letter uses.
 *
 * There is deliberately no second template system here. `lib/mail/template.ts`
 * already renders for the reader this project is actually written for: someone
 * in their seventies, on a phone, in a mail client from 2019. A digest is that
 * layout with a list in the middle, and it inherits the plain-text alternative,
 * the escaping and the one-click unsubscribe headers by construction rather
 * than by remembering to add them.
 *
 * Pure: it takes everything it needs and returns a `Mail`. Nothing here reads
 * the database, the filesystem or the clock, which is what lets a test assert
 * "this reader's mail is in Hungarian" without a transport anywhere near it.
 */

export type DigestRecipient = {
  email: string;
  name: string | null;
  locale: Locale;
};

export type RenderDigestOptions = {
  username: string;
  /** The journal's name, as the reader knows it. */
  title: string;
  recipient: DigestRecipient;
  content: DigestContent;
  /** The reader's self-serve preferences page (D6). */
  manageUrl: string;
  /** The `List-Unsubscribe` address — a different URL; see `unsubscribeUrlFor`. */
  unsubscribeUrl: string;
};

export function renderDigest(options: RenderDigestOptions): Mail {
  const { recipient, content, title } = options;
  const locale = recipient.locale;
  const count = String(content.dayCount);
  const one = content.dayCount === 1;

  const subject = translateIn(locale, one ? "digest.subjectOne" : "digest.subject", {
    count,
    title,
  });
  const headline = translateIn(locale, one ? "digest.titleOne" : "digest.title", { count });

  const blocks: MailBlock[] = [];
  if (recipient.name) {
    blocks.push({
      kind: "paragraph",
      text: translateIn(locale, "digest.greeting", { name: recipient.name }),
    });
  }
  blocks.push({ kind: "paragraph", text: translateIn(locale, "digest.intro", { title }) });

  // A heading per trip only when there is more than one: a single-trip digest
  // already says which journal it is in the title, and a lone heading above a
  // list of six lines is furniture.
  const several = content.trips.length > 1;
  for (const trip of content.trips) {
    if (several) blocks.push({ kind: "heading", text: trip.title });
    for (const day of trip.days) {
      blocks.push({
        kind: "item",
        title: day.title,
        meta: day.location
          ? `${formatDigestDate(locale, day.date)} · ${day.location}`
          : formatDigestDate(locale, day.date),
        href: day.url,
      });
    }
    const trimmed = trip.newDays - trip.days.length;
    if (trimmed > 0) {
      blocks.push({
        kind: "paragraph",
        text: translateIn(locale, trimmed === 1 ? "digest.moreOne" : "digest.more", {
          count: String(trimmed),
        }),
      });
    }
  }

  // One clear link, and it goes to the newest day rather than to the front
  // page: the reader pressed "read the new days", so that is where they land.
  const newest = content.trips.flatMap((trip) => trip.days).at(-1);
  const target = newest?.url ?? content.trips[0]?.url;
  if (target) {
    blocks.push({ kind: "button", text: translateIn(locale, "digest.button"), href: target });
  }

  return renderMail(
    recipient.email,
    subject,
    {
      preheader: translateIn(locale, "digest.intro", { title }),
      title: headline,
      blocks,
      footer: translateIn(locale, "digest.footer", { site: title }),
      manageLink: {
        text: translateIn(locale, "digest.preferences"),
        href: options.manageUrl,
      },
      unsubscribeUrl: options.unsubscribeUrl,
      unsubscribeLabel: translateIn(locale, "contact.unsubscribe"),
    },
    options.username,
  );
}
