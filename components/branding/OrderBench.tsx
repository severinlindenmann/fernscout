import OrderDocket from "@/components/order/OrderDocket";
import { photobookOrderView, postcardOrderView } from "@/lib/order/view";
import type { PhotobookOrder, PhotobookPayload } from "@/lib/photobook/orders";
import type { PostcardOrder } from "@/lib/postcard/orders";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";

/**
 * An order in the states a reader cannot reach — B1464.
 *
 * Almost everything worth looking at on an order page is a state somebody
 * would have to spend money, wait a week or provoke a printer to produce: a
 * refused print with its credits back, a word Gelato sent that this instance
 * has never mapped, a proposal that expired unsent, a book whose PDFs have
 * been pruned. B1461 was checked by hand-inserting rows into a development
 * database, which is precisely the procedure `/docs/branding` exists to
 * replace.
 *
 * Every order below is an object literal. No journal, no database, no
 * session, no capability — which is also what makes this the fastest page in
 * the repository to open while changing the component.
 *
 * The one thing this bench cannot show is the action slot in its real form:
 * the send button belongs to the postcard page because that page owns the
 * route it posts to. What is drawn here is a button-shaped stand-in, so the
 * *layout* with an action is checkable even though the action is not.
 */

const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn("en", key, vars);

const LABELS = {
  price: t("photobook.receipt.priceHeading"),
  total: t("photobook.receipt.total"),
  goingTo: t("photobook.print.toLabel"),
  files: t("photobook.downloadFile"),
  download: t("photobook.downloadFile"),
  noFiles: t("photobook.print.noFiles"),
};

const ADDRESS = {
  name: "A Reader",
  line1: "Beispielweg 4",
  line2: "",
  postcode: "3011",
  city: "Bern",
  country: "CH",
};

function book(payload: Partial<PhotobookPayload> = {}): PhotobookOrder {
  return {
    id: "0000000-bench-book",
    owner: "bench",
    status: "built",
    createdAt: "2026-09-11T09:12:00Z",
    updatedAt: "2026-09-11T09:12:00Z",
    payload: {
      trip: "bench/a-trip",
      options: { size: "square", coverType: "soft" } as PhotobookPayload["options"],
      pages: 46,
      volumes: 1,
      credits: 238,
      files: ["book.pdf"],
      print: {
        contactId: "c1",
        quotedCredits: 238,
        quotedAt: "2026-09-11T09:00:00Z",
        shipmentMethodUid: "normal",
      },
      ...payload,
    },
  };
}

function cards(
  payload: Partial<PostcardOrder["payload"]> = {},
  over: Partial<PostcardOrder> = {},
): PostcardOrder {
  return {
    id: "0000000-bench-cards",
    owner: "bench",
    status: "draft",
    provider: "dry-run",
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T08:00:00Z",
    payload: {
      trip: "bench/a-trip",
      day: "2026-08-14-a-day",
      photo: "a.jpg",
      message: "Hello from the bench",
      from: "Us",
      recipients: ["c1", "c2", "c3", "c4"],
      locale: "en",
      creditsEach: 20,
      expiresAt: "2026-09-17T08:00:00Z",
      ...payload,
    },
    ...over,
  };
}

const bookInput = {
  t,
  tripTitle: "A trip along a coast",
  sizeLabel: "Square 200 × 200 mm",
  recipient: ADDRESS,
  files: ["book.pdf"],
  fileHref: () => "#",
};

const cardInput = {
  t,
  dayName: "A morning on the bench",
  sentWhen: "10 September",
  recipients: [
    { name: "One Reader", town: "Bern, CH" },
    { name: "Two Reader", town: "Wien, AT" },
    { name: "Three Reader", town: "Luzern, CH" },
    { name: "Four Reader", town: "Lisboa, PT" },
  ],
  // Fixed, so the expired card below stays expired and the pending one stays
  // pending however long after this was written the page is opened.
  now: Date.parse("2026-09-12T00:00:00Z"),
};

const printed = (providerRef: string) => ({
  contactId: "c1",
  quotedCredits: 238,
  quotedAt: "2026-09-11T09:00:00Z",
  shipmentMethodUid: "normal",
  providerRef,
});

const CASES: { title: string; why: string; node: React.ReactNode }[] = [
  {
    title: "Accepted, and paid for",
    why: "The ordinary receipt: one charge, one envelope, one file. Everything else on this page is a variation on it.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          order: book({ print: printed("g-1") }),
          providerStatus: "created",
        })}
      />
    ),
  },
  {
    title: "With the cover it was ordered with",
    why: "B1469: the plate is the photograph the owner chose, checked against the disk first — a book whose photograph has since gone shows the block above instead, never a broken image. It is not a render of the printed cover; the title is set over this in the PDF and nothing here draws that.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          // A data URI, so the bench still needs no journal and no media.
          coverImage:
            "data:image/svg+xml;utf8," +
            encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9bd"/><stop offset="1" stop-color="#aeb7c5"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/></svg>`,
            ),
          order: book({ print: printed("g-6") }),
          providerStatus: "created",
        })}
      />
    ),
  },
  {
    title: "Being printed",
    why: "The one yellow pill. Yellow is a fill on this palette and never text, which is why the dot carries it and the chip stays a tint.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          order: book({ print: printed("g-2") }),
          providerStatus: "in_production",
        })}
      />
    ),
  },
  {
    title: "Shipped",
    why: "Green, and a page the owner opens to find out where the parcel is.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          order: book({ print: printed("g-3") }),
          providerStatus: "shipped",
        })}
      />
    ),
  },
  {
    title: "Refused, and refunded",
    why: "The printer had already handed back an order id before refusing — the common shape (B1454). Coral strip, a refund line, a total of zero.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          order: book({ print: { ...printed("g-4"), failure: "refused" } }),
          providerStatus: "failed",
        })}
      />
    ),
  },
  {
    title: "A word we have never mapped",
    why: "Gelato can add a status tomorrow. It prints raw, untranslated, in the neutral tone — a colour it has not earned would be inventing a fact about somebody's book.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          order: book({ print: printed("g-5") }),
          providerStatus: "held_at_customs",
        })}
      />
    ),
  },
  {
    title: "Pruned, and from before the print door",
    why: "An old book whose PDFs were deleted to make room (B483). No files, no printer, and the page says so rather than offering a download that would 404.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={photobookOrderView({
          ...bookInput,
          files: [],
          recipient: null,
          order: book({ print: undefined, files: [], pruned: true }),
        })}
      />
    ),
  },
  {
    title: "Four cards, waiting for the owner",
    why: "The only state with an action. The press sits beside the status rather than under the addresses, which is the whole reason the object went left.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={postcardOrderView({ ...cardInput, order: cards() })}
        action={
          <span className="rounded-full border border-yellow-600 bg-yellow-400 px-4 py-2 text-sm font-bold text-yellow-950">
            Send 4 postcards for 80 credits
          </span>
        }
      />
    ),
  },
  {
    title: "Sent",
    why: "Same order, no action. A receipt for cards, with the ledger the postcard page never used to show at all.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={postcardOrderView({ ...cardInput, order: cards({}, { status: "built" }) })}
      />
    ),
  },
  {
    title: "Expired unsent",
    why: "A proposal older than a week. Saying “waiting for you” about something nobody can act on any more would be a lie the page is in a position to avoid.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={postcardOrderView({
          ...cardInput,
          order: cards({ expiresAt: "2026-09-11T00:00:00Z" }),
        })}
      />
    ),
  },
  {
    title: "Refused by the printer",
    why: "Cards, refunded whole. The same two slots differ as on a refused book, which is the point of there being one component.",
    node: (
      <OrderDocket
        labels={LABELS}
        view={postcardOrderView({ ...cardInput, order: cards({}, { status: "failed" }) })}
      />
    ),
  },
];

export default function OrderBench() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500">Workbench</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-navy-900">
        Orders
      </h1>
      <p className="mt-3 max-w-2xl text-navy-700">
        One component for a photobook and for a set of postcards, in the states a reader cannot
        reach. Everything here is a fixture — no journal, no database, no session — so a fault that
        shows on this page is a fault in{" "}
        <code className="font-mono text-sm">components/order/OrderDocket.tsx</code> or in{" "}
        <code className="font-mono text-sm">lib/order/view.ts</code>, and nowhere else.
      </p>

      <div className="mt-10 flex flex-col gap-12">
        {CASES.map((c) => (
          <section key={c.title}>
            <h2 className="font-display text-lg font-semibold text-navy-900">{c.title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-navy-600">{c.why}</p>
            <div className="mt-4 rounded-2xl border border-navy-200 bg-cream-50 p-4 sm:p-6">
              {c.node}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
