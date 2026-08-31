import "server-only";
import { createHash } from "node:crypto";

/**
 * A crude in-memory rate limit, used only to stop a script hammering the
 * reaction endpoint.
 *
 * Deliberately *not* an identity check. Everyone in one house — or on one
 * hostel wifi — shares an address, and on a family travel blog that is exactly
 * the group most likely to react to the same day within a minute of each
 * other. The limit is set well above what a household could produce by hand.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_IN_WINDOW = 60;

const hits = new Map<string, number[]>();

/** Hashed so raw addresses never sit in memory or in a log line. */
function key(ip: string) {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/**
 * A named bucket with its own limits.
 *
 * The default bucket is deliberately generous (see above). Guessing a trip
 * password is the opposite situation: a household will try it once or twice,
 * and anything beyond that is someone working through a word list.
 */
export function rateLimitFor(
  namespace: string,
  ip: string,
  options: { max: number; windowMs: number },
): { ok: boolean; retryAfter: number } {
  const k = `${namespace}:${key(ip)}`;
  const now = Date.now();
  const recent = (hits.get(k) ?? []).filter((t) => now - t < options.windowMs);

  if (recent.length >= options.max) {
    const retryAfter = Math.ceil((options.windowMs - (now - recent[0])) / 1000);
    hits.set(k, recent);
    return { ok: false, retryAfter };
  }
  recent.push(now);
  hits.set(k, recent);
  return { ok: true, retryAfter: 0 };
}

export function rateLimit(ip: string): { ok: boolean; retryAfter: number } {
  const k = key(ip);
  const now = Date.now();
  const recent = (hits.get(k) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_IN_WINDOW) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    hits.set(k, recent);
    return { ok: false, retryAfter };
  }

  recent.push(now);
  hits.set(k, recent);

  // Opportunistic cleanup so the map can't grow without bound.
  if (hits.size > 5000) {
    for (const [k2, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(k2);
    }
  }

  return { ok: true, retryAfter: 0 };
}

/** Client address as seen through nginx. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
