// PATCH /api/web/{user}/figures/set — the journal's own door onto its
// default walking figures, from a cookie — B2022. Same shape as the trip's
// `.../plan` door beside this one: `applyJournalPatch` (the same function
// `PATCH /api/v2/{user}` calls for a bearer token) is the one place that
// parses, validates and writes the journal document, so a set saved from
// the studio and one saved by an agent read back identically. Narrowed to
// `figures`/`declined` only — everything else about the journal has its own
// door (`app/api/web/[user]/route.ts`).
import { applyJournalPatch } from "@/app/api/v2/[user]/route";
import { journalDoc } from "@/lib/api/v2/schemas";
import { isOwner } from "@/lib/contacts/session";
import { journalV2Fields } from "@/lib/journals";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent sets the journal's default figures with " +
    "PATCH /api/v2/{user}.",
};

const ALLOWED = ["figures", "declined"];

export async function PATCH(request: Request, { params }: RouteContext<"/api/web/[user]/figures/set">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user } = await params;
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Read the body twice on purpose, same reasoning as `.../plan`: once here
  // to keep this door narrow, once inside `applyJournalPatch`, which is the
  // one place that actually parses and validates it.
  const clone = request.clone();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (Object.keys(body).some((key) => !ALLOWED.includes(key))) {
    return Response.json({ error: "unsupported_field" }, { status: 400 });
  }

  const stored = journalDoc.parse({ ...journalV2Fields(journal), username: user });
  // "sections" (B2022, the same mode `applyTripPatch` got in B2011): this
  // door only ever answers the figures question, and must not be refused
  // because a DIFFERENT section — a journal signed up before v2 with no
  // tagline and no decline, say — is still open.
  return applyJournalPatch(user, stored, clone, "sections");
}
