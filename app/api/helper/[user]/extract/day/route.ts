import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { extendOnTouch } from "@/lib/staging/expiry";
import { DATE_RE, readManifest, writeManifest, type DayRow } from "@/lib/staging/manifest";

export const dynamic = "force-dynamic";

/**
 * Answering one question about one day — B1751, Task 2.3.
 *
 * Deliberately not `appendWords` from `lib/dayReadiness.ts`: nothing is in
 * `inbox/days/` yet for this run and will not be until Task 3.1 commits it,
 * so writing there now would create a half-day nothing owns. The answer
 * lives on the manifest's own `DayRow` — `words`, appended to — and the
 * question id goes into `answered` so `questionsForDay` never asks it again.
 *
 * **`skip: true`** — the follow-up screen's own "Skip" (S7c, B1803 Task
 * 3.5). "None of them is required" has to be true of the *data*, not just
 * the wording: a skipped follow-up is marked `answered` so it never comes
 * back, but nothing is appended to `words` — an empty field, never a blank
 * line standing in for an answer nobody gave.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/day">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as {
    run?: string;
    date?: string;
    questionId?: string;
    answer?: string;
    location?: string;
    skip?: boolean;
  } | null;
  if (
    !body ||
    typeof body.run !== "string" ||
    typeof body.date !== "string" ||
    typeof body.questionId !== "string" ||
    typeof body.answer !== "string"
  ) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  // The *shape*, not merely the type — B1803 final review, finding 1. `""`
  // is real and must stay storable: it is the undated group's own date
  // (`lib/extract/group.ts`), and its answers belong on the manifest like
  // anybody else's. Anything that is neither that nor a real `yyyy-mm-dd`
  // has no business becoming a `DayRow.date`, which later names a folder
  // and is formatted as a weekday by every screen that reads it back.
  if (body.date !== "" && !DATE_RE.test(body.date)) {
    return Response.json({ error: "invalid_date", expected: "yyyy-mm-dd" }, { status: 400 });
  }
  const skip = body.skip === true;
  const answer = body.answer.trim();
  if (!skip && answer === "") return Response.json({ error: "empty_answer" }, { status: 400 });

  const manifest = readManifest(user, body.run);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  const extended = extendOnTouch(manifest, new Date());
  const current = extended ?? manifest;

  let day: DayRow | undefined = current.days.find((d) => d.date === body.date);
  if (!day) {
    day = { date: body.date, answered: [] };
    current.days.push(day);
  }
  // Blank line between answers rather than a run-on paragraph — the same
  // shape a person typing several short answers in a row would leave.
  // Never for a skip: there is nothing to append, and an empty field beats
  // a blank line pretending to be one.
  if (!skip) {
    day.words = day.words ? `${day.words}\n\n${answer}` : answer;
  }
  if (!day.answered.includes(body.questionId)) day.answered.push(body.questionId);
  if (typeof body.location === "string" && body.location.trim() !== "") {
    day.location = body.location.trim();
  }

  writeManifest(user, current);
  return Response.json({ day });
}
