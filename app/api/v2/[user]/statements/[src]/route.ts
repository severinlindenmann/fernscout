// GET /api/v2/{user}/statements/{src} — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/content.md §3. Reads and reports; writes
// nothing. `src` is what POST /api/v2/{user}/media with
// intent.kind: "bank_export" answered with — always `inbox:<id>` today, since
// a bank export always lands in the flat inbox (lib/api/v2/media.ts).
import fs from "node:fs";
import { statementRead } from "@/lib/api/v2/schemas";
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { findInboxFile } from "@/lib/inbox";
import { readStatement } from "@/lib/statements/read";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/statements/[src]">,
) {
  const { user, src } = await params;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  if (!src.startsWith("inbox:")) {
    return fail("unknown_statement", ERROR_CODES.unknown_statement, undefined, 404);
  }
  const id = src.slice("inbox:".length);
  const staged = findInboxFile(user, id);
  if (!staged || staged.entry.kind !== "files" || staged.entry.importKind !== "bank_export") {
    return fail("unknown_statement", ERROR_CODES.unknown_statement, undefined, 404);
  }

  const text = fs.readFileSync(staged.file, "utf8");
  const statement = readStatement(text, staged.entry.filename, { format: staged.entry.importFormat });
  if ("refusal" in statement) {
    return fail(
      "unreadable_statement",
      `${ERROR_CODES.unreadable_statement} ${statement.message}`,
      statement.problems,
      400,
    );
  }

  const payments = statement.spending.days.flatMap((day) =>
    day.payments.map((p) => ({
      date: day.date,
      label: p.description,
      amount: p.charged?.amount ?? p.amount,
      currency: p.charged?.currency ?? p.currency,
      merchant: p.description,
    })),
  );

  const doc = statementRead.parse({
    src,
    ...(staged.entry.trip ? { trip: staged.entry.trip } : {}),
    dateRange: { from: statement.from, to: statement.to },
    merchants: statement.spending.merchants.map((m) => ({
      name: m.description,
      total: m.total,
      currency: m.currency,
      count: m.payments,
    })),
    payments,
    rates: statement.rates,
  });
  return ok(doc);
}
