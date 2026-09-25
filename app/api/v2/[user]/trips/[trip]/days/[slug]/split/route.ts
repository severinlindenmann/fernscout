// POST .../days/{slug}/split — B1903, v2's own door onto
// `splitDayTransactional` (lib/studio/reshapeDay.ts, B1832).
//
// Splits one day's update into two, on the same date — the mechanism D3
// already gave the content model (several updates may share a date,
// distinguished by `time`). Relocates the second half's photographs into a
// new media folder on disk; there is no way to compose this from other v2
// calls without re-uploading them as new print masters, which AGENTS.md
// forbids treating as equivalent to the originals. See the move route's own
// comment for the shared B1892 path-traversal reasoning — this route calls
// the same reshapeDay.ts function and inherits the same guards.
import { daySplitRequest, daySplitResult } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { ok, readDryRun } from "@/lib/api/v2/route";
import { gateReshape, bareSlugOf, reshapeFail } from "@/lib/api/v2/reshapeGate";
import { splitDayTransactional } from "@/lib/studio/reshapeDay";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { slugify } from "@/lib/slug";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/split">) {
  const { user, trip: tripId, slug } = await params;
  const gate = await gateReshape(request, user, slug);
  if (!gate.ok) return gate.response;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = jsonBody.value;
  const result = daySplitRequest.safeParse(parsed);
  if (!result.success) {
    return reshapeFail("invalid_request", "This is not a usable split.", { problems: problemsFrom(result.error) });
  }
  const input = result.data;
  const bareSlug = bareSlugOf(slug);
  // The date never changes on a split (same doc as the original), so the
  // new half's stem shares the prefix the URL's own `{slug}` already
  // carries — this is a preview only; `splitDayTransactional` recomputes
  // the real thing off the stored day, not off this string.
  const datePrefix = slug.slice(0, 10);

  const dryRun = readDryRun(request);
  if (dryRun === null) return reshapeFail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    const previewSecondBare = slugify(input.secondTitle) || "entry";
    return ok(
      daySplitResult.parse({
        ok: true,
        firstSlug: slug,
        secondSlug: `${datePrefix}-${previewSecondBare}`,
        dryRun: true,
      }),
    );
  }

  const split = splitDayTransactional(user, tripId, bareSlug, input);
  if (!split.ok) {
    // Spelled out so every code this route answers with is a literal string
    // here — `test/openapi-v2-contract.test.ts` walks route files for that.
    switch (split.error) {
      case "unknown_trip":
        return reshapeFail("unknown_trip", ERROR_CODES.unknown_trip);
      case "unknown_day":
        return reshapeFail("unknown_day", ERROR_CODES.unknown_day);
      case "title_required":
        return reshapeFail("title_required", ERROR_CODES.title_required);
      case "slug_taken":
        return reshapeFail("slug_taken", ERROR_CODES.slug_taken);
      default: {
        const exhaustive: never = split.error;
        throw new Error(`unhandled split error: ${String(exhaustive)}`);
      }
    }
  }

  return ok(
    daySplitResult.parse({
      ok: true,
      firstSlug: slug,
      secondSlug: `${datePrefix}-${split.newSlug}`,
    }),
  );
}
