import { describe, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { printCrossRate } from "../scripts/update-rates.mjs";

/**
 * B216 — the read-only `--pair`/`--base`/`--on` mode on
 * `scripts/update-rates.mjs`. It exists so an author freezing a trip's
 * `rates:` block has a number to paste rather than inverting the ECB's own
 * convention by hand — and it must never write anything, because a frozen
 * rate is a judgement about what the trip actually cost (docs/currencies.md).
 */

/** A 90-day ECB history document with exactly the days a test names. */
function historyXml(days: Record<string, Record<string, number>>) {
  const cubes = Object.entries(days)
    .map(
      ([date, rates]) =>
        `<Cube time="${date}">` +
        Object.entries(rates)
          .map(([code, rate]) => `<Cube currency="${code}" rate="${rate}"/>`)
          .join("") +
        `</Cube>`,
    )
    .join("");
  return `<?xml version="1.0"?><gesmes:Envelope><Cube>${cubes}</Cube></gesmes:Envelope>`;
}

function fakeFetch(xml: string) {
  return vi.fn().mockResolvedValue({ ok: true, text: async () => xml });
}

describe("printCrossRate", () => {
  test("prints the trip-convention rate and touches no filesystem", async () => {
    // 1 EUR = 36 THB, 1 EUR = 0.94 CHF, on this day -> CHF per 1 THB = 0.94/36.
    const fetchImpl = fakeFetch(historyXml({ "2026-03-14": { THB: 36, CHF: 0.94 } }));
    const log = vi.fn();
    const error = vi.fn();

    const ok = await printCrossRate(
      { pair: "THB", base: "CHF", on: "2026-03-14" },
      { fetchImpl, log, error },
    );

    expect(ok).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // one network read, nothing more
    const printed = String(log.mock.calls[0]?.[0]);
    expect(printed).toContain("CHF per 1 THB");
    expect(printed).toContain("THB: 0.0261111");
  });

  test("falls back to the nearest earlier publication day and says so", async () => {
    // 2026-03-15 is a Sunday in this fixture; only the Friday before published.
    const fetchImpl = fakeFetch(historyXml({ "2026-03-13": { THB: 36, CHF: 0.94 } }));
    const log = vi.fn();

    const ok = await printCrossRate({ pair: "THB", base: "CHF", on: "2026-03-15" }, { fetchImpl, log, error: vi.fn() });

    expect(ok).toBe(true);
    expect(String(log.mock.calls[0]?.[0])).toContain("nearest publication day on or before 2026-03-15");
  });

  test("refuses a date before the window rather than guessing", async () => {
    const fetchImpl = fakeFetch(historyXml({ "2026-03-01": { THB: 36 } }));
    const error = vi.fn();

    const ok = await printCrossRate({ pair: "THB", base: "CHF", on: "2025-01-01" }, { fetchImpl, log: vi.fn(), error });

    expect(ok).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("eurofxref-hist.zip"));
  });

  test("refuses a currency the ECB does not publish", async () => {
    const fetchImpl = fakeFetch(historyXml({ "2026-03-14": { CHF: 0.94 } }));
    const error = vi.fn();

    const ok = await printCrossRate({ pair: "XYZ", base: "CHF", on: "2026-03-14" }, { fetchImpl, log: vi.fn(), error });

    expect(ok).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("does not publish XYZ"));
  });

  test("the CLI refuses a partial --pair/--base/--on and fetches nothing", () => {
    const script = path.join(__dirname, "..", "scripts", "update-rates.mjs");
    const res = spawnSync("node", [script, "--pair", "THB"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("only meaningful together");
  });
});
