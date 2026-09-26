import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useOnline } from "@/components/studio/useOnline";

/**
 * B2372 — the plan page's composer read online/offline text from `useOnline()`
 * and rendered a hydration mismatch. Node 24 exposes a global `navigator`
 * with `navigator.onLine` left `undefined` (confirmed on this runtime), so
 * the old initializer — `typeof navigator === "undefined" ? true :
 * navigator.onLine` — took the second branch on the server and answered a
 * falsy value, while a real browser's `navigator.onLine` is `true` by
 * default. Server said "offline", browser said "online": the mismatch.
 *
 * This runs in vitest's default `node` environment (see vitest.config.ts),
 * which is exactly the runtime the bug needs — no jsdom, no stubbing.
 */
describe("useOnline on the server", () => {
  test("renders online even though this runtime's navigator.onLine is undefined", () => {
    expect(typeof navigator).toBe("object");
    expect(navigator.onLine).toBeUndefined();

    function Probe() {
      return <>{useOnline() ? "online" : "offline"}</>;
    }
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toBe("online");
  });
});
