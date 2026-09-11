import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PHOTOBOOK_OUTCOME_STATES } from "@/lib/photobook/orders";

/**
 * B484 — a narrow gap in the order-outcome page.
 *
 * `OUTCOME_MESSAGE` in `PhotobookPageContent.tsx` used to be typed
 * `Record<string, TranslationKey>`, so it could fall out of step with the
 * states `order/route.ts` actually sends without the compiler noticing —
 * exactly the drift `test/locales.test.ts`'s B529 case checks for
 * `TranslationKey` itself. It is now an exact `Record` over
 * `PhotobookOutcomeState`, so `tsc` refuses the file if a state is added
 * there without its message here, or if a stale entry (the now-unreachable
 * `"refund_failed"`, from before B509) is left behind. This test parses the
 * source the same way B529 does, so the check still runs under `--quick`,
 * which skips the typecheck.
 *
 * B484's other half — a success panel that could render with no download
 * links — no longer applies: since B1365 a finished order redirects
 * straight to its own receipt page (`/<user>/photobooks/<id>`) rather than
 * back through this panel, so there is no success state here to test.
 */

describe("OUTCOME_MESSAGE covers every state — B484", () => {
  test("its keys are exactly PHOTOBOOK_OUTCOME_STATES", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "app",
        "[user]",
        "(trip)",
        "photobook",
        "PhotobookPageContent.tsx",
      ),
      "utf8",
    );
    const start = source.indexOf("const OUTCOME_MESSAGE");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("\n};", start));
    const declared = [...block.matchAll(/^\s*([a-z_]+):\s*"photobook\./gm)].map((m) => m[1]);

    expect(declared.sort()).toEqual([...PHOTOBOOK_OUTCOME_STATES].sort());
  });
});
