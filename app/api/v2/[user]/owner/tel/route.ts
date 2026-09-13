// GET/DELETE /api/v2/{user}/owner/tel — B1654, D20.
//
// The owner's own telephone number, moved off `config.json` and into a
// central store (`lib/ownerTel.ts`) alongside contacts and credits. Owner
// only, like every other journal-wide resource — `requireJournalOwner`
// refuses a trip-scoped token even when it belongs to the right journal
// (B1652 is why that check exists at all).
//
// **There is no PATCH here, deliberately.** An agent holding an owner token
// cannot set this field to a number of its own choosing — that would be an
// exfiltration path: `lib/digest/dayWhatsapp.ts` sends the owner's own copy
// of every published day to whatever number is on file, so a token that
// could redirect it could redirect a person's own journal at them, or worse,
// at somebody else's phone. Setting the number is `.../owner/tel/verify` and
// `.../verify/redeem` below, which prove possession of the number with a
// passcode before anything is written — nothing inside a boundary may move
// the boundary, the same rule `owner.email` already follows one file up.
// Clearing is different: it only ever turns a channel off, so it stays here.
import { ownerTelDoc } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok } from "@/lib/api/v2/route";
import { getUser } from "@/lib/users";
import { clearOwnerTel, ownerTelDocFields } from "@/lib/ownerTel";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/owner/tel">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  return ok(ownerTelDoc.parse(await ownerTelDocFields(user)));
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]/owner/tel">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

  await clearOwnerTel(user);
  return ok(ownerTelDoc.parse(await ownerTelDocFields(user)));
}
