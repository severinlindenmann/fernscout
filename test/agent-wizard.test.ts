import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NO_PROSE, isWritten, stepFor, type WizardDraft } from "@/lib/helper/draft";

/**
 * The wizard at `/agent/<user>` — B682.
 *
 * The whole of its state machine is `stepFor`, and that is the point: there is
 * no session row, no persisted position and nothing to migrate, so the only
 * thing that can be wrong is this function's reading of a draft on disk. A
 * half-written day has to resolve to the same step from any device and after
 * any crash, which is what the first block asserts.
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
    .map((file) => fs.readFileSync(path.join(dir, file), "utf8"));

  // Thirteen since B689 added the four the inbox screen needs: reading a
  // location export, reading a statement's columns, applying the mapping, and
  // taking a file back out again. Before that, nine — B686's `transcribe`
  // beside B687's describe-photos, B685's intent router and the trip its one
  // write intent lands on. The count is
  // spelled out rather than
  // inferred so that the next route has to be thought about here, which is
  // where the guard is asserted — and it earned that on the B685/B687 merge,
  // where two branches built in parallel each updated it to a number that was
  // right on its own branch and wrong on main.
  test("there are thirteen of them, and each is guarded", () => {
    expect(sources).toHaveLength(13);
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

/**
 * B711 — the preview card kept saying "Draft — not on the site yet" after a
 * successful publish, because `preview.day` is read once before publishing
 * and carries `draft: true` on every entry; nothing re-fetched it once
 * `publishedUrl` was set, so the outcome panel below said "It is on the
 * site." while the card above it still said the opposite.
 *
 * Asserted at the source, in the style of `test/agent-shell.test.ts`: there is
 * no component-render harness in this suite, and what matters is that the
 * card's own render guard excludes the published state, not what a snapshot
 * looks like.
 */
describe("the preview card, once published", () => {
  test("is no longer shown once the outcome panel takes over", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "components", "AgentWizard.tsx"),
      "utf8",
    );
    expect(source).toContain("preview && !publishedUrl");
  });
});
