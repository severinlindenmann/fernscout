import { describe, expect, test } from "vitest";
import { madeWithFor, serverSite } from "@/lib/site";
import type { UserConfig } from "@/lib/config";
import type { Trip } from "@/lib/types";

/**
 * B2485 — the "Made with" line under a journal page is for a page anybody
 * may open. A guest-only trip, a private one, or any trip in a guest-only
 * journal never carries it.
 */
const user = (visibility: "public" | "guest") => ({ visibility }) as UserConfig;
const trip = (visibility: Trip["visibility"]) => ({ visibility }) as Trip;

describe("madeWithFor", () => {
  test("a public trip in a public journal names the instance", () => {
    expect(madeWithFor(user("public"), trip("public"))).toBe(serverSite().name);
  });

  test.each(["guest", "private"] as const)("a %s trip does not", (v) => {
    expect(madeWithFor(user("public"), trip(v))).toBeUndefined();
  });

  test("a guest-only journal does not, whatever its trip says", () => {
    expect(madeWithFor(user("guest"), trip("public"))).toBeUndefined();
  });
});
