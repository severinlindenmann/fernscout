// Validates a trip's plan.md contents — the intended route, as a list of
// stops — before it becomes a file. B909.
//
// Pure, like lib/validate/costs.ts beside it: no fs, so this is testable with
// a plain object literal and shared between the REST route and any future
// caller without dragging the filesystem in.
//
// Each stop is the shape `lib/plan.ts` already reads off `plan.md`'s
// `route:` list (`RawStop`, mirrored here as `RouteStopInput`) — location and
// country are names a person wrote, lat/lng are a real coordinate, and
// countryCode/note are optional. `location` and `lat`/`lng` are the fields a
// stop cannot do without: a plan the map cannot place is not a plan.
import { describe, type Problem } from "./entry";

const COUNTRY_CODE_RE = /^[A-Za-z]{2}$/;

type RouteStopInput = {
  location?: unknown;
  country?: unknown;
  countryCode?: unknown;
  lat?: unknown;
  lng?: unknown;
  note?: unknown;
};

function checkStop(raw: unknown, i: number, problems: Problem[]): void {
  const stop = (raw && typeof raw === "object" ? raw : {}) as RouteStopInput;
  const prefix = `route[${i}]`;

  if (typeof stop.location !== "string" || stop.location.trim() === "") {
    problems.push({
      field: `${prefix}.location`,
      got: describe(stop.location),
      expected: "a non-empty string — the name of the stop, as a person would write it",
    });
  }
  if (stop.country !== undefined && typeof stop.country !== "string") {
    problems.push({ field: `${prefix}.country`, got: describe(stop.country), expected: "a string" });
  }
  if (stop.countryCode !== undefined) {
    if (typeof stop.countryCode !== "string" || !COUNTRY_CODE_RE.test(stop.countryCode)) {
      problems.push({
        field: `${prefix}.countryCode`,
        got: describe(stop.countryCode),
        expected: "an ISO 3166-1 alpha-2 code, e.g. CH — two letters",
      });
    }
  }
  if (typeof stop.lat !== "number" || !Number.isFinite(stop.lat) || stop.lat < -90 || stop.lat > 90) {
    problems.push({ field: `${prefix}.lat`, got: describe(stop.lat), expected: "-90 to 90" });
  }
  if (typeof stop.lng !== "number" || !Number.isFinite(stop.lng) || stop.lng < -180 || stop.lng > 180) {
    problems.push({ field: `${prefix}.lng`, got: describe(stop.lng), expected: "-180 to 180" });
  }
  if (stop.note !== undefined && typeof stop.note !== "string") {
    problems.push({ field: `${prefix}.note`, got: describe(stop.note), expected: "a string" });
  }
}

function checkRoute(raw: unknown, problems: Problem[]): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    problems.push({
      field: "route",
      got: describe(raw),
      expected: "a list of stops: {location, lat, lng, country?, countryCode?, note?}",
    });
    return;
  }
  raw.forEach((stop, i) => checkStop(stop, i, problems));
}

function checkBody(raw: unknown, problems: Problem[]): void {
  if (raw === undefined) return;
  if (typeof raw !== "string") {
    problems.push({ field: "body", got: describe(raw), expected: "a string — the trip's own prose about the route" });
  }
}

export type PlanInput = { route?: unknown; body?: unknown };

/**
 * `PUT .../plan` — the whole file. Both fields are optional: an empty or
 * absent `route` writes a plan.md with no stops yet (or none at all, if
 * `body` is absent too), the same way an absent `costs` list does on
 * costs.md. What is checked, when a stop is given, is that it is a real
 * place a map can plot — see `checkStop`.
 */
export function validatePlanPut(input: PlanInput): Problem[] {
  const problems: Problem[] = [];
  checkRoute(input.route, problems);
  checkBody(input.body, problems);
  return problems;
}
