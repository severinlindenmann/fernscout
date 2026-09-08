import { isEnabled } from "@/lib/capabilities";
import { createInvite, inviteExpiry, inviteLinkUrl } from "@/lib/contacts/invites";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The guest link the person confirmed — B931.
 *
 * A 71-year-old said *"nur meine Tochter soll das lesen können"*, was given
 * `visibility: private` — which means the people who were on the trip — and
 * was told her daughter could read it. Nobody had asked for the daughter's
 * name, no invite existed, and the conversation had no way to make one: this
 * is that way. The honest answer is now available to say, which is the only
 * reason the check in `lib/helper/model.ts` can insist on it.
 *
 * **Guest only, and there is deliberately no `kind` in the request.** A buddy
 * link is write access to a trip and belongs on the contacts page, where the
 * two are chosen side by side under the sentences that say what they do
 * (`components/InviteToRead.tsx` makes exactly this choice, for exactly this
 * reason). A conversation that could hand out either by mishearing a sentence
 * would be the worst place in the product to put that choice.
 *
 * **It grants nothing, and nothing downstream is changed to make it.**
 * Whoever opens the link proves their own address and lands in the owner's
 * queue; `approveContact` is still the only thing in the codebase that writes
 * a grant. There is no `email` here either — naming an address is the owner
 * vouching for it (B319) and pre-approves it, and that is a decision to make
 * on a page with the address in front of you, not one for a model to reach by
 * hearing a name.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, exactly as every other route in this family — see
 * `app/api/helper/[user]/trip/route.ts` for the whole of that reasoning.
 */

const LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/invite">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  if (!isEnabled("contacts", user)) {
    // No queue for a redemption to land in, so a link would lead nowhere.
    return Response.json({ error: "contacts_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-invite", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  // Whose link this is, for the owner's own list. It prefills nothing that
  // grants anything and is theirs to correct in the field before pressing.
  const name = typeof body.name === "string" ? body.name.trim() : "";

  const created = await createInvite(user, {
    kind: "guest",
    tripId: null,
    ...(name ? { name } : {}),
    // Always dated: a link that never expires is a shared password wearing a
    // URL. `inviteExpiry`'s own default, the same one the contacts page uses.
    expiresAt: inviteExpiry(),
  });

  return Response.json(
    {
      ok: true,
      // Present exactly once, here. Only the hash is stored, so nothing reads
      // this back on a later turn and no model ever holds a live credential.
      url: inviteLinkUrl(serverSite().url, user, "guest", created.token),
    },
    { status: 201 },
  );
}
