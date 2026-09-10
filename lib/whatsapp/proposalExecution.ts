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
 * channel; `pressProposal` refuses anything else with `"web_only"` rather
 * than the caller having to know which tools are money or irreversible.
 * Adding a tool to this file is a decision to let a phone do it; not adding
 * one is the safe default.
 *
 * **B1235 widened this from eight tools to nearly every ordinary write.**
 * The live walkthrough that found it hit `attach_files` and `draft_words` —
 * this channel's two core flows — refused as `"web_only"`, and the owner's
 * own decision on B1061 already settled the question the old exclusion list
 * was guessing at: writing a day up, captioning and transcribing spend this
 * journal's credits from WhatsApp exactly as they do on the web, so "spends
 * a credit" was never a reason to keep a tool off this list. What stays
 * excluded now is only four kinds of thing: postcards and photobooks
 * (`propose_postcards`, `photobook`, `print_order` — a real order at a
 * printer, B434's own reasoning), buying room or credits (`buy_room`,
 * `buy_credits` — nothing an agent holds can pay, AGENTS.md), anything
 * deletion-shaped (`remove_photo` deletes the kept original with no undo;
 * `discard_file` throws away inbox bytes for good; `revoke_key` ends an
 * agent's own access; `cleanup` is the operator's storage broom), and an
 * import that would decide costs' categories itself (none is a `Tool` here
 * to begin with).
 *
 * `describe_photos` has no entry precisely because it is not a `Tool` in
 * `lib/helper/tools/registry.ts` — a browser button posts to its route
 * directly, the model never proposes it, and there is therefore no
 * `Proposal` whose `tool` this file could ever be asked to press. Giving it
 * a line here would be a route nothing can reach.
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
  // B1235 — the channel's own core flows, and everything else ordinary.
  attach_files: async () => (await import("@/app/api/helper/[user]/day/attach/route")).POST,
  draft_words: async () => (await import("@/app/api/helper/[user]/day/write-day/route")).POST,
  set_day_words: async () => (await import("@/app/api/helper/[user]/day/route")).PATCH,
  add_cost: async () => (await import("@/app/api/helper/[user]/day/costs/route")).POST,
  set_rate: async () => (await import("@/app/api/helper/[user]/trip/rates/route")).POST,
  set_budget: async () => (await import("@/app/api/helper/[user]/trip/budget/route")).POST,
  invite_guest: async () => (await import("@/app/api/helper/[user]/invite/route")).POST,
  revoke_invite: async () => (await import("@/app/api/helper/[user]/invite/revoke/route")).POST,
  tell_readers: async () => (await import("@/app/api/helper/[user]/day/tell-readers/route")).POST,
  channels: async () => (await import("@/app/api/helper/[user]/channels/route")).POST,
  journal_settings: async () => (await import("@/app/api/helper/[user]/journal/route")).POST,
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
