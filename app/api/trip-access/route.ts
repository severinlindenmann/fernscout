import { cookies } from "next/headers";
import {
  TRIP_COOKIE_MAX_AGE,
  signTripToken,
  tripCookieName,
  verifyTripPassword,
} from "@/lib/access";
import { rateLimitFor } from "@/lib/rateLimit";
import { getTrip } from "@/lib/trips";

/** Attempts allowed per address before the gate closes for a while. */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const tripId = String(form?.get("trip") ?? "");
  const password = String(form?.get("password") ?? "");

  const limit = rateLimitFor("trip-access", clientIp(request), {
    max: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  });
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "too-many-attempts", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const trip = getTrip(tripId);
  // Same answer whether the trip is missing, public, or the password is wrong:
  // a prober learns nothing about which trips exist or are protected.
  if (!trip || trip.visibility === "public" || !trip.passwordHash) {
    return Response.json({ ok: false, error: "wrong-password" }, { status: 401 });
  }
  if (!verifyTripPassword(password, trip.passwordHash)) {
    console.warn(`[access] failed password attempt for trip "${trip.id}"`);
    return Response.json({ ok: false, error: "wrong-password" }, { status: 401 });
  }

  // The password was right, and we still cannot let them in: signing the
  // cookie needs SESSION_SECRET. Answered as a server fault, because it is
  // one — telling somebody who typed the correct password that it was wrong
  // would send them looking for a mistake they did not make.
  if (!process.env.SESSION_SECRET) {
    console.error(
      `[access] correct password for "${trip.id}" could not be honoured: SESSION_SECRET is not set.`,
    );
    return Response.json({ ok: false, error: "server-misconfigured" }, { status: 503 });
  }

  const jar = await cookies();
  jar.set(tripCookieName(trip.ref), signTripToken(trip), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TRIP_COOKIE_MAX_AGE,
  });
  return Response.json({ ok: true });
}
