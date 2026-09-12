import { authenticate, errorResponse, mayActAsOwner, outOfScope, ownsUser } from "@/lib/api/auth";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/travellers` — the journal's own default party, B1526.
 *
 * `.../trips/{trip}/travellers` is the same door one trip down; this is the
 * one above it, for the party a trip draws when it says nothing for itself.
 * It used to be file-only — readable and writable only by editing
 * `config.json` by hand — which a hosted journal's owner has no way to do.
 * `PATCH /api/v1/<user>/config` with `{"travellers": [...]}` is where it is
 * written; this is where it is read back, the same shape
 * `.../presets` and `.../preview` already use.
 *
 * Owner only, the same gate `GET .../config` uses: a trip-scoped token can
 * see and change how *its own* trip is drawn, but the journal's own default
 * is the owner's, the same as every other field on `config.json`.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/travellers">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);

  if (!mayActAsOwner(auth.session, user)) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip. The journal's own default party — how it is " +
          "drawn when a trip does not say for itself — is the owner's to read and to change.",
      },
      { status: 403 },
    );
  }

  const config = getUser(user);
  if (!config) return Response.json({ error: "no_such_journal" }, { status: 404 });

  return Response.json({
    user,
    travellers: config.travellers,
    note:
      "How this journal's own pages draw a party when a trip carries no travellers: block " +
      `of its own. PATCH /api/v1/${user}/config with {"travellers": [...]} to change it — ` +
      `GET /api/v2/${user}/figures/presets lists every word a figure takes.`,
  });
}
