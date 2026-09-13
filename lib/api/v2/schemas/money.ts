// Money's own wire shapes — B1622, phase 2 step 4. New surface, not a
// change to a frozen schema: the golden-contract review (01-golden-
// contract.md) covered day/trip/journal/figures/media/status, and money
// never had a Zod module before this ticket. See
// docs/plans/2026-09-12-api-v2/money.md §2.2-2.3 for the field tables this
// mirrors.
import { z } from "zod";
import { BUYER_METHODS, CREDIT_STEP, MAX_CREDITS, MIN_CREDITS } from "@/lib/credits/pricing";

/**
 * `PUT /api/v2/{user}/purchases/{id}` and `PUT /api/web/{user}/purchases/{id}`
 * — one required field, an AMOUNT never a price (the price is always
 * server-computed from it, `lib/credits/pricing.ts:priceRappen`). Money.md
 * §2.2: "there is no `declined` map on this resource — it has one required
 * field and no optional detail", so core rule 2's carve-out for "plain
 * optional only where absent is the overwhelming default" applies to the
 * whole document rather than to individual fields.
 */
export const purchaseCreate = z.strictObject({
  credits: z
    .number()
    .int()
    .min(MIN_CREDITS)
    .max(MAX_CREDITS)
    .refine((n) => n % CREDIT_STEP === 0, {
      message: `Ask for a whole number of credits between ${MIN_CREDITS} and ${MAX_CREDITS}, in steps of ${CREDIT_STEP}.`,
    }),
});
export type PurchaseCreate = z.infer<typeof purchaseCreate>;

/** `PaymentStatus` in `lib/payments.ts`, restated here because that module is
 * `server-only` and a schema file may not import a runtime array from one
 * (see day.ts/trip.ts importing from the PLAIN `lib/costFormat.ts` and
 * `lib/validate/entry.ts` for the pattern this otherwise follows). Keep this
 * matching `PaymentStatus` exactly. */
export const PURCHASE_STATUSES = ["pending", "requested", "paid", "refunded"] as const;

export const purchaseDoc = z.strictObject({
  id: z.string(),
  credits: z.number().int(),
  priceRappen: z.number().int(),
  price: z.string(),
  discount: z.string(),
  status: z.enum(PURCHASE_STATUSES),
  // `admin` never reaches this — an admin grant is never a document a
  // buyer's own purchase can carry (money.md §3).
  method: z.enum(BUYER_METHODS).nullable(),
  paymentUrl: z.string().nullable(),
  mailedTo: z.string(),
  createdAt: z.string(),
  requestedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
});
export type PurchaseDoc = z.infer<typeof purchaseDoc>;

/**
 * `GET /api/v2/{user}/credits/ledger` — money.md §2.3. `LedgerReason` in
 * `lib/credits.ts` is both private and `server-only`, so this list is
 * hand-kept beside it rather than imported (the same constraint
 * `PURCHASE_STATUSES` above is under). Keep it matching `LedgerReason`
 * exactly.
 */
export const LEDGER_REASONS = [
  "grant",
  "day_mail",
  "day_whatsapp",
  "digest",
  "postcard",
  "photobook",
  "photobook_print",
  "storage",
  "helper",
  "transcription",
  "ask_thread",
  "find_in_journal",
  "travellers_from_photo",
  "refund",
  "purchase_refund",
] as const;

export const ledgerRow = z.strictObject({
  id: z.string(),
  delta: z.number(),
  reason: z.enum(LEDGER_REASONS),
  ref: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type LedgerRowDoc = z.infer<typeof ledgerRow>;
