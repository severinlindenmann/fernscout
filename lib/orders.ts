import "server-only";
import { listOrders as listPostcardOrders, orderCost, type PostcardOrder } from "./postcard/orders";
import { listPhotobookOrders, type PhotobookOrder } from "./photobook/orders";
import { creditsInRappen, formatChf } from "./credits/pricing";

export type OrderRow = {
  id: string;
  kind: "postcard" | "photobook";
  /** `draft` | `submitted` | `built` | `print_submitted` | `refused` |
   * `shipped` | `failed` — not the same set the two tables store in their own
   * `status` column. See `photobookDisplayStatus` below for why. */
  status: string;
  createdAt: string;
  /** Preformatted CHF, server-side, from the pricing table. */
  chf: string;
};

/**
 * A photobook's own `status` column does not say what a print was refused —
 * `markPrintFailed` (`lib/photobook/orders.ts`) puts a refused print back to
 * `built` so the book can be printed again, and records the refusal only in
 * `payload.print.failure`. `app/[user]/photobooks/[id]/page.tsx` already reads
 * that field on its own for the same reason; this is the same read, for a
 * list row rather than a full page.
 */
function photobookDisplayStatus(order: PhotobookOrder): string {
  const print = order.payload.print;
  if (order.status === "built" && print?.failure) return "refused";
  if (order.status === "print_submitted" && print?.shippedAt) return "shipped";
  return order.status;
}

/** Every photobook and postcard order this owner has, newest first — B1452. */
export async function listAllOrders(owner: string): Promise<OrderRow[]> {
  const [postcards, photobooks] = await Promise.all([
    listPostcardOrders(owner),
    listPhotobookOrders(owner),
  ]);

  const rows: OrderRow[] = [
    ...postcards.map((order: PostcardOrder) => ({
      id: order.id,
      kind: "postcard" as const,
      status: order.status as string,
      createdAt: order.createdAt,
      chf: formatChf(creditsInRappen(orderCost(order))),
    })),
    ...photobooks.map((order) => ({
      id: order.id,
      kind: "photobook" as const,
      status: photobookDisplayStatus(order),
      createdAt: order.createdAt,
      chf: formatChf(creditsInRappen(order.payload.credits)),
    })),
  ];

  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
