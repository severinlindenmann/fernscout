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
import { readJsonBody } from "@/lib/api/jsonBody";

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

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
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
    // D10 / B1844 — a line whose date has no day in this trip is not skipped
    // and not dropped: `applyCosts` itself now files it onto the trip's own
    // `costs.items` and reports which dates went there (`written.filedToTrip`)
    // — the same write this route used to make on its own, moved down to
    // `lib/statements/apply.ts` so the v2 API's `costs/apply` does it too.
    // The top-level `filedToTrip` count is kept for `StatementFlow`'s own
    // done screen, which only ever read a total.
    const written = applyCosts(trip.ref, checked.rows);
    // Past the cost-line bound on a day or on the trip (B2243): nothing written.
    if ("problems" in written) {
      return Response.json({ error: "invalid_rows", problems: written.problems }, { status: 400 });
    }
    const filedToTrip = written.filedToTrip.reduce((sum, f) => sum + f.rows, 0);

    return Response.json({ ok: true, written, filedToTrip });
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
  // Named explicitly when `../route.ts` recognised the file, or — B1822 —
  // detected here for free when nothing was said either way, the same
  // `COSTS_IMPORTERS.find(...detect...)` that route runs, so a caller who
  // never asked the model still gets the free answer when there is one.
  const known =
    typeof body.format === "string"
      ? COSTS_IMPORTERS.find((importer) => importer.id === body.format)
      : body.mapping === undefined
        ? COSTS_IMPORTERS.find((importer) => importer.detect(text.slice(0, 64 * 1024), found.entry.filename))
        : undefined;

  let payments;
  if (known) {
    try {
      payments = known.parse(text);
    } catch {
      return Response.json({ error: "unreadable" }, { status: 400 });
    }
  } else if (body.mapping === undefined) {
    // B1822, spec §7.7 — "an unrecognised bank reaches the same decide step
    // through the generic column mapping … it is never a dead end." No
    // model and no credit: the header is free, and it is all a person needs
    // to point at four columns themselves.
    const table = readTable(text, skipLines);
    if (!table) return Response.json({ error: "not_a_table" }, { status: 400 });
    return Response.json({ ok: true, unrecognized: true, header: table.header, sample: table.rows.slice(0, 5) });
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
  const dated = payments.filter((p) => p.date >= trip.start && p.date <= trip.end && !p.transfer);
  const inTrip = dated.filter((p) => p.amount < 0);
  return Response.json({
    ok: true,
    format: known?.id,
    label: known?.label,
    read: payments.length,
    // Every line not offered below, for any reason: out of the trip's dates,
    // a transfer, or money coming in.
    outside: payments.length - inTrip.length,
    // B2056 — the part of \`outside\` left out only for its sign: in the trip's
    // dates, not a transfer, and positive. A file that writes money going
    // out as positive lands every line here; \`mapping.outgoingPositive\`
    // flips it.
    wrongSign: dated.filter((p) => p.amount > 0).length,
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
