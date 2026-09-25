import { beforeEach, vi } from "vitest";

/**
 * B1947 — finds tests that are only correct until a fixture's end date
 * passes, by running the whole suite with the clock a year forward.
 *
 * Off by default: normal runs never see this file do anything. Set
 * FERNSCOUT_TEST_CLOCK_OFFSET_DAYS (`npm run test:future-clock` sets 365) and
 * every test that does not already take control of `Date` itself gets that
 * offset applied before it runs. A test that fakes its own fixed system time
 * (the shape B1946 introduced) overrides this in its own beforeEach and is
 * unaffected, which is the point — it already pinned its trip's tense.
 */
const offsetDays = Number(process.env.FERNSCOUT_TEST_CLOCK_OFFSET_DAYS ?? "");

if (offsetDays) {
  const offsetMs = offsetDays * 24 * 60 * 60 * 1000;
  const futureNow = () => new Date(Date.now() + offsetMs);

  // Applied here, at module scope, so it is in effect before the test
  // file's own top-level code runs — several fixtures compute a `const
  // TODAY = ...` at import time, and faking the clock only inside
  // `beforeEach` would leave that constant reading the real day while the
  // test itself ran against the offset one.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(futureNow());

  beforeEach(() => {
    if (vi.isFakeTimers()) return; // still faked, or the test file owns it
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(futureNow());
  });
}
