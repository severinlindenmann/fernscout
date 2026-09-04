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

/**
 * One address's hits in one bucket, and the window they are counted over.
 *
 * The window is stored rather than looked up because eviction has to know it.
 * Every bucket on this server shares one map, and they do not share a window:
 * nine of the namespaced ones run fifteen minutes and two run an hour, against
 * the default's ten. A sweep that judged all of them by the default's window
 * deleted the longer ones while they were still counting — which is not
 * housekeeping, it is resetting a limit. B222.
 */
type Bucket = { times: number[]; windowMs: number };

const hits = new Map<string, Bucket>();

/** Above this many buckets, eviction runs. */
const MAX_BUCKETS = 5000;

/**
 * At most one full scan per second.
 *
 * Without it, a map held above the threshold by live traffic re-scans every
 * key on every request — so the moment the counters are under load is the
 * moment each request costs an extra five thousand comparisons. The map can
 * grow by one second's worth of new addresses between scans, which is the
 * trade.
 */
const SWEEP_INTERVAL_MS = 1000;
let lastSweep = 0;

/**
 * Drop buckets whose own window has closed.
 *
 * Called by `take()`, which is the single door both public functions go
 * through — the point of B04. It used to live inside `rateLimit()`, below an
 * early return, so it ran only for the default bucket and only when that
 * bucket said yes. The twelve namespaced callers wrote into this same map and
 * never swept it, and the one caller certain to be hammering an endpoint — the
 * one being refused — was the one that never pruned.
 */
function sweep(now: number) {
  if (hits.size <= MAX_BUCKETS) return;
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of hits) {
    if (bucket.times.every((t) => now - t >= bucket.windowMs)) hits.delete(key);
  }
}

/**
 * One attempt against one bucket.
 *
 * Both `rateLimit` and `rateLimitFor` are this function with different
 * arguments. They were two copies of the same seven lines, and the copies had
 * already drifted: only one of them swept.
 */
function take(
  key: string,
  max: number,
  windowMs: number,
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const recent = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    const retryAfter = Math.ceil((windowMs - (now - recent[0])) / 1000);
    hits.set(key, { times: recent, windowMs });
    sweep(now);
    return { ok: false, retryAfter };
  }

  recent.push(now);
  hits.set(key, { times: recent, windowMs });
  sweep(now);
  return { ok: true, retryAfter: 0 };
}

/**
 * How many buckets are being tracked.
 *
 * Exists so the eviction below can be asserted rather than reasoned about: a
 * sweep is a thing that stops happening silently, and "the map does not grow"
 * is not observable from any response. Read-only, and nothing in the
 * application calls it.
 */
export function trackedBuckets(): number {
  return hits.size;
}

/** Hashed so raw addresses never sit in memory or in a log line. */
function key(ip: string) {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/**
 * A named bucket with its own limits.
 *
 * The default bucket is deliberately generous (see above). Asking for a
 * sign-in code is the opposite situation: a reader needs one or two, and
 * anything beyond that is somebody working through a list of addresses.
 */
export function rateLimitFor(
  namespace: string,
  ip: string,
  options: { max: number; windowMs: number },
): { ok: boolean; retryAfter: number } {
  return take(`${namespace}:${key(ip)}`, options.max, options.windowMs);
}

export function rateLimit(ip: string): { ok: boolean; retryAfter: number } {
  return take(key(ip), MAX_IN_WINDOW, WINDOW_MS);
}

/**
 * The address every limit on this server is keyed by.
 *
 * **Reading the first value here is only safe because the proxy overwrites the
 * header.** `deploy/Caddyfile` sets `header_up X-Forwarded-For {remote_host}`,
 * which replaces whatever the client sent rather than appending to it — which
 * is Caddy's default and was the bug. Without that line a client sends
 * `X-Forwarded-For: 203.0.113.9`, that value lands in first position, and it
 * is what comes back from here: rotate the header per request and every limit
 * keyed on this resets.
 *
 * So the two halves are one mechanism and neither works alone. If this app is
 * ever put behind a different proxy, that proxy must overwrite the header too,
 * or this function has to stop trusting it.
 *
 * Reading the *last* value instead would also defeat a forged prefix, but only
 * while exactly one proxy sits in front; overwriting at the edge survives a
 * second one being added.
 *
 * The docstring here used to say "as seen through nginx", from before Caddy,
 * which is most of why nobody re-checked it.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
