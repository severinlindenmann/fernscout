import fs from "node:fs";
import { COSTS_IMPORTERS } from "@/importers/costs";
import { applyMapping, checkMapping, statementSample } from "@/importers/costs/mapping";
import { isEnabled } from "@/lib/capabilities";
import { mayUseAi } from "@paid/billing/lib/aiDays";
import { hasHelperConsent } from "@/lib/helper/consent";
import { HELPER_PROVIDER, mapStatementColumns } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
import { findInboxFile } from "@/lib/inbox";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/api/jsonBody";

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
 * nothing. One call for a statement of any length.
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
 * rate limit, consent, then the AI-day check, then the model.
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
    return notYourJournal(request, user);
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

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body || typeof body.inbox !== "string") {
    return Response.json({ error: "no_file" }, { status: 400 });
  }
  const found = findInboxFile(user, body.inbox);
  if (!found) return Response.json({ error: "unknown_inbox_file" }, { status: 404 });

  // "That is not the header row" — B761. A preamble line with a comma or two
  // in it (an account name, an export date) can have as many cells as the
  // real header, and detection cannot tell the two apart on its own. A person
  // who sees nonsense column names says so, and this moves the guess down a
  // line rather than trying to be cleverer about it.
  const skipLines = Math.min(20, Math.max(0, Number(body.skipLines) || 0));

  const text = fs.readFileSync(found.file, "utf8");

  // **The Regelwerk first.** A bank one of `importers/costs/` already knows by
  // heart needs no mapping and no model: the parser is right, free and
  // instant, and asking anyway would spend an AI day for an answer the
  // repository already had. Only a statement nothing recognises reaches the
  // gates below.
  const known = COSTS_IMPORTERS.find((importer) =>
    importer.detect(text.slice(0, 64 * 1024), found.entry.filename),
  );
  if (known) {
    return Response.json({ ok: true, format: known.id, label: known.label });
  }

  const sample = statementSample(text, PREVIEW_ROWS, skipLines);
  if (!sample || sample.rows.length === 0) {
    // Refused before the AI-day check: there is nothing in this file for a
    // model to read.
    return Response.json({ error: "not_a_table" }, { status: 400 });
  }

  // Its own scope, and `words` does not stand in for it.
  if (!hasHelperConsent(user, "statement")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  const supplied = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  const key = supplied === "" ? null : idempotencyKey(user, "helper.statement", supplied);
  const fingerprint = fingerprintOf({ inbox: found.entry.id, skipLines });
  const recalled = await recall<Record<string, unknown>>(key, fingerprint);
  if (recalled.kind === "replay") return Response.json(recalled.value);
  if (recalled.kind === "conflict") {
    return Response.json({ error: "idempotency_conflict" }, { status: 409 });
  }

  // B2591 — "statement" takes no AI day of its own; it needs an active plan
  // or unused Free days.
  const gate = await mayUseAi(user);
  if (!gate.ok) return Response.json(gate.refusal, { status: 402 });

  let read;
  try {
    read = await mapStatementColumns(sample, user);
  } catch {
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
    skipLines,
    // Applied by code, to the sample only, so the person sees what the mapping
    // *does* rather than what it claims.
    preview: problems.length === 0 ? applyMapping(rejoin(sample), read.mapping) : [],
    provider: HELPER_PROVIDER,
  };
  await remember(key, fingerprint, answer);
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
