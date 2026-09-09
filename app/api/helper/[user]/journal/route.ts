import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { setJournalProfile } from "@/lib/journals";

export const dynamic = "force-dynamic";

/**
 * The journal's own title and tagline, from the room — B1042 batch
 * (`journal_settings` in `lib/helper/tools/areas/journal.ts`).
 *
 * Only these two ever reach `setJournalProfile` from here. `JOURNAL_PROFILE_FIELDS`
 * carries more — visibility, locales, currencies shown — and switching those
 * on or off is a bigger decision than a chat message should make on its own;
 * this route does not accept them. `setJournalProfile` is the same function
 * `PATCH /api/v1/<user>/config` calls, so a title changed here is a title
 * changed any other way.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `app/api/helper/[user]/day/route.ts` sets out at
 * length.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/journal">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const changes: Record<string, unknown> = {};
  if (typeof body?.title === "string") changes.title = body.title;
  if (typeof body?.tagline === "string") changes.tagline = body.tagline;

  if (Object.keys(changes).length === 0) {
    refused(user, "journal_settings", "nothing_to_change");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = setJournalProfile(user, changes);
  if (!result.ok) {
    refused(user, "journal_settings", result.error);
    const status = result.error === "no_such_journal" ? 404 : 400;
    return Response.json({ error: result.error, message: result.message }, { status });
  }

  wrote(user, "journal_settings", { changed: result.changed });
  return Response.json({ ok: true, journal: result.journal, changed: result.changed });
}
