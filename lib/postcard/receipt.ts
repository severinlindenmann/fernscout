import "server-only";
import { getUser } from "../users";
import { translateIn } from "../locales";
import { pickLocale } from "../contacts/locale";
import { sendTransactional } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import type { Locale } from "../types";

/**
 * What was posted, to whom, and what it looked like — B467.
 *
 * A send spends credits, prints paper and puts it through somebody's door, and
 * until this the only trace the owner kept was a line on a page they were
 * about to close. The credit ledger records that fifteen credits went on
 * `postcard` against an order id; it cannot answer "did I send Marta one from
 * the pass, and which photograph was it?". This is that answer, in the place
 * people already keep answers.
 *
 * ## Names, never addresses
 *
 * `lib/contacts/mail.ts` states the rule for its own five letters and it holds
 * here: **no letter this project sends ever contains a postal address.** Mail
 * is the least private channel in the system, and an address in an inbox undoes
 * the encrypted column it was carefully kept in. So the receipt names people
 * and stops — the card itself carries the address because an envelope must,
 * and a receipt has no such excuse. `test/postcard-receipt.test.ts` checks it
 * against a contact whose street is known.
 *
 * The **PDF is the exception that proves it**: the attached card is the artwork
 * as printed, and its back necessarily shows the address it was sent to. That
 * is the one place the owner is entitled to see it, it is the document they
 * asked to be printed, and it is one file rather than a list. A receipt for
 * several cards attaches the *first* card only, for that reason: the design is
 * the same on all of them, and attaching five PDFs would put five households'
 * addresses in one inbox to prove one photograph.
 *
 * ## Free, and best effort
 *
 * Transactional: it goes to one person, about their own account, about
 * something they just did. `lib/credits.ts` says that kind is free and this
 * calls `sendTransactional`, never `spend`. And it is best effort in the same
 * way `sendInviteMail` is — the cards have already gone to the printer by the
 * time this runs, so a dead SMTP host must never turn a successful send into a
 * reported failure.
 */

export type ReceiptInput = {
  owner: string;
  orderId: string;
  day: string;
  /** Names only. Never an address — see above. */
  names: string[];
  /** Cards the printer accepted. */
  sent: number;
  creditsSpent: number;
  balance: number | null;
  /** The two-page card, as printed. One, whatever the recipient count. */
  pdf?: Buffer;
};

export async function sendPostcardReceipt(input: ReceiptInput): Promise<void> {
  const user = getUser(input.owner);
  const to = user?.owner.email;
  if (!to) return;

  // The owner is the recipient of this one, so it is written in *their*
  // language — the same exception `lib/contacts/mail.ts` makes for its note to
  // the owner.
  const locale: Locale = pickLocale(user.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const names = input.names.join(", ");
  const content = {
    preheader: t("postcard.receipt.preheader", { count: String(input.sent) }),
    title:
      input.sent === 1
        ? t("postcard.receipt.titleOne", { name: names })
        : t("postcard.receipt.titleMany", { count: String(input.sent) }),
    blocks: [
      { kind: "paragraph" as const, text: t("postcard.receipt.body", { names, day: input.day }) },
      {
        kind: "paragraph" as const,
        text:
          input.balance === null
            ? t("postcard.receipt.cost", { total: String(input.creditsSpent) })
            : t("postcard.receipt.costAndBalance", {
                total: String(input.creditsSpent),
                balance: String(input.balance),
              }),
      },
      { kind: "paragraph" as const, text: t("postcard.receipt.attached") },
      {
        kind: "item" as const,
        title: t("postcard.receipt.viewOrder"),
        href: `${serverSite().url}/${input.owner}/postcards/${input.orderId}`,
      },
    ],
    footer: t("postcard.receipt.footer"),
    ...(input.pdf
      ? {
          attachments: [
            {
              filename: `postcard-${input.day}.pdf`,
              contentType: "application/pdf",
              data: input.pdf,
              // Referenced by nothing; the encoder still wants an id, and its
              // presence is what keeps the attachment branch single.
              contentId: `postcard-${input.orderId}`,
              // The whole reason `lib/mail/rfc822.ts` learned a second shape:
              // a saved file, not a piece of the message.
              disposition: "attachment" as const,
            },
          ],
        }
      : {}),
  };

  const subject =
    input.sent === 1
      ? t("postcard.receipt.subjectOne", { name: names })
      : t("postcard.receipt.subjectMany", { count: String(input.sent) });

  try {
    await sendTransactional(
      renderMail(to, subject, content, input.owner),
      `postcard receipt for ${input.orderId}`,
    );
  } catch (error) {
    // The cards are already at the printer. Saying so in the log is the whole
    // remedy available; failing the send would be a lie about what happened.
    console.error(`[postcard] receipt for ${input.orderId} could not be sent:`, error);
  }
}
