import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { SESSION_SCOPE } from "@/lib/auth";
import { FEATURE_NAMES, type FeatureName } from "@/lib/config";
import {
  JOURNAL_FIELD_REFUSALS,
  JOURNAL_PROFILE_FIELDS,
  journalProfile,
  setJournalFeatures,
  setJournalProfile,
} from "@/lib/journals";
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
 * `features`, one boolean per capability — and, since B220, the fields a
 * journal describes itself with: `JOURNAL_PROFILE_FIELDS` in lib/journals.ts.
 * A title typoed at signup used to be permanent without a shell on the server.
 *
 * Three keys are still refused, one sentence each, in
 * `JOURNAL_FIELD_REFUSALS`: `owner.email` because it is the credential
 * deciding who can obtain a token for this journal (decision 24) and a token
 * must not move the boundary that issued it; `baseCurrency` because changing
 * it re-reads every cost already written rather than reconverting it; and
 * `media` because the server is already a ceiling over it, so a write there
 * could only be inert or a self-narrowing nobody asked for. The body is
 * refused whole when it carries one of them, rather than quietly ignoring it,
 * so a caller that tried is told.
 *
 * ## One kind of change per call
 *
 * A body naming `features` *and* a profile field is refused rather than
 * half-applied. Each call edits `config.json` once — read, change, write, read
 * back, restore if it does not load — and doing that twice in one request
 * means a request that can succeed halfway. Over MCP the same line falls out
 * of the shape: `set_journal_features` and `set_journal_profile` are two
 * tools.
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
  const config = getUser(user);
  if (!features || !config) return Response.json({ error: "no_such_journal" }, { status: 404 });

  return Response.json({
    user,
    /**
     * What the journal says about itself — the half B220 made writable.
     *
     * Read back here rather than only written, because a caller sending
     * `displayCurrencies` has to know the base currency it must contain, and
     * `baseCurrency` is not writable: without this the only way to learn it
     * would be to guess and be refused.
     */
    journal: journalProfile(config),
    /**
     * What this journal *asks for*, which is not the same as what it gets. The
     * server is a ceiling above this, so a capability true here can still be
     * off for readers — `/api/health` is where that answer lives, with the
     * reason. Saying so is cheaper than an agent inferring it wrongly.
     */
    features,
    next:
      `PATCH ${new URL(request.url).pathname} with {"features": {"contacts": true}} to change ` +
      `one. /api/health says what this server can actually provide. The same URL takes ` +
      `${JOURNAL_PROFILE_FIELDS.join(", ")} — one or more of them, in a call of their own.`,
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

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'Name what to change: {"features": {"contacts": true}}, or one of ' +
          `${JOURNAL_PROFILE_FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // Named rather than ignored, and answered before anything else in the body
  // is looked at. A caller that sent `owner` or `baseCurrency` has asked for
  // something this deliberately does not do, and a silent 200 — or a 200 for
  // the half it did understand — would read as though it had happened.
  const unwritable = keys.filter(
    (key) => key !== "features" && !(JOURNAL_PROFILE_FIELDS as readonly string[]).includes(key),
  );
  if (unwritable.length > 0) {
    const reasons = unwritable.map((key) => JOURNAL_FIELD_REFUSALS[key]).filter(Boolean);
    return Response.json(
      {
        error: "unsupported_field",
        message:
          `This call changes ${unwritable.map((k) => JSON.stringify(k)).join(", ")} for ` +
          `nobody, and it wrote nothing now. It writes the journal's "features" block and ` +
          `${JOURNAL_PROFILE_FIELDS.join(", ")}.` +
          (reasons.length ? ` ${reasons.join(" ")}` : ""),
      },
      { status: 400 },
    );
  }

  const profileKeys = keys.filter((key) => key !== "features");
  if (keys.includes("features") && profileKeys.length > 0) {
    return Response.json(
      {
        error: "mixed_change",
        message:
          `Send the capabilities and ${profileKeys.join(", ")} as two calls. Each one edits ` +
          `config.json whole — written, read back, and put back if it does not load — and a ` +
          `request doing that twice is a request that can succeed halfway. Nothing was ` +
          `changed.`,
      },
      { status: 400 },
    );
  }

  if (profileKeys.length > 0) {
    const result = setJournalProfile(
      user,
      Object.fromEntries(profileKeys.map((key) => [key, body[key]])),
    );
    if (!result.ok) {
      const status =
        result.error === "no_such_journal" ? 404 : result.error === "write_failed" ? 500 : 400;
      return Response.json({ error: result.error, message: result.message }, { status });
    }
    return Response.json({
      ok: true,
      user,
      journal: result.journal,
      changed: result.changed,
      note: result.changed.length
        ? `Changed: ${result.changed.join(", ")}.`
        : "Nothing changed — the journal already said exactly this.",
    });
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
