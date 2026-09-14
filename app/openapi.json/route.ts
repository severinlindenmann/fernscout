import { serverSite } from "@/lib/site";

/**
 * The retired v1 machine contract — B1734.
 *
 * This used to be the only published contract for `/api/auth/**` — the
 * sign-in flow every client, v2 included, needs to get a token — plus the
 * two v1 routes that outlived v1 (`track`, `deletions/{token}`), `/api/health`
 * and the markdown twins. Retiring it before the auth surface had anywhere
 * else to live would have left a client able to read every write door in
 * `/api/v2/openapi.json` and no way to obtain the credential they all
 * require — worse than the trap it already was: `fernscout-helper` cached
 * this exact document, reported discovery a success, and then answered 404
 * on every call it made (B1715).
 *
 * Now that the auth doors and the two surviving v1 routes have moved into
 * `/api/v2/openapi.json` (generated from `lib/api/v2/schemas/`, which
 * cannot drift from the routes the way a second hand-written document can),
 * there is nothing left here to serve. Same reasoning as
 * `/content-model.json` (B1700) and a deleted journal's own 410
 * (`lib/deletions.ts`): a thing that used to be here is not a typo, so this
 * is 410, not 404, and not a silent deletion.
 */
export function GET() {
  const site = serverSite().url;
  return Response.json(
    {
      error: "gone",
      message:
        "This document is retired. It used to be the only published contract for signing in " +
        "(/api/auth/**) and for the two v1 routes that outlived v1 — both have since moved into " +
        `${site}/api/v2/openapi.json, which is generated from the same Zod schemas the routes ` +
        `actually parse with. Read that instead. The prose guides are at ${site}/skill/*.md.`,
      replacedBy: `${site}/api/v2/openapi.json`,
    },
    { status: 410, headers: { "Cache-Control": "public, max-age=300" } },
  );
}
