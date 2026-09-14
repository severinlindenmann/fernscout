import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B1696 — a billed send must not be losable to a restart.
 *
 * `CloudTransport.send` is the only place in this codebase that spends real
 * money on a network call, and its record of having done so used to be written
 * *after* Meta answered. A restart in the gap therefore left a charge on the
 * bill and nothing anywhere else — which is not hypothetical: one €0.049
 * MARKETING send is billed in Meta's 2026-09-10 bucket with no matching line
 * in a journal covering the whole of that day without a gap, on a server that
 * restarted around forty-five times a day that fortnight.
 *
 * So the attempt is logged first and the acceptance second, and this test is
 * about that ORDER rather than about either line existing.
 *
 * **Why this reads the source instead of driving the transport.** Reaching
 * `CloudTransport` for real means a server config naming the `cloud` backend,
 * Graph credentials in the environment, a stubbed `fetch`, and a database for
 * `recordWhatsappSend` — four pieces of scaffolding, none of which would be
 * asserting the thing that matters. The regression this guards against is
 * somebody tidying two adjacent `console.log`s back together below the call,
 * and where the line sits relative to `sendTemplate` is exactly what the
 * source says. `test/no-browser-dialogs.test.ts` is the same shape for the
 * same reason.
 */

const SOURCE = path.join(process.cwd(), "lib", "whatsapp", "index.ts");

describe("the cloud transport's record of a billed send", () => {
  test("logs the attempt before the network call, not after it", () => {
    const source = fs.readFileSync(SOURCE, "utf8");

    const attempt = source.indexOf("sending`");
    const call = source.indexOf("await sendTemplate(");
    const accepted = source.indexOf("-> ${id}`");

    expect(attempt, "the attempt line is gone from lib/whatsapp/index.ts").toBeGreaterThan(-1);
    expect(call, "sendTemplate is no longer called here").toBeGreaterThan(-1);
    expect(accepted, "the acceptance line is gone from lib/whatsapp/index.ts").toBeGreaterThan(-1);

    expect(
      attempt,
      "the attempt must be logged BEFORE sendTemplate — a line written only " +
        "after Meta answers is lost on a restart, and the money is not",
    ).toBeLessThan(call);
    expect(accepted, "the wamid is only known after the call").toBeGreaterThan(call);
  });

  test("the two lines are told apart by what they claim", () => {
    const source = fs.readFileSync(SOURCE, "utf8");

    // An attempt that reads like an acceptance is worse than no line at all:
    // the whole point is that a `sending` with no `-> wamid` beside it is
    // visible as a send that may have been billed and never confirmed.
    const attemptLine = source
      .split("\n")
      .find((line) => line.includes("[whatsapp:cloud]") && line.includes("sending`"));

    expect(attemptLine).toBeDefined();
    expect(attemptLine).not.toContain("${id}");
    expect(attemptLine).not.toContain("->");
  });
});
