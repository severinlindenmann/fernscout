import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { wrote } from "@/lib/helper/thread";
import { runCleanup } from "@/lib/storageCleanup";

export const dynamic = "force-dynamic";

/**
 * The cleanup the person confirmed — B1042 batch (`cleanup` in
 * `lib/helper/tools/areas/journal.ts`).
 *
 * Staged inbox files are deliberately out of scope here, the same as
 * `POST /api/v1/<user>/storage/cleanup`: those are removed one at a time,
 * where a person is looking at what they are removing.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `app/api/helper/[user]/day/route.ts` sets out at
 * length.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/storage/cleanup">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const result = await runCleanup(user);
  wrote(user, "cleanup", { bytes: result.bytes, files: result.files });
  return Response.json({ ok: true, ...result });
}
