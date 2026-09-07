import fs from "node:fs";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { applyMapping, checkMapping, statementSample } from "@/importers/costs/mapping";
import { isEnabled } from "@/lib/capabilities";
import { refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import { HELPER_PROVIDER, mapStatementColumns, STATEMENT_CREDITS } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { findInboxFile } from "@/lib/inbox";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Which column is which — B689, and the one place in this feature a model is
 * spoken to.
 *
 * **The header row and five sample rows go out. The file does not.** A
 * statement is two thousand lines of somebody's financial life, most of it
 * nothing to do with any trip, and sending it row by row would be both a bill
 * and a disclosure nobody asked for. What leaves is the sample; what comes
 * back is a mapping; `applyMapping` reads the rest here, in a `for` loop, for
 * nothing. One credit for a statement of any length, because it is one call.
 *
 * Its own consent scope, for the same reason `speech` has one (B686): a person
 * who agreed to send the sentence they typed has said nothing about their
 * bank. `words` is not enough and is not accepted here.
 *
 * **Nothing is written by this route.** It answers with the mapping and a
 * preview of the first few rows as this software would read them, and stops —
 * a person corrects any column they like, and `./apply` is a separate press.
 * The same shape B677 gave the API: a statement is read and reported, and
 * writing is a second call with a person in between.
 *
 * The gates run cheapest first, like `../day/write-day`: owner, capability,
 * rate limit, consent, then the credit, then the model — the only one that can
 * fail after money has moved, which is what the refund is for.
 */

/** Fifteen minutes. Somebody has one statement, not twenty. */
const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

/** How many rows the person sees before they agree the mapping. The same five
 *  the model saw, so the screen shows exactly what the answer was based on. */
const PREVIEW_ROWS = 5;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/statement">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-statement", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.inbox !== "string") {
    return Response.json({ error: "no_file" }, { status: 400 });
  }
  const found = findInboxFile(user, body.inbox);
  if (!found) return Response.json({ error: "unknown_inbox_file" }, { status: 404 });

  const text = fs.readFileSync(found.file, "utf8");

  // **The Regelwerk first.** A bank one of `importers/costs/` already knows by
  // heart needs no mapping and no model: the parser is right, free and
  // instant, and asking anyway would be charging a credit for an answer the
  // repository already had. Only a statement nothing recognises reaches the
  // gates below.
  const known = COSTS_IMPORTERS.find((importer) =>
    importer.detect(text.slice(0, 64 * 1024), found.entry.filename),
  );
  if (known) {
    return Response.json({ ok: true, format: known.id, label: known.label, spent: 0 });
  }

  const sample = statementSample(text, PREVIEW_ROWS);
  if (!sample || sample.rows.length === 0) {
    // Refused before the credit: there is nothing in this file for a model to
    // read, and charging for that would be charging for a wrong answer.
    return Response.json({ error: "not_a_table" }, { status: 400 });
  }

  // Its own scope, and `words` does not stand in for it.
  if (!hasHelperConsent(user, "statement")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const supplied = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  const key = supplied === "" ? null : idempotencyKey(user, "helper.statement", supplied);
  const fingerprint = fingerprintOf({ inbox: found.entry.id });
  const recalled = recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  const ledgerRef = `${user}/statement/${found.entry.id}`;
  if (!(await spend(user, STATEMENT_CREDITS, "helper", ledgerRef))) {
    return Response.json({ error: "no_credits" }, { status: 402 });
  }

  let read;
  try {
    read = await mapStatementColumns(sample, user);
  } catch {
    await refund(user, STATEMENT_CREDITS, ledgerRef);
    return Response.json({ error: "model_failed" }, { status: 502 });
  }

  // What it said, checked against the file it was said about. A column name
  // that is not in the header is reported rather than applied — the person is
  // about to fix it in a picker either way, and a silently dropped column is
  // an empty preview nobody can explain.
  const problems = checkMapping(sample.header, read.mapping);
  const answer = {
    ok: true,
    header: sample.header,
    sample: sample.rows,
    mapping: read.mapping,
    notes: read.notes,
    problems,
    // Applied by code, to the sample only, so the person sees what the mapping
    // *does* rather than what it claims.
    preview: problems.length === 0 ? applyMapping(rejoin(sample), read.mapping) : [],
    spent: STATEMENT_CREDITS,
    provider: HELPER_PROVIDER,
  };
  remember(key, fingerprint, answer);
  return Response.json(answer);
}

/** The sample back as a little CSV, so the preview runs through the same
 * `applyMapping` the whole file will — a preview built by a second code path
 * is a preview that can be right about a file the import gets wrong. */
function rejoin(sample: { header: string[]; rows: string[][] }): string {
  const line = (cells: string[]) =>
    cells.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",");
  return [line(sample.header), ...sample.rows.map(line)].join("\n");
}
