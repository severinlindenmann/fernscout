import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { setJournalFeatures } from "@/lib/journals";

export const dynamic = "force-dynamic";

/**
 * The `channels` press — B1051.
 *
 * The wizard's own door onto `POST /api/v1/<user>/channels`, calling the same
 * `setJournalFeatures` that route calls rather than proxying to it — the
 * pattern every route in this family follows (`./day/publish/route.ts`,
 * `./trip/route.ts`): the server is a ceiling a journal can never write past,
 * and there is exactly one function that writes `features` for either door to
 * share.
 *
 * `enabled` arrives as `"on"` or `"off"` — a `ProposalField` carries a
 * string, never a boolean — and is parsed here rather than asking the model
 * to produce JSON `true`/`false` it might get wrong.
 */
const CHANNELS = ["mail", "whatsapp"] as const;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/channels">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const channel = CHANNELS.find((name) => name === body?.channel);
  const enabled = body?.enabled === "on" ? true : body?.enabled === "off" ? false : undefined;
  if (!channel || enabled === undefined) {
    refused(user, "channels", "bad_request");
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const result = setJournalFeatures(user, { [channel]: enabled });
  if (!result.ok) {
    refused(user, "channels", result.error);
    return Response.json(result, {
      status: result.error === "capability_unavailable" ? 409 : 400,
    });
  }

  wrote(user, "channels", { channel, enabled });
  return Response.json({ ok: true, channel, enabled });
}
