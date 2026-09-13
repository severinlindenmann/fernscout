// GET /api/v2/{user}/postcards/recipients — B1624, phase 2 step 4.
// Unchanged in substance from v1: a name, a town and a country each, never a
// street. See AGENTS.md's paragraph on postcards for why.
import { ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { postcardsReady } from "@/lib/api/v2/postcards";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { postcardCandidates } from "@/lib/postcard/contacts";

export const dynamic = "force-dynamic";

/**
 * The body, apart from who is asking — B1674. Called here after
 * `requireJournalOwner` (bearer), and by `app/api/web/[user]/postcards/recipients/route.ts`
 * after its own cookie-only `isOwner` check plus the same `postcardsReady`
 * — a v2 route file cannot import a sibling's glue, so this is where the two
 * doors share it.
 */
export async function postcardRecipientsDoc(user: string): Promise<Response> {
  const recipients = await postcardCandidates(user);
  return ok({
    creditsEach: POSTCARD_CREDITS,
    recipients,
    ...(recipients.length === 0
      ? {
          note:
            "Nobody has asked this journal for a real postcard yet. Readers opt in on the " +
            `guest form or their own manage page; the owner sees them at /${user}/contacts.`,
        }
      : {}),
  });
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/postcards/recipients">,
) {
  const { user } = await params;
  const ready = postcardsReady(user);
  if (!ready.ok) return ready.response;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  return postcardRecipientsDoc(user);
}
