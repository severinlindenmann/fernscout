import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B697 — `/agent` used to render its own `<main>` and nothing else: no way
 * back to the journal or the landing page beyond the browser's own back
 * button, which an installed PWA does not always have.
 *
 * B1121 split the one shared layout in two: `/agent` draws no frame of its
 * own any more (`HelperRoom` and `AgentDoor` each carry their own way back,
 * a chevron at the header's own edge rather than a second bar above the
 * whole page), and `app/agent/[user]/layout.tsx` keeps the original bar for
 * the wizard and its inbox, which draw no header of their own. Same style of
 * assertion as `test/docs-shell.test.tsx` (B470): what matters is that
 * something owns the way home on every page under `/agent`, not what a
 * render looks like pixel for pixel.
 */
function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("the agent shell", () => {
  test("the wizard's own layout links back to the site", () => {
    // At app/agent/[user]/layout.tsx, so it wraps both app/agent/[user]/page.tsx
    // (the wizard) and app/agent/[user]/inbox/page.tsx without either page
    // having to bring its own.
    const layout = read("app/agent/[user]/layout.tsx");
    // B1728: one step up, and for this frame that is `/agent` rather than
    // "/". Both pages it wraps sit under the helper, so the landing page was
    // never one level above them — it was just the only destination the old
    // control knew.
    expect(layout).toContain('<UpLink');
    expect(layout).toContain('href="/agent"');
  });

  test("the door draws its own way back, now that the shared frame does not", () => {
    const door = read("components/AgentDoor.tsx");
    // The door *is* `/agent`, so one level up really is the landing page.
    expect(door).toContain('<UpLink');
    expect(door).toContain('href="/"');
  });

  test("the room draws a chevron before the journal name, not a second bar", () => {
    const room = read("components/HelperRoom.tsx");
    expect(room).toContain('<UpLink');
    expect(room).toContain('href="/"');
    // Icon-only here and nowhere else — this is chrome on a full-height
    // conversation and the word would push the journal switcher off a phone.
    // The accessible name still says where it goes. B1728.
    expect(room).toContain("showLabel={false}");
  });
});
