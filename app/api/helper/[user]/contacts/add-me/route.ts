import { addSelfContact } from "@/lib/contacts";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * The owner, added as their own contact, from the conversation — B1393.
 *
 * The press `add_contact` (`lib/helper/tools/areas/printed.ts`) proposes.
 * Reads the name and address from this journal's own `config.json` — never
 * from the request body — so nothing the model wrote can name who the row is
 * for or what address it carries. The same three steps `app/api/contacts/admin/route.ts`'s
 * `"self"` action always ran, now shared as `addSelfContact` rather than
 * typed out a second time.
 *
 * Owner only, cookie only, outside `/api/v1` — the same door as every other
 * helper write.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/contacts/add-me">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const result = await addSelfContact(user);
  if (!result.ok) {
    refused(user, "add_contact", result.error);
    return Response.json({ error: result.error }, { status: 409 });
  }

  wrote(user, "add_contact", { id: result.contact.id, status: result.contact.status });
  return Response.json({ ok: true, contact: { id: result.contact.id, status: result.contact.status } });
}
