// @scans app/api/helper/**
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { routeSource } from "./support/openCore";
import { backFrom, NO_PROSE, isWritten, stepFor, type WizardDraft } from "@/lib/helper/draft";

/**
 * `lib/helper/draft.ts`, and the helper routes' own door guard — B682.
 *
 * Renamed from `test/agent-wizard.test.ts` when B1239 deleted the retired
 * step-wizard component (`components/AgentWizard.tsx`, B1220) — this file
 * never rendered it, and only ever tested `draft.ts` (still live: the day
 * route and WhatsApp dispatch both read it) and the route-guard census
 * below, which is independent of any component.
 *
 * `stepFor`'s state machine has no session row, no persisted position and
 * nothing to migrate, so the only thing that can be wrong is its reading of
 * a draft on disk. A half-written day has to resolve to the same step from
 * any device and after any crash, which is what the first block asserts.
 */

function draft(over: Partial<WizardDraft> = {}): WizardDraft {
  return {
    trip: "a-trip",
    slug: "2026-05-04-a-day",
    date: "2026-05-04",
    title: "2026-05-04",
    photos: 0,
    written: false,
    ...over,
  };
}

describe("where a half-finished day resolves to", () => {
  test("nothing started lands on the trip", () => {
    expect(stepFor(null)).toBe("trip");
  });

  test("a day with no photographs lands on the photographs", () => {
    expect(stepFor(draft())).toBe("photos");
  });

  test("photographs but no words lands on the words", () => {
    expect(stepFor(draft({ photos: 8 }))).toBe("words");
  });

  test("a finished day lands on the preview, never on publish", () => {
    expect(stepFor(draft({ photos: 8, written: true }))).toBe("preview");
  });
});

/**
 * The way back — B769.
 *
 * The audience is somebody who is not sure they pressed the right thing, and
 * the absence of a back button is what turns a small mistake into abandoning
 * the page. It is derived rather than remembered, like everything else here.
 */
describe("where a way back leads", () => {
  test("the first screen has none — absent, not disabled", () => {
    expect(backFrom("trip")).toBeNull();
    // The trip and the date are asked on one screen; see `stepFor`.
    expect(backFrom("date")).toBeNull();
  });

  test("every other step names the one before it", () => {
    expect(backFrom("photos")).toBe("trip");
    expect(backFrom("words")).toBe("photos");
    expect(backFrom("preview")).toBe("words");
    expect(backFrom("publish")).toBe("words");
  });
});

describe("the placeholder a day is created with", () => {
  test("is not mistaken for somebody's words", () => {
    expect(isWritten(NO_PROSE)).toBe(false);
    expect(isWritten("   ")).toBe(false);
    expect(isWritten("The pass was shut.")).toBe(true);
  });
});

/**
 * The helper routes are the browser's door and nobody else's.
 *
 * `isHelperOwner` asks `resolveAccess`, which reads the two cookies and never
 * an `Authorization` header — so a bearer token cannot reach a write surface
 * that `/openapi.json` does not describe. This asserts the property at the
 * source rather than through a request, because a route that grew its own
 * `authenticate` call would pass a request-level test that only tried a cookie.
 */
describe("the helper routes", () => {
  const dir = path.join(import.meta.dirname, "..", "app", "api", "helper");
  const sources = fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("route.ts"))
    .flatMap((file) => routeSource(path.join(dir, file)) ?? []);

  // No literal count here on purpose (B2711) — a hand-kept number fights
  // every merge that adds a route (it has already conflicted on several).
  // Whatever is on disk is guarded; that is the property that matters.
  test("every one of them is guarded", () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toContain("isHelperOwner");
    }
  });

  test("none of them reads a bearer token", () => {
    for (const source of sources) {
      expect(source).not.toContain("authorization");
      expect(source).not.toContain("authenticate(");
    }
  });

  test("none of them can publish except the one that is for it", () => {
    const publishers = sources.filter((source) => source.includes("publishDraft"));
    expect(publishers).toHaveLength(1);
  });
});
