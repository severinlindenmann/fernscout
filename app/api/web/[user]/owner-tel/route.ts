// DELETE /api/web/{user}/owner-tel — the owner's own "Remove this number"
// button in Journal settings, from a cookie — B2833. Owner browser only: any
// Authorization header is refused (an agent clears with DELETE
// /api/v2/{user}/owner/tel, which runs the same function), and a request
// whose Origin is another site is refused like the other cookie-only deletes.
// Only ever removes a number; there is no way to set one here.
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isOwner } from "@/lib/contacts/session";
import { clearOwnerTel } from "@/lib/ownerTel";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: RouteContext<"/api/web/[user]/owner-tel">) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser. An agent uses DELETE /api/v2/{user}/owner/tel." },
      { status: 403 },
    );
  }
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  const { user } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });

  await clearOwnerTel(user);
  return Response.json({ ok: true });
}
