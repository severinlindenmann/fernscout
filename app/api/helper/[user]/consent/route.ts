import { isEnabled } from "@/lib/capabilities";
import { HELPER_SCOPES, recordHelperConsent, revokeHelperConsent, type HelperScope } from "@/lib/helper/consent";
import { HELPER_PROVIDER } from "@/lib/helper/model";
import { speechProvider } from "@/lib/helper/transcribe";
import { isHelperOwner } from "@/lib/helper/server";

export const dynamic = "force-dynamic";

/**
 * Saying yes, and taking it back — B684, extended to name a scope in B687.
 *
 * Free, owner only, cookie only. `POST` records the consent the panel
 * describes, for the scope it asked about — `speech` since B686 — `words` when the body says
 * nothing, since that is what every panel before B687 meant. `DELETE` removes
 * the whole record, and the next call in either scope is refused until
 * somebody reads a panel again. There is nothing to migrate and nothing to
 * expire: the file is the whole of it (`lib/helper/consent.ts`).
 */

/**
 * Which capability a scope belongs to — B686.
 *
 * `speech` is the transcriber's, and the two switches are independent: an
 * instance may run speech with no model at all, and gating its consent on
 * `helper` would leave the record button with no way to ask.
 */
async function gate(user: string, scope: HelperScope | "any"): Promise<Response | null> {
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }
  // `DELETE` takes back every scope at once, so either capability being on is
  // reason enough to let somebody withdraw — a permission that cannot be
  // withdrawn because the other switch went off is not a permission.
  const on =
    scope === "any"
      ? isEnabled("helper", user) || isEnabled("transcription", user)
      : isEnabled(scope === "speech" ? "transcription" : "helper", user);
  if (!on) {
    const needed = scope === "speech" ? "transcription" : "helper";
    return Response.json({ error: `${needed}_unavailable` }, { status: 404 });
  }
  return null;
}

function scopeOf(raw: unknown): HelperScope {
  return (HELPER_SCOPES as readonly string[]).includes(raw as string) ? (raw as HelperScope) : "words";
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/consent">) {
  const { user } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = scopeOf(body.scope);
  const refused = await gate(user, scope);
  if (refused) return refused;
  // Whoever this particular yes is about: the model for words and
  // photographs, the transcriber for a voice.
  const provider = scope === "speech" ? speechProvider() : HELPER_PROVIDER;
  return Response.json({ ok: true, consent: recordHelperConsent(user, provider, scope) });
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/helper/[user]/consent">,
) {
  const { user } = await params;
  const refused = await gate(user, "any");
  if (refused) return refused;
  revokeHelperConsent(user);
  return Response.json({ ok: true, consent: null });
}
