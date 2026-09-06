import { isOwner } from "@/lib/contacts/session";
import { updateOrderFigures } from "@/lib/postcard/orders";
import { backToPreview } from "@/lib/postcard/redirectBack";

export const dynamic = "force-dynamic";

/**
 * Switching the traveller figures on or off for a card that has not gone yet
 * — B628.
 *
 * The same door as `message` and `crop`, and deliberately so: not under
 * `/api/v1/`, satisfied only by the owner's cookie (`isOwner` called
 * *without* the request, which is what excludes a bearer token), and a
 * request carrying an `Authorization` header is refused outright. An agent
 * has no way to see whether the figures fit beside the signature it wrote, so
 * this is the owner's own control, the same reasoning `crop` was given.
 *
 * A plain form checkbox rather than the drag control's `fetch`, because a
 * toggle needs no JavaScript to work on a bad connection — the same choice
 * `message`'s form already makes.
 *
 * Refused once the order leaves `draft`, so a toggle that lands while a send
 * is in flight changes no row rather than quietly altering what is printing.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/postcards/[id]/figures">,
) {
  const { user, id } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Whether the traveller figures print is chosen by the person whose journal it is, " +
          "on the preview page. An agent cannot see whether they fit beside the words it wrote.",
      },
      { status: 403 },
    );
  }

  if (!(await isOwner(user))) {
    return backToPreview(user, id, "forbidden");
  }

  const form = await request.formData();
  const figures = form.get("figures") === "on";

  const saved = await updateOrderFigures(user, id, figures);
  return backToPreview(user, id, saved ? "saved" : "already_sent");
}
