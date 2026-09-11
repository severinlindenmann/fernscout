import "server-only";
import { getUser } from "../users";
import { loadServerConfig } from "../config";
import { translateIn } from "../locales";
import { pickLocale } from "../contacts/locale";
import { sendTransactional } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import type { Locale } from "../types";
import { visibleBookFiles } from "./visibleFiles";

/**
 * What was made, what it cost, and where the files are.
 *
 * Links rather than an attachment, and that is not a shortcut: a 60-page book
 * at 300 DPI is hundreds of megabytes and no mailbox takes it. The postcard
 * receipt attaches its card because a card is one sheet.
 *
 * **It must not say the book was printed or posted, with one exception.**
 * This mail is sent only after a successful submission to Gelato (the
 * refusal branch in `order/route.ts` returns early, B1330), so "on the way"
 * is the strongest honest claim here: accepted is not printed, and a later
 * webhook can still report a refusal, which is exactly what happened to all
 * six books in the B911 run. `test/photobook-receipt.test.ts` checks the
 * words. **The one exception is `sendPhotobookShipped`, below** — it fires
 * only from a `shipped` webhook, by which point the book genuinely has been
 * printed and posted, and saying so is the first honest use of that word
 * anywhere in this file. Transactional, free, and
 * best effort — the files exist by the time this runs, so a dead SMTP host
 * must not turn a finished book into a reported failure.
 *
 * `files` is filtered through `visibleBookFiles` (B1438), the same helper the
 * order page reads, so the two never disagree about what is offered — the
 * print-ready interior and cover halves stay on disk and reachable by direct
 * URL, just not listed here.
 */

export type PhotobookReceiptInput = {
  owner: string;
  orderId: string;
  tripTitle: string;
  pages: number;
  volumes: number;
  /** "Square 200 × 200 mm", in the reader's own language — B1227. The two
   * facts a person checks a parcel against are the size and the cover, and
   * this mail named neither. */
  size: string;
  /** "Softcover" or "Hardcover", already translated. */
  cover: string;
  creditsSpent: number;
  balance: number | null;
  files: string[];
  /** Photographs the build could not read — pages that print as gaps. The
   * owner has already paid for the book; this is how they find out, since
   * this mail is the one place written for them to actually read. */
  missing?: string[];
};

/**
 * Whether this instance can actually put a book on paper — B1227.
 *
 * The same question `/api/health` answers and the order panel asks: a
 * `dry-run` provider builds files and reaches no printer. Read here rather
 * than passed in, because the caller knows what it built and not what the
 * instance is for.
 */
function canPrint(): boolean {
  const feature = loadServerConfig().features.photobook as Record<string, unknown>;
  const provider = typeof feature.provider === "string" ? feature.provider : "dry-run";
  return provider !== "dry-run";
}

/**
 * The other mail: the book was built and paid for, and the printer refused —
 * B1330.
 *
 * **No links.** The receipt carries the files because there is a book on its
 * way and those are its PDFs; this one carries none, because nothing was
 * bought in the end. Offering a download here would read as "here is what you
 * paid for" over an order that was refunded, which is the same confusion the
 * on-page message was fixed for.
 *
 * What it does carry is the reference. Every order is "my photobook" to the
 * person who made it, and this id is the only way anybody can find out what
 * actually happened.
 *
 * Best effort and never throws, like its sibling: the credits are already back
 * by the time this runs, and a dead SMTP host must not turn a handled refusal
 * into an unhandled one.
 */
export async function sendPhotobookRefused(input: {
  owner: string;
  orderId: string;
  tripTitle: string;
  creditsRefunded: number;
}): Promise<void> {
  const user = getUser(input.owner);
  const to = user?.owner.email;
  if (!to) return;

  const locale: Locale = pickLocale(user.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);
  const vars = { trip: input.tripTitle, credits: String(input.creditsRefunded) };
  const base = `${serverSite().url}/${input.owner}/photobooks/${input.orderId}`;

  try {
    await sendTransactional(
      renderMail(
        to,
        t("photobook.refused.subject", vars),
        {
          preheader: t("photobook.refused.preheader", vars),
          title: t("photobook.refused.title"),
          blocks: [
            { kind: "paragraph" as const, text: t("photobook.refused.body", vars) },
            { kind: "paragraph" as const, text: t("photobook.refused.reference", { id: input.orderId }) },
            { kind: "paragraph" as const, text: t("photobook.refused.next") },
            { kind: "item" as const, title: t("photobook.refused.viewOrder"), href: base },
          ],
          footer: t("photobook.receipt.footer"),
        },
        input.owner,
      ),
      `photobook refusal for ${input.orderId}`,
    );
  } catch (error) {
    console.error(`[photobook] refusal notice for ${input.orderId} could not be sent:`, error);
  }
}

/**
 * The book is in the post — B1440.
 *
 * The one mail the owner's word asked for (2026-09-11): not one per Gelato
 * status, one when it ships, carrying the tracking. Same shape as its two
 * siblings above: best-effort, never throws, links to the order page. The
 * caller (`app/api/webhooks/gelato/route.ts`) sends this at most once per
 * order — `recordTracking` in `lib/photobook/orders.ts` is what makes that
 * true, not this function.
 */
export async function sendPhotobookShipped(input: {
  owner: string;
  orderId: string;
  tripTitle: string;
  tracking: { code: string; url?: string; carrier?: string }[];
}): Promise<void> {
  const user = getUser(input.owner);
  const to = user?.owner.email;
  if (!to) return;

  const locale: Locale = pickLocale(user.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);
  const vars = { trip: input.tripTitle };
  const base = `${serverSite().url}/${input.owner}/photobooks/${input.orderId}`;

  try {
    await sendTransactional(
      renderMail(
        to,
        t("photobook.shipped.subject", vars),
        {
          preheader: t("photobook.shipped.preheader", vars),
          title: t("photobook.shipped.title"),
          blocks: [
            { kind: "paragraph" as const, text: t("photobook.shipped.body", vars) },
            ...input.tracking.map((code) => {
              const title = code.carrier
                ? t("photobook.shipped.trackingWithCarrier", { code: code.code, carrier: code.carrier })
                : t("photobook.shipped.tracking", { code: code.code });
              // Not every carrier gives Gelato a tracking URL — the code
              // itself is still worth having, just as a line rather than a
              // dead link.
              return code.url
                ? { kind: "item" as const, title, href: code.url }
                : { kind: "paragraph" as const, text: title };
            }),
            { kind: "item" as const, title: t("photobook.shipped.viewOrder"), href: base },
          ],
          footer: t("photobook.receipt.footer"),
        },
        input.owner,
      ),
      `photobook shipped notice for ${input.orderId}`,
    );
  } catch (error) {
    console.error(`[photobook] shipped notice for ${input.orderId} could not be sent:`, error);
  }
}

export async function sendPhotobookReceipt(input: PhotobookReceiptInput): Promise<void> {
  const user = getUser(input.owner);
  const to = user?.owner.email;
  if (!to) return;

  const locale: Locale = pickLocale(user.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const base = `${serverSite().url}/${input.owner}/photobooks/${input.orderId}`;
  const files = visibleBookFiles(input.files);
  const numbers = {
    trip: input.tripTitle,
    pages: String(input.pages),
    volumes: String(input.volumes),
    size: input.size,
    cover: input.cover,
  };

  const content = {
    preheader: t("photobook.receipt.preheader", numbers),
    title: t("photobook.receipt.title"),
    blocks: [
      {
        kind: "paragraph" as const,
        // Two sentences rather than one with "volume(s)" in it — B548's rule
        // about that shape holds in the mail as much as on the page, and
        // there is no plural helper on this side of the wall.
        text: t(
          input.volumes > 1 ? "photobook.receipt.bodyVolumes" : "photobook.receipt.body",
          numbers,
        ),
      },
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
      ...files.map((file) => ({
        kind: "item" as const,
        title: `${t("photobook.receipt.download")} — ${file}`,
        href: `${base}/${file}`,
      })),
      { kind: "item" as const, title: t("photobook.receipt.viewOrder"), href: base },
      ...(input.missing && input.missing.length > 0
        ? [
            {
              kind: "paragraph" as const,
              text: t("photobook.receipt.missing", { count: String(input.missing.length) }),
            },
          ]
        : []),
      // B1227. Only where it is true. This sentence told every instance it had
      // no print account, which stopped being true the day Gelato was
      // connected and survived because nobody reads their own receipts. On an
      // instance that does print, the order page carries the printer's own
      // status and this mail must not contradict it.
      ...(canPrint()
        ? []
        : [{ kind: "paragraph" as const, text: t("photobook.receipt.notPrinted") }]),
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
