import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { FEATURE_NAMES, type FeatureName } from "@/lib/config";
import { setJournalFeatures } from "@/lib/journals";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET` and `PATCH /api/v1/<user>/config` — the capabilities a journal asks for.
 *
 * ## Why there is an endpoint at all
 *
 * A journal's `features` block was decided once, at creation, and then frozen:
 * no endpoint, no tool and no page wrote it, so the only way to change one was
 * to edit `content/<user>/config.json` over SSH. Every journal made before B153
 * therefore has contacts off with no way to turn them on — and since B39 an
 * invite link is the only way to let anybody into a journal, which makes those
 * journals unable to be shared and unable to be repaired by the person who owns
 * them. B182.
 *
 * This is not a settings page, and there will not be one (decision 24). It is
 * the same shape as everything else here: a call an agent makes because a
 * person asked for it.
 *
 * ## What it touches
 *
 * `features` only, one boolean per capability. Not the title, the tagline, the
 * locales or the currencies — those share the problem and are a wider surface
 * (B220) — and never `owner.email`, which is the credential deciding who can
 * obtain a token for this journal (decision 24). A token issued *because of*
 * that address must not be able to change it; that is an operator's edit, at
 * the file. The body is refused if it carries anything but `features`, rather
 * than quietly ignoring the rest, so a caller that tried is told.
 *
 * ## What it cannot do
 *
 * Switch on something the server has not configured. `lib/capabilities.ts`
 * treats `content/config.json` as a ceiling, so such a write would be inert
 * rather than dangerous — and inert is the problem, so `setJournalFeatures`
 * refuses it and passes on the server's own reason. Switching a capability
 * *off* is always allowed: a journal narrowing itself asks nobody.
 *
 * Owner only, agent scope only. A token scoped to one trip writes days into
 * that trip; deciding what the journal can do is not the same authority, and
 * this route draws the line in the same place `DELETE /api/v1/<user>` does.
 */

function view(username: string) {
  const user = getUser(username);
  if (!user) return null;
  const features = {} as Record<FeatureName, boolean>;
  for (const name of FEATURE_NAMES) features[name] = user.features[name].enabled;
  return features;
}

export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/config">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  /**
   * The same gate as the PATCH below, and for the same reason — B231.
   *
   * `ownsUser` says which journal a token belongs to, not what it may do
   * inside it, so on its own it let a token scoped to one trip read the
   * journal's whole `features` block: which capabilities its owner has
   * switched on, for a journal the holder can otherwise see one trip of. Small
   * beside the archive that ticket is about, and the same mistake in the same
   * idiom, so it is fixed in the same pass rather than left as the last
   * instance of it.
   */
  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip. What the journal around it can do is the owner's " +
          "to read and to change.",
      },
      { status: 403 },
    );
  }

  const features = view(user);
  if (!features) return Response.json({ error: "no_such_journal" }, { status: 404 });

  return Response.json({
    user,
    /**
     * What this journal *asks for*, which is not the same as what it gets. The
     * server is a ceiling above this, so a capability true here can still be
     * off for readers — `/api/health` is where that answer lives, with the
     * reason. Saying so is cheaper than an agent inferring it wrongly.
     */
    features,
    next:
      `PATCH ${new URL(request.url).pathname} with {"features": {"contacts": true}} to change ` +
      `one. /api/health says what this server can actually provide.`,
  });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v1/[user]/config">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip. Writing days into a trip and deciding what the " +
          "journal around it can do are different authorities — only the owner can do this.",
      },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      {
        error: "invalid_request",
        message: 'Send a JSON object: {"features": {"contacts": true}}.',
      },
      { status: 400 },
    );
  }

  // Named rather than ignored. A caller that sent `owner` or `title` has asked
  // for something this deliberately does not do, and a silent 200 would read
  // as though it had happened.
  const extra = Object.keys(body).filter((key) => key !== "features");
  if (extra.length > 0) {
    return Response.json(
      {
        error: "unsupported_field",
        message:
          `This call changes ${extra.map((k) => JSON.stringify(k)).join(", ")} for nobody: it ` +
          `writes the journal's "features" block and nothing else, and it wrote nothing now. ` +
          `owner.email in particular is never writable here — it is the address that decides ` +
          `who can get a token for this journal, so a token cannot move it. Ask the person ` +
          `who runs the server.`,
      },
      { status: 400 },
    );
  }

  const features = body.features;
  if (typeof features !== "object" || features === null || Array.isArray(features)) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          '"features" must be an object of capability names to true or false, e.g. ' +
          `{"features": {"contacts": true}}. Known: ${FEATURE_NAMES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const result = setJournalFeatures(user, features as Record<string, unknown>);
  if (!result.ok) {
    const status =
      result.error === "no_such_journal" ? 404 : result.error === "write_failed" ? 500 : 400;
    return Response.json({ error: result.error, message: result.message }, { status });
  }

  return Response.json({
    ok: true,
    user,
    features: result.features,
    changed: result.changed,
    note: result.changed.length
      ? `Changed: ${result.changed.join(", ")}. This is what the journal asks for; the server ` +
        `is still the ceiling above it, and /api/health says what it provides.`
      : "Nothing changed — the journal already asked for exactly this.",
  });
}
