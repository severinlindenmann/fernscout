import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
    .map((file) => fs.readFileSync(path.join(dir, file), "utf8"));

  // Fifteen since B820 added `day/costs` — the receipt a person types in
  // themselves, which is the first thing in this family that writes money.
  // Fourteen since B816 added the takedown — `day/unpublish`, the verb that
  // makes a published day something the browser can still act on.
  // Thirteen before that, since B689 added the four the inbox screen needs: reading a
  // location export, reading a statement's columns, applying the mapping, and
  // taking a file back out again. Before that, nine — B686's `transcribe`
  // beside B687's describe-photos, B685's intent router and the trip its one
  // write intent lands on. The count is
  // spelled out rather than
  // inferred so that the next route has to be thought about here, which is
  // where the guard is asserted — and it earned that on the B685/B687 merge,
  // where two branches built in parallel each updated it to a number that was
  // right on its own branch and wrong on main.
  // Sixteen since B904, which added the search a person asks in their own
  // words — the same gate, the same cookie-only family.
  // Seventeen since B900 added `proposal`, which makes a write tool's fields
  // without a model and tells the conversation that a press went through. It
  // writes nothing itself — the press posts to one of the sixteen above it —
  // and it is in this family because it is the same cookie and the same owner.
  // Eighteen since B915 added `day/attach`, which puts a photograph already
  // waiting in the inbox onto a day — the door the files pane presses, with
  // the same cookie and the same owner check as the seventeen above it.
  // Nineteen since B931 added `invite`, which proposes the guest link that
  // lets somebody who was not on a trip ask to read it. Same cookie, same
  // owner check, and it issues a link and never a grant.
  // Thirty-five, and sixteen of them arrived in one run — the conversation
  // was given the rest of what the API door already had. A trip's own
  // settings (`trip/visibility`, `trip/people`, `trip/tracks`, and the `trip`
  // route's own new PATCH), its money (`trip/rates`, `trip/budget`), who hears
  // about a day (`invite/revoke`, `day/tell-readers`, `channels`), the journal
  // itself (`journal`, `storage/cleanup`, `storage`, `keys`), the printed
  // things (`postcard`, `photobook`), and what is on disk that nobody wants —
  // `day/remove-photo` and `inbox/discard`. The number is not the point; the
  // loop below is. Every one is the same cookie and the same owner check as
  // the nineteen before them.
  // Thirty-seven. Two arrived at once and neither knew about the other:
  // `inbox/[id]/thumbnail` (B1123) hands back a small derivative of a
  // photograph still waiting in the inbox, so the files pane can show one
  // rather than a generic icon; and `sessions` (B1109) is the history panel's
  // own read of `sessionsOf` — the clock icon's door onto the same list
  // `past_conversations` answers from inside the conversation. Same cookie,
  // same owner check, both.
  // Thirty-eight: `inbox` (B1171), the pane's own upload into the inbox —
  // the same validation as the v1 door, behind the room's cookie.
  // Thirty-nine: `account` (B1208), the numbers behind the header's credit
  // chip — balance, month, storage — same cookie, same owner check.
  // Forty: `trip/reminder` (B1219), the evening nudge's own on/off switch —
  // same cookie, same owner check, and a trip-scoped agent token cannot
  // reach it either.
  // Forty-two: `day/undo` (B1218), the swap behind the "Rückgängig" chip, and
  // `day/weather`, the one route the "look the weather up" chip may reach —
  // same cookie, same owner check as the forty before them.
  // Forty-three: `contacts/add-me` (B1393), the press behind `add_contact` —
  // the owner adding themself as a contact, from the name already on this
  // journal. Same cookie, same owner check.
  test("there are forty-three of them, and each is guarded", () => {
    expect(sources).toHaveLength(43);
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
