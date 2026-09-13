// POST /api/v2/{user}/contacts/import — B1623, phase 2 step 4.
//
// Moved from app/api/v1/[user]/contacts/import — internals (`importContactRows`)
// unchanged. Every row lands exactly where the public request form leaves
// one: `pending`, never pre-approved, with its own confirmation mail.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { importContactRows, type ImportRow, MAX_IMPORT_ROWS } from "@/lib/contacts/importRows";
import { isEnabled } from "@/lib/capabilities";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/import">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const config = getUser(user);
  if (!config) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = Array.isArray(body?.rows) ? (body.rows as ImportRow[]) : null;
  if (!rows || rows.length === 0) {
    return fail(
      "invalid_request",
      "`rows` must be a non-empty array of {name, email, tel?} — the entries a person agreed, " +
        `from what POST /api/v1/${user}/import (kind contacts) reported. Never rows typed from ` +
        "memory: a card's own EMAIL is what makes a row importable.",
    );
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return fail("invalid_request", `${rows.length} rows; one call carries at most ${MAX_IMPORT_ROWS}.`);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    return ok({
      filed: 0,
      invalid: 0,
      results: rows.map((row) => ({ ...row, outcome: "created", dryRun: true })),
      next: "Nothing was filed — dryRun.",
    });
  }

  const results = await importContactRows(user, config, rows);
  const filed = results.filter((r) => r.outcome === "created" || r.outcome === "updated").length;
  return ok({
    filed,
    invalid: results.filter((r) => r.outcome === "invalid").length,
    results,
    next:
      filed > 0
        ? `${filed} row${filed === 1 ? " is" : "s are"} pending, each with its own confirmation mail on ` +
          "its way — none of them is a recipient, a reader, or anything else until that address " +
          "confirms. Nobody has been added to any trip or given anything to read."
        : "Nothing was filed — check `results` for what each row needs.",
  });
}
