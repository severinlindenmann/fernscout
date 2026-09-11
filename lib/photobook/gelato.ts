import "server-only";
import { loadServerConfig } from "../config";
import { buildGelatoRequest, type BookOrder } from "./providers";

/**
 * Talking to Gelato — the same discipline as `lib/postcard/stannp.ts`, for the
 * same reasons.
 *
 * ## Draft is the default, and it is not the caller's to override
 *
 * `orderType` is `"order"` only when `features.photobook.live` is true.
 * `BookOrder.test` is not trusted for this — a caller-supplied flag is a flag
 * that can be set wrong once — so `submitBookPrint` recomputes it from server
 * config before building the request, exactly as `sendPostcard` recomputes
 * `test` from `features.postcards.live` rather than taking a caller's word.
 * A `"draft"` order is validated by Gelato and never printed.
 *
 * ## The key is environment only
 *
 * `GELATO_API_KEY`, never `site/config.json` — AGENTS.md. With none set,
 * every function here refuses without making a network call.
 *
 * ## Every failure is a returned value
 *
 * Nothing throws. A refusal (HTTP 400, Gelato's own `{code, message,
 * details}`) or an unreachable host both come back as `{ error }`, because a
 * throw here would abandon whatever claim/spend the caller already made.
 *
 * ## The create-order shape is unconfirmed
 *
 * Only the quote endpoint has been called against a live key (2026-09-07).
 * `submitBookPrint` posts exactly what `buildGelatoRequest` builds; if the
 * shape is wrong, Gelato's refusal is logged (never the key) and returned as
 * `"refused"`. See docs/providers/photobook.md.
 */

export type GelatoFailure = "no_key" | "refused" | "unreachable";

export type QuoteInput = {
  productUid: string;
  pageCount: number;
  country: string;
  currency: string;
};

export type QuoteResult = {
  printMinor: number;
  shipMinor: number;
  currency: string;
  shipmentMethodUid: string;
  expiresAt: string;
};

const QUOTE_URL = "https://order.gelatoapis.com/v4/orders:quote";
const ORDERS_URL = "https://order.gelatoapis.com/v4/orders";

function isLive(): boolean {
  const feature = loadServerConfig().features.photobook as Record<string, unknown>;
  return feature.live === true;
}

/** Decimal francs to integer cents — money must not stay a float. */
function toMinor(price: number): number {
  return Math.round(price * 100);
}

async function post<T>(
  url: string,
  key: string,
  body: unknown,
): Promise<T | { error: GelatoFailure; message?: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { error: "unreachable" };
  }

  const raw = await response.text();
  if (!response.ok) {
    // Their own words, never the key. Logged for whoever reads server logs;
    // most callers still only ever look at `error` — B1165 is what reads
    // `message` too, to keep it beside the order rather than only in
    // `journalctl`.
    console.error("gelato refused:", raw.slice(0, 500));
    return { error: "refused", message: providerMessageFrom(raw) };
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error("gelato: unparseable response:", raw.slice(0, 500));
    return { error: "refused" };
  }
}

/**
 * Gelato's own `{code, message, details}` shape, or nothing readable — B1165.
 * Never the key, and never anything this server did not receive back.
 */
function providerMessageFrom(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

export async function quoteBook(input: QuoteInput): Promise<QuoteResult | { error: GelatoFailure }> {
  const key = process.env.GELATO_API_KEY;
  if (!key) return { error: "no_key" };

  const result = await post<{
    quotes?: {
      products?: { price: number; currency: string }[];
      shipmentMethods?: { shipmentMethodUid: string; price: number; currency: string }[];
      expirationDateTime?: string;
    }[];
  }>(QUOTE_URL, key, {
    orderReferenceId: `quote-${Date.now()}`,
    // B1125. `itemReferenceId` is Gelato's handle for one line of an order,
    // and `orders:quote` refuses a blank one — `products[0].itemReferenceId:
    // This value should not be blank`. Without it every quote came back as a
    // 400, which this module reports as `refused` and the order page renders
    // as "the printer could not be reached", so the print panel could never
    // appear and no book could be addressed. One book per quote, so a
    // constant is the whole of what it needs to be.
    products: [
      { itemReferenceId: "book", productUid: input.productUid, pageCount: input.pageCount, quantity: 1 },
    ],
    recipient: { country: input.country },
    currency: input.currency,
  });
  if ("error" in result) return result;

  const quote = result.quotes?.[0];
  const product = quote?.products?.[0];
  const methods = quote?.shipmentMethods ?? [];
  if (!product || methods.length === 0 || !quote?.expirationDateTime) {
    console.error("gelato: quote response missing expected fields");
    return { error: "refused" };
  }

  // Cheapest first, so the order that follows ships by the method the quote
  // actually named.
  const cheapest = methods.reduce((a, b) => (b.price < a.price ? b : a));

  return {
    printMinor: toMinor(product.price),
    shipMinor: toMinor(cheapest.price),
    currency: product.currency,
    shipmentMethodUid: cheapest.shipmentMethodUid,
    expiresAt: quote.expirationDateTime,
  };
}

export async function submitBookPrint(
  order: BookOrder,
): Promise<{ providerRef: string } | { error: GelatoFailure; message?: string }> {
  const key = process.env.GELATO_API_KEY;
  if (!key) return { error: "no_key" };

  let request;
  try {
    request = buildGelatoRequest({ ...order, test: !isLive() });
  } catch (error) {
    console.error("gelato: could not build request:", error);
    return { error: "refused" };
  }

  const result = await post<{ id?: string }>(request.url, key, request.body);
  if ("error" in result) return result;

  if (!result.id) {
    console.error("gelato: order response had no id");
    return { error: "refused" };
  }
  return { providerRef: result.id };
}

/** Gelato's own status word (e.g. `"printed"`, `"cancelled"`) or null. */
export async function fetchOrderStatus(providerRef: string): Promise<string | null> {
  const key = process.env.GELATO_API_KEY;
  if (!key) return null;

  let response: Response;
  try {
    response = await fetch(`${ORDERS_URL}/${encodeURIComponent(providerRef)}`, {
      headers: { "X-API-KEY": key },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  try {
    const body = (await response.json()) as { fulfillmentStatus?: string };
    return body.fulfillmentStatus ?? null;
  } catch {
    return null;
  }
}
