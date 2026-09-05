import "server-only";
import { getUser } from "../users";
import { translateIn } from "../locales";
import { pickLocale } from "../contacts/locale";
import { sendTransactional } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import type { Locale } from "../types";

/**
 * What was made, what it cost, and where the files are.
 *
 * Links rather than an attachment, and that is not a shortcut: a 60-page book
 * at 300 DPI is hundreds of megabytes and no mailbox takes it. The postcard
 * receipt attaches its card because a card is one sheet.
 *
 * **It must not say the book was printed or posted**, because nothing was.
 * `test/photobook-receipt.test.ts` checks the words. Transactional, free, and
 * best effort — the files exist by the time this runs, so a dead SMTP host
 * must not turn a finished book into a reported failure.
 */

export type PhotobookReceiptInput = {
  owner: string;
  orderId: string;
  tripTitle: string;
  pages: number;
  volumes: number;
  creditsSpent: number;
  balance: number | null;
  files: string[];
  /** Photographs the build could not read — pages that print as gaps. The
   * owner has already paid for the book; this is how they find out, since
   * this mail is the one place written for them to actually read. */
  missing?: string[];
};

export async function sendPhotobookReceipt(input: PhotobookReceiptInput): Promise<void> {
  const user = getUser(input.owner);
  const to = user?.owner.email;
  if (!to) return;

  const locale: Locale = pickLocale(user.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const base = `${serverSite().url}/${input.owner}/photobooks/${input.orderId}`;
  const numbers = {
    trip: input.tripTitle,
    pages: String(input.pages),
    volumes: String(input.volumes),
  };

  const content = {
    preheader: t("photobook.receipt.preheader", numbers),
    title: t("photobook.receipt.title"),
    blocks: [
      { kind: "paragraph" as const, text: t("photobook.receipt.body", numbers) },
      {
        kind: "paragraph" as const,
        text:
          input.balance === null
            ? t("photobook.receipt.cost", { total: String(input.creditsSpent) })
            : t("photobook.receipt.costAndBalance", {
                total: String(input.creditsSpent),
                balance: String(input.balance),
              }),
      },
      ...input.files.map((file) => ({
        kind: "item" as const,
        title: `${t("photobook.receipt.download")} — ${file}`,
        href: `${base}/${file}`,
      })),
      ...(input.missing && input.missing.length > 0
        ? [
            {
              kind: "paragraph" as const,
              text: t("photobook.receipt.missing", { count: String(input.missing.length) }),
            },
          ]
        : []),
      { kind: "paragraph" as const, text: t("photobook.receipt.notPrinted") },
    ],
    footer: t("photobook.receipt.footer"),
  };

  try {
    await sendTransactional(
      renderMail(to, t("photobook.receipt.subject", numbers), content, input.owner),
      `photobook receipt for ${input.orderId}`,
    );
  } catch (error) {
    console.error(`[photobook] receipt for ${input.orderId} could not be sent:`, error);
  }
}
