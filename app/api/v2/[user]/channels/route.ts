// GET/PATCH /api/v2/{user}/channels — B1623, phase 2 step 4.
//
// The owner's own mute switches for the two sending channels — narrower than
// the server's capability, never wider. See social.md §2.6.
import { channelsPatch } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ok, readDryRun } from "@/lib/api/v2/route";
import { resolveCapabilities } from "@/lib/capabilities";
import { setJournalFeatures } from "@/lib/journals";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const CHANNELS = ["mail", "whatsapp"] as const;

/**
 * Both verbs' own logic, apart from who is asking — B1595. Called here after
 * `requireJournalOwner` (bearer), and by
 * `app/api/web/[user]/channels/route.ts` after its own cookie-only `isOwner`
 * check — both already know the journal exists by the time they call these.
 */
export function channelsGetDoc(user: string): Response {
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  const server = resolveCapabilities();
  const doc = {
    mail: server.mail.enabled ? journal.features.mail.enabled : null,
    whatsapp: server.whatsapp.enabled ? journal.features.whatsapp.enabled : null,
  };
  return ok(doc, { etag: etagFor(doc) });
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/channels">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return channelsGetDoc(user);
}

export async function channelsPatchResponse(user: string, request: Request): Promise<Response> {
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  const parsed = await request.json().catch(() => null);
  const result = channelsPatch.safeParse(parsed);
  if (!result.success) {
    return fail("invalid_request", "Send { mail?: boolean, whatsapp?: boolean } — at least one.");
  }
  const changes = result.data;
  if (Object.keys(changes).length === 0) {
    return fail("invalid_request", `Name at least one channel to switch on or off: ${CHANNELS.join(", ")}.`);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    const journal = getUser(user)!;
    const server = resolveCapabilities();
    return ok({
      mail: server.mail.enabled ? (changes.mail ?? journal.features.mail.enabled) : null,
      whatsapp: server.whatsapp.enabled ? (changes.whatsapp ?? journal.features.whatsapp.enabled) : null,
    });
  }

  const written = setJournalFeatures(user, changes);
  if (!written.ok) {
    return fail(
      written.error === "capability_unavailable" ? "capability_unavailable" : "invalid_request",
      written.message,
      undefined,
      written.error === "capability_unavailable" ? 409 : 400,
    );
  }

  const server = resolveCapabilities();
  return ok({
    mail: server.mail.enabled ? written.features.mail : null,
    whatsapp: server.whatsapp.enabled ? written.features.whatsapp : null,
  });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v2/[user]/channels">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return channelsPatchResponse(user, request);
}
