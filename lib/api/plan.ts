import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { clearMatterCache } from "../entries";
import { planFilePath } from "../plan";
import { getTrip } from "../trips";
import { quoteScalar } from "../validate/frontmatter";

/**
 * Writing plan.md through the API — B909.
 *
 * `lib/plan.ts` has read this file since W33 and never wrote it; the only
 * way a route existed was typing it by hand, over SSH or with the
 * `add-a-trip` skill on a local checkout — exactly the shape AGENTS.md
 * treats as a defect. This is the write half, mirroring lib/api/costs.ts's
 * `putCosts` in shape: `PUT` replaces the whole file, because a route is
 * short enough that resending it whole is not the burden it would be for
 * costs.md (per the ticket's own decision).
 *
 * `route` and `body` are validated by `lib/validate/plan.ts` before
 * anything here runs — this module only renders what already passed.
 */

type RouteStopInput = {
  location: string;
  country?: string;
  countryCode?: string;
  lat: number;
  lng: number;
  note?: string;
};

export type PlanFileInput = {
  route?: RouteStopInput[];
  body?: string;
};

export type PlanWriteResult = { ok: true } | { ok: false; error: string; bug?: true };

/**
 * The `route:` list, one stop per line, flow style — the same shape
 * `content/example/**\/plan.md` already uses, so a hand-written file and one
 * this writes look the same.
 */
function routeLines(route: RouteStopInput[] | undefined): string[] {
  if (!route || route.length === 0) return [];
  const items = route.map((stop) => {
    const fields = [
      `location: ${quoteScalar(stop.location)}`,
      ...(stop.country ? [`country: ${quoteScalar(stop.country)}`] : []),
      ...(stop.countryCode ? [`countryCode: ${quoteScalar(stop.countryCode.toUpperCase())}`] : []),
      `lat: ${stop.lat}`,
      `lng: ${stop.lng}`,
      ...(stop.note ? [`note: ${quoteScalar(stop.note)}`] : []),
    ];
    return `  - { ${fields.join(", ")} }`;
  });
  return ["route:", ...items];
}

/**
 * The write just made, read back — or a sentence saying what is wrong with
 * it. Same instinct as `costsDoesNotReadBack` (lib/api/costs.ts): `quoteScalar`
 * cannot emit YAML that fails to parse, but this still confirms it did.
 */
function planDoesNotReadBack(file: string): string | null {
  try {
    matter(fs.readFileSync(file, "utf8"));
    return null;
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    clearMatterCache();
    return `its frontmatter does not parse (${said})`;
  }
}

/** Create or wholly replace a trip's plan.md — `PUT .../plan`. */
export function putPlan(ref: string, input: PlanFileInput): PlanWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const file = planFilePath(ref);
  const lines = ["---", ...routeLines(input.route), "---", "", (input.body ?? "").trim(), ""];

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));

  const unreadable = planDoesNotReadBack(file);
  if (unreadable) {
    return {
      ok: false,
      bug: true,
      error: `The plan was written but ${unreadable}. This is a bug; please report it.`,
    };
  }
  return { ok: true };
}
