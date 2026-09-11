import { authenticate, errorResponse, mayActAsOwner, outOfScope, ownsUser } from "@/lib/api/auth";
import { isEnabled } from "@/lib/capabilities";
import { importContactRows, type ImportRow } from "@/lib/contacts/importRows";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The agreed rows from a `contacts` import, filed one at a time — B1394, and
 * the second half of a vCard import the same way `.../costs/import` is the
 * second half of a statement one.
 *
 * `POST /api/v1/<user>/import` (kind `contacts`) reads a vCard and writes
 * nothing. This is where a person says *these* entries, from everybody on
 * the card, are actually contacts of this journal — the same decision
 * `POST /api/v1/<user>/import`'s `costs` branch leaves to a person about
 * which payments were the trip's.
 *
 * **Every row lands exactly where the public request form leaves one:**
 * `pending`, no address stored beyond a phone number if the row carried one,
 * and a six-digit code mailed to the address itself — never pre-approved,
 * because importing twenty contacts at once must not be a way past the same
 * proof of address every other contact needs. `approveContact` still refuses
 * an unconfirmed row; nothing here calls it.
 *
 * **Owner only**, journal-wide rather than trip-scoped — a phone's address
 * book is nobody's trip, and a token scoped to one would be a way to add
 * contacts to a journal it cannot otherwise touch.
 */

const MAX_ROWS = 50;

export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/contacts/import">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (!mayActAsOwner(auth.session, user)) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip. A phone's address book belongs to the whole " +
          "journal, not the days a token's trip covers, so importing contacts is the owner's " +
          "to do.",
      },
      { status: 403 },
    );
  }

  const config = getUser(user);
  if (!config || !isEnabled("contacts", user)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = Array.isArray(body?.rows) ? (body.rows as ImportRow[]) : null;
  if (!rows || rows.length === 0) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          "`rows` must be a non-empty array of {name, email, tel?} — the entries a person " +
          "agreed, from what `POST /api/v1/" + user + "/import` (kind `contacts`) reported. " +
          "Never rows typed from memory: a card's own EMAIL is what makes a row importable.",
      },
      { status: 400 },
    );
  }
  if (rows.length > MAX_ROWS) {
    return Response.json(
      { error: "invalid_request", message: `${rows.length} rows; one call carries at most ${MAX_ROWS}.` },
      { status: 400 },
    );
  }

  const results = await importContactRows(user, config, rows);
  const filed = results.filter((r) => r.outcome === "created" || r.outcome === "updated").length;
  return Response.json({
    filed,
    invalid: results.filter((r) => r.outcome === "invalid").length,
    results,
    next:
      filed > 0
        ? `${filed} row${filed === 1 ? " is" : "s are"} pending, each with its own confirmation ` +
          "mail on its way — none of them is a recipient, a reader, or anything else until " +
          "that address confirms. Nobody has been added to any trip or given anything to read."
        : "Nothing was filed — check `results` for what each row needs.",
  });
}
