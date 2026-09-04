import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { rateLimit, rateLimitFor, trackedBuckets } from "@/lib/rateLimit";

/**
 * B04 — the counters, and what removes them.
 *
 * `lib/rateLimit.ts` keeps every bucket in one module-level map, which is an
 * honest choice for one Node process on one VPS and is not what this file is
 * about. What it is about is eviction, which was written into `rateLimit()`
 * only — the *default* bucket, used by two endpoints — while the twelve
 * namespaced callers wrote into the same map and never swept it.
 *
 * The map is shared between these tests because the module is. They run in one
 * file, in order, and each one moves the clock far enough that the last one's
 * keys are expired rather than merely old.
 */

/**
 * A bucket per fill, so the count assertions below are about eviction and not
 * about which test ran first.
 */
function fillDefault(count: number, offset = 0) {
  for (let i = 0; i < count; i++) {
    const n = i + offset;
    rateLimit(`10.${Math.floor(n / 62500) % 250}.${Math.floor(n / 250) % 250}.${n % 250}`);
  }
}

const HOURLY = { max: 5, windowMs: 60 * 60 * 1000 };
const QUARTER_HOUR = { max: 20, windowMs: 15 * 60 * 1000 };

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T00:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("the limits themselves", () => {
  test("a household sharing one address stays well inside the default bucket", () => {
    // Sixty in ten minutes, which is far more than a family reacting to the
    // same day from one hostel wifi. The limit must not have moved.
    for (let i = 0; i < 60; i++) {
      expect(rateLimit("203.0.113.50").ok, `attempt ${i + 1}`).toBe(true);
    }
    const refused = rateLimit("203.0.113.50");
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(600);
  });

  test("a namespaced bucket keeps its own max and its own window", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimitFor("journals-create", "203.0.113.51", HOURLY).ok).toBe(true);
    }
    expect(rateLimitFor("journals-create", "203.0.113.51", HOURLY).ok).toBe(false);
    // Ten minutes is the *default* window, and it is not this bucket's.
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(rateLimitFor("journals-create", "203.0.113.51", HOURLY).ok).toBe(false);
    // The hour is.
    vi.advanceTimersByTime(50 * 60 * 1000);
    expect(rateLimitFor("journals-create", "203.0.113.51", HOURLY).ok).toBe(true);
  });
});

describe("eviction", () => {
  test("a namespaced bucket prunes expired keys with no rateLimit() call at all", () => {
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    // Past the threshold, entirely through the door twelve callers use.
    for (let i = 0; i < 5100; i++) {
      rateLimitFor("auth-verify", `198.51.100.${i}`, QUARTER_HOUR);
    }
    expect(trackedBuckets()).toBeGreaterThan(5000);

    // Every one of those windows has closed.
    vi.advanceTimersByTime(16 * 60 * 1000);
    rateLimitFor("auth-verify", "192.0.2.7", QUARTER_HOUR);

    // Before B04 this stayed above 5000 for as long as the process lived,
    // unless something happened to call the default bucket.
    expect(trackedBuckets()).toBe(1);
  });

  test("a bucket whose own window is still open is not swept away by a shorter one", () => {
    /**
     * The reason the sweep could not simply be shared as it stood, and a
     * bypass in its own right — captured as B222.
     *
     * Eviction tested `now - t >= WINDOW_MS`, the *default* ten minutes, against
     * every key in the map. Nine of the twelve namespaced buckets run a
     * fifteen-minute window and two run an hour, so an hourly limit looked
     * expired after eleven minutes and was deleted — resetting it. Filling the
     * map past the threshold is what triggers the scan, and 5000 distinct
     * addresses is a morning's work for anybody with an IPv6 allocation.
     */
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      expect(rateLimitFor("journals-create", "203.0.113.99", HOURLY).ok).toBe(true);
    }
    expect(rateLimitFor("journals-create", "203.0.113.99", HOURLY).ok).toBe(false);

    // Past the default window, nowhere near this bucket's own.
    vi.advanceTimersByTime(11 * 60 * 1000);
    // And now make the map big enough that a sweep runs.
    fillDefault(5100, 100_000);

    // Still refused. Fifty minutes of the hour are left.
    expect(rateLimitFor("journals-create", "203.0.113.99", HOURLY).ok).toBe(false);
  });

  test("a refusal sweeps too — the caller filling the map is the refused one", () => {
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    // One address over its own limit, and a map full of keys that have expired.
    for (let i = 0; i < 5100; i++) {
      rateLimitFor("auth-signup", `198.51.100.${i}`, QUARTER_HOUR);
    }
    vi.advanceTimersByTime(16 * 60 * 1000);
    for (let i = 0; i < 20; i++) rateLimitFor("auth-signup", "192.0.2.8", QUARTER_HOUR);
    const refused = rateLimitFor("auth-signup", "192.0.2.8", QUARTER_HOUR);
    expect(refused.ok).toBe(false);
    // The sweep used to sit below an early return, so the one caller
    // guaranteed to be hammering the endpoint was the one that never pruned.
    expect(trackedBuckets()).toBe(1);
  });
});
