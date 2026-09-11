import { formatCredits } from "../credits/format";
import type { TranslationKey } from "../i18n";
import { orderLedger, type OrderLedger, type OrderLedgerLine } from "./ledger";
import type { PhotobookOrder } from "../photobook/orders";
import type { PostcardOrder } from "../postcard/orders";
import { orderCost, isExpired, isPending } from "../postcard/orders";
import type { PostalAddress } from "../postcard/render";
import { addressLines } from "./address";
import { A6_LANDSCAPE } from "../postcard/spec";

/**
 * What an order *is*, with no idea what it is an order for — B1463.
 *
 * A photobook order and a postcard order answer the same four questions —
 * what is this, where does it stand, what did it cost, who is it going to —
 * and until this file they answered them in two unrelated pages, with the
 * envelope markup written out three times and the status vocabulary living
 * on only one of them. Two copies of a vocabulary is how the two drift, and
 * they already had: the photobook receipt said what a book cost and the
 * postcard page never said what the cards cost at all.
 *
 * So: one shape, and one adapter per product that fills it.
 *
 * ## What is deliberately *not* here
 *
 * **The action.** The drafts count six slots and this type has five, because
 * the sixth is a form that spends credits — behaviour, not a fact about the
 * order — and it belongs to the page that owns the route it posts to. The
 * postcard send button is the only thing in this codebase that spends at a
 * printer and it is reachable from exactly one place; a "label and a href"
 * on a data structure would be the beginning of a second one. `OrderDocket`
 * takes it as a rendered slot instead.
 *
 * **Anything that touches the network or the disk.** Gelato's own word for a
 * print's state arrives here as an argument, already fetched by the server
 * component. That keeps this file synchronous, pure, and testable in every
 * state a reader cannot reach — which is the whole point of building it
 * before the component.
 *
 * ## Every string is resolved here
 *
 * The adapters take a bound translator rather than returning keys, because
 * the alternative is a component that knows which key goes with which
 * product, which is the product knowledge this split exists to remove.
 */

/** The four tones the palette reserves for state. Coral is a real failure and
 *  nothing else; an unrecognised state is navy, never a colour it has not
 *  earned. */
export type OrderTone = "navy" | "yellow" | "green" | "coral";

type OrderStatus = {
  tone: OrderTone;
  label: string;
  /** One sentence of context, when the state has one to add. */
  note?: string;
};

/** An envelope, as it is read: the name over the address. */
type OrderRecipient = { name: string; lines: string[] };

/** The physical thing. `spec` stands in for the plate until something renders
 *  a cover (B1469), which is why `image` is optional rather than required. */
type OrderObject = {
  label: string;
  spec: string;
  shape: "square" | "wide";
  image?: string;
};

type OrderFile = { name: string; sub: string; href: string };

export type OrderView = {
  kind: "photobook" | "postcards";
  head: { eyebrow: string; title: string; subtitle: string };
  status: OrderStatus | null;
  ledger: OrderLedger;
  recipients: OrderRecipient[];
  object: OrderObject | null;
  files: OrderFile[];
  /** Ordered-at and reference, on one line. */
  meta: string;
};

/** A translator already bound to the reader's locale. */
type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

/**
 * The Gelato words this instance has a meaning and a colour for — B1451,
 * moved here whole from `app/[user]/photobooks/[id]/page.tsx`.
 *
 * Keyed lower-case: `TERMINAL_FAILURES` in `lib/photobook/print.ts` already
 * lower-cases before comparing, because Gelato's sandbox has been seen
 * returning `Cancelled` capitalised.
 *
 * `printed` here is Gelato's word for "the printer has printed it" — not our
 * own order-status column, which B1437 renamed to `built` for exactly this
 * reason.
 */
const KNOWN_STATUSES: Record<string, { key: TranslationKey; tone: OrderTone }> = {
  created: { key: "photobook.print.status.accepted", tone: "navy" },
  passed: { key: "photobook.print.status.accepted", tone: "navy" },
  in_production: { key: "photobook.print.status.inProduction", tone: "yellow" },
  printed: { key: "photobook.print.status.inProduction", tone: "yellow" },
  shipped: { key: "photobook.print.status.shipped", tone: "green" },
  failed: { key: "photobook.print.status.refused", tone: "coral" },
  canceled: { key: "photobook.print.status.refused", tone: "coral" },
  cancelled: { key: "photobook.print.status.refused", tone: "coral" },
};

/** The context sentence each mapped state has, and the ones that have none. */
const STATUS_CONTEXT: Partial<Record<TranslationKey, TranslationKey>> = {
  "photobook.print.status.accepted": "photobook.print.context.accepted",
  "photobook.print.status.inProduction": "photobook.print.context.inProduction",
  "photobook.print.status.shipped": "photobook.print.context.shipped",
};

export type PhotobookViewInput = {
  order: PhotobookOrder;
  t: Translate;
  /** The trip's own title, or null when the trip is gone. */
  tripTitle: string | null;
  /** What the size is called — `BOOK_SIZES[...]?.name`, already resolved. */
  sizeLabel: string;
  /** Gelato's own word for this order, already fetched: the word, `null`
   *  where the lookup failed, or `undefined` where there was nothing to ask
   *  about. The three are different answers and the page must not flatten
   *  them. */
  providerStatus?: string | null;
  /** The whole envelope, name included — `bookAddressFor`'s own shape. */
  recipient: PostalAddress | null;
  files: string[];
  /** Where a file of this order is downloaded from. */
  fileHref: (file: string) => string;
  /**
   * The photograph on the front of this book — B1469, and only when the page
   * has confirmed the file is still there. Absent is the ordinary case (a
   * cover the planner picked leaves no record on the order), and absent is
   * fine: the slot falls back to the size and the binding.
   */
  coverImage?: string;
};

/**
 * One photobook order as an order.
 *
 * The pill and the sentence under it are computed **separately** — B1454. A
 * refused order almost always still carries a `providerRef` (Gelato accepts
 * the order, hands back an id, and only then refuses it), so whether the
 * credits are back can never be read off which branch drew the pill. It is a
 * fact about `print.failure`, asked on its own.
 */
export function photobookOrderView(input: PhotobookViewInput): OrderView {
  const { order, t, sizeLabel } = input;
  const print = order.payload.print;
  const refunded = Boolean(print?.failure ?? order.payload.failure);

  let status: OrderStatus | null = null;
  let matched: TranslationKey | null = null;

  if (print?.providerRef) {
    if (input.providerStatus) {
      const known = KNOWN_STATUSES[input.providerStatus.toLowerCase()];
      // The rule that outlives the styling: a word this instance has not
      // mapped gets no colour and no translation, ever — just the raw word
      // Gelato sent, in the neutral tone. Gelato can add a status tomorrow,
      // and colouring an unrecognised one green or red would be inventing a
      // fact about somebody's book.
      status = known
        ? { tone: known.tone, label: t(known.key) }
        : { tone: "navy", label: input.providerStatus };
      matched = known?.key ?? null;
    } else {
      status = { tone: "navy", label: t("photobook.print.status.unknown") };
    }
  } else if (print?.failure) {
    status = { tone: "coral", label: t("photobook.print.status.refused") };
  }

  if (status) {
    if (refunded) {
      status.note = t("photobook.print.refusedRefunded", {
        credits: formatCredits(order.payload.credits),
      });
    } else {
      const context = matched ? STATUS_CONTEXT[matched] : undefined;
      if (context) status.note = t(context);
    }
  } else if (!print?.providerRef && !print?.failure) {
    // No print was ever completed for this order — a book from before this
    // instance addressed a book at the moment it was bought (pre-B1157). The
    // files are the whole of what can be offered it.
    status = { tone: "navy", label: t("photobook.print.status.unknown"), note: t("photobook.print.legacyNoPrintDoor") };
  }

  const lines: Omit<OrderLedgerLine, "amount">[] = [
    { label: t("photobook.receipt.line"), credits: order.payload.credits },
  ];
  if (refunded) {
    lines.push({ label: t("photobook.receipt.refunded"), credits: order.payload.credits, refund: true });
  }

  return {
    kind: "photobook",
    head: {
      eyebrow: t("photobook.title"),
      title: t("photobook.print.receiptTitle"),
      subtitle: t(
        order.payload.volumes === 1 ? "photobook.print.orderIntro.one" : "photobook.print.orderIntro",
        {
          trip: input.tripTitle ?? order.payload.trip,
          pages: String(order.payload.pages),
          volumes: String(order.payload.volumes),
          size: sizeLabel,
        },
      ),
    },
    status,
    ledger: orderLedger(t, lines),
    recipients: input.recipient
      ? [{ name: input.recipient.name, lines: addressLines(input.recipient) }]
      : [],
    object: {
      label: t("order.object.cover"),
      spec: sizeLabel,
      shape: "square",
      image: input.coverImage,
    },
    files: input.files.map((file) => ({ name: file, sub: sizeLabel, href: input.fileHref(file) })),
    meta: t("photobook.receipt.meta", { date: order.createdAt.slice(0, 10), id: order.id }),
  };
}

export type PostcardViewInput = {
  order: PostcardOrder;
  t: Translate;
  /** What the day is called, or null for a card staged from the inbox. */
  dayName: string | null;
  /** When it went, for the sent wording — already formatted. */
  sentWhen: string;
  /** Name and town only, in the order's own order. A street never reaches
   *  this list: `addressesFor` is the owner's own disclosure and lives on the
   *  page, behind a control they open deliberately. */
  recipients: { name: string; town: string }[];
  now?: number;
};

/**
 * One postcard order as an order.
 *
 * Three states rather than a printer's vocabulary: waiting for the owner,
 * gone to the printer, or refused with the credits back. An expired proposal
 * reads as its own state — the cards can no longer be sent, and saying
 * "waiting for you" about something nothing can do any more would be a lie
 * the page is in a position to avoid.
 */
export function postcardOrderView(input: PostcardViewInput): OrderView {
  const { order, t } = input;
  const pending = isPending(order);
  const expired = isExpired(order, input.now);
  const failed = order.status === "failed";
  const count = order.payload.recipients.length;
  const cost = orderCost(order);

  let status: OrderStatus;
  if (failed) {
    status = {
      tone: "coral",
      label: t("photobook.print.status.refused"),
      note: t("postcard.result.providerFailed"),
    };
  } else if (!pending) {
    status = { tone: "green", label: t("photobook.print.status.shipped"), note: t("postcard.result.sent") };
  } else if (expired) {
    status = { tone: "navy", label: t("order.status.expired"), note: t("postcard.result.expired") };
  } else {
    status = { tone: "navy", label: t("order.status.waiting"), note: t("postcard.page.sendWarning") };
  }

  const introKey: TranslationKey = input.dayName
    ? failed
      ? "postcard.page.introFailed"
      : pending
        ? "postcard.page.intro"
        : "postcard.page.introSent"
    : failed
      ? "postcard.page.introFromFileFailed"
      : pending
        ? "postcard.page.introFromFile"
        : "postcard.page.introFromFileSent";

  const lines: Omit<OrderLedgerLine, "amount">[] = [
    {
      label: t("order.postcards.line", {
        each: formatCredits(order.payload.creditsEach),
        count: String(count),
      }),
      credits: cost,
    },
  ];
  // A refused set is refunded whole, the same way a refused book is, and the
  // ledger says so rather than leaving somebody to work out whether the money
  // came back.
  if (failed) lines.push({ label: t("photobook.receipt.refunded"), credits: cost, refund: true });

  return {
    kind: "postcards",
    head: {
      eyebrow: t("postcard.title"),
      title: t(
        pending
          ? "postcard.page.title"
          : failed
            ? "postcard.page.titleFailed"
            : "postcard.page.titleSent",
      ),
      subtitle: t(introKey, { day: input.dayName ?? "", when: input.sentWhen }),
    },
    status,
    ledger: orderLedger(t, lines),
    recipients: input.recipients.map((r) => ({ name: r.name, lines: [r.town] })),
    // The size comes from the print spec rather than a string in a locale
    // file — a card's dimensions are a fact about what is printed, and a
    // translated copy of them is a copy that can disagree with the printer.
    object: {
      label: t("order.object.front"),
      shape: "wide",
      spec: `${A6_LANDSCAPE.trimWidthMm} × ${A6_LANDSCAPE.trimHeightMm} mm`,
    },
    files: [],
    meta: t(pending ? "order.meta.proposed" : "order.meta.sent", {
      date: order.createdAt.slice(0, 10),
      id: order.id,
    }),
  };
}
