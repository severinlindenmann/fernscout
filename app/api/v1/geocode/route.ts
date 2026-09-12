import { authenticate, errorResponse } from "@/lib/api/auth";
import { checkAgainstContract } from "@/lib/api/contract";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import {
  geocodePlace,
  MAX_QUERY_LEN,
  MIN_QUERY_LEN,
  type GeocodeContextCoordinate,
} from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import { rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const PATH = "/api/v1/geocode";

type Problem = {
  field: string;
  got: string;
  expected: string;
  hint?: string;
};

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "string" ? JSON.stringify(value) : typeof value;
}

function validateContextCoordinates(value: unknown): {
  coordinates: GeocodeContextCoordinate[];
  problems: Problem[];
} {
  if (value === undefined) return { coordinates: [], problems: [] };
  if (!Array.isArray(value)) {
    return {
      coordinates: [],
      problems: [
        {
          field: "contextCoordinates",
          got: describe(value),
          expected: "an array of { lat, lng } objects",
        },
      ],
    };
  }

  const problems: Problem[] = [];
  const coordinates: GeocodeContextCoordinate[] = [];
  value.forEach((entry, index) => {
    const field = `contextCoordinates[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push({ field, got: describe(entry), expected: "an object with lat and lng numbers" });
      return;
    }
    const lat = (entry as { lat?: unknown }).lat;
    const lng = (entry as { lng?: unknown }).lng;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      problems.push({ field: `${field}.lat`, got: describe(lat), expected: "a number from -90 to 90" });
    }
    if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      problems.push({ field: `${field}.lng`, got: describe(lng), expected: "a number from -180 to 180" });
    }
    if (
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      lat >= -90 &&
      lat <= 90 &&
      typeof lng === "number" &&
      Number.isFinite(lng) &&
      lng >= -180 &&
      lng <= 180
    ) {
      coordinates.push({ lat, lng });
    }
  });

  return { coordinates, problems };
}

/**
 * Turn a place name into candidate coordinates for a day.
 *
 * Returns a shortlist, never a single silent guess: ambiguous names are the
 * whole reason this exists. The caller asks the person which candidate they
 * meant; this route only does the lookup and the ranking.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const username = auth.session.owner;
  if (!isEnabled("addressLookup", username)) {
    return Response.json(
      { error: "address_lookup_disabled", message: ERROR_CODES.address_lookup_disabled },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      {
        error: "invalid_json",
        message: `${ERROR_CODES.invalid_json} This route expects a JSON object with at least \`query\`.`,
      },
      { status: 400 },
    );
  }

  const shape = checkAgainstContract(PATH, "post", body);
  const problems: Problem[] = [...shape.problems];

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < MIN_QUERY_LEN) {
    problems.push({
      field: "query",
      got: JSON.stringify(query),
      expected: `at least ${MIN_QUERY_LEN} characters`,
      hint: "A place this short is refused before the provider is asked.",
    });
  }
  if (query.length > MAX_QUERY_LEN) {
    problems.push({
      field: "query",
      got: `${query.length} characters`,
      expected: `at most ${MAX_QUERY_LEN} characters`,
    });
  }

  const countryHint = typeof body.countryHint === "string" ? body.countryHint.trim() : undefined;
  const regionHint = typeof body.regionHint === "string" ? body.regionHint.trim() : undefined;
  const context = validateContextCoordinates(body.contextCoordinates);
  problems.push(...context.problems);

  if (problems.length > 0) {
    return Response.json({ error: "invalid_request", problems }, { status: 400 });
  }

  const limit = rateLimitFor("place-geocode", username, {
    max: 1,
    windowMs: 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const locale = request.headers.get("accept-language")?.split(",")[0]?.trim().split("-")[0] ?? "en";
  const results = await geocodePlace(query, locale, {
    countryHint: countryHint || undefined,
    regionHint: regionHint || undefined,
    contextCoordinates: context.coordinates,
  });
  if (results === null) {
    return Response.json(
      {
        error: "provider_unavailable",
        message:
          "The geocoding provider could not be reached, or answered something unusable. Ask the " +
          "person for coordinates directly, or retry in a moment.",
      },
      { status: 502 },
    );
  }

  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
