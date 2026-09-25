import { serverSite } from "@/lib/site";

/**
 * The retired file-shape document — B1700.
 *
 * This used to publish the shape of a journal on disk: which files, which
 * keys, which call wrote each one. It was written for v1's folder of Markdown
 * with frontmatter, and v2 changed all three halves of that — the files are
 * JSON, a trip is one document rather than three, and every optional section
 * is asked-or-declined. The document was patched once (its `doors`, B1676) and
 * drifted again within the day: it went on naming `trip.md`, `costs.md` and
 * `entries/*.md`, and advertising `POST .../trips` and `POST .../days`, two
 * calls that do not exist. A real migration followed it and had to write every
 * call by hand.
 *
 * A second hand-maintained contract beside the generated one is what produced
 * that, so it is not being re-typed for v2: `/api/v2/openapi.json` is
 * generated from the same Zod schemas the routes parse with, which makes the
 * drift this document kept suffering structurally impossible.
 *
 * **410, not 404, and not a silent deletion.** A client fetching this is a
 * program, and "gone, here is what replaced it" is the difference between a
 * port and a mystery. Same reasoning as a deleted journal's own 410
 * (lib/deletions.ts): a thing that used to be here is not a typo.
 */
export function GET() {
  const site = serverSite().url;
  return Response.json(
    {
      error: "gone",
      message:
        "This document is retired. It described a journal's files as v1 kept them — " +
        "trip.md, costs.md, entries/*.md, frontmatter — and none of that is how a journal " +
        "is stored any more: content on disk is JSON, a trip is one document with costs and " +
        "plan as sections of it, and every optional section is either sent or named in " +
        "`declined` with a reason. Read the contract that is generated from the schemas the " +
        "routes actually parse with, which cannot drift from them: " +
        `${site}/api/v2/openapi.json. The guides at ${site}/skill/ say the same things in prose.`,
      replacedBy: `${site}/api/v2/openapi.json`,
    },
    { status: 410, headers: { "Cache-Control": "public, max-age=300" } },
  );
}
