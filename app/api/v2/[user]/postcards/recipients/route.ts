// GET /api/v2/{user}/postcards/recipients — B1624, phase 2 step 4.
// Unchanged in substance from v1: a name, a town and a country each, never a
// street. See AGENTS.md's paragraph on postcards for why.
import { isEnabled } from "@/lib/capabilities";
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { postcardCandidates } from "@/lib/postcard/contacts";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/postcards/recipients">,
) {
  const { user } = await params;
  if (!getUser(user) || !isEnabled("postcards") || !isEnabled("contacts")) {
    return fail("postcards_disabled", ERROR_CODES.postcards_disabled, undefined, 404);
  }
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

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
