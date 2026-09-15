import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  EXTENSION_MS, WARNED_GRACE_MS, expiryActionFor, extendOnTouch, resumeExpiryState, spentOnRun,
} from "@/lib/staging/expiry";
import type { RunManifest } from "@/lib/staging/manifest";

// `spentOnRun` reads through `lib/credits.ts`, whose `spend`/`grant` both
// refuse outright unless the `credits` capability is on (`creditsEnabled`).
// Nothing else in this file touches capabilities at all, so this stays on
// for the whole file rather than only the one describe block that needs it.
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));

const run = (over: Partial<RunManifest> = {}): RunManifest => ({
  version: 1, runId: "run-1", owner: "alex",
  createdAt: "2026-09-15T04:00:00Z",
  expiresAt: "2026-09-17T04:00:00Z",
  tripId: null, mode: "type", state: "telling", photos: [], days: [], ...over,
});

describe("when a run is warned", () => {
  test("nothing happens in the first 24 hours", () => {
    expect(expiryActionFor(run(), new Date("2026-09-15T23:00:00Z")).do).toBe("nothing");
  });

  test("past 24 hours old it warns, and offers the extension", () => {
    const action = expiryActionFor(run(), new Date("2026-09-16T05:00:00Z"));
    expect(action).toMatchObject({ do: "warn", hoursLeft: 24, canExtend: true });
  });

  test("the warning pins expiry to exactly 24 hours after the warning, not to createdAt + 48h", () => {
    // Uploaded at 02:00, nightly pass at 03:00 the next night: 25 hours have
    // passed, so 23 hours of the original 48 are left. Without the pin the
    // mail would promise 24 and mean 23; with it, the promise is true.
    //
    // (createdAt is overridden 2h earlier than the shared fixture's default
    // purely so this run is already past WARN_AFTER_MS at the chosen `now` —
    // nothing asserted below depends on createdAt, only on `now`.)
    const action = expiryActionFor(run({ createdAt: "2026-09-15T02:00:00Z" }), new Date("2026-09-16T03:00:00Z"));
    expect(action).toMatchObject({ do: "warn" });
    if (action.do !== "warn") throw new Error("unreachable");
    expect(action.expiresAt).toBe("2026-09-17T03:00:00.000Z");
    expect(action.hoursLeft).toBe(24);
  });

  test("a warned run is never warned twice", () => {
    const warned = run({ warnedAt: "2026-09-16T03:00:00Z", expiresAt: "2026-09-17T03:00:00Z" });
    expect(expiryActionFor(warned, new Date("2026-09-16T23:00:00Z")).do).toBe("nothing");
  });
});

describe("when a run is continued", () => {
  test("continuing after the warning buys 48 hours, once", () => {
    const warned = run({ warnedAt: "2026-09-16T03:00:00Z", expiresAt: "2026-09-17T03:00:00Z" });
    const now = new Date("2026-09-16T20:00:00Z");
    const extended = extendOnTouch(warned, now);
    expect(extended?.expiresAt).toBe(new Date(now.getTime() + EXTENSION_MS).toISOString());
    expect(extended?.extendedAt).toBe(now.toISOString());
    // A second touch changes nothing at all.
    expect(extendOnTouch(extended!, new Date("2026-09-17T09:00:00Z"))).toBeNull();
  });

  test("continuing before any warning changes nothing — the 48 hours are still running", () => {
    expect(extendOnTouch(run(), new Date("2026-09-15T10:00:00Z"))).toBeNull();
  });

  test("an extended run gets one final notice and no second offer", () => {
    const extended = run({
      warnedAt: "2026-09-16T03:00:00Z",
      extendedAt: "2026-09-16T20:00:00Z",
      expiresAt: "2026-09-18T20:00:00Z",
    });
    const action = expiryActionFor(extended, new Date("2026-09-17T21:00:00Z"));
    expect(action).toMatchObject({ do: "final-notice" });
  });
});

/**
 * The resume screen's own three states — B1751 Task 4.3. Pure, same as
 * everything else in this file: `resumeExpiryState` takes only the manifest
 * and one boolean (has this exact request just extended it), never a clock
 * or the filesystem.
 */
describe("resumeExpiryState — the three sentences the resume screen can say", () => {
  test("not yet warned — no deadline to name, just the clock", () => {
    expect(resumeExpiryState(run(), false)).toEqual({ kind: "notWarned" });
  });

  test("warned, and this request is what just extended it", () => {
    const warnedAt = "2026-09-16T03:00:00Z";
    const extended = run({ warnedAt, extendedAt: "2026-09-16T03:00:01Z", expiresAt: "2026-09-18T03:00:01Z" });
    const state = resumeExpiryState(extended, true);
    expect(state).toEqual({
      kind: "justExtended",
      hadUntil: new Date(Date.parse(warnedAt) + WARNED_GRACE_MS).toISOString(),
      until: extended.expiresAt,
    });
  });

  test("already extended, before this request — no fresh 'just came back' framing", () => {
    const extended = run({
      warnedAt: "2026-09-16T03:00:00Z",
      extendedAt: "2026-09-16T04:00:00Z",
      expiresAt: "2026-09-18T04:00:00Z",
    });
    expect(resumeExpiryState(extended, false)).toEqual({ kind: "extended", until: extended.expiresAt });
  });

  test("the three states are three different shapes, not the same message dressed up", () => {
    const notWarned = resumeExpiryState(run(), false);
    const justExtended = resumeExpiryState(
      run({ warnedAt: "2026-09-16T03:00:00Z", extendedAt: "2026-09-16T03:00:01Z", expiresAt: "2026-09-18T03:00:01Z" }),
      true,
    );
    const extended = resumeExpiryState(
      run({ warnedAt: "2026-09-16T03:00:00Z", extendedAt: "2026-09-16T04:00:00Z", expiresAt: "2026-09-18T04:00:00Z" }),
      false,
    );
    const kinds = new Set([notWarned.kind, justExtended.kind, extended.kind]);
    expect(kinds.size).toBe(3);
  });
});

/**
 * `spentOnRun` — the number the expiry warning tells somebody they are
 * about to lose (`lib/staging/expiry.ts`'s own `sendExpiryMail`). Needs a
 * real database, unlike everything else in this file: it reads the ledger
 * through `lib/credits.ts`, which refuses outright with nowhere to record
 * one (see that module's own doc comment), so a real sqlite file is what
 * lets the match and non-match paths actually run.
 */
describe("spentOnRun — what the expiry warning tells somebody they are about to lose", () => {
  let dbDir: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-staging-expiry-"));
    process.env.DATABASE_URL = `sqlite:${path.join(dbDir, "test.db")}`;
    const { getDatabase } = await import("@/lib/db");
    const { migrateToLatest } = await import("@/lib/db/migrate");
    await migrateToLatest(await getDatabase());
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/lib/db");
    await closeDatabase();
    delete process.env.DATABASE_URL;
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  test("sums every spend under this run's own ref, across more than one enrich (R30's widened ref)", async () => {
    const { grant, spend } = await import("@/lib/credits");
    await grant("alex", 10, "test");
    // Two `extract/enrich` calls on the same run, two different photo-set
    // hashes (a resume that added photographs between them) — both must
    // count.
    await spend("alex", 3, "helper", "extract:run-abc:aaa111");
    await spend("alex", 2, "helper", "extract:run-abc:bbb222");
    expect(await spentOnRun("alex", "run-abc")).toBe(5);
  });

  test("does not match a different run whose id is a text prefix of this one's", async () => {
    const { grant, spend } = await import("@/lib/credits");
    await grant("alex", 10, "test");
    await spend("alex", 3, "helper", "extract:run-abc:aaa111"); // the run under test
    // A different run whose id happens to start with "run-abc" — the
    // trailing colon in the prefix match is what has to keep this out.
    // `newRunId` (lib/staging/paths.ts) always produces a fixed-length
    // ISO-timestamp id, so two *real* run ids can never actually collide
    // like this — this constructs the case by hand to prove the boundary
    // logic holds regardless of whether the generator can reach it.
    await spend("alex", 4, "helper", "extract:run-abc-2:zzz999");
    expect(await spentOnRun("alex", "run-abc")).toBe(3);
  });

  test("a run with nothing spent reports zero, not undefined or a crash", async () => {
    expect(await spentOnRun("alex", "run-nothing-spent")).toBe(0);
  });
});
