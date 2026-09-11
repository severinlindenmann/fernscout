import { describe, expect, it } from "vitest";
import {
  importContactRows,
  MAX_IMPORT_ROWS,
  TooManyRowsError,
  type ImportRow,
} from "../lib/contacts/importRows";
import type { UserConfig } from "../lib/config";

/**
 * Every row a contact import files sends somebody a confirmation mail, so the
 * row count is a bound on letters to strangers, not just on rows in a table.
 *
 * `POST /api/v1/<user>/contacts/import` had that bound from the start.
 * `POST /api/helper/<user>/contacts/import`, added beside it in B1394, did not:
 * the refactor that gave the two doors one write path left the guard behind in
 * one caller, and a background security review found it on deployed code.
 *
 * So the bound moved into the writer, and this is the test that says so. It
 * asserts against `importContactRows` rather than against either route,
 * deliberately — a route-level test would have passed on the unfixed code for
 * the route that happened to have the check, and said nothing about the next
 * door somebody adds.
 */
describe("a contact import is bounded where it is written, not where it is called", () => {
  const config = { defaultLocale: "en" } as unknown as UserConfig;
  const rows = (n: number): ImportRow[] =>
    Array.from({ length: n }, (_, i) => ({
      name: `Person ${i}`,
      email: `person${i}@example.test`,
    }));

  it("refuses more rows than one call may carry, before filing or mailing any of them", async () => {
    await expect(
      importContactRows("nobody", config, rows(MAX_IMPORT_ROWS + 1)),
    ).rejects.toBeInstanceOf(TooManyRowsError);
  });

  it("says how many arrived and what the limit is, so a caller can split the work", async () => {
    // `expect(...).rejects` rather than a catch: a catch widens the type to
    // include the resolved value, and narrowing that back with a cast would
    // make the test pass even if the call had succeeded.
    await expect(importContactRows("nobody", config, rows(500))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TooManyRowsError &&
        error.count === 500 &&
        error.message.includes("500") &&
        error.message.includes(String(MAX_IMPORT_ROWS)),
    );
  });

  it("throws before it reaches the mail, which is the cost being bounded", async () => {
    // `requestContact` and `sendCodeMail` would both need a database and a mail
    // transport. Neither is configured here, so if the guard did not come first
    // this would fail with something other than TooManyRowsError — which is the
    // assertion: nothing downstream ran.
    const error = await importContactRows("nobody", config, rows(51)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TooManyRowsError);
  });

  it("lets a call at exactly the limit through to the writer", async () => {
    // Not a happy-path test: with no database this will fail, and that is the
    // point — it must fail for a reason that is NOT the bound, or the boundary
    // is off by one in the direction that silently refuses honest work.
    const error = await importContactRows("nobody", config, rows(MAX_IMPORT_ROWS)).catch(
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(TooManyRowsError);
  });
});
