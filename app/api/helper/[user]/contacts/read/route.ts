import fs from "node:fs";
import { isEnabled } from "@/lib/capabilities";
import { readContactsFile } from "@/lib/contacts/readImport";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { findInboxFile } from "@/lib/inbox";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * A phone's own address book, read from the inbox — B1823, the cookie-side
 * twin `POST /api/v2/[user]/import` (kind `contacts`) never had.
 *
 * `readContactsFile` (`lib/contacts/readImport.ts`) already does the actual
 * reading and reporting — the same function the bearer door calls, so a
 * vCard read from a browser session and one read by an agent's own token
 * parse identically. **Nothing here writes.** A person still has to agree
 * which rows are contacts of this journal; `POST /api/helper/[user]/contacts/import`
 * is the door that files them, exactly as it already does for the card flow
 * in `/agent`.
 *
 * Cookie only, owner only, outside `/api/v1` — the same door as every other
 * helper write.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/contacts/read">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("contacts", user)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body || typeof body.inbox !== "string") {
    return Response.json({ error: "no_file" }, { status: 400 });
  }
  const found = findInboxFile(user, body.inbox);
  if (!found) return Response.json({ error: "unknown_inbox_file" }, { status: 404 });

  const text = fs.readFileSync(found.file, "utf8");
  const format = typeof body.format === "string" ? body.format : undefined;
  const read = readContactsFile(text, found.entry.filename, { format });

  if ("refusal" in read) {
    return Response.json(
      { error: read.refusal === "unknown_format" ? "unreadable" : read.refusal, message: read.message, problems: read.problems },
      { status: 400 },
    );
  }

  return Response.json({ ok: true, ...read });
}
