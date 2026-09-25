import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * B1921 — the staged-contacts review had no studio equivalent, so
 * `NonPhotoImport`'s `contacts` kind pointed at `/agent` to finish. Decision:
 * `/[user]/studio/people` (`PeopleFlow`, B1823) already reads a vCard, shows
 * every row with its reason before anything is written, and files the rows
 * — the whole job that screen only ever staged. So the `contacts` kind and
 * `/[user]/studio/contacts` retire rather than gaining a second build of the
 * same review.
 *
 * Proves the two runtime halves of that decision: the old page is gone, and
 * both of its addresses now redirect to `/[user]/studio/people` rather than
 * dead-ending anywhere (an unlinked superseded route is worse than none).
 */
describe("studio/contacts is retired in favour of studio/people", () => {
  test("the page file no longer exists", () => {
    const pagePath = path.join(process.cwd(), "app/[user]/studio/contacts/page.tsx");
    expect(existsSync(pagePath)).toBe(false);
  });

  test("both its old addresses redirect to /:user/studio/people", async () => {
    const config = (await import("../next.config")).default;
    const redirects = await config.redirects!();

    const fromStudio = redirects.find((r) => r.source === "/:user/studio/contacts");
    expect(fromStudio?.destination).toBe("/:user/studio/people");

    const fromExtract = redirects.find((r) => r.source === "/:user/extract/contacts");
    expect(fromExtract?.destination).toBe("/:user/studio/people");
  });
});
