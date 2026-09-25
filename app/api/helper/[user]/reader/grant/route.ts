import { isEmail } from "@/lib/auth";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { grantContactAccess } from "@/lib/contacts";
import { sendGrantedMail } from "@/lib/contacts/mail";
import { pickLocale } from "@/lib/contacts/locale";
import { getUser } from "@/lib/users";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/**
 * "Invite somebody to read" — B1833, D11, spec §7.5.
 *
 * **D11 — an owner grants a named address direct access.** The address can
 * read the journal the moment `grantContactAccess` returns; the mail that
 * follows tells the person rather than asking them, and carries the way to
 * decline everything D11 requires. A *link* still grants nothing — nothing
 * here mints one; this route writes the grant straight from the server,
 * behind the owner's own cookie.
 *
 * Owner only, cookie only — the same reasoning `POST
 * app/api/helper/[user]/trip/route.ts` gives at length: this is a page a
 * person is looking at, not a contract route an agent's bearer token reaches.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/reader/grant">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const limited = rateLimitFor("helper-reader-grant", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!isEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });

  const journal = getUser(user);
  if (!journal) return Response.json({ error: "no_such_journal" }, { status: 404 });

  const locale = pickLocale(null, journal.defaultLocale);
  const result = await grantContactAccess(user, { name, email, locale });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 409 });
  }

  // Best effort (B272's own rule, followed by every other mail in this
  // module): the grant already exists by the time this runs, so a send
  // failure here must not undo it — the owner still sees the address on
  // their contacts page and can resend from there.
  await sendGrantedMail(user, journal, result.contact);

  return Response.json({ ok: true, email: result.contact.email });
}
