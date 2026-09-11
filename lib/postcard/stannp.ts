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

/**
 * The states this instance will store — B1548.
 *
 * Stannp reports `printing`, `dispatched`, `local_delivery`, `delivered`,
 * `returned` and `cancelled` too, but writing any of the last three would
 * mean this system claiming to know a card was delivered — the thing
 * `app/api/webhooks/stannp/route.ts`'s own module comment already decided
 * it never will. Its webhook only ever writes `"cancelled"`; this list is
 * the same boundary, just reachable without waiting for a webhook.
 */
const KNOWN_STATUSES = ["received", "printing", "dispatched", "cancelled"] as const;
export type StannpStatus = (typeof KNOWN_STATUSES)[number];

/**
 * What Stannp says about one card **right now** — B1548.
 *
 * There is no websocket and no push from them for anything but
 * cancellation, so this is the only way this instance can learn
 * `printing` happened between two page loads. `ref` is
 * `RecipientResult.ref` — `stannp:<id>` or `stannp-test:<id>` — and the id
 * in the path is theirs, not a query parameter: `?id=` answers `"Missing
 * resource ID"`, `/get/<id>` is what actually works (confirmed against a
 * live card).
 *
 * Best-effort: no key, no match, a network failure or a status this
 * instance has not chosen to store all come back `null` rather than
 * throwing, because a Stannp outage must not break the page that shows a
 * card already went to the printer.
 */
export async function fetchStannpStatus(ref: string): Promise<StannpStatus | null> {
  const key = process.env.STANNP_API_KEY;
  if (!key) return null;
  const match = /^stannp(?:-test)?:(\d+)$/.exec(ref);
  if (!match) return null;

  try {
    const response = await fetch(
      `https://api-eu1.stannp.com/v1/postcards/get/${match[1]}`,
      { headers: { Authorization: authHeader(key) } },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { success?: boolean; data?: { status?: string } };
    if (payload.success !== true) return null;
    const status = payload.data?.status;
    return (KNOWN_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as StannpStatus)
      : null;
  } catch {
    return null;
  }
}

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

  const raw = await response.text();
  let payload:
    | { success?: boolean; error?: string; data?: { id?: number | string; pdf?: string; cost?: string } }
    | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success !== true) {
    // Their own words when they gave any, and otherwise the body itself —
    // never a bare status. The first version of this said `HTTP ${status}`
    // when `error` was absent, which is how a 200 carrying a perfectly clear
    // explanation was reported as "stannp refused: HTTP 200" and cost an
    // afternoon. A refusal message that omits what the server said is not a
    // refusal message.
    const said = payload?.error ?? raw.slice(0, 300) ?? `HTTP ${response.status}`;
    return { ok: false, error: `stannp refused: ${said}` };
  }

  // **`id` is 0 on every test render**, and only on those. Checking it for
  // truthiness — which is what this did — rejected every successful free
  // sample as a failure, refunded the credits and recorded the order as
  // `failed` while the card had rendered perfectly. The id is present or it
  // is not; zero is a value.
  const id = payload.data?.id;
  if (id === undefined || id === null) {
    return { ok: false, error: `stannp refused: no id in ${raw.slice(0, 200)}` };
  }

  return {
    ok: true,
    // Prefixed with the mode, because a ledger row saying a card was sent when
    // Stannp only rendered a sample is the one thing this must not be able to
    // claim. `stannp-test:` is not a send.
    ref: `${test ? "stannp-test" : "stannp"}:${id}`,
    pdf: payload.data?.pdf,
    cost: payload.data?.cost,
  };
}
