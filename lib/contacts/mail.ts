import "server-only";
import type { UserConfig } from "../config";
import { CODE_TTL_MINUTES } from "../auth";

import { translateIn } from "../locales";
import { sendMail } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import type { Locale } from "../types";
import {
  manageTokenFor,
  manageUrl,
  unsubscribeUrlFor,
  type ContactRecord,
} from "./index";
import { pickLocale } from "./locale";

/**
 * The four letters this feature writes.
 *
 * Each one is written in the *recipient's* language, which is the whole point
 * of keeping a locale on the contact: the digest picking `preferred_locale` per
 * recipient (ROADMAP §3.1) starts here. The one exception is the note to the
 * owner, which is in the owner's language — they are the recipient of that one.
 *
 * **No letter ever contains a postal address.** Not the confirmation, not the
 * note to the owner. Mail is the least private channel in this system and an
 * address in a subject line would undo the encrypted column entirely.
 *
 * Every letter to a reader carries the self-serve link in its footer, so
 * `List-Unsubscribe` works from any mail client and no reader ever has to find
 * a login to make the mail stop.
 */

function baseUrl(): string {
  return serverSite().url;
}

function footerFor(locale: Locale, user: UserConfig): string {
  return translateIn(locale, "contact.mailFooter", { site: user.title });
}

/** The one-time code (C12). Transactional: no unsubscribe link, because there
 * is nothing yet to unsubscribe from. */
export async function sendCodeMail(
  username: string,
  user: UserConfig,
  to: string,
  locale: Locale,
  code: string,
) {
  return sendMail(
    renderMail(
      to,
      translateIn(locale, "contact.mailCodeSubject", { title: user.title }),
      {
        preheader: translateIn(locale, "contact.mailCodeBody", { code, minutes: CODE_TTL_MINUTES }),
        title: translateIn(locale, "contact.mailCodeTitle"),
        blocks: [
          { kind: "paragraph", text: translateIn(locale, "contact.mailCodeBody", { code, minutes: CODE_TTL_MINUTES }) },
          { kind: "paragraph", text: translateIn(locale, "contact.mailCodeIgnore") },
        ],
        footer: footerFor(locale, user),
      },
      username,
    ),
  );
}

/** "We have your details, the owner will let you in." Carries the manage link
 * — the first mail that can, because the address has just been proved. */
export async function sendConfirmedMail(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
  manageToken: string,
) {
  const locale = pickLocale(contact.locale, user.defaultLocale);
  const manage = manageUrl(baseUrl(), username, manageToken);
  return sendMail(
    renderMail(
      contact.email,
      translateIn(locale, "contact.doneTitle"),
      {
        preheader: translateIn(locale, "contact.doneBody", { title: user.title }),
        title: translateIn(locale, "contact.doneTitle"),
        blocks: [
          { kind: "paragraph", text: translateIn(locale, "contact.doneBody", { title: user.title }) },
          {
            kind: "button",
            text: translateIn(locale, "contact.mailManageButton"),
            href: manage,
          },
        ],
        footer: footerFor(locale, user),
        unsubscribeUrl: unsubscribeUrlFor(baseUrl(), username, manageToken),
      },
      username,
    ),
  );
}

/**
 * C16 — the owner hears about it.
 *
 * Sent the moment somebody confirms, not on a schedule, because the failure
 * this exists to prevent is a request sitting unseen for a fortnight while the
 * owner is on a bus. It links straight into the overview rather than asking
 * them to go and find it.
 */
export async function notifyOwnerOfRequest(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
) {
  if (!user.owner.email) return null;
  const locale = pickLocale(user.defaultLocale);
  return sendMail(
    renderMail(
      user.owner.email,
      translateIn(locale, "contact.mailRequestSubject", { title: user.title }),
      {
        preheader: translateIn(locale, "contact.mailRequestBody", {
          name: contact.name ?? contact.email,
          email: contact.email,
        }),
        title: translateIn(locale, "contact.mailRequestTitle"),
        blocks: [
          {
            kind: "paragraph",
            // Name and address, and nothing else. Whether they asked for a
            // postcard is on the overview page; where they live is not in a
            // mail.
            text: translateIn(locale, "contact.mailRequestBody", {
              name: contact.name ?? contact.email,
              email: contact.email,
            }),
          },
          {
            kind: "button",
            text: translateIn(locale, "contact.mailRequestButton"),
            href: `${baseUrl()}/${username}/contacts`,
          },
        ],
        footer: footerFor(locale, user),
      },
      username,
    ),
  );
}

/** "You're in." Sent when the owner approves, in the reader's language. */
export async function sendApprovedMail(
  username: string,
  user: UserConfig,
  contact: ContactRecord,
) {
  const locale = pickLocale(contact.locale, user.defaultLocale);
  // Recomputed rather than carried around: the manage token is derived from the
  // contact id, so a mail written months later still has the working link.
  const token = manageTokenFor(username, contact.id);
  return sendMail(
    renderMail(
      contact.email,
      translateIn(locale, "contact.mailApprovedSubject", { title: user.title }),
      {
        preheader: translateIn(locale, "contact.mailApprovedBody", { title: user.title }),
        title: translateIn(locale, "contact.mailApprovedTitle"),
        blocks: [
          {
            kind: "paragraph",
            text: translateIn(locale, "contact.mailApprovedBody", { title: user.title }),
          },
          {
            kind: "button",
            text: translateIn(locale, "contact.mailApprovedButton", { title: user.title }),
            href: `${baseUrl()}/${username}`,
          },
          {
            kind: "item",
            title: translateIn(locale, "contact.mailManageButton"),
            href: manageUrl(baseUrl(), username, token),
          },
        ],
        footer: footerFor(locale, user),
        unsubscribeUrl: unsubscribeUrlFor(baseUrl(), username, token),
      },
      username,
    ),
  );
}
