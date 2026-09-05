import { arrangeParty } from "@/lib/travellers/layout";
import { renderFigure } from "@/lib/travellers/render";
import { MAX_FIGURES, type Figure } from "@/lib/travellers/vocabulary";
import { parseTravellers } from "@/lib/travellers/parse";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/<user>/travellers/preview?…` — see the figure before writing it.
 *
 * **This is what makes the interview honest.** An agent asks "how would you
 * like to be drawn?", maps the answer onto attributes, and then has to hand
 * back something a person can actually confirm. Reading `skin: medium-deep,
 * hairStyle: braids` down a phone is not confirmation; a picture is. A person
 * cannot agree to a description they cannot see.
 *
 * It is also the reason `lib/travellers/render.ts` is pure. A drawing that
 * lives inside a React component cannot be reached without booting Next, and
 * this route, the component and `scripts/travellers.mjs` all need the same
 * one — otherwise the preview is a second implementation that drifts, and the
 * person confirms one picture and gets another.
 *
 * ## Read-only, and no controls
 *
 * There is no character editor in the browser and there will not be one
 * (decision 24). This answers with an image and nothing else: no form, no
 * state, nothing to press. It is the agent that edits, as everywhere else.
 *
 * ## Two shapes
 *
 *   ?figure={json}    one figure
 *   ?party=[{…},{…}]  a whole party, arranged as the hero would arrange it
 *
 * Open to anyone who can see the journal, because nothing here is stored or
 * read from disk — the caller supplies the figures and gets a picture back.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/travellers/preview">,
) {
  const { user } = await params;
  if (!getUser(user)) {
    return Response.json(
      { error: "no_such_journal", message: `No journal called "${user}".` },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("party") ?? url.searchParams.get("figure");
  if (!raw) {
    return Response.json(
      {
        error: "nothing_to_draw",
        message:
          "Pass ?figure={…} for one traveller or ?party=[{…},{…}] for a group, both as JSON. " +
          "GET /api/v1/" +
          user +
          "/travellers/presets lists every word they take.",
      },
      { status: 400 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json(
      {
        error: "invalid_json",
        message: "figure and party are JSON, and this did not parse. Remember to URL-encode it.",
      },
      { status: 400 },
    );
  }

  // The same reader the trip file goes through, so what the preview draws and
  // what a written trip draws cannot disagree. It fails open, which is right
  // here too: showing somebody a figure with one field defaulted, and saying
  // so, beats refusing to show them anything.
  const figures: Figure[] = parseTravellers(
    Array.isArray(parsed) ? parsed : [parsed],
    "the preview query",
  );
  if (figures.length === 0) {
    return Response.json(
      {
        error: "nothing_to_draw",
        message: `Expected an object, or a list of up to ${MAX_FIGURES} of them.`,
      },
      { status: 400 },
    );
  }

  const size = Math.max(24, Math.min(240, Number(url.searchParams.get("size")) || 106));
  const { placements, width, height } = arrangeParty(figures, size);

  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" ` +
    `height="${height}" viewBox="0 0 ${Math.round(width)} ${height}" role="img" ` +
    `aria-label="${figures.length === 1 ? "an illustrated traveller" : `${figures.length} illustrated travellers`}">` +
    placements
      .map((p) => {
        // Feet on the baseline: the figure is drawn at its own height and then
        // translated down by whatever the composition's height leaves over.
        const top = height - p.bottom - Math.round(size * 1.42) * p.scale;
        return (
          `<g transform="translate(${p.x.toFixed(1)}, ${top.toFixed(1)}) ` +
          `scale(${p.scale})">` +
          renderFigure(p.figure, { width: size, decorative: true }) +
          `</g>`
        );
      })
      .join("") +
    `</svg>`;

  return new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Nothing to cache across callers: the picture is entirely a function of
      // the query, and the query is a draft somebody is still editing.
      "cache-control": "no-store",
    },
  });
}
