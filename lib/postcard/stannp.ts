import "server-only";
import { loadServerConfig } from "../config";
import { buildStannpRequest } from "./providers";
import type { PostalAddress } from "./render";

/**
 * Posting one card to Stannp — B435, and the first provider in this codebase
 * that can actually put ink on paper.
 *
 * ## Test mode is the default, and it is free
 *
 * Stannp's `test=true` renders the card and returns a sample PDF, and the item
 * "will never be dispatched". `features.postcards.live` — absent or `false` on
 * every instance that has not deliberately said otherwise — forces it on every
 * request. So a funded account, a real order and a real press of the Send
 * button still post nothing: flipping one boolean in the server config is the
 * only path to paper, and it is an operator's decision rather than a caller's.
 *
 * That is deliberately *not* a per-request argument. A caller who could ask
 * for a live send is a caller who could ask for one by mistake, and the whole
 * shape of `lib/postcard/send.ts` is about making the expensive thing
 * unreachable rather than merely discouraged.
 *
 * ## The key is environment only
 *
 * `STANNP_API_KEY`, never `site/config.json` — AGENTS.md, and it is a
 * credential that can spend money. With none set this refuses rather than
 * half-running, so an instance configured for `stannp` without a key fails
 * closed instead of quietly reporting a send that never happened.
 */

export type StannpResult = { ok: true; ref: string; pdf?: string; cost?: string } | { ok: false; error: string };

function isLive(): boolean {
  const feature = loadServerConfig().features.postcards as Record<string, unknown>;
  return feature.live === true;
}

/** HTTP basic, key as the username and an empty password — their documented form. */
function authHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export async function sendPostcard(input: {
  to: PostalAddress;
  front: Uint8Array;
  back: Uint8Array;
  /** The credit-ledger row this card was paid for by. Refused if empty — B07. */
  paymentRef: string;
}): Promise<StannpResult> {
  const key = process.env.STANNP_API_KEY;
  if (!key) return { ok: false, error: "STANNP_API_KEY is not set" };

  const test = !isLive();
  let request;
  try {
    request = buildStannpRequest({ ...input, test });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "bad order" };
  }

  const body = new FormData();
  for (const [name, value] of Object.entries(request.fields)) body.append(name, value);
  // Two separate files rather than the two-page PDF: Stannp composes the card
  // itself and has no way to be told which page is which side.
  body.append("front", new Blob([new Uint8Array(input.front)], { type: "application/pdf" }), "front.pdf");
  body.append("back", new Blob([new Uint8Array(input.back)], { type: "application/pdf" }), "back.pdf");

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: { Authorization: authHeader(key) },
      body,
    });
  } catch (error) {
    // A network failure is a card that was not printed, which is what the
    // caller refunds on. Never a throw: one unreachable host must not abandon
    // the loop halfway through a list and leave the rest uncharged and unsent.
    return { ok: false, error: `stannp unreachable: ${error instanceof Error ? error.message : "unknown"}` };
  }

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; error?: string; data?: { id?: number | string; pdf?: string; cost?: string } }
    | null;

  if (!response.ok || !payload?.success || !payload.data?.id) {
    const said = payload?.error ?? `HTTP ${response.status}`;
    return { ok: false, error: `stannp refused: ${said}` };
  }

  return {
    ok: true,
    // Prefixed with the mode, because a ledger row saying a card was sent when
    // Stannp only rendered a sample is the one thing this must not be able to
    // claim. `stannp-test:` is not a send.
    ref: `${test ? "stannp-test" : "stannp"}:${payload.data.id}`,
    pdf: payload.data.pdf,
    cost: payload.data.cost,
  };
}
