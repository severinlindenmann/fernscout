import fs from "node:fs";
import {
  applyMapping,
  checkMapping,
  readTable,
  type ColumnMapping,
  type DateFormat,
  DATE_FORMATS,
} from "@/importers/costs/mapping";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { applyCosts, validateRows } from "@/lib/statements/apply";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { findInboxFile } from "@/lib/inbox";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The mapping, applied — B689, and **no model, no credit, no provider.**
 *
 * Two presses live here, and neither of them talks to anything:
 *
 * 1. Without `rows`, it reads the whole file through the mapping the person
 *    has just confirmed and hands back what it found — every payment going
 *    out, with the date and the amount this software will actually record.
 *    Nothing is written. That is the loop the plan is built around: two
 *    thousand rows read by a `for` loop that cost nothing, from one sample
 *    somebody agreed to.
 * 2. With `rows`, it writes those rows onto the days they happened on, through
 *    `applyCosts` — the same writer `POST /api/v1/<user>/trips/<trip>/costs/import`
 *    uses, so a statement read from a phone and a statement read by somebody's
 *    own agent land identically.
 *
 * **The category is never chosen here.** `validateRows` requires one on every
 * row and the caller supplies it, because whether a payment was "food" or "the
 * one good dinner" is an editorial decision about somebody's trip and this
 * software does not make those — `importers/costs/schema.ts` says it at
 * length, and it is the reason a costs import has always been two calls.
 */

const SHOWN = 400;

function mappingFrom(raw: unknown): ColumnMapping | null {
  const m = (raw ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);
  const date = text(m.date);
  const amount = text(m.amount);
  if (!date || !amount) return null;
  return {
    date,
    amount,
    description: text(m.description) ?? "",
    currency: text(m.currency),
    fixedCurrency: text(m.fixedCurrency)?.toUpperCase(),
    account: text(m.account),
    dateFormat: ((DATE_FORMATS as readonly string[]).includes(m.dateFormat as string)
      ? m.dateFormat
      : "YYYY-MM-DD") as DateFormat,
    decimalComma: m.decimalComma === true,
    outgoingPositive: m.outgoingPositive === true,
  };
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/statement/apply">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const trip = getTrip(tripRef(user, typeof body.trip === "string" ? body.trip : ""));
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  // The second press writes and needs no file: the rows are the person's own,
  // read back off their screen after they put a category on each.
  if (body.rows !== undefined) {
    const checked = validateRows(body.rows);
    if ("problems" in checked) {
      return Response.json({ error: "invalid_rows", problems: checked.problems }, { status: 400 });
    }
    return Response.json({ ok: true, written: applyCosts(trip.ref, checked.rows) });
  }

  if (typeof body.inbox !== "string") return Response.json({ error: "no_file" }, { status: 400 });
  const found = findInboxFile(user, body.inbox);
  if (!found) return Response.json({ error: "unknown_inbox_file" }, { status: 404 });

  const text = fs.readFileSync(found.file, "utf8");

  // The same escape hatch `../route.ts` takes, so a preamble a person moved
  // past there is moved past here too — the whole file is read with the same
  // header line the sample was confirmed against (B761).
  const skipLines = Math.min(20, Math.max(0, Number(body.skipLines) || 0));

  // A bank the repository already knows: its own parser, no mapping involved.
  // The screen reaches this branch when `../route.ts` recognised the file and
  // charged nothing for saying so.
  const known =
    typeof body.format === "string"
      ? COSTS_IMPORTERS.find((importer) => importer.id === body.format)
      : undefined;

  let payments;
  if (known) {
    try {
      payments = known.parse(text);
    } catch {
      return Response.json({ error: "unreadable" }, { status: 400 });
    }
  } else {
    const mapping = mappingFrom(body.mapping);
    if (!mapping) return Response.json({ error: "no_mapping" }, { status: 400 });

    const table = readTable(text, skipLines);
    if (!table) return Response.json({ error: "not_a_table" }, { status: 400 });

    const problems = checkMapping(table.header, mapping);
    if (problems.length > 0) {
      return Response.json({ error: "bad_mapping", problems }, { status: 400 });
    }
    payments = applyMapping(text, mapping, skipLines);
  }
  // The trip's own dates, because a statement covers the fortnight either side
  // of it and nobody wants to scroll past their rent to find a ferry.
  const inTrip = payments.filter(
    (p) => p.date >= trip.start && p.date <= trip.end && p.amount < 0 && !p.transfer,
  );
  return Response.json({
    ok: true,
    read: payments.length,
    outside: payments.length - inTrip.length,
    spending: inTrip.slice(0, SHOWN).map((p) => ({
      date: p.date,
      label: p.description,
      // Positive: a `costs:` entry on a day records what a thing cost, and the
      // sign belongs to the statement rather than to a journal.
      amount: Math.round(Math.abs(p.amount) * 100) / 100,
      currency: p.currency,
    })),
    truncated: Math.max(0, inTrip.length - SHOWN),
  });
}
