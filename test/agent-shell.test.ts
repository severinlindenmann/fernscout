import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B697 — `/agent` used to render its own `<main>` and nothing else: no way
 * back to the journal or the landing page beyond the browser's own back
 * button, which an installed PWA does not always have.
 *
 * Same style of assertion as `test/docs-shell.test.tsx` (B470), for the same
 * reason: what matters is that a layout owns the way home for every page
 * under `/agent`, not what a render looks like pixel for pixel.
 */
function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("the agent shell", () => {
  test("a layout exists and links back to the site", () => {
    // At app/agent/layout.tsx, so it wraps every route under the segment —
    // both app/agent/page.tsx (the door) and app/agent/[user]/page.tsx (the
    // wizard) — without either page having to bring its own.
    const layout = read("app/agent/layout.tsx");
    // B822: the way home is `BackLink`'s fallback rather than a bare `<Link>`
    // now, so a reader who arrived at `/agent` from elsewhere in the app
    // retraces there instead of always landing on "/".
    expect(layout).toContain('fallbackHref="/"');
    expect(layout).toContain("docs.backToSite");
  });
});
