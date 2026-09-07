import "server-only";
import { balanceOf } from "../credits";
import { formatChf } from "./pricing";
import { pickLocale } from "../contacts/locale";
import { translateIn } from "../locales";
import { sendTransactional } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import type { Payment } from "../payments";
import type { Locale } from "../types";
import { getUser } from "../users";

/**
 * What somebody just paid for — B866.
 *
 * Money left a person's account and credits arrived in a journal, and until
 * this the Stripe path said nothing at all while the operator-approval path
 * said one sentence of hard-coded English. Neither gave a reference anybody
 * could put in their own books, which is the whole job of a receipt.
 *
 * ## It is a receipt, not an invoice for tax
 *
 * It states what was paid, when, for what, and under which reference — and it
 * makes no claim about VAT, because nothing this server reads knows whether
 * the operator is registered for it. Inventing a tax line would be the same
 * class of mistake as inventing weather: plausible, unverifiable, and worse
 * than an absent field. An operator who needs a tax invoice issues it from
 * their own accounting against the reference printed here.
 *
 * ## Free, best effort, and after the fact
 *
 * Transactional — one person, their own account, something they just did — so
 * it goes through `sendTransactional` and never `spend`. And it is called
 * *after* the credits are granted: by the time this runs the purchase is
 * complete, so a dead SMTP host must never turn a settled payment into a
 * failed one. Every failure is swallowed, exactly as `sendPostcardReceipt`
 * swallows its own.
 */
export async function sendPurchaseReceipt(payment: Payment): Promise<void> {
  try {
    const user = getUser(payment.owner);
    const to = user?.owner.email;
    if (!to) return;

    // The buyer is the journal's owner, so it is written in their language —
    // the same exception the postcard receipt makes.
    const locale: Locale = pickLocale(user.defaultLocale);
    const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
      translateIn(locale, key, vars);

    const credits = String(payment.credits);
    const amount = formatChf(payment.amountRappen);
    // `paidAt` is what the receipt is dated by; a row reaching here without
    // one has been settled by a path that did not stamp it, and the day it
    // was raised is a truer answer than today's date.
    const date = (payment.paidAt ?? payment.createdAt).slice(0, 10);
    const balance = await balanceOf(payment.owner);

    const content = {
      preheader: t("purchase.receipt.preheader", { credits, amount }),
      title: t("purchase.receipt.title"),
      blocks: [
        { kind: "paragraph" as const, text: t("purchase.receipt.body", { credits }) },
        ...(balance === null
          ? []
          : [
              {
                kind: "paragraph" as const,
                text: t("purchase.receipt.balance", { balance: String(balance) }),
              },
            ]),
        {
          kind: "table" as const,
          head: [t("purchase.receipt.colItem"), t("purchase.receipt.colAmount")],
          rows: [
            {
              cells: [t("purchase.receipt.lineCredits", { credits }), amount],
              // The method is small type under the line rather than a third
              // column: it is absent on older rows, and a column that is
              // empty half the time is a worse table than a note that is.
              note: payment.method
                ? t("purchase.receipt.paidWith", {
                    method: t(`purchase.receipt.method.${payment.method}` as "purchase.receipt.method.card"),
                  })
                : undefined,
            },
            { cells: [t("purchase.receipt.lineTotal"), amount] },
          ],
        },
        {
          kind: "meta" as const,
          text: t("purchase.receipt.reference", { id: payment.id, date }),
        },
        {
          kind: "item" as const,
          title: t("purchase.receipt.viewAccount"),
          href: `${serverSite().url}/${payment.owner}/account`,
        },
      ],
      footer: t("purchase.receipt.footer"),
    };

    await sendTransactional(
      renderMail(to, t("purchase.receipt.subject", { credits }), content, payment.owner),
      `purchase receipt for ${payment.id}`,
    );
  } catch (error) {
    // The credits are already granted. Saying so in the log is the whole
    // remedy; failing here would be a lie about what happened to the money.
    console.error(`[credits] receipt for payment ${payment.id} could not be sent:`, error);
  }
}

/**
 * The money went back — B878.
 *
 * Sent when the operator records a refund, and it says what was actually
 * taken rather than what was bought: somebody who spent sixty of a hundred
 * credits gets forty back off their balance, and a letter claiming a hundred
 * would be the first thing they check and the first thing that is wrong.
 * Where nothing could be taken it says that too, which is a truer sentence
 * than silence about the credits.
 *
 * Best effort and silent, like the receipt above: the money has already been
 * refunded by the time this runs.
 */
export async function sendRefundNotice(payment: Payment, creditsTaken: number): Promise<void> {
  try {
    const user = getUser(payment.owner);
    const to = user?.owner.email;
    if (!to) return;

    const locale: Locale = pickLocale(user.defaultLocale);
    const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
      translateIn(locale, key, vars);

    const amount = formatChf(payment.amountRappen);
    const content = {
      preheader: t("purchase.refund.preheader", { amount }),
      title: t("purchase.refund.title"),
      blocks: [
        { kind: "paragraph" as const, text: t("purchase.refund.body", { amount }) },
        {
          kind: "paragraph" as const,
          text:
            creditsTaken > 0
              ? t("purchase.refund.credits", { credits: String(creditsTaken) })
              : t("purchase.refund.creditsNone"),
        },
        {
          kind: "meta" as const,
          text: t("purchase.receipt.reference", {
            id: payment.id,
            date: (payment.paidAt ?? payment.createdAt).slice(0, 10),
          }),
        },
        {
          kind: "item" as const,
          title: t("purchase.receipt.viewAccount"),
          href: `${serverSite().url}/${payment.owner}/account`,
        },
      ],
      footer: t("purchase.refund.footer"),
    };

    await sendTransactional(
      renderMail(to, t("purchase.refund.subject", { amount }), content, payment.owner),
      `refund notice for ${payment.id}`,
    );
  } catch (error) {
    console.error(`[credits] refund notice for ${payment.id} could not be sent:`, error);
  }
}
