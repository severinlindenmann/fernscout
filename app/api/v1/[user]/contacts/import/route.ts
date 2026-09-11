import { authenticate, errorResponse, mayActAsOwner, outOfScope, ownsUser } from "@/lib/api/auth";
import { isEnabled } from "@/lib/capabilities";
import { requestContact } from "@/lib/contacts";
import { pickLocale } from "@/lib/contacts/locale";
import { sendCodeMail } from "@/lib/contacts/mail";
import { isEmail, issueCode } from "@/lib/auth";
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

type Row = { name?: unknown; email?: unknown; tel?: unknown };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type RowOutcome = { name: string; email: string; outcome: "created" | "updated" | "ignored" | "invalid" };

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
  const rows = Array.isArray(body?.rows) ? (body.rows as Row[]) : null;
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

  const locale = pickLocale(null, config.defaultLocale);
  const results: RowOutcome[] = [];

  for (const row of rows) {
    const name = str(row.name);
    const email = str(row.email);
    const tel = str(row.tel);
    if (!name || !isEmail(email)) {
      results.push({ name, email, outcome: "invalid" });
      continue;
    }

    const result = await requestContact(user, {
      name,
      email,
      locale,
      // A number carried through and nothing else — the same shape the
      // public form uses for "I did not say" beyond it. `EMPTY_ADDRESS`
      // itself is not imported here; a postal address is not on a phone's
      // contact card the way it is on an envelope somebody already sent.
      address: tel ? { tel } : undefined,
      wantsEmailDigest: false,
      wantsPostcard: false,
      // Left untouched on purpose — B1394's own note: a vCard's TEL is
      // carried through so it is not lost, but ticking "message me on
      // WhatsApp" is a separate decision nobody made on this row's behalf.
      wantsWhatsapp: false,
      createdVia: "owner-import",
    });

    if (result.outcome === "ignored") {
      results.push({ name, email, outcome: "ignored" });
      continue;
    }

    // Best effort, the same reasoning `sendApprovedMail` and every other
    // mail in this family gets: the row already exists by the time this
    // runs, and a dead SMTP host must not undo it.
    try {
      const { code } = await issueCode(user, email, "guest");
      await sendCodeMail(user, config, email, locale, code);
    } catch {
      // The row is still pending and still correct; only the mail failed.
    }
    results.push({ name, email, outcome: result.outcome });
  }

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
