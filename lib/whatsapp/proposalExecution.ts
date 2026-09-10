import "server-only";
import { runAsCaller, whatsappCaller } from "../helper/caller";
import type { Proposal } from "../helper/blocks";

/**
 * Pressing a proposal from WhatsApp — B1230.
 *
 * **The same route the web panel's own button posts to, and no second
 * implementation of the write.** `components/HelperAsk.tsx`'s `accept()`
 * posts `proposal.arguments` to `proposal.endpoint` with `proposal.method`;
 * this does exactly that, except it calls the route's exported handler
 * directly rather than over HTTP — there is no browser here to make the
 * request, and no cookie to put in one. `lib/helper/caller.ts`'s
 * `runAsCaller` is what the route's own `isHelperOwner()` accepts instead.
 *
 * **Opt-in, and that is the scope guard (B1230's decision 4), not an
 * afterthought.** Only a tool listed below can ever be pressed from this
 * channel. A write tool the model can still propose here — `propose_
 * postcards`, `photobook` and `buy_room` (all spend credits at a printer or
 * on storage), `draft_words` (spends a credit on a model call before it has
 * even proposed a write), `cleanup` (an operator switch), `revoke_key`,
 * `discard_file`, `attach_files`, `remove_photo` and `set_day_words` — is
 * simply absent, so `pressProposal` refuses it with `"web_only"` rather than
 * the caller having to know which tools are money or irreversible. Adding a
 * tool to this file is a decision to let a phone do it; not adding one is
 * the safe default. The last four stay out for a narrower reason than money:
 * a WhatsApp accept sends exactly `proposal.arguments` with no per-field
 * editing, which is fine for a trip or a day's own dates but not yet
 * exercised for the ones that carry a file, a photograph's own path, or a
 * body of prose the person has not read back — a later ticket can widen this
 * list without touching anything else here.
 */

type RouteHandler = (
  request: Request,
  ctx: { params: Promise<{ user: string }> },
) => Promise<Response>;

const ROUTE_BY_TOOL: Record<string, () => Promise<RouteHandler>> = {
  create_trip: async () => (await import("@/app/api/helper/[user]/trip/route")).POST,
  edit_trip: async () => (await import("@/app/api/helper/[user]/trip/route")).PATCH,
  set_visibility: async () => (await import("@/app/api/helper/[user]/trip/visibility/route")).PATCH,
  trip_people: async () => (await import("@/app/api/helper/[user]/trip/people/route")).PATCH,
  trip_tracks: async () => (await import("@/app/api/helper/[user]/trip/tracks/route")).PATCH,
  start_day: async () => (await import("@/app/api/helper/[user]/day/route")).POST,
  publish_day: async () => (await import("@/app/api/helper/[user]/day/publish/route")).POST,
  unpublish_day: async () => (await import("@/app/api/helper/[user]/day/unpublish/route")).POST,
};

/** Whether B1230's executor below will actually press this tool's proposal —
 *  what `lib/whatsapp/dispatch.ts` asks before it offers a `form`-shaped
 *  proposal a button that could not do anything. */
export function isWhatsappExecutable(tool: string): boolean {
  return tool in ROUTE_BY_TOOL;
}

export type PressResult = { ok: true } | { ok: false; error: string };

/**
 * Run one waiting proposal as the journal it was made for.
 *
 * `"web_only"` is the one error this can answer that no route ever would —
 * every other string is whatever the route itself put in its JSON body's
 * `error` field, the same code `components/HelperAsk.tsx` reads.
 */
export async function pressProposal(username: string, proposal: Proposal): Promise<PressResult> {
  const load = ROUTE_BY_TOOL[proposal.tool];
  if (!load) return { ok: false, error: "web_only" };

  const handler = await load();
  const request = new Request(`https://internal.invalid${proposal.endpoint}`, {
    method: proposal.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proposal.arguments),
  });

  const response = await runAsCaller(whatsappCaller(username), () =>
    handler(request, { params: Promise.resolve({ user: username }) }),
  );
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body.error ?? `status_${response.status}` };
}
