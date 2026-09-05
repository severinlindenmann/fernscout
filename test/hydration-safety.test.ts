import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B454 — nothing may read a browser store while rendering.
 *
 * The server has no `localStorage`, `sessionStorage`, `matchMedia` or
 * `navigator`. A component that reads one of them *during* render therefore
 * produces one tree on the server and a different one in the browser's first
 * pass, and React responds by throwing the server's HTML away and rebuilding
 * from scratch — "Minified React error #418", once per page load.
 *
 * It is a quiet failure and that is what makes it worth a test: the page still
 * works, so nobody notices, and the cost is paid by whichever reader had the
 * key set. `Landing` read `localStorage` in a `useState` initialiser to decide
 * whether to show a skeleton instead of the marketing hero — a flag whose
 * whole purpose was avoiding a flash, causing a much larger one.
 *
 * The rule is not "never touch these": it is "not while rendering". Inside a
 * `useEffect`, an event handler or a callback is correct and common here — see
 * `CurrencyProvider`, which adopts a stored currency in an effect and explains
 * why in the same words.
 */

const BROWSER_ONLY = /\b(localStorage|sessionStorage|matchMedia)\b/;

function componentFiles(): string[] {
  const dir = path.join(process.cwd(), "components");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => path.join("components", f));
}

/**
 * The initialiser of a `useState(() => …)`, which runs on the server too.
 *
 * Deliberately crude: it matches the arrow form only, because that is the one
 * that looks safe. `useState(localStorage.getItem(…))` would be a plain
 * expression and is caught by the same regex without the arrow.
 */
const LAZY_INIT = /useState\(\s*\(\)\s*=>\s*([\s\S]{0,400}?)\n\s*\);/g;

describe("no component reads a browser-only API while rendering", () => {
  test("there is something to check", () => {
    expect(componentFiles().length).toBeGreaterThan(20);
  });

  test.each(componentFiles())("%s", (file) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const offenders: string[] = [];

    for (const [, body] of source.matchAll(LAZY_INIT)) {
      if (BROWSER_ONLY.test(body)) offenders.push(body.trim().slice(0, 80));
    }

    expect(
      offenders,
      `${file} reads a browser-only API inside a useState initialiser, which runs on the ` +
        `server too — move it into a useEffect (see components/CurrencyProvider.tsx)`,
    ).toEqual([]);
  });
});
