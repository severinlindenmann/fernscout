import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { setJournalProfile } from "@/lib/journals";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `PATCH /api/journal` — what the journal calls itself, changed by the person
 * who owns it. B619.
 *
 * ## Why it is not `PATCH /api/v1/{user}/config`
 *
 * That route writes the same fields and takes a **bearer token only**
 * (`authenticate` in lib/api/auth.ts). The owner standing on their own page is
 * holding a cookie, and the two credentials are deliberately not
 * interchangeable — `resolveSession` compares a row's `kind` against what the
 * caller asked for, which is what stops reading the site on a phone from
 * putting a write token in somebody's pocket.
 *
 * So this is the cookie-side door, and it is the same shape as the two that
 * already exist: `/api/contacts/admin`, where the owner approves a guest and
 * edits a contact's address, and the postcard send route, which spends
 * credits at a printer. Both are outside `/api/v1`, both take
 * `isOwner(username, request)` and no token at all.
 *
 * ## What it does not do
 *
 * Everything else in `JOURNAL_PROFILE_FIELDS`. `title` and `tagline` are the
 * two an owner reads on their own page and can see are wrong; `locales`,
 * `displayCurrencies` and `manualRates` are an agent's job, where there is
 * room to explain what a bad answer costs. Narrow on purpose: this route
 * hands a browser session a pen, and the smallest surface that answers the
 * ticket is the right one.
 *
 * `owner.email` is not here and is not anywhere. It is the address that
 * decides who can obtain a write token for this journal, so a stolen
 * year-long cookie must not be able to move the journal to another mailbox.
 * The page shows it and says who changes it.
 */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";

  // No `contacts` check, unlike `/api/contacts/admin`'s own guard: a
  // journal's name has nothing to do with whether it has guests.
  if (!getUser(username)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!isEnabled("auth", username)) {
    // Without sign-in there is no cookie session, so there is no owner to be:
    // a 404 rather than a 403, matching how every other gated surface answers
    // for a capability this journal does not have.
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!(await isOwner(username, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const changes: Record<string, unknown> = {};
  for (const field of ["title", "tagline"] as const) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (Object.keys(changes).length === 0) {
    return Response.json({ error: "nothing_to_change" }, { status: 400 });
  }

  // `setJournalProfile` owns every rule about these two — a title cannot be
  // cleared, an empty tagline removes the key rather than writing "", and a
  // control character is refused because the value lands in a `<title>`, an
  // OG tag and a mail subject. Restating any of that here would be a second
  // copy to disagree with the first.
  const result = setJournalProfile(username, changes);
  if (!result.ok) {
    const status = result.error === "write_failed" ? 500 : 400;
    return Response.json({ error: result.error, message: result.message }, { status });
  }
  return Response.json({
    ok: true,
    title: result.journal.title,
    tagline: result.journal.tagline,
    changed: result.changed,
  });
}
