import { isEnabled } from "@/lib/capabilities";
import { balanceOf, refund, spend } from "@/lib/credits";
import { HELPER_TURN_CREDITS, noCreditsAnswer } from "@/lib/helper/creditGate";
import { sayIn } from "@/lib/helper/intents";
import { findInJournal } from "@/lib/helper/model";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { requestLocale } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { searchCatalogueFor } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * A sentence in, the rows it meant out — B904.
 *
 * The search box searches locally and instantly (MiniSearch, in the browser)
 * and always will; this is the button beside it, for the sentence whose words
 * are nowhere in the journal. "The day we got lost near the border" matches no
 * token and is exactly how a person remembers a day.
 *
 * **A flat `HELPER_TURN_CREDITS` a call, since B1091** — spent right before
 * `findInJournal` and refunded if it throws, the same shape `ask` uses and
 * for the same reason: nothing here should be a second implementation of
 * that gate. A catalogue with nothing in it, or a rate limit already tripped,
 * never reaches the model and is never charged. `lib/rateLimit.ts` is the
 * brake beneath the credit, and `recordUsage` still books every call so the
 * operator can see what it costs (`/admin`).
 *
 * **The catalogue is the reader's own.** `searchCatalogueFor` is
 * `buildDocsForReader` flattened, so the model is shown nothing this caller
 * could not already open — the permission work is B635's and B890's and is
 * not repeated or reinterpreted here.
 *
 * **Ids in, ids out.** What comes back is looked up in the very list that was
 * sent; anything else is dropped. A model that invents `/quinn/day/venice`
 * would otherwise be inventing a page, and inventing is the one thing this
 * codebase never lets a model do.
 *
 * Cookie only, owner only, bearer refused by construction — `isHelperOwner`.
 */

/** Fifteen minutes. A person hunting for one day tries a handful of
 *  phrasings; a script tries a dictionary. */
const LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/** Whether the button belongs on the page asking — the same probe `ask` has,
 *  and the same answer to a 404: draw nothing at all. */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/search">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/search">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-search", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });
  const said = typeof body.said === "string" ? body.said.trim().slice(0, 300) : "";
  if (said === "") return Response.json({ error: "no_question" }, { status: 400 });
  // Whether a transcriber wrote this rather than a person typing it — B1006.
  // It changes nothing about the search and everything about what a *wrong*
  // answer means: a misheard word is worth proposing a correction for, a typed
  // one is what they meant to type.
  const spoken = body.spoken === true;

  const rows = await searchCatalogueFor(user, request);
  if (rows.length === 0) return Response.json({ hits: [] });

  const locale = await requestLocale();
  const say = sayIn(locale);
  const ledgerRef = `${user}/search/${Date.now()}`;
  if (!(await spend(user, HELPER_TURN_CREDITS, "find_in_journal", ledgerRef))) {
    const balance = (await balanceOf(user)) ?? 0;
    return Response.json({
      suggestion: noCreditsAnswer(say, balance, `/${encodeURIComponent(user)}/account#buy`),
      hits: [],
    });
  }

  let found;
  try {
    found = await findInJournal(
      said,
      rows,
      new Date().toISOString().slice(0, 10),
      user,
      spoken,
    );
  } catch {
    // The credit bought nothing — B1091, the same refund `ask` gives for the
    // identical reason.
    await refund(user, HELPER_TURN_CREDITS, ledgerRef);
    return Response.json({ suggestion: "", hits: [] });
  }
  const byId = new Map(rows.map((row) => [row.id, row]));

  return Response.json({
    // What the model thinks they actually said, where a name in the catalogue
    // is what makes the correction work — B1006. Offered, never applied: a
    // search box that quietly answers a different question is worse than one
    // that finds nothing.
    suggestion: found.suggestion,
    hits: found.hits
      .map((hit) => ({ hit, row: byId.get(hit.id) }))
      .filter(
        (pair): pair is { hit: (typeof found.hits)[number]; row: (typeof rows)[number] } =>
          Boolean(pair.row),
      )
      .map(({ hit, row }) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        where: row.where,
        url: row.url,
        why: hit.why,
      })),
  });
}
