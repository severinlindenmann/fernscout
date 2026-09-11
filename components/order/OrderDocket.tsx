import type { ReactNode } from "react";
import type { OrderLedger } from "@/lib/order/ledger";
import type { OrderTone, OrderView } from "@/lib/order/view";

/**
 * One order, drawn — B1464, and the same component for a book and for a set
 * of postcards.
 *
 * It renders an `OrderView` (`lib/order/view.ts`) and knows nothing else: no
 * product, no database, no session, no capability. That is what lets
 * `/docs/branding/order` show it in the states a reader cannot reach — a
 * refused print, a word the printer sent that this instance has never mapped,
 * an expired proposal — from object literals rather than from a seeded
 * database.
 *
 * ## The action is a slot, not a prop
 *
 * `action` arrives as rendered children from the page that owns the route it
 * posts to. The postcard send button is the only thing in this codebase that
 * spends credits at a printer and it is reachable from exactly one place; a
 * `{ label, href }` on a view model would be the beginning of a second one.
 * A receipt passes nothing and the slot is simply absent.
 *
 * ## What the drafts settled, so a later change knows what it is breaking
 *
 * Object plate left, status and money right — so that on a proposal the press
 * is beside the price rather than under an address list, and on a phone the
 * order is object, status, ledger, action in that order. One yellow rule, on
 * the total, because yellow in this palette is the thing that costs money.
 * Coral is a real failure and nothing else.
 */

const TONE_CHIP: Record<OrderTone, string> = {
  navy: "border-navy-300 bg-navy-100 text-navy-800",
  yellow: "border-yellow-400 bg-yellow-300 text-yellow-950",
  green: "border-green-500 bg-green-100 text-green-700",
  coral: "border-coral-600 bg-coral-100 text-coral-600",
};

/** The dot uses each tone's deep token as a *fill* — `yellow-600` included,
 *  which is fill-only on this palette — while the chip stays a light tint so
 *  the label is legible without leaning on colour to carry the meaning. */
const TONE_DOT: Record<OrderTone, string> = {
  navy: "bg-navy-600",
  yellow: "bg-yellow-600",
  green: "bg-green-700",
  coral: "bg-coral-600",
};

export function OrderPill({ tone, label }: { tone: OrderTone; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CHIP[tone]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  );
}

/** The name centred over the whole address — how an address is read, and what
 *  somebody checks a parcel against (B1145). */
export function OrderEnvelope({
  toLabel,
  name,
  lines,
}: {
  toLabel: string;
  name: string;
  lines: string[];
}) {
  return (
    <address className="rounded-lg border border-dashed border-navy-300 bg-cream-50 px-3 py-3 text-center not-italic">
      <span className="block text-[0.7rem] font-semibold uppercase tracking-wider text-navy-600">
        {toLabel}
      </span>
      <span className="mt-1 block text-base font-semibold text-navy-900">{name}</span>
      {lines.map((line) => (
        <span key={line} className="block text-sm text-navy-700">
          {line}
        </span>
      ))}
    </address>
  );
}

/**
 * The money, as a card — the same one before the press and after it.
 *
 * Exported because the photobook buy panel renders it too (B1466): a price
 * somebody agreed to and the price on the receipt afterwards must not be
 * phrased differently, and they were.
 */
export function OrderLedgerCard({
  ledger,
  heading,
  totalLabel,
  meta,
}: {
  ledger: OrderLedger;
  heading: string;
  totalLabel: string;
  meta?: string;
}) {
  return (
    <section className="rounded-xl border border-navy-200 bg-white">
      <h2 className="border-b border-navy-200 px-4 py-3 font-display text-base font-semibold text-navy-900">
        {heading}
      </h2>
      <dl>
        {ledger.lines.map((line) => (
          <div
            key={line.label}
            className="flex items-baseline justify-between gap-4 border-b border-navy-100 px-4 py-3 last:border-b-0"
          >
            <dt className="text-sm text-navy-700">{line.label}</dt>
            <dd className="shrink-0 font-mono text-sm text-navy-900">{line.amount}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-yellow-400 bg-cream-100 px-4 py-3">
          <dt className="text-sm font-semibold text-navy-900">{totalLabel}</dt>
          <dd className="shrink-0 text-right">
            <span className="block font-mono text-base font-semibold text-navy-900">
              {ledger.totalLabel}
            </span>
            <span className="block text-xs text-navy-600">{ledger.totalMoney}</span>
          </dd>
        </div>
      </dl>
      {/* The date as it is stored, not as a locale renders it: a receipt is
          read back months later, sometimes beside a bank statement. */}
      {meta && (
        <p className="border-t border-navy-100 px-4 py-3 font-mono text-xs text-navy-600">{meta}</p>
      )}
    </section>
  );
}

export type OrderDocketProps = {
  view: OrderView;
  /** Section headings and the two labels the view model has no product
   *  opinion about, already translated by the page. */
  labels: {
    price: string;
    total: string;
    goingTo: string;
    files: string;
    download: string;
    noFiles: string;
  };
  /** The one press, when this order is still asking for one. */
  action?: ReactNode;
  /**
   * The picture of the thing, when drawing it is the page's business rather
   * than the view model's — B1479. A postcard front is the trip's photograph
   * under the crop *this order* carries, which is CSS the page already knows
   * how to write and the view model has no business holding. A photobook
   * passes nothing and `view.object.image` draws it.
   */
  objectMedia?: ReactNode;
  /** Anything the page needs under the status — tracking rows, a warning.
   *  Kept as a slot rather than a field because what belongs here is markup
   *  with links in it, not a fact about the order. */
  statusExtra?: ReactNode;
};

export default function OrderDocket({
  view,
  labels,
  action,
  statusExtra,
  objectMedia,
}: OrderDocketProps) {
  const failed = view.status?.tone === "coral";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500">
          {view.head.eyebrow}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
          {view.head.title}
        </h1>
        <p className="mt-2 text-sm text-navy-600">{view.head.subtitle}</p>
      </div>

      {view.status && (
        <section
          id="status"
          className={`scroll-mt-4 rounded-xl border px-4 py-3 ${
            failed ? "border-coral-300 bg-coral-50" : "border-navy-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <OrderPill tone={view.status.tone} label={view.status.label} />
            {view.status.note && (
              <p className={`min-w-[14rem] flex-1 text-sm ${failed ? "text-coral-600" : "text-navy-700"}`}>
                {view.status.note}
              </p>
            )}
            {action}
          </div>
          {statusExtra}
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-[15rem_minmax(0,1fr)] md:items-start">
        <div className="flex flex-col gap-5">
          {view.object && (
            <div className="overflow-hidden rounded-xl border border-navy-200 bg-white">
              {/* No plate unless something actually rendered one. An empty
                  rectangle where a cover should be reads as a picture that
                  failed to load, and a book with no thumbnail is not a
                  broken book — B1469 is what fills this in. */}
              {objectMedia ??
                (view.object.image && (
                  <img
                    src={view.object.image}
                    alt={view.object.label}
                    className="block w-full bg-navy-50"
                  />
                ))}
              <p className="px-3 py-2 text-xs text-navy-600">
                <span className="block font-semibold uppercase tracking-wider text-navy-500">
                  {view.object.label}
                </span>
                {view.object.spec}
              </p>
            </div>
          )}
          {/* One envelope is drawn as an envelope; four are drawn as a list.
              A set of postcards addressed to a family would otherwise be four
              full envelopes down a phone, pushing the price and the press off
              the bottom of the screen — and what somebody checks on a list of
              four is that these are the right four people, not each street in
              turn. B1464, found on the bench at 390px. */}
          {view.recipients.length === 1 ? (
            <OrderEnvelope
              toLabel={labels.goingTo}
              name={view.recipients[0].name}
              lines={view.recipients[0].lines}
            />
          ) : view.recipients.length > 1 ? (
            <section className="rounded-xl border border-navy-200 bg-white">
              <h2 className="border-b border-navy-200 px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-wider text-navy-600">
                {labels.goingTo}
              </h2>
              <ul>
                {view.recipients.map((to) => (
                  <li key={to.name} className="border-b border-navy-100 px-4 py-2 last:border-b-0">
                    <span className="block text-sm font-semibold text-navy-900">{to.name}</span>
                    <span className="block text-xs text-navy-600">{to.lines.join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <OrderLedgerCard
            ledger={view.ledger}
            heading={labels.price}
            totalLabel={labels.total}
            meta={view.meta}
          />

          {view.kind === "photobook" && (
            <section className="rounded-xl border border-navy-200 bg-white">
              <h2 className="border-b border-navy-200 px-4 py-3 font-display text-base font-semibold text-navy-900">
                {labels.files}
              </h2>
              {view.files.length > 0 ? (
                <ul>
                  {view.files.map((file) => (
                    <li
                      key={file.name}
                      className="flex items-center gap-3 border-b border-navy-100 px-4 py-3 last:border-b-0"
                    >
                      <span
                        aria-hidden
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-navy-100 text-[10px] font-bold tracking-wide text-navy-700"
                      >
                        PDF
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-navy-900">{file.name}</p>
                        <p className="truncate text-xs text-navy-600">{file.sub}</p>
                      </div>
                      <a
                        className="shrink-0 rounded-full border border-navy-300 px-3 py-1.5 text-xs font-semibold text-navy-800 transition-colors hover:bg-navy-50"
                        href={file.href}
                      >
                        {labels.download}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-navy-600">{labels.noFiles}</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
